import { openDb, nowIso } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { accountDisabled, accountExpired, badRequest, invalidCredentials, notFound } from '../lib/errors.js';

export const SECTIONS = ['live', 'guide', 'movies', 'series', 'favourites', 'recent', 'catchup', 'recordings', 'settings'];

const DEFAULT_SECTIONS = ['live', 'guide', 'movies', 'series', 'favourites', 'recent', 'settings'];

export async function createUser({ username, password, role = 'user', displayName = '', maxDevices, expiresAt = null, sections = DEFAULT_SECTIONS }) {
  const db = openDb();
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(name))
    throw badRequest('A username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
  if (role !== 'user' && role !== 'admin') throw badRequest('Role must be user or admin.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) throw badRequest('That username is taken.');

  const pw = await hashPassword(password);
  const now = nowIso();
  const info = db.prepare(`INSERT INTO users
      (username, display_name, password_hash, password_salt, password_algo, role, enabled, expires_at, max_devices, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
    .run(name, displayName || name, pw.hash, pw.salt, pw.algo, role,
         expiresAt, maxDevices ?? (await import('../config.js')).config.defaults.maxDevices, now, now);

  const id = Number(info.lastInsertRowid);
  setSections(id, sections);
  return getUser(id);
}

export function getUser(id) {
  const db = openDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw notFound('No such user.');
  return row;
}

export function findByUsername(username) {
  return openDb().prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

export function setSections(userId, sections) {
  const db = openDb();
  const wanted = new Set((sections || []).filter(s => SECTIONS.includes(s)));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_sections WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO user_sections (user_id, section, enabled) VALUES (?, ?, ?)');
    for (const s of SECTIONS) ins.run(userId, s, wanted.has(s) ? 1 : 0);
  });
  tx();
}

export function sectionsFor(userId) {
  const rows = openDb().prepare('SELECT section, enabled FROM user_sections WHERE user_id = ?').all(userId);
  const out = {};
  for (const s of SECTIONS) out[s] = false;
  for (const r of rows) out[r.section] = Boolean(r.enabled);
  return out;
}

/** The account checks that apply on every sign-in and every refresh. */
export function assertUsable(user) {
  if (!user) throw invalidCredentials();
  if (!user.enabled) throw accountDisabled();
  if (user.expires_at && Date.parse(user.expires_at) <= Date.now()) throw accountExpired();
  return user;
}

export async function authenticate(username, password) {
  const user = findByUsername(username);
  // Hash regardless, so a missing username and a wrong password take the
  // same time and cannot be told apart by anybody watching the clock.
  const stored = user
    ? { hash: user.password_hash, salt: user.password_salt }
    : { hash: '00'.repeat(64), salt: '16384$8$1$' + '00'.repeat(16) };
  const ok = await verifyPassword(password, stored);
  if (!user || !ok) throw invalidCredentials();
  return assertUsable(user);
}

export async function setPassword(userId, password) {
  const pw = await hashPassword(password);
  openDb().prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ? WHERE id = ?')
    .run(pw.hash, pw.salt, pw.algo, nowIso(), userId);
}

export function setEnabled(userId, enabled) {
  openDb().prepare('UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, nowIso(), userId);
}

export function listUsers() {
  return openDb().prepare(`SELECT id, username, display_name, role, enabled, expires_at, max_devices, created_at
                           FROM users ORDER BY username`).all();
}

/** What the client is told about itself. Never the password columns. */
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    expiresAt: user.expires_at,
    maxDevices: user.max_devices
  };
}
