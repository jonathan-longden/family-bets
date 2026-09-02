/**
 * Every setting comes from the environment, with defaults that work on a PC
 * on a home network. Nothing here is hard-coded into the clients: the app is
 * told an API endpoint and asks this server for the rest.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name, fallback) {
  const v = Number(env(name, fallback));
  if (!Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return v;
}

function bool(name, fallback) {
  const v = String(env(name, fallback)).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

const root = path.resolve(process.cwd());

/**
 * The signing secret for playback tickets. Persisted next to the database so
 * tickets survive a restart; generated on first run so nobody has to invent
 * one. Override with TELLY_SECRET in production.
 */
function secret(dataDir) {
  const fromEnv = env('TELLY_SECRET', '');
  if (fromEnv) return Buffer.from(fromEnv, 'utf8');
  const file = path.join(dataDir, 'secret.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  return null; // db/index.js writes one on first boot
}

const dataDir = path.resolve(env('TELLY_DATA_DIR', path.join(root, 'data')));

export const config = {
  env: env('NODE_ENV', 'development'),

  // Listening. 0.0.0.0 so a TV on the same network can reach the PC.
  host: env('TELLY_HOST', '0.0.0.0'),
  port: int('TELLY_PORT', 8443),

  // TLS. Point these at a certificate to serve HTTPS directly; behind a
  // reverse proxy on a VPS, leave them unset and terminate TLS there.
  tls: {
    certPath: env('TELLY_TLS_CERT', ''),
    keyPath: env('TELLY_TLS_KEY', ''),
    get enabled() { return Boolean(this.certPath && this.keyPath); }
  },
  // Behind nginx/Caddy this must be on so rate limiting sees real client IPs.
  trustProxy: bool('TELLY_TRUST_PROXY', 'false'),

  dataDir,
  dbPath: env('TELLY_DB', path.join(dataDir, 'telly.db')),
  secret: secret(dataDir),

  tokens: {
    accessTtlSeconds: int('TELLY_ACCESS_TTL', 60 * 30),          // 30 minutes
    refreshTtlSeconds: int('TELLY_REFRESH_TTL', 60 * 60 * 24 * 30), // 30 days
    ticketTtlSeconds: int('TELLY_TICKET_TTL', 60 * 5)            // 5 minutes
  },

  // redirect: the server hands the player the upstream URL and steps out of
  // the way. proxy: the server relays the bytes, so the upstream address
  // never reaches the device — at the cost of your bandwidth.
  streamMode: env('TELLY_STREAM_MODE', 'redirect'),

  rateLimit: {
    loginPerMinute: int('TELLY_RL_LOGIN', 10),
    apiPerMinute: int('TELLY_RL_API', 300)
  },

  // How long a cached playlist is served before the server refetches it.
  playlistTtlSeconds: int('TELLY_PLAYLIST_TTL', 60 * 60 * 6),

  defaults: {
    maxDevices: int('TELLY_DEFAULT_MAX_DEVICES', 2)
  }
};

export function newSecretHex() {
  return randomBytes(32).toString('hex');
}
