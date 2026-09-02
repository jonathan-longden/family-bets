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

export function channels(userId, { kind = 'live', group = null, search = null, limit = 500, offset = 0 } = {}) {
  const ids = assignedIds(userId);
  if (!ids.length) return { total: 0, items: [] };

  const where = [`source_id IN (${placeholders(ids.length)})`, 'kind = ?'];
  const args = [...ids, kind];
  if (group) { where.push('group_title = ?'); args.push(group); }
  if (search) { where.push('name_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }

  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM channels WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT id, source_id, ext_id, kind, number, name, group_title, logo, tvg_id
      FROM channels WHERE ${where.join(' AND ')}
      ORDER BY number, name LIMIT ? OFFSET ?`).all(...args, Math.min(Number(limit) || 500, 2000), Number(offset) || 0);

  return { total, items: rows.map(publicChannel) };
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
    kind: row.kind,
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
