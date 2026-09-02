/**
 * Opaque tokens. The client holds a random string; the database holds only its
 * SHA-256, so a copy of the database is not a set of working logins. Being
 * opaque rather than a JWT also means revoking one is a single UPDATE.
 */
import { randomBytes, createHash } from 'node:crypto';

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function expiryFrom(seconds, from = new Date()) {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

export function isExpired(iso, now = new Date()) {
  if (!iso) return true;
  const t = Date.parse(iso);
  return !Number.isFinite(t) || t <= now.getTime();
}
