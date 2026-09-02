import { openDb, nowIso } from '../db/index.js';
import { entitledChannel, publicChannel } from './library.js';

/** Favourites, recently watched and settings: per user, on the server. */

export function favourites(userId) {
  return openDb().prepare(`SELECT c.* FROM favourites f JOIN channels c ON c.id = f.channel_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(userId).map(publicChannel);
}

export function addFavourite(userId, channelId) {
  entitledChannel(userId, channelId);
  openDb().prepare('INSERT OR IGNORE INTO favourites (user_id, channel_id, created_at) VALUES (?, ?, ?)')
    .run(userId, channelId, nowIso());
}

export function removeFavourite(userId, channelId) {
  openDb().prepare('DELETE FROM favourites WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
}

export function recent(userId, limit = 24) {
  return openDb().prepare(`SELECT c.*, r.watched_at FROM recently_watched r JOIN channels c ON c.id = r.channel_id
      WHERE r.user_id = ? ORDER BY r.watched_at DESC LIMIT ?`).all(userId, Math.min(Number(limit) || 24, 100))
    .map(row => ({ ...publicChannel(row), watchedAt: row.watched_at }));
}

export function markWatched(userId, channelId, positionMs = 0) {
  entitledChannel(userId, channelId);
  openDb().prepare(`INSERT INTO recently_watched (user_id, channel_id, watched_at, position_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET watched_at = excluded.watched_at, position_ms = excluded.position_ms`)
    .run(userId, channelId, nowIso(), Number(positionMs) || 0);
}

export function settings(userId) {
  const rows = openDb().prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);
  const out = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
  return out;
}

export function putSettings(userId, patch) {
  const db = openDb();
  const stmt = db.prepare(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`);
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) continue;
      stmt.run(userId, k, JSON.stringify(v));
    }
  });
  tx();
  return settings(userId);
}
