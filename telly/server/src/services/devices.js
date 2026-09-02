import { openDb, nowIso } from '../db/index.js';
import { deviceLimit, notFound } from '../lib/errors.js';

/**
 * A device is remembered by a key the client generates once and keeps. The
 * limit is counted over devices that still have a live session, so signing out
 * on the old television frees the slot without an administrator.
 */
export function registerDevice(userId, { key, name, platform, appVersion, ip }, maxDevices) {
  const db = openDb();
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM devices WHERE user_id = ? AND device_key = ?').get(userId, key);

  if (existing) {
    if (existing.revoked_at) throw notFound('This device has been removed from the account.');
    db.prepare('UPDATE devices SET name = ?, platform = ?, app_version = ?, last_seen_at = ?, last_ip = ? WHERE id = ?')
      .run(name || existing.name, platform || existing.platform, appVersion || existing.app_version, now, ip || '', existing.id);
    return db.prepare('SELECT * FROM devices WHERE id = ?').get(existing.id);
  }

  const active = db.prepare(`SELECT COUNT(DISTINCT d.id) AS n FROM devices d
      JOIN sessions s ON s.device_id = d.id
      WHERE d.user_id = ? AND d.revoked_at IS NULL AND s.revoked_at IS NULL
        AND s.refresh_expires_at > ?`).get(userId, now).n;
  if (active >= maxDevices) throw deviceLimit(maxDevices);

  const info = db.prepare(`INSERT INTO devices (user_id, device_key, name, platform, app_version, last_seen_at, last_ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, key, name || 'Device', platform || '', appVersion || '', now, ip || '', now);
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function listDevices(userId) {
  return openDb().prepare(`SELECT d.id, d.name, d.platform, d.app_version, d.last_seen_at, d.created_at, d.revoked_at,
      (SELECT COUNT(*) FROM sessions s WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.refresh_expires_at > ?) AS active_sessions
      FROM devices d WHERE d.user_id = ? ORDER BY d.created_at`).all(nowIso(), userId);
}

export function revokeDevice(userId, deviceId) {
  const db = openDb();
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ?').run(now, deviceId, userId);
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(now, deviceId);
  });
  tx();
}

export function touch(deviceId, ip) {
  openDb().prepare('UPDATE devices SET last_seen_at = ?, last_ip = ? WHERE id = ?').run(nowIso(), ip || '', deviceId);
}
