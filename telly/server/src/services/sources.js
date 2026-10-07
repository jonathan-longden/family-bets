import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { parseM3u } from './m3u.js';
import { loadXtream } from './xtream.js';
import { badRequest, notFound, upstreamFailed } from '../lib/errors.js';
import { forgetSourceCatalogue } from './catalogue.js';
import { instanceAllowed, hostOf, publicSettings, sourceSettings } from './peertube.js';

/**
 * An IPTV source belongs to the operator. Its credentials live here and are
 * used only by this process; clients receive channels, never addresses.
 */
export function createSource({ name, kind, url = '', username = '', password = '', epgUrl = '',
                               refreshIntervalSeconds, settings = null } = {}) {
  if (!['m3u_url', 'm3u_text', 'xtream', 'peertube'].includes(kind)) {
    throw badRequest('kind must be m3u_url, m3u_text, xtream or peertube.');
  }
  if (!String(name || '').trim()) throw badRequest('A source needs a name.');

  /* A PeerTube instance has to be one Telly is willing to ask. The check is
     here as well as at import time: refusing at the point of adding is the
     only way an operator finds out before a sync reports nothing. */
  if (kind === 'peertube') {
    if (!String(url || '').trim()) throw badRequest('A PeerTube source needs the instance address.');
    if (!instanceAllowed(url)) {
      throw badRequest(`${hostOf(url) || 'That host'} is not on Telly's PeerTube allowlist. ` +
        'Set TELLY_PEERTUBE_HOSTS to change which instances may be added.');
    }
  }

  const now = nowIso();
  const info = openDb().prepare(`INSERT INTO sources
      (name, kind, url, username, password, epg_url, refresh_interval_seconds, settings,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(name).trim(), kind, url, username, password, epgUrl,
         Number(refreshIntervalSeconds) || config.playlistTtlSeconds,
         settings ? JSON.stringify(settings) : '', now, now);
  return getSource(Number(info.lastInsertRowid));
}

/**
 * Change a source without touching its channels. Turning one off hides it from
 * every client immediately; its channels stay in the catalogue so turning it
 * back on is instant rather than another download.
 */
export function updateSource(id, patch = {}) {
  const row = getSource(id);
  const next = {
    name: patch.name === undefined ? row.name : String(patch.name).trim(),
    url: patch.url === undefined ? row.url : String(patch.url).trim(),
    username: patch.username === undefined ? row.username : String(patch.username),
    password: patch.password === undefined ? row.password : String(patch.password),
    epgUrl: patch.epgUrl === undefined ? row.epg_url : String(patch.epgUrl).trim(),
    enabled: patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0),
    interval: patch.refreshIntervalSeconds === undefined
      ? row.refresh_interval_seconds
      : Math.max(Number(patch.refreshIntervalSeconds) || 0, 60),
    settings: patch.settings === undefined ? row.settings : JSON.stringify(patch.settings || {})
  };
  if (!next.name) throw badRequest('A source needs a name.');
  /* Re-pointing a PeerTube source is still adding an instance, so it faces
     the same allowlist. */
  if (row.kind === 'peertube' && next.url !== row.url && !instanceAllowed(next.url)) {
    throw badRequest(`${hostOf(next.url) || 'That host'} is not on Telly's PeerTube allowlist.`);
  }
  openDb().prepare(`UPDATE sources SET name = ?, url = ?, username = ?, password = ?, epg_url = ?,
      enabled = ?, refresh_interval_seconds = ?, settings = ?, updated_at = ? WHERE id = ?`)
    .run(next.name, next.url, next.username, next.password, next.epgUrl,
         next.enabled, next.interval, next.settings, nowIso(), id);
  return getSource(id);
}

/**
 * Remove a source, and everything it was the only carrier of.
 *
 * Its channels go with the row, as they always have. Its catalogue entries go
 * too, which matters for an Xtream panel: a film whose only address needs a
 * subscription that has just been removed cannot be played by anybody, so
 * leaving it in Movies would be leaving a ghost. A film the household also
 * has on disk keeps its card and loses one way to play.
 */
export function deleteSource(id) {
  getSource(id);
  const forgotten = forgetSourceCatalogue(id);
  openDb().prepare('DELETE FROM sources WHERE id = ?').run(id);
  return forgotten;
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
    refreshIntervalSeconds: s.refresh_interval_seconds,
    lastSyncedAt: s.last_synced_at, lastAttemptAt: s.last_attempt_at,
    lastError: s.last_error, failCount: s.fail_count, channelCount: s.channel_count,
    builtin: s.builtin || null,
    lastHealthAt: s.last_health_at,
    lastImport: {
      added: s.last_import_added, updated: s.last_import_updated, removed: s.last_import_removed
    },
    /* What this instance has been told to take, and whether Telly is still
       willing to ask it — an allowlist can be tightened after a source was
       added, and the admin screen should say so rather than the next sync
       quietly importing nothing. */
    ...(s.kind === 'peertube' ? { peertube: publicSettings(s) } : {})
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

/**
 * Syncing a PeerTube instance: the catalogue importer, for this provider.
 *
 * It runs the provider rather than this one source, because that is where the
 * politeness, the retries, the run record and the figures live — and the
 * importer already walks every enabled instance. A sync asked for from one
 * source's row therefore reads them all, which is the same thing the Refresh
 * button on the provider does, and the result says what was imported.
 */
async function syncPeertube(source, { fetchImpl = fetch } = {}) {
  const { providerByKey } = await import('./providers/index.js');
  const { runImport } = await import('./importer.js');
  const provider = providerByKey('peertube');
  if (!provider) throw upstreamFailed('The PeerTube provider is not registered.');
  if (!provider.enabled) {
    throw badRequest('The PeerTube provider is switched off. Turn it on in ' +
      'Settings → Catalogue providers, then sync.');
  }

  const got = await runImport(provider.id, { fetchImpl });
  const run = (got && got.run) || {};
  const at = nowIso();
  openDb().prepare(`UPDATE sources SET last_synced_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?`)
    .run(at, run.status === 'failed' ? String(run.message || 'Import failed') : null, at, source.id);

  return {
    source: getSource(source.id),
    /* No channels were added, and saying so plainly is better than a zero
       that looks like a failure. */
    added: 0, updated: 0, removed: 0, total: 0,
    catalogue: run
  };
}

/** Fetches the source and replaces its cached channels in one transaction. */
export async function syncSource(sourceId, { fetchImpl = fetch, text = null } = {}) {
  const db = openDb();
  const source = getSource(sourceId);
  let parsed;

  /* A PeerTube instance has no channels — it is a library of films, and
     syncing it means running the catalogue import that reads it. Routed here
     so that one Sync button does the right thing for whichever kind of source
     the operator is looking at, rather than this kind needing its own. */
  if (source.kind === 'peertube') return syncPeertube(source, { fetchImpl });

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
  let added = 0, updated = 0;

  /**
   * Upserted on the stream address, which is what actually identifies a
   * stream: a group title is the publisher's filing and changes between
   * refreshes without the channel changing at all. So a refresh updates the
   * row that is already there — keeping its id, and with it the favourites,
   * the health history and anything else hanging off it — rather than making
   * a second one.
   */
  const tx = db.transaction(() => {
    const find = db.prepare('SELECT id FROM channels WHERE source_id = ? AND source_key = ?');
    const ins = db.prepare(`INSERT INTO channels
        (source_id, source_key, ext_id, kind, number, name, name_key, group_title, logo,
         tvg_id, tvg_name, country, language, stream_url, active, first_seen_at, last_seen_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
    const upd = db.prepare(`UPDATE channels SET
        ext_id = ?, kind = ?, number = ?, name = ?, name_key = ?, group_title = ?, logo = ?,
        tvg_id = ?, tvg_name = ?, country = ?, language = ?, stream_url = ?,
        active = 1, last_seen_at = ? WHERE id = ?`);

    for (const c of parsed.channels) {
      const key = c.url;
      const row = find.get(sourceId, key);
      if (row) {
        upd.run(c.extId, c.kind, c.number, c.name, c.name.toLowerCase(), c.group, c.logo,
                c.tvgId, c.tvgName || '', c.country || '', c.language || '', c.url, now, row.id);
        updated++;
      } else {
        ins.run(sourceId, key, c.extId, c.kind, c.number, c.name, c.name.toLowerCase(), c.group, c.logo,
                c.tvgId, c.tvgName || '', c.country || '', c.language || '', c.url, now, now, now);
        added++;
      }
    }

    /* A channel that is no longer in the playlist is marked inactive, not
       deleted. Playlists drop channels for an afternoon and bring them back;
       deleting one would lose whoever had favourited it. */
    const removed = db.prepare(`UPDATE channels SET active = 0
        WHERE source_id = ? AND last_seen_at <> ? AND active = 1`).run(sourceId, now).changes;

    const live = db.prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ? AND active = 1')
      .get(sourceId).n;
    db.prepare(`UPDATE sources SET last_synced_at = ?, last_error = NULL, channel_count = ?,
        last_import_added = ?, last_import_updated = ?, last_import_removed = ?,
        epg_url = COALESCE(NULLIF(?, ''), epg_url), updated_at = ? WHERE id = ?`)
      .run(now, live, added, updated, removed, parsed.epgUrl || '', now, sourceId);
    syncSource.lastRemoved = removed;
  });
  tx();

  return {
    channels: parsed.channels.length,
    added, updated, deactivated: syncSource.lastRemoved || 0,
    syncedAt: now
  };
}

/** True when a source has never synced, or its cache has gone stale. */
export function needsSync(source) {
  if (!source.last_synced_at) return true;
  const age = (Date.now() - Date.parse(source.last_synced_at)) / 1000;
  return age > config.playlistTtlSeconds;
}

/**
 * The playlists Telly can set up for you: the iptv-org country lists, fetched
 * live so a change upstream arrives on the next refresh. Nothing is copied
 * into this repository, and these are public free-to-air and free
 * ad-supported streams only — there is no subscription to put here.
 *
 * `enable` is the exact set that should be on: a list names the ones wanted
 * and switches the rest off, so the settings screen can send what it shows
 * and get that. Omitting it means "all of them", for a first run. An empty
 * list therefore means none, which is why it is not the default.
 *
 * It is keyed on `builtin`, not on the URL, so running this twice adopts the
 * row that is already there, and a file iptv-org moves corrects that row
 * rather than adding a second source beside it — favourites and health
 * history stay with it.
 */
export function ensureBuiltinSources({ enable = null } = {}) {
  const db = openDb();
  const out = [];
  const exact = Array.isArray(enable);
  for (const def of config.builtinSources) {
    const wanted = !exact || enable.includes(def.key);
    let row = db.prepare('SELECT * FROM sources WHERE builtin = ?').get(def.key);
    if (!row) {
      if (!wanted) continue;
      const created = createSource({ name: def.name, kind: 'm3u_url', url: def.url });
      db.prepare('UPDATE sources SET builtin = ? WHERE id = ?').run(def.key, created.id);
      row = getSource(created.id);
    } else if (row.url !== def.url) {
      // iptv-org moving a file should not mean a second source.
      db.prepare('UPDATE sources SET url = ?, updated_at = ? WHERE id = ?').run(def.url, nowIso(), row.id);
      row = getSource(row.id);
    }
    if (exact) {
      db.prepare('UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?')
        .run(wanted ? 1 : 0, nowIso(), row.id);
      row = getSource(row.id);
    }
    out.push(row);
  }
  return out;
}

/** The built-in definitions, whether or not they have been set up yet. */
export function builtinCatalogue() {
  const db = openDb();
  return config.builtinSources.map(def => {
    const row = db.prepare('SELECT * FROM sources WHERE builtin = ?').get(def.key);
    return {
      key: def.key, name: def.name, url: def.url,
      installed: Boolean(row),
      sourceId: row ? row.id : null,
      enabled: row ? Boolean(row.enabled) : false
    };
  });
}
