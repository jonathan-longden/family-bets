/**
 * Every setting comes from the environment, with defaults that work on a PC
 * on a home network. Nothing here is hard-coded into the clients: the app is
 * told an API endpoint and asks this server for the rest.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/* The working directory is wherever somebody happened to type `node`, so
   anything derived from it moves when they start the server from elsewhere.
   These are anchored to this file instead: serverRoot is telly/server, and
   appRoot is telly/, where index.html lives. */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.resolve(serverRoot, '..');
const root = serverRoot;

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

  /* The app's own files, served from this server so the browser and the API
     share an origin — see routes/app.js. Default: the directory above this
     one, which is where index.html lives in this repository. */
  app: {
    serve: bool('TELLY_SERVE_APP', 'true'),
    dir: path.resolve(env('TELLY_APP_DIR', appRoot))
  },

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

  /**
   * The same choice for a catalogue source whose address carries a
   * subscription's username and password — an Xtream panel's films and
   * series.
   *
   * This one defaults the other way round, and deliberately. A redirect is
   * cheaper, but the address it sends is
   *
   *     http://panel:8080/movie/USERNAME/PASSWORD/1234.mkv
   *
   * so redirecting hands every television and phone in the house the
   * subscription itself. Relaying costs the bytes and keeps the credential
   * where it belongs: the panel is asked by this server, over the same
   * internet connection it would have used anyway, and the device sees only
   * an address on this server.
   *
   * Set TELLY_VOD_MODE=redirect to trade that back for the bandwidth. It is
   * a reasonable choice on a network you trust; it is not the default,
   * because it is not the safe one.
   */
  vodMode: env('TELLY_VOD_MODE', 'proxy'),

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
    /* Two refusals in a row, not one, before a channel that was working
       disappears from Live TV. One bad check is a bad moment on somebody
       else's server; hiding on it would make the list flicker. One good check
       is enough to bring it back, because a stream that answers properly is
       answering properly. */
    hideAfter: int('TELLY_HEALTH_HIDE_AFTER', 2),
    // Several refusals in a row, not one, before a channel is called failed.
    failAfter: int('TELLY_HEALTH_FAIL_AFTER', 3),
    // How little of a stream ffprobe is allowed to pull before deciding.
    analyzeMicroseconds: int('TELLY_HEALTH_ANALYZE_US', 1500000),
    probeBytes: int('TELLY_HEALTH_PROBE_BYTES', 262144)
  },

  /**
   * Artwork. A poster is small; twenty-four thousand of them are not.
   *
   * The cache already fetches once and revalidates with an ETag. These are
   * the ceilings: a poster that arrives bigger than `maxPosterBytes` is
   * refused rather than stored, and once the cache passes `maxMb` nothing new
   * is fetched until a prune frees room. At the default poster size that is
   * about forty kilobytes a film, so a twenty-four-thousand-title catalogue
   * settles around a gigabyte — and the ceiling stops it going further on its
   * own.
   */
  artwork: {
    maxPosterBytes: int('TELLY_ART_MAX_BYTES', 768 * 1024),
    maxMb: int('TELLY_ART_MAX_MB', 2048),
    /* How many works one artwork pass will look at. A pass is cheap to
       repeat and the scheduler runs it again, so this is a trickle rather
       than a stampede. */
    batch: int('TELLY_ART_BATCH', 200),
    /* A picture that would not load is not asked for again straight away —
       but nor is it written off for good, because one bad moment on somebody
       else's image host should not blank a poster permanently. */
    retryFailedDays: int('TELLY_ART_RETRY_DAYS', 7)
  },

  /**
   * The Movie Database, as the fallback when a provider has no poster.
   *
   * Off unless a key is set: TELLY_TMDB_KEY. It is their documented public
   * API, read with a key the operator obtained themselves, and it is the only
   * external metadata source Telly uses — nothing here scrapes IMDb or
   * anywhere else, and a provider that supplies its own poster is never
   * second-guessed.
   *
   * `lookupsPerRun` is the important one. Asking TMDB by an id a provider
   * already gave is cheap and exact; searching by title and year is neither,
   * so it is rationed. A pass spends at most this many searches and stops,
   * and what it could not resolve is marked so the next pass does not try it
   * again from scratch.
   *
   * Using it obliges an acknowledgement, which Settings and the docs carry:
   * this product uses the TMDB API but is not endorsed or certified by TMDB.
   */
  tmdb: {
    key: env('TELLY_TMDB_KEY', ''),
    apiBase: env('TELLY_TMDB_API', 'https://api.themoviedb.org/3'),
    imageBase: env('TELLY_TMDB_IMAGES', 'https://image.tmdb.org/t/p'),
    /* w342 is the poster size a card wants. Bigger is wasted on a grid and
       multiplies by every title in the catalogue. */
    posterSize: env('TELLY_TMDB_POSTER', 'w342'),
    backdropSize: env('TELLY_TMDB_BACKDROP', 'w780'),
    language: env('TELLY_TMDB_LANG', 'en-GB'),
    lookupsPerRun: int('TELLY_TMDB_LOOKUPS', 250),
    requestDelayMs: int('TELLY_TMDB_DELAY', 120),
    timeoutMs: int('TELLY_TMDB_TIMEOUT', 12000),
    /* A title-and-year search is only trusted when the year matches and the
       name is close. Below this the answer is thrown away: a wrong poster is
       worse than none. */
    minTitleScore: Number(env('TELLY_TMDB_MIN_SCORE', '0.82'))
  },

  /**
   * PeerTube — openly licensed video, from instances Telly is willing to ask.
   *
   * PeerTube is a federation, not a service. Anybody may run an instance, and
   * the global search index aggregates whoever asks to be aggregated — so
   * "search PeerTube" is not a thing Telly does. It asks named instances,
   * and only ones on this list.
   *
   * `allowedHosts` is Telly's own allowlist and is the outer gate: an
   * operator may add a source for any host on it and for no other. It is
   * checked when the source is created AND again on every import, because a
   * list that is only enforced at creation time is not enforced at all.
   *
   * The hosts shipped here run under their own published rules and carry
   * material their uploaders have licensed openly. An operator who wants a
   * different one — their own instance, most obviously — sets
   * TELLY_PEERTUBE_HOSTS, which replaces the list rather than adding to it.
   */
  peertube: {
    allowedHosts: String(env('TELLY_PEERTUBE_HOSTS',
      'framatube.org,tilvids.com,peertube.tv,video.blender.org'))
      .split(',').map(h => h.trim().toLowerCase()).filter(Boolean),

    /* Feature-length by default, which is what Movies is for. A short is not
       a film, and a trailer is certainly not. */
    minDurationSeconds: int('TELLY_PEERTUBE_MIN_SECONDS', 45 * 60),
    maxDurationSeconds: int('TELLY_PEERTUBE_MAX_SECONDS', 6 * 60 * 60),

    /* How many results one search asks for, and how many pages deep it goes.
       Small on purpose: an instance is somebody's server. */
    pageSize: int('TELLY_PEERTUBE_PAGE', 50),
    maxPages: int('TELLY_PEERTUBE_PAGES', 4),

    /* Required by default. An instance that only offers progressive files is
       still usable — see `webVideoAccepted` — but HLS is what plays well on
       a television. */
    requireHls: bool('TELLY_PEERTUBE_REQUIRE_HLS', 'false'),
    webVideoAccepted: bool('TELLY_PEERTUBE_WEB_VIDEO', 'true')
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
