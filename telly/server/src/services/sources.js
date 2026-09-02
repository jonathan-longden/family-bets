import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { parseM3u } from './m3u.js';
import { loadXtream } from './xtream.js';
import { badRequest, notFound, upstreamFailed } from '../lib/errors.js';

/**
 * An IPTV source belongs to the operator. Its credentials live here and are
 * used only by this process; clients receive channels, never addresses.
 */
export function createSource({ name, kind, url = '', username = '', password = '', epgUrl = '' }) {
  if (!['m3u_url', 'm3u_text', 'xtream'].includes(kind)) throw badRequest('kind must be m3u_url, m3u_text or xtream.');
  if (!String(name || '').trim()) throw badRequest('A source needs a name.');
  const now = nowIso();
  const info = openDb().prepare(`INSERT INTO sources (name, kind, url, username, password, epg_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(String(name).trim(), kind, url, username, password, epgUrl, now, now);
  return getSource(Number(info.lastInsertRowid));
}

export function getSource(id) {
  const row = openDb().prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) throw notFound('No such source.');
  return row;
}

export function listSources() {
  return openDb().prepare('SELECT * FROM sources ORDER BY name').all();
}

/** What an admin client may see: everything except the upstream password. */
export function publicSource(s) {
  return {
    id: s.id, name: s.name, kind: s.kind, url: s.url, username: s.username,
    hasPassword: Boolean(s.password), epgUrl: s.epg_url, enabled: Boolean(s.enabled),
    lastSyncedAt: s.last_synced_at, lastError: s.last_error, channelCount: s.channel_count
  };
}

export function assign(userId, sourceId) {
  openDb().prepare('INSERT OR IGNORE INTO user_sources (user_id, source_id, created_at) VALUES (?, ?, ?)')
    .run(userId, sourceId, nowIso());
}

export function unassign(userId, sourceId) {
  openDb().prepare('DELETE FROM user_sources WHERE user_id = ? AND source_id = ?').run(userId, sourceId);
}

export function sourcesForUser(userId) {
  return openDb().prepare(`SELECT s.* FROM sources s
      JOIN user_sources us ON us.source_id = s.id
      WHERE us.user_id = ? AND s.enabled = 1 ORDER BY s.name`).all(userId);
}

/** Fetches the source and replaces its cached channels in one transaction. */
export async function syncSource(sourceId, { fetchImpl = fetch, text = null } = {}) {
  const db = openDb();
  const source = getSource(sourceId);
  let parsed;

  try {
    if (source.kind === 'xtream') {
      parsed = await loadXtream({ host: source.url, username: source.username, password: source.password }, fetchImpl);
    } else if (source.kind === 'm3u_url') {
      let res;
      try { res = await fetchImpl(source.url, { headers: { 'user-agent': 'Telly-Server/1.0' } }); }
      catch (e) { throw upstreamFailed(`Could not reach that playlist: ${e.message}`); }
      if (!res.ok) throw upstreamFailed(`The playlist server replied ${res.status} ${res.statusText}.`);
      parsed = parseM3u(await res.text());
    } else {
      if (text == null) throw badRequest('An m3u_text source needs its text supplying.');
      parsed = parseM3u(text);
    }
  } catch (e) {
    db.prepare('UPDATE sources SET last_error = ?, updated_at = ? WHERE id = ?')
      .run(e.message || String(e), nowIso(), sourceId);
    throw e;
  }

  if (!parsed.channels.length) {
    const msg = 'That source returned no channels.';
    db.prepare('UPDATE sources SET last_error = ?, updated_at = ? WHERE id = ?').run(msg, nowIso(), sourceId);
    throw upstreamFailed(msg);
  }

  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM channels WHERE source_id = ?').run(sourceId);
    const ins = db.prepare(`INSERT INTO channels
        (source_id, ext_id, kind, number, name, name_key, group_title, logo, tvg_id, stream_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of parsed.channels) {
      ins.run(sourceId, c.extId, c.kind, c.number, c.name, c.name.toLowerCase(), c.group, c.logo, c.tvgId, c.url, now);
    }
    db.prepare(`UPDATE sources SET last_synced_at = ?, last_error = NULL, channel_count = ?, epg_url = COALESCE(NULLIF(?, ''), epg_url), updated_at = ?
                WHERE id = ?`)
      .run(now, parsed.channels.length, parsed.epgUrl || '', now, sourceId);
  });
  tx();

  return { channels: parsed.channels.length, syncedAt: now };
}

/** True when a source has never synced, or its cache has gone stale. */
export function needsSync(source) {
  if (!source.last_synced_at) return true;
  const age = (Date.now() - Date.parse(source.last_synced_at)) / 1000;
  return age > config.playlistTtlSeconds;
}
