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

  // Personal media. Scanning walks the folders in media_folders; this is only
  // how often, and whether a scan runs at all on a timer.
  media: {
    scanIntervalSeconds: int('TELLY_SCAN_INTERVAL', 60 * 60),
    get scanEnabled() { return this.scanIntervalSeconds > 0; },
    /* How long a file may be missing before its row is dropped. A scan that
       cannot see a file marks it and moves on, so an unmounted drive or a
       share that blinks does not empty the catalogue. Seven days. */
    missingGraceSeconds: int('TELLY_MISSING_GRACE', 7 * 24 * 60 * 60)
  },

  // FFmpeg is optional. Without it everything a browser can open still plays
  // directly from disk; with it, the containers a browser cannot open are
  // remuxed on the way out.
  ffmpeg: {
    path: env('TELLY_FFMPEG', 'ffmpeg'),
    ffprobePath: env('TELLY_FFPROBE', 'ffprobe'),
    enabled: bool('TELLY_FFMPEG_ENABLED', 'true'),
    videoCodec: env('TELLY_FFMPEG_VCODEC', 'libx264'),
    preset: env('TELLY_FFMPEG_PRESET', 'veryfast'),
    crf: int('TELLY_FFMPEG_CRF', 23)
  },

  /**
   * Channel health. A public playlist is mostly dead links, so the checks
   * matter — but they are the server reaching out to a few hundred strangers,
   * so the limits matter more. Short timeouts, a handful at a time, and a
   * working channel left alone for a day.
   */
  health: {
    enabled: bool('TELLY_HEALTH_ENABLED', 'true'),
    timeoutMs: int('TELLY_HEALTH_TIMEOUT', 8000),
    concurrency: int('TELLY_HEALTH_CONCURRENCY', 6),
    batch: int('TELLY_HEALTH_BATCH', 120),
    workingIntervalHours: int('TELLY_HEALTH_OK_HOURS', 24),
    retryBaseMinutes: int('TELLY_HEALTH_RETRY_MINUTES', 30),
    maxRetryHours: int('TELLY_HEALTH_MAX_RETRY_HOURS', 24),
    // Several refusals in a row, not one, before a channel is called failed.
    failAfter: int('TELLY_HEALTH_FAIL_AFTER', 3),
    // How little of a stream ffprobe is allowed to pull before deciding.
    analyzeMicroseconds: int('TELLY_HEALTH_ANALYZE_US', 1500000),
    probeBytes: int('TELLY_HEALTH_PROBE_BYTES', 262144)
  },

  /**
   * The playlists Telly can set up for you. Fetched live from iptv-org so a
   * channel change upstream arrives on the next refresh; nothing is copied
   * into this repository. Public free-to-air and free ad-supported streams
   * only — no subscriptions, nothing behind a paywall.
   */
  builtinSources: [
    { key: 'iptv-org:uk', name: 'United Kingdom (IPTV-org)',
      url: env('TELLY_IPTV_ORG_UK', 'https://iptv-org.github.io/iptv/countries/uk.m3u') },
    { key: 'iptv-org:us', name: 'United States (IPTV-org)',
      url: env('TELLY_IPTV_ORG_US', 'https://iptv-org.github.io/iptv/countries/us.m3u') }
  ],

  defaults: {
    maxDevices: int('TELLY_DEFAULT_MAX_DEVICES', 2)
  }
};

export function newSecretHex() {
  return randomBytes(32).toString('hex');
}
