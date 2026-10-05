import { openDb } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';

/**
 * Reading the catalogue. Every query is scoped by the user's assigned sources,
 * so entitlement is enforced in SQL rather than remembered by a caller.
 */
function assignedIds(userId) {
  return openDb().prepare(`SELECT s.id FROM sources s JOIN user_sources us ON us.source_id = s.id
      WHERE us.user_id = ? AND s.enabled = 1`).all(userId).map(r => r.id);
}

function placeholders(n) { return new Array(n).fill('?').join(','); }

export function categories(userId, kind = 'live') {
  const ids = assignedIds(userId);
  if (!ids.length) return [];
  return openDb().prepare(`SELECT group_title AS name, COUNT(*) AS count FROM channels
      WHERE source_id IN (${placeholders(ids.length)}) AND kind = ?
      GROUP BY group_title ORDER BY group_title`).all(...ids, kind);
}

const SORTS = {
  number: 'number, name',
  name: 'name_key, number',
  group: 'group_title, number, name',
  country: 'country, number, name',
  recent: 'first_seen_at DESC, name'
};

/**
 * The channels a user may see.
 *
 * Three filters are on by default and are the reason a public playlist is
 * usable at all: a channel that has left the playlist (`active`), a channel
 * this person has hidden, and — once a source has been checked — a channel
 * whose stream does not work. `health: 'any'` turns the last one off, which
 * is what the settings screen uses to show what is failing.
 */
export function channels(userId, { kind = 'live', group = null, search = null,
                                   country = null, language = null, health = 'playable',
                                   includeInactive = false, includeHidden = false,
                                   sort = 'number', limit = 500, offset = 0 } = {}) {
  const ids = assignedIds(userId);
  if (!ids.length) return { total: 0, items: [] };

  const where = [`source_id IN (${placeholders(ids.length)})`];
  const args = [...ids];
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (group) { where.push('group_title = ?'); args.push(group); }
  if (search) { where.push('name_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }
  if (country) { where.push('country = ?'); args.push(String(country)); }
  if (language) { where.push('language = ?'); args.push(String(language)); }
  if (!includeInactive) where.push('active = 1');
  if (!includeHidden) {
    where.push('id NOT IN (SELECT channel_id FROM hidden_channels WHERE user_id = ?)');
    args.push(userId);
  }
  /* 'playable' keeps anything not yet known to be broken: a library that has
     never been checked is shown in full rather than hidden wholesale. */
  if (health === 'playable') where.push("health_status IN ('working', 'unchecked', 'temporarily_unavailable')");
  else if (health === 'working') where.push("health_status = 'working'");
  else if (health === 'failed') where.push("health_status IN ('failed', 'temporarily_unavailable')");

  const order = SORTS[sort] || SORTS.number;
  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM channels WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM channels WHERE ${where.join(' AND ')}
      ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Number(limit) || 500, 2000), Number(offset) || 0);

  return { total, items: rows.map(publicChannel) };
}

export function oneChannel(userId, channelId) {
  const row = entitledChannel(userId, channelId);
  return publicChannel(row);
}

/* Hiding is a person's own: it never changes what anybody else sees. */
export function hideChannel(userId, channelId, hidden = true) {
  entitledChannel(userId, channelId);
  const db = openDb();
  if (hidden) {
    db.prepare('INSERT OR IGNORE INTO hidden_channels (user_id, channel_id, created_at) VALUES (?, ?, ?)')
      .run(userId, channelId, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM hidden_channels WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  }
}

export function hiddenChannelIds(userId) {
  return openDb().prepare('SELECT channel_id FROM hidden_channels WHERE user_id = ?')
    .all(userId).map(r => r.channel_id);
}

/** The countries and languages a user's channels actually declare. */
export function facets(userId, column) {
  if (!['country', 'language'].includes(column)) return [];
  const ids = assignedIds(userId);
  if (!ids.length) return [];
  return openDb().prepare(`SELECT ${column} AS name, COUNT(*) AS count FROM channels
      WHERE source_id IN (${placeholders(ids.length)}) AND ${column} <> ''
      GROUP BY ${column} ORDER BY count DESC, ${column}`).all(...ids);
}

/** Every tvg-id a user's channels carry, for matching against a guide. */
export function tvgIdsFor(userId) {
  const ids = assignedIds(userId);
  if (!ids.length) return [];
  return openDb().prepare(`SELECT DISTINCT tvg_id FROM channels
      WHERE source_id IN (${placeholders(ids.length)}) AND tvg_id <> ''`).all(...ids).map(r => r.tvg_id);
}

/**
 * An M3U built back out of SQLite. The catalogue is the source of truth and
 * this is the interchange format, so a playlist that went through three
 * sources, a de-duplication and a rename comes back out as one file any other
 * player can open.
 *
 * It carries real stream addresses, which is the point of an export and the
 * reason it is an admin action rather than something a client may fetch.
 */
export function exportM3u({ sourceId = null, kind = null } = {}) {
  const where = [], args = [];
  if (sourceId) { where.push('source_id = ?'); args.push(Number(sourceId)); }
  if (kind) { where.push('kind = ?'); args.push(String(kind)); }
  const rows = openDb().prepare(`SELECT * FROM channels
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY source_id, number, name`).all(...args);

  const q = (v) => String(v == null ? '' : v).replace(/"/g, "'");
  const out = ['#EXTM3U'];
  for (const c of rows) {
    const bits = [`#EXTINF:-1 tvg-id="${q(c.tvg_id)}"`, `tvg-name="${q(c.name)}"`, `tvg-logo="${q(c.logo)}"`];
    if (c.country) bits.push(`tvg-country="${q(c.country)}"`);
    if (c.language) bits.push(`tvg-language="${q(c.language)}"`);
    bits.push(`group-title="${q(c.group_title)}"`);
    out.push(bits.join(' ') + ',' + String(c.name).replace(/[\r\n]+/g, ' '));
    out.push(c.stream_url);
  }
  return out.join('\n') + '\n';
}

/**
 * One search across everything the server holds: channels the user may see,
 * and the personal library, which is the server's own and not per-source.
 */
export function searchAll(userId, term, { limit = 20 } = {}) {
  const q = String(term || '').trim();
  if (q.length < 2) return { channels: [], movies: [], series: [], recordings: [] };
  const like = `%${q.toLowerCase()}%`;
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const db = openDb();
  const ids = assignedIds(userId);

  const chans = ids.length
    ? db.prepare(`SELECT id, source_id, ext_id, kind, number, name, group_title, logo, tvg_id, country, language
        FROM channels WHERE source_id IN (${placeholders(ids.length)}) AND name_key LIKE ?
        ORDER BY name LIMIT ?`).all(...ids, like, n).map(publicChannel)
    : [];

  return {
    channels: chans,
    /* Only what could actually be played: a row whose file is missing is kept
       but not offered, the same rule the catalogue listings follow. */
    movies: db.prepare(`SELECT * FROM movies WHERE title_key LIKE ? AND missing_since IS NULL
        ORDER BY title_key LIMIT ?`).all(like, n),
    series: db.prepare(`SELECT * FROM series s WHERE s.title_key LIKE ?
        AND EXISTS (SELECT 1 FROM episodes e WHERE e.series_id = s.id AND e.missing_since IS NULL)
        ORDER BY s.title_key LIMIT ?`).all(like, n),
    recordings: db.prepare(`SELECT * FROM recordings WHERE title_key LIKE ? AND missing_since IS NULL
        ORDER BY title_key LIMIT ?`).all(like, n)
  };
}

/** The client's view of a channel: no stream_url, ever. */
export function publicChannel(row) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    group: row.group_title,
    logo: row.logo,
    tvgId: row.tvg_id,
    tvgName: row.tvg_name || '',
    country: row.country || '',
    language: row.language || '',
    kind: row.kind,
    active: row.active === undefined ? true : Boolean(row.active),
    /* Said plainly, so a client can show a channel it knows is off rather
       than silently dropping it. */
    health: row.health_status || 'unchecked',
    lastCheckedAt: row.last_checked_at || null,
    lastSuccessAt: row.last_success_at || null,
    failureReason: row.failure_reason || '',
    playback: `/api/v1/stream/${row.id}`
  };
}

/** Resolves a channel the user is actually entitled to, or refuses. */
export function entitledChannel(userId, channelId) {
  const row = openDb().prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!row) throw notFound('No such channel.');
  const allowed = openDb().prepare('SELECT 1 FROM user_sources WHERE user_id = ? AND source_id = ?')
    .get(userId, row.source_id);
  if (!allowed) throw forbidden('That channel is not part of your subscription.');
  return row;
}
