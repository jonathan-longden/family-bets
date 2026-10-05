import { ACCESS, STATUS, PLAYBACK } from './contract.js';

/**
 * The Internet Archive — the one requested-style provider that can actually be
 * imported, and the reason the rest of this machinery is testable.
 *
 * It qualifies on every count the brief asks about:
 *
 *   · a documented public API meant to be read — advancedsearch.php for
 *     listing and /metadata/{id} for one item;
 *   · public-domain and openly-licensed material, so there is nothing to
 *     bypass and no DRM to break;
 *   · real direct playback — the MP4 behind /download/{id}/{file} is a file
 *     the Telly player opens, so Play plays rather than opening a website;
 *   · artwork at a documented address, /services/img/{id}.
 *
 * Telly already offers Archive film lists on the Free channels screen. This
 * turns those into real catalogue entries with metadata, which is what the
 * brief wants and what no commercial provider here permits.
 *
 * The collection is configurable because "the Archive" is not one catalogue:
 * `feature_films` is the obvious one, and an operator may want another.
 */

/* The Archive's own addresses. Overridable because "the Archive" is not
   always archive.org: there are mirrors, and a local instance is how this
   adapter gets exercised without asking a charity for ten thousand films. */
const BASE = String(process.env.TELLY_ARCHIVE_BASE || 'https://archive.org').replace(/\/+$/, '');
const SEARCH = `${BASE}/advancedsearch.php`;
const META = `${BASE}/metadata/`;
const DETAILS = `${BASE}/details/`;
const DOWNLOAD = `${BASE}/download/`;
const IMG = `${BASE}/services/img/`;

/* What the player can open directly, best first. */
const PLAYABLE = [
  { format: /^h\.264$|^mpeg4$|^512kb mpeg4$|^hivision mp4$/i, ext: /\.(mp4|m4v)$/i },
  { format: /^ogg video$/i, ext: /\.ogv$/i },
  { format: /^webm$/i, ext: /\.webm$/i }
];

const FIELDS = ['identifier', 'title', 'year', 'date', 'description', 'runtime',
  'subject', 'language', 'licenseurl', 'creator', 'director', 'writer', 'mediatype',
  'avg_rating', 'downloads'];

export default {
  key: 'archive-org',
  name: 'Internet Archive',
  baseUrl: BASE + '/',
  termsUrl: 'https://archive.org/about/terms.php',
  robotsUrl: 'https://archive.org/robots.txt',
  enabledByDefault: false,     // an operator decides to pull a few thousand films

  access: {
    method: ACCESS.officialApi,
    status: STATUS.available,
    reason: 'Public, documented search and metadata APIs over public-domain and ' +
      'openly-licensed material, with direct file playback.',
    assessedAt: '2026-10-05'
  },

  capabilities: {
    metadata: true,
    artwork: true,
    playback: true,
    playbackType: PLAYBACK.direct
  },

  /* Deliberately unhurried. The Archive is a charity running a library, and
     nothing here is in a rush. */
  limits: {
    requestDelayMs: 1200,
    concurrency: 2,
    timeoutMs: 20000,
    maxRetries: 3,
    pageLimit: 10,               // 10 × 100 rows per run unless raised
    refreshIntervalSeconds: 7 * 24 * 60 * 60
  },

  settings: {
    collection: 'feature_films',
    rowsPerPage: 100
  },

  /**
   * One page of search results at a time, and one metadata call per item to
   * find a file worth playing. An item with nothing playable is skipped rather
   * than recorded as a title that cannot be opened.
   */
  async * discover(ctx) {
    const collection = ctx.setting('collection', 'feature_films');
    const rows = Math.min(Number(ctx.setting('rowsPerPage', 100)) || 100, 100);
    const pages = ctx.pageLimit || 10;

    for (let page = 1; page <= pages; page++) {
      const url = `${SEARCH}?${new URLSearchParams({
        q: `collection:(${collection}) AND mediatype:(movies)`,
        rows: String(rows),
        page: String(page),
        output: 'json',
        sort: 'downloads desc'
      })}&${FIELDS.map(f => `fl%5B%5D=${f}`).join('&')}`;

      const body = await ctx.getJson(url);
      const docs = (body && body.response && body.response.docs) || [];
      if (!docs.length) return;

      for (const doc of docs) {
        if (ctx.cancelled) return;
        const work = await this.one(ctx, doc);
        if (work) yield work;
      }
      if (docs.length < rows) return;            // that was the last page
    }
  },

  /** One search result, turned into a catalogue work. */
  async one(ctx, doc) {
    const id = String(doc.identifier || '');
    if (!id) return null;

    const meta = await ctx.getJson(META + encodeURIComponent(id)).catch(() => null);
    if (!meta) return null;

    const file = pickFile(meta.files || []);
    /* No playable file means no entry. A catalogue of titles that will not
       open is not a catalogue. */
    if (!file) return null;

    const m = meta.metadata || {};
    const year = yearOf(doc.year ?? m.year ?? doc.date ?? m.date);

    return {
      kind: 'movie',
      title: text(doc.title ?? m.title) || id,
      originalTitle: '',
      year,
      releaseDate: dateOf(doc.date ?? m.date),
      description: stripTags(text(doc.description ?? m.description)),
      runtimeMinutes: runtimeOf(m.runtime ?? doc.runtime) || Math.round(Number(file.length || 0) / 60),
      rating: doc.avg_rating != null ? Number(doc.avg_rating) : null,
      genres: list(doc.subject ?? m.subject).slice(0, 8),
      languages: list(doc.language ?? m.language),
      keywords: list(doc.subject ?? m.subject).slice(8, 20),
      directors: list(m.director ?? doc.director),
      writers: list(m.writer ?? doc.writer),
      cast: list(m.creator ?? doc.creator).map((name, i) => ({ name, ordering: i })),
      poster: IMG + encodeURIComponent(id),
      thumbnail: IMG + encodeURIComponent(id),
      source: {
        contentId: id,
        metadataUrl: DETAILS + encodeURIComponent(id),
        /* A real file, at a documented address. This is what Play uses. */
        playbackUrl: DOWNLOAD + encodeURIComponent(id) + '/' + encodeURIComponent(file.name),
        playbackType: PLAYBACK.direct,
        availability: 'available',
        quality: file.height ? `${file.height}p` : ''
      }
    };
  }
};

/* ---------------------------------------------------------------- helpers -- */

function pickFile(files) {
  for (const want of PLAYABLE) {
    /* Biggest match wins: the Archive usually holds a low-bitrate derivative
       beside the real thing, and the real thing is the one to play. */
    const hits = files
      .filter(f => want.ext.test(f.name || '') || want.format.test(f.format || ''))
      .sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
    if (hits.length) return hits[0];
  }
  return null;
}

const text = (v) => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[;,]/))
  .map(x => String(x).trim()).filter(Boolean);

function yearOf(v) {
  const m = String(text(v)).match(/(1[89]\d{2}|20\d{2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1870 && n <= new Date().getFullYear() + 2 ? n : null;
}

function dateOf(v) {
  const s = text(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function runtimeOf(v) {
  const s = text(v);
  if (!s) return 0;
  /* "1:34:12", "94 min", "5640" (seconds) */
  const clock = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Math.round((Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) / 60);
  const mins = s.match(/(\d+)\s*min/i);
  if (mins) return Number(mins[1]);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 60) : 0;
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export { pickFile, yearOf, runtimeOf, stripTags, dateOf };
