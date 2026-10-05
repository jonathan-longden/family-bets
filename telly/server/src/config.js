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
  // A source may set its own interval; this is the default for one that does not.
  playlistTtlSeconds: int('TELLY_PLAYLIST_TTL', 60 * 60 * 6),

  // The background refresher: playlists and guides on their own intervals.
  // Set TELLY_REFRESH_INTERVAL to 0 to turn it off and refresh by hand.
  refresh: {
    tickSeconds: int('TELLY_REFRESH_INTERVAL', 300),
    get enabled() { return this.tickSeconds > 0; },
    // After a failure a source is left alone for a while rather than hammered,
    // and its channels are kept: an upstream having a bad hour is not a reason
    // to empty somebody's television.
    backoffSeconds: int('TELLY_REFRESH_BACKOFF', 900),
    maxBackoffSeconds: int('TELLY_REFRESH_MAX_BACKOFF', 60 * 60 * 6)
  },

  // Personal media. Scanning walks the folders in media_roots; this is only
  // how often, and whether a scan runs at all on a timer.
  media: {
    scanIntervalSeconds: int('TELLY_SCAN_INTERVAL', 60 * 60),
    get scanEnabled() { return this.scanIntervalSeconds > 0; }
  },

  // FFmpeg is optional. Without it everything a browser can open still plays
  // directly from disk; with it, the containers a browser cannot open are
  // remuxed on the way out.
  ffmpeg: {
    path: env('TELLY_FFMPEG', 'ffmpeg'),
    enabled: bool('TELLY_FFMPEG_ENABLED', 'true'),
    videoCodec: env('TELLY_FFMPEG_VCODEC', 'libx264'),
    preset: env('TELLY_FFMPEG_PRESET', 'veryfast'),
    crf: int('TELLY_FFMPEG_CRF', 23)
  },

  defaults: {
    maxDevices: int('TELLY_DEFAULT_MAX_DEVICES', 2)
  }
};

export function newSecretHex() {
  return randomBytes(32).toString('hex');
}
