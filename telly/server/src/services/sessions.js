import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { newToken, hashToken, expiryFrom, isExpired } from '../lib/tokens.js';
import { sessionExpired } from '../lib/errors.js';

export function issueSession(userId, deviceId) {
  const db = openDb();
  const access = newToken();
  const refresh = newToken();
  const now = nowIso();
  db.prepare(`INSERT INTO sessions
      (user_id, device_id, access_hash, refresh_hash, access_expires_at, refresh_expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, deviceId, hashToken(access), hashToken(refresh),
         expiryFrom(config.tokens.accessTtlSeconds), expiryFrom(config.tokens.refreshTtlSeconds), now);
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresIn: config.tokens.accessTtlSeconds,
    refreshExpiresIn: config.tokens.refreshTtlSeconds
  };
}

/** The session row for a token, valid or not — the caller decides what to say. */
export function findByAccess(token) {
  return openDb().prepare('SELECT * FROM sessions WHERE access_hash = ?').get(hashToken(token || '')) || null;
}

export function isUsable(row) {
  return Boolean(row) && !row.revoked_at && !isExpired(row.access_expires_at);
}

/** Resolves a bearer token to its session, or throws the expiry the app can act on. */
export function sessionForAccess(token) {
  const row = findByAccess(token);
  if (!isUsable(row)) throw sessionExpired();
  return row;
}

/** Refresh rotates both tokens: a stolen refresh token is good once, at most. */
export function rotate(refreshToken) {
  const db = openDb();
  const row = db.prepare('SELECT * FROM sessions WHERE refresh_hash = ?').get(hashToken(refreshToken || ''));
  if (!row || row.revoked_at || isExpired(row.refresh_expires_at)) throw sessionExpired();
  const now = nowIso();
  const access = newToken();
  const refresh = newToken();
  db.prepare(`UPDATE sessions SET access_hash = ?, refresh_hash = ?, access_expires_at = ?, refresh_expires_at = ?
              WHERE id = ?`)
    .run(hashToken(access), hashToken(refresh), expiryFrom(config.tokens.accessTtlSeconds),
         expiryFrom(config.tokens.refreshTtlSeconds), row.id);
  return {
    session: row,
    tokens: {
      accessToken: access, refreshToken: refresh,
      expiresIn: config.tokens.accessTtlSeconds, refreshExpiresIn: config.tokens.refreshTtlSeconds
    },
    now
  };
}

export function revoke(sessionId) {
  openDb().prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), sessionId);
}

export function revokeAllForUser(userId) {
  openDb().prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
}
