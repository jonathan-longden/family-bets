import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { notFound } from '../lib/errors.js';

/**
 * Artwork, fetched once.
 *
 * A poster is the same bytes every week, so the row remembers the URL, where
 * the copy went, and the validators the provider gave. The next import sends
 * If-None-Match and gets a 304, which costs a few hundred bytes instead of a
 * few hundred kilobytes — across a few thousand films, that is the difference
 * between a polite import and a rude one.
 *
 * Two things it will not do:
 *
 *   · copy artwork from a provider whose terms do not permit a local copy. Such
 *     a provider's adapter declares `artworkPolicy: 'reference'` and the row is
 *     marked reference_only: the URL is kept and handed to the client, and
 *     nothing is stored here.
 *   · re-fetch something that failed, straight away. A URL that 404s is
 *     recorded as failed and left alone.
 */

const DIRNAME = 'artwork';

export function artworkDir() {
  return path.join(config.dataDir, DIRNAME);
}

/** A stable name from the URL, so the same picture lands in the same place. */
export function artworkName(url, contentType = '') {
  const hash = createHash('sha256').update(String(url)).digest('hex').slice(0, 32);
  const ext = /png/.test(contentType) ? '.png'
    : /webp/.test(contentType) ? '.webp'
    : /gif/.test(contentType) ? '.gif'
    : /svg/.test(contentType) ? '.svg'
    : '.jpg';
  /* Two levels of fan-out, so a directory never holds ten thousand files. */
  return path.join(hash.slice(0, 2), hash.slice(2, 4), hash + ext);
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|svg\+xml)$/;

/* A poster's ceiling, and the cache's.
 *
 * One poster at the size a card wants is tens of kilobytes. A print-resolution
 * one is a couple of megabytes, and twenty-four thousand of those is fifty
 * gigabytes of somebody's disk — so an image that arrives bigger than this is
 * refused rather than stored, and the catalogue keeps Telly's own generated
 * artwork for it.
 */
const maxBytes = () => Math.max(Number(config.artwork.maxPosterBytes) || 0, 16 * 1024);

/* The total, checked cheaply: SUM over the cache is not something to do once
 * per picture, so the answer is kept for a minute. Once the cache is full
 * nothing new is fetched — what is already here still serves, and a prune
 * makes room.
 */
let totalAt = 0, totalBytes = 0;
export function cacheBytes({ fresh = false } = {}) {
  if (fresh || Date.now() - totalAt > 60e3) {
    const row = openDb().prepare(`SELECT SUM(size_bytes) b FROM artwork_cache WHERE state = 'cached'`).get();
    totalBytes = Number((row && row.b) || 0);
    totalAt = Date.now();
  }
  return totalBytes;
}

/** Is a recorded failure old enough to be worth trying once more? */
export function staleFailure(row) {
  const days = Math.max(Number(config.artwork.retryFailedDays) || 0, 0);
  if (!days) return false;
  const last = row && (row.fetched_at || row.created_at);
  if (!last) return true;
  return Date.now() - Date.parse(last) > days * 86400e3;
}

export function cacheFull() {
  const ceiling = Math.max(Number(config.artwork.maxMb) || 0, 1) * 1024 * 1024;
  return cacheBytes() >= ceiling;
}

/**
 * Fetch one picture if it is not already here. Returns the row.
 *
 * Failures are recorded and swallowed: a missing poster is a missing poster,
 * not a reason for an import of four thousand films to stop.
 */
export async function fetchArtwork(url, { provider = null, ctx = null, fetchImpl = fetch } = {}) {
  const clean = String(url || '').trim();
  if (!clean || !/^https?:\/\//i.test(clean)) return null;

  const db = openDb();
  const at = nowIso();
  let row = db.prepare('SELECT * FROM artwork_cache WHERE url = ?').get(clean);

  if (!row) {
    db.prepare(`INSERT INTO artwork_cache (url, provider_id, state, created_at)
        VALUES (?, ?, 'pending', ?) ON CONFLICT(url) DO NOTHING`)
      .run(clean, provider ? provider.id : null, at);
    row = db.prepare('SELECT * FROM artwork_cache WHERE url = ?').get(clean);
  }

  const touch = () => db.prepare('UPDATE artwork_cache SET last_used_at = ? WHERE id = ?')
    .run(at, row.id);

  /* Already here and still on disk: nothing to do at all. */
  if (row.state === 'cached' && row.rel_path && existsSync(path.join(artworkDir(), row.rel_path))) {
    touch();
    return row;
  }
  if (row.state === 'reference_only') { touch(); return row; }
  /* A failure is remembered so an import of four thousand films does not
     retry the same dead URL four thousand times — and forgotten after a
     while, because hosts come back. `fetched_at` on a failed row is when it
     was last attempted. */
  if (row.state === 'failed' && !staleFailure(row)) { touch(); return row; }

  /* A full cache is not an error and not a reason to keep asking: the row is
     left pending so a later pass picks it up once a prune has made room. */
  if (cacheFull()) { touch(); return row; }

  try {
    /* Only ask "has it changed?" when there is still a copy here to keep. A
       pruned row remembers its validators but no longer has the file, and a
       304 to that question would mark it cached with nothing on disk — a
       poster that resolves to an address that cannot be served. */
    const haveFile = Boolean(row.rel_path && existsSync(path.join(artworkDir(), row.rel_path)));
    const headers = {};
    if (haveFile && row.etag) headers['if-none-match'] = row.etag;
    if (haveFile && row.last_modified) headers['if-modified-since'] = row.last_modified;

    const res = ctx ? await ctx.get(clean, { headers }) : await fetchImpl(clean, { headers });

    if (res.status === 304) {
      db.prepare(`UPDATE artwork_cache SET state = 'cached', fetched_at = ?, last_used_at = ? WHERE id = ?`)
        .run(at, at, row.id);
      return db.prepare('SELECT * FROM artwork_cache WHERE id = ?').get(row.id);
    }

    /* Said as what it was: a 404 is a missing picture, not a picture of the
       wrong type, and the difference is the first thing somebody reading the
       failure wants to know. */
    if (!res.ok && res.status !== 304) {
      throw new Error(`answered ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);
    }
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) throw new Error(`not an image (${type || 'no content-type'})`);

    /* Declared too big: refused before the body is read, so an oversized
       poster costs a request rather than the megabytes. */
    const cap = maxBytes();
    const length = Number(res.headers.get('content-length') || 0);
    if (length && length > cap) throw new Error(`too large (${length} bytes, limit ${cap})`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) throw new Error(`too large (${buf.length} bytes, limit ${cap})`);
    if (!buf.length) throw new Error('empty');

    const rel = artworkName(clean, type);
    const file = path.join(artworkDir(), rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, buf);

    db.prepare(`UPDATE artwork_cache SET rel_path = ?, content_type = ?, size_bytes = ?,
          etag = ?, last_modified = ?, state = 'cached', failure_reason = '',
          fetched_at = ?, last_used_at = ? WHERE id = ?`)
      .run(rel, type, buf.length, res.headers.get('etag') || '',
           res.headers.get('last-modified') || '', at, at, row.id);
    totalBytes += buf.length;
  } catch (e) {
    db.prepare(`UPDATE artwork_cache SET state = 'failed', failure_reason = ?,
        fetched_at = ?, last_used_at = ? WHERE id = ?`)
      .run(String(e.message || e).slice(0, 200), at, at, row.id);
  }
  return db.prepare('SELECT * FROM artwork_cache WHERE id = ?').get(row.id);
}

/** Record a URL as one to link rather than copy. */
export function referenceOnly(url, provider = null) {
  const clean = String(url || '').trim();
  if (!clean) return null;
  const at = nowIso();
  openDb().prepare(`INSERT INTO artwork_cache (url, provider_id, state, created_at, last_used_at)
      VALUES (?, ?, 'reference_only', ?, ?)
      ON CONFLICT(url) DO UPDATE SET state = 'reference_only', last_used_at = ?`)
    .run(clean, provider ? provider.id : null, at, at, at);
  return openDb().prepare('SELECT * FROM artwork_cache WHERE url = ?').get(clean);
}

/**
 * Everything a work points at, cached in one go. Called by the importer, which
 * is why a failure here never propagates: the film is in the catalogue either
 * way, with Telly's own generated artwork behind it.
 */
export async function cacheArtwork(provider, work, { ctx = null } = {}) {
  if (!provider.supports_artwork) return;
  const adapterPolicy = work.artworkPolicy || 'cache';
  const urls = [work.poster, work.backdrop, work.thumbnail,
    ...(work.cast || []).map(c => c && c.image)].filter(Boolean)
    /* A local source already serves its own artwork by id, so there is
       nothing to fetch and nothing to copy. */
    .filter(u => /^https?:\/\//i.test(u));

  for (const url of urls.slice(0, 6)) {
    if (adapterPolicy === 'reference') referenceOnly(url, provider);
    else await fetchArtwork(url, { provider, ctx });
  }
}

/**
 * Where a cached picture is, for the route that serves it. Resolved and
 * checked to be inside the artwork directory before anything is opened — the
 * same rule the media folders follow, for the same reason.
 */
export function cachedArtworkPath(id) {
  const row = openDb().prepare('SELECT * FROM artwork_cache WHERE id = ?').get(Number(id));
  if (!row || row.state !== 'cached' || !row.rel_path) throw notFound('No cached artwork for that.');
  const base = path.resolve(artworkDir());
  const file = path.resolve(path.join(base, row.rel_path));
  if (file !== base && !file.startsWith(base + path.sep)) {
    throw notFound('No cached artwork for that.');
  }
  if (!existsSync(file)) throw notFound('That artwork is no longer on disk.');
  return { file, contentType: row.content_type || 'image/jpeg' };
}

/** The id a client should ask for, given a URL a provider published. */
export function cachedIdFor(url) {
  const row = openDb().prepare('SELECT id, state FROM artwork_cache WHERE url = ?')
    .get(String(url || '').trim());
  return row && row.state === 'cached' ? row.id : null;
}

/**
 * What the cache knows about a URL: its id when there is a copy, and its
 * state either way.
 *
 * The state matters on the way out as well as on the way in. A URL recorded
 * as `failed` is a URL that does not load — handing it to a client gives
 * every device in the house a broken image to try, so the work is answered
 * with no poster instead and the client draws its own.
 */
export function artworkState(url) {
  const row = openDb().prepare('SELECT id, state FROM artwork_cache WHERE url = ?')
    .get(String(url || '').trim());
  if (!row) return { id: null, state: '' };
  return { id: row.state === 'cached' ? row.id : null, state: row.state };
}

export function artworkStats() {
  const db = openDb();
  const rows = db.prepare('SELECT state, COUNT(*) n, SUM(size_bytes) bytes FROM artwork_cache GROUP BY state')
    .all();
  const out = { cached: 0, pending: 0, reference_only: 0, failed: 0, bytes: 0 };
  for (const r of rows) { out[r.state] = r.n; out.bytes += Number(r.bytes || 0); }
  out.maxBytes = Math.max(Number(config.artwork.maxMb) || 0, 1) * 1024 * 1024;
  out.perImageLimit = maxBytes();
  out.full = out.bytes >= out.maxBytes;
  return out;
}

/** Drop copies nothing has asked for in a while, oldest first. */
export function pruneArtwork({ keepDays = 90, limit = 500 } = {}) {
  const db = openDb();
  const cutoff = new Date(Date.now() - keepDays * 86400e3).toISOString();
  const rows = db.prepare(`SELECT * FROM artwork_cache WHERE state = 'cached'
      AND (last_used_at IS NULL OR last_used_at < ?) ORDER BY last_used_at LIMIT ?`)
    .all(cutoff, limit);
  let freed = 0;
  for (const r of rows) {
    const file = path.join(artworkDir(), r.rel_path);
    try {
      if (existsSync(file)) { freed += statSync(file).size; rmSync(file); }
      /* The validators go with the file. Keeping them would have the next
         fetch ask whether a picture we no longer hold has changed. */
      db.prepare(`UPDATE artwork_cache SET state = 'pending', rel_path = '', size_bytes = 0,
          etag = '', last_modified = '' WHERE id = ?`).run(r.id);
    } catch { /* a file that will not delete is not worth failing a prune over */ }
  }
  cacheBytes({ fresh: true });             // room has been made; stop refusing
  return { dropped: rows.length, freed };
}
