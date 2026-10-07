import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
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

/* The shape artworkName() produces, and the only shape anything here will
   delete: thirty-two hex characters and a picture's extension. */
const ARTWORK_FILE = /^[0-9a-f]{32}\.(jpg|png|webp|gif|svg)$/;

/* A poster's ceiling, and the cache's.
 *
 * One poster at the size a card wants is tens of kilobytes. A print-resolution
 * one is a couple of megabytes, and twenty-four thousand of those is fifty
 * gigabytes of somebody's disk — so an image that arrives bigger than this is
 * refused rather than stored, and the catalogue keeps Telly's own generated
 * artwork for it.
 */
const maxBytes = () => Math.max(Number(config.artwork.maxPosterBytes) || 0, 16 * 1024);

/* The cache's own ceiling, in bytes. */
export function ceilingBytes() {
  return Math.max(Number(config.artwork.maxMb) || 0, 1) * 1024 * 1024;
}

/* Having made room, come down far enough to be worth the trouble. Evicting
 * exactly one poster to fit exactly one poster would mean a prune on every
 * single fetch for the rest of the catalogue; this leaves a tenth of the
 * cache free, so one prune serves the next few hundred pictures.
 */
const LOW_WATER = 0.9;

/* And the point below which a cache is no longer under pressure, so the
 * pictures evicted to make room are worth collecting again. Comfortably under
 * LOW_WATER, so an eviction does not immediately undo itself; reached when an
 * operator raises the limit or prunes by age, which is exactly when those
 * pictures should come back. */
const RELIEVED = 0.8;

/* The total, checked cheaply: SUM over the cache is not something to do once
 * per picture, so the answer is kept for a minute and adjusted in place as
 * pictures are written and evicted.
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

/**
 * What is actually on the disk, which is the number an operator's `du`
 * reports and therefore the only one worth calling a limit.
 *
 * The ledger is a column in a table and can drift from the folder it
 * describes — a write that landed while the row update did not, a file left
 * behind when a picture came back under a different content type, a data
 * directory restored from a backup older than its database. Drift is always
 * in the same direction: files on disk that no row claims.
 */
export function diskUsage() {
  const base = artworkDir();
  let bytes = 0, files = 0;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      try { bytes += statSync(full).size; files += 1; } catch { /* vanished under us */ }
    }
  };
  walk(base);
  return { bytes, files };
}

/**
 * Make the folder and the ledger agree.
 *
 * Deletes files no cached row points at and corrects the running total from
 * what is really there. Without this the ceiling bounds a number in a table
 * rather than a number of bytes on somebody's disk, and the two had been seen
 * to differ by hundreds of megabytes.
 *
 * It only ever removes files inside the artwork directory, and it removes no
 * rows at all: a catalogue record is never this function's business.
 */
export function reconcileArtwork() {
  const base = artworkDir();
  const db = openDb();
  const known = new Set(db.prepare(`SELECT rel_path FROM artwork_cache
      WHERE state = 'cached' AND rel_path <> ''`).all()
    .map(r => path.join(base, r.rel_path)));

  let orphans = 0, freed = 0, kept = 0, skipped = 0;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (known.has(full)) { kept += 1; continue; }
      /* This function deletes files, so it deletes only files of its own
         making: the hashed name artworkName() produces, and nothing else.
         Anything an operator has put in this folder is left where it is. */
      if (!ARTWORK_FILE.test(e.name)) { skipped += 1; continue; }
      try {
        const size = statSync(full).size;
        rmSync(full);
        orphans += 1; freed += size;
      } catch { /* a file that will not delete is not worth failing over */ }
    }
  };
  walk(base);

  /* A cached row whose file is gone is not cached. Say so, and drop the
     validators with it — asking "has it changed?" about a picture we have
     not got invites a 304, which means "keep what you have". */
  const missing = db.prepare(`SELECT id, rel_path FROM artwork_cache
      WHERE state = 'cached' AND rel_path <> ''`).all()
    .filter(r => !existsSync(path.join(base, r.rel_path)));
  for (const r of missing) {
    db.prepare(`UPDATE artwork_cache SET state = 'pending', rel_path = '', size_bytes = 0,
        etag = '', last_modified = '' WHERE id = ?`).run(r.id);
  }

  cacheBytes({ fresh: true });
  return { orphans, freed, kept, skipped, relisted: missing.length, bytes: cacheBytes() };
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

    /* The ceiling, enforced against this picture's real size rather than
       guessed at beforehand — and enforced by evicting the least recently
       used pictures to fit it, not by refusing it. The only thing eviction
       cannot make room for is a picture bigger than the whole cache. */
    if (!makeRoom(buf.length)) {
      /* Not a failure of the picture or of the host, so the row keeps its
         state and no blackout is recorded against it: when the cache can
         hold it, it will be fetched. */
      touch();
      return db.prepare('SELECT * FROM artwork_cache WHERE id = ?').get(row.id);
    }

    const rel = artworkName(clean, type);
    const file = path.join(artworkDir(), rel);
    mkdirSync(path.dirname(file), { recursive: true });
    /* A picture that replaces one under a different name leaves the old file
       behind, and nothing would ever claim it again. */
    if (row.rel_path && row.rel_path !== rel) {
      try { rmSync(path.join(artworkDir(), row.rel_path), { force: true }); } catch {}
    }
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
  const out = { cached: 0, pending: 0, reference_only: 0, failed: 0, evicted: 0, bytes: 0 };
  for (const r of rows) { out[r.state] = r.n; out.bytes += Number(r.bytes || 0); }
  out.maxBytes = ceilingBytes();
  out.perImageLimit = maxBytes();
  out.full = cacheBytes() >= out.maxBytes;
  return out;
}

/**
 * Drop cached copies, least recently used first.
 *
 * Two ways to ask, and they compose:
 *
 *   keepDays   drop what nothing has asked for in that long. The housekeeping
 *              prune, which is what the admin endpoint and the CLI run.
 *   downTo     drop until the cache is at or below this many bytes, however
 *              recently the pictures were used. This is what makes the
 *              configured ceiling a real ceiling: when there is no room for
 *              the picture being fetched, the oldest ones leave to make it.
 *
 * `mark` is the state an evicted row is left in. Age-pruned rows become
 * `pending` and the artwork pass will collect them again; rows evicted for
 * space become `evicted`, which the pass leaves alone — re-fetching a picture
 * we just deleted for want of room would be a treadmill against somebody
 * else's image host, and the catalogue simply has more posters than the
 * cache may hold until the limit is raised.
 *
 * Either way the file goes and the row stays. No catalogue record is touched
 * by any of this: a film keeps its poster URL and is fetched again on demand.
 */
export function pruneArtwork({ keepDays = 90, limit = 500, downTo = null,
                               mark = 'pending', reconcile = false } = {}) {
  const db = openDb();
  const out = { dropped: 0, freed: 0, orphans: 0, orphanBytes: 0 };

  /* Reclaim anything on disk that no row claims first: it is free room, and
     taking it may mean evicting nothing at all. */
  if (reconcile) {
    const got = reconcileArtwork();
    out.orphans = got.orphans;
    out.orphanBytes = got.freed;
  }

  const rows = downTo == null
    ? db.prepare(`SELECT * FROM artwork_cache WHERE state = 'cached'
          AND (last_used_at IS NULL OR last_used_at < ?) ORDER BY last_used_at LIMIT ?`)
        .all(new Date(Date.now() - keepDays * 86400e3).toISOString(), limit)
    /* Oldest first, and only as many as it takes — the loop below stops the
       moment the cache is small enough. Three columns rather than the whole
       row, because on a cache of thirty thousand pictures the difference is
       a few hundred kilobytes of objects for a list that is mostly skipped. */
    : db.prepare(`SELECT id, rel_path, size_bytes FROM artwork_cache WHERE state = 'cached'
          ORDER BY last_used_at IS NULL DESC, last_used_at, id`).all();

  let used = cacheBytes({ fresh: true });
  for (const r of rows) {
    if (downTo != null && used <= downTo) break;
    const file = path.join(artworkDir(), r.rel_path);
    try {
      if (r.rel_path && existsSync(file)) { out.freed += statSync(file).size; rmSync(file); }
      /* The validators go with the file. Keeping them would have the next
         fetch ask whether a picture we no longer hold has changed, and a 304
         to that question would mark the row cached with nothing on disk. */
      db.prepare(`UPDATE artwork_cache SET state = ?, rel_path = '', size_bytes = 0,
          etag = '', last_modified = '' WHERE id = ?`).run(mark, r.id);
      used -= Number(r.size_bytes || 0);
      out.dropped += 1;
    } catch { /* a file that will not delete is not worth failing a prune over */ }
  }

  cacheBytes({ fresh: true });             // room has been made; stop refusing
  out.bytes = cacheBytes();
  return out;
}

/**
 * Room for one more picture, made rather than waited for.
 *
 * Returns true when `need` bytes may now be written without the cache going
 * over its ceiling. Refusing is reserved for the one case eviction cannot
 * help with: a single picture larger than the whole cache is allowed to be.
 *
 * The disk is reconciled at most every few minutes, because walking thirty
 * thousand files is not something to do once per poster — but it is done the
 * first time the cache claims to be full, which is exactly when a ledger that
 * has drifted from the folder matters.
 */
let reconciledAt = 0;
export function makeRoom(need) {
  const want = Math.max(Number(need) || 0, 0);
  const ceiling = ceilingBytes();
  if (want > ceiling) return false;            // nothing to evict would help
  if (cacheBytes() + want <= ceiling) return true;

  const reconcile = Date.now() - reconciledAt > 5 * 60e3;
  if (reconcile) reconciledAt = Date.now();

  /* Down to the low-water mark, and at least far enough for this picture. */
  const target = Math.min(Math.floor(ceiling * LOW_WATER), ceiling - want);
  pruneArtwork({ downTo: Math.max(target, 0), mark: 'evicted', reconcile });
  return cacheBytes() + want <= ceiling;
}

/**
 * Pictures evicted for want of room are worth collecting again once there is
 * room — when the operator raises the limit, or a housekeeping prune has
 * cleared out what nothing was looking at. Below RELIEVED the cache is no
 * longer under pressure, so they go back in the queue.
 *
 * Nothing is fetched here; the rows simply become eligible again.
 */
export function reviveEvicted() {
  if (cacheBytes() >= ceilingBytes() * RELIEVED) return 0;
  const got = openDb().prepare(`UPDATE artwork_cache SET state = 'pending'
      WHERE state = 'evicted'`).run();
  return got.changes || 0;
}
