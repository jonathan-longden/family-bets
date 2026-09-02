import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, newSecretHex } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db;

export function openDb(dbPath = config.dbPath) {
  if (db) return db;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  ensureSecret();
  return db;
}

/** Applied migrations are recorded, so a later 002_*.sql runs exactly once. */
function migrate(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(database.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const dir = path.join(here, 'migrations');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    database.exec('BEGIN');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
      database.exec('COMMIT');
    } catch (e) {
      database.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
  }
}

/** A signing key for playback tickets, made once and kept beside the database. */
function ensureSecret() {
  if (config.secret) return;
  const file = path.join(config.dataDir, 'secret.key');
  if (!existsSync(file)) {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(file, newSecretHex(), { mode: 0o600 });
  }
  config.secret = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
}

export function closeDb() {
  if (db) { db.close(); db = undefined; }
}

export function nowIso() { return new Date().toISOString(); }
