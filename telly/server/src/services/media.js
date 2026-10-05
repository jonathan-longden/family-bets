import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { openDb, nowIso } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Personal media: folders on the server's own disk, read in place.
 *
 * The files are never copied and never moved. A scan records where each one
 * is, what it appears to be, and what the filename says about it; the path
 * column is for this process only and is stripped from every client reply, so
 * a phone learns that "Arrival (2016)" exists and can be played, and never
 * learns that it is C:\Media\Movies\Arrival (2016)\Arrival.2016.mkv.
 */

/** Containers worth offering. Anything else in the folder is somebody's notes. */
export const VIDEO_EXT = new Set([
  '.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.ts', '.m2ts', '.mpg', '.mpeg', '.webm', '.flv', '.ogv'
]);
const POSTER_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const ART_NAMES = ['poster', 'folder', 'cover', 'thumb'];

/* Sample files and the junk a download leaves behind are not a library. */
const IGNORE = /(^|[.\s_-])(sample|trailer|extras?|featurette|behind[ ._-]the[ ._-]scenes)([.\s_-]|$)/i;
const IGNORE_DIR = /^(\.|@eaDir$|extras?$|featurettes?$|specials?$|subs?$|subtitles?$)/i;

/* The marks a release name carries that are not part of the title. */
const NOISE = new RegExp(
  '\\b(' +
  '1080p|2160p|720p|480p|4k|uhd|hdr|hdr10|dv|sdr|bluray|blu-ray|bdrip|brrip|dvdrip|webrip|web-?dl|hdtv|' +
  'remux|repack|proper|extended|unrated|directors?[. _-]cut|imax|' +
  'x264|x265|h ?264|h ?265|hevc|avc|xvid|divx|' +
  'aac|ac3|eac3|dts|dts-hd|truehd|atmos|ddp?[0-9.]*|flac|mp3|opus|' +
  '[257]\\.[01]|multi|dual|subbed|dubbed' +
  ')\\b', 'i');

/* Season and episode, in the three ways a filename ever says it. */
const EP_PATTERNS = [
  /\bs(\d{1,2})[ ._-]?e(\d{1,3})\b/i,            // S01E02, s1.e2
  /\b(\d{1,2})x(\d{1,3})\b/i,                     // 1x02
  /\bseason[ ._-]?(\d{1,2})[ ._-]+episode[ ._-]?(\d{1,3})\b/i
];
/* A recording's own convention: a date and often the channel it came from. */
const REC_DATE = /\b(20\d{2}|19\d{2})[.\-_ ]?(\d{2})[.\-_ ]?(\d{2})\b/;
const YEAR_BRACKETED = /[([](19\d{2}|20\d{2})[)\]]/;
const YEAR_BARE = /\b(19\d{2}|20\d{2})\b/g;

export function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip the release noise and the separators, leaving something readable. */
export function cleanTitle(raw) {
  let s = String(raw || '').replace(/\.[A-Za-z0-9]{2,4}$/, '');     // extension
  s = s.replace(/[._]+/g, ' ');
  s = s.replace(/\[[^\]]*\]/g, ' ');                                 // [group]
  // Cut at the first piece of release noise: everything after it is technical.
  const words = s.split(/\s+/);
  const out = [];
  for (const w of words) {
    if (NOISE.test(w)) break;
    out.push(w);
  }
  s = (out.length ? out.join(' ') : s);
  s = s.replace(/[-–—\s]+$/, '');
  return titleCase(s) || titleCase(raw);
}

/**
 * The year a filename claims. A bracketed year wins wherever it sits, because
 * that is the convention and it is the one a title like "Blade Runner 2049
 * (2017)" relies on; failing that, the last plausible four digits, since a
 * release name puts the year after the title and before the technical marks.
 */
export function yearOf(raw) {
  const s = String(raw || '');
  const limit = new Date().getFullYear() + 2;
  const plausible = (n) => n >= 1895 && n <= limit;

  const b = YEAR_BRACKETED.exec(s);
  if (b && plausible(Number(b[1]))) return Number(b[1]);

  let last = null, m;
  YEAR_BARE.lastIndex = 0;
  while ((m = YEAR_BARE.exec(s))) if (plausible(Number(m[1]))) last = Number(m[1]);
  return last;
}

/** Season and episode numbers from a filename, or null when it is not one. */
export function episodeOf(name) {
  for (const re of EP_PATTERNS) {
    const m = re.exec(name);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  }
  return null;
}

/**
 * The series a file belongs to: what comes before the SxxExx in the filename,
 * and failing that the folder two levels up ("Show/Season 1/ep.mkv").
 */
export function seriesOf(relPath, fileName) {
  for (const re of EP_PATTERNS) {
    const m = re.exec(fileName);
    if (m && m.index > 0) {
      const head = cleanTitle(fileName.slice(0, m.index));
      if (head) return head;
    }
  }
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (/^(season|series|s)[ ._-]?\d+$/i.test(parts[i])) continue;
    return cleanTitle(parts[i]);
  }
  return cleanTitle(fileName);
}

/** An episode's own title, where the filename bothers to give one. */
export function episodeTitleOf(fileName) {
  for (const re of EP_PATTERNS) {
    const m = re.exec(fileName);
    if (!m) continue;
    const tail = fileName.slice(m.index + m[0].length);
    const t = cleanTitle(tail.replace(/^[\s._-]+/, ''));
    return /^\d+$/.test(t) ? '' : t;
  }
  return '';
}

/** Walk a folder, depth-limited, skipping the directories nobody means. */
export function walk(root, { maxDepth = 6 } = {}) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }                                   // unreadable: skip, do not fail the scan
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIR.test(e.name)) continue;
        visit(full, depth + 1);
      } else if (e.isFile()) {
        if (!VIDEO_EXT.has(path.extname(e.name).toLowerCase())) continue;
        if (IGNORE.test(e.name)) continue;
        out.push(full);
      }
    }
  };
  visit(root, 0);
  return out;
}

/** Artwork sitting beside a file or in its folder, if there is any. */
function posterFor(file) {
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  const names = [base, ...ART_NAMES];
  for (const n of names) {
    for (const ext of POSTER_EXT) {
      const candidate = path.join(dir, n + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function fileFacts(file) {
  let st;
  try { st = statSync(file); } catch { return null; }
  return {
    size: st.size,
    modified: new Date(st.mtimeMs).toISOString(),
    container: path.extname(file).replace('.', '').toLowerCase()
  };
}

/* --------------------------------------------------------------- roots --- */

export function createRoot({ label, path: dir, kind }) {
  if (!['movies', 'series', 'recordings'].includes(kind))
    throw badRequest('kind must be movies, series or recordings.');
  const clean = String(dir || '').trim();
  if (!clean) throw badRequest('A media folder needs a path.');
  if (!path.isAbsolute(clean)) throw badRequest('Give the folder as an absolute path.');
  const now = nowIso();
  const info = openDb().prepare(`INSERT INTO media_roots (label, path, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(String(label || clean).trim(), clean, kind, now, now);
  return getRoot(Number(info.lastInsertRowid));
}

export function getRoot(id) {
  const row = openDb().prepare('SELECT * FROM media_roots WHERE id = ?').get(id);
  if (!row) throw notFound('No such media folder.');
  return row;
}

export function listRoots() {
  return openDb().prepare('SELECT * FROM media_roots ORDER BY kind, label').all();
}

export function updateRoot(id, patch) {
  const row = getRoot(id);
  const next = {
    label: patch.label === undefined ? row.label : String(patch.label).trim(),
    enabled: patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0)
  };
  openDb().prepare('UPDATE media_roots SET label = ?, enabled = ?, updated_at = ? WHERE id = ?')
    .run(next.label, next.enabled, nowIso(), id);
  return getRoot(id);
}

export function deleteRoot(id) {
  getRoot(id);
  openDb().prepare('DELETE FROM media_roots WHERE id = ?').run(id);
}

/** What an admin sees. The path is the operator's own, so it is shown here. */
export function publicRoot(r) {
  return {
    id: r.id, label: r.label, path: r.path, kind: r.kind, enabled: Boolean(r.enabled),
    lastScanAt: r.last_scan_at, lastError: r.last_error, itemCount: r.item_count
  };
}

/* -------------------------------------------------------------- scanning -- */

/**
 * Scan one root. Rows are upserted and stamped with this scan's time; the ones
 * that were not seen are deleted at the end, so a file removed from disk
 * leaves the catalogue and a file that merely moved within the root does too,
 * arriving again under its new relative path.
 */
export function scanRoot(rootId) {
  const db = openDb();
  const root = getRoot(rootId);
  const at = nowIso();

  if (!existsSync(root.path)) {
    db.prepare('UPDATE media_roots SET last_error = ?, last_scan_at = ?, updated_at = ? WHERE id = ?')
      .run('That folder does not exist on the server.', at, at, rootId);
    return { found: 0, removed: 0, error: 'missing' };
  }

  const files = walk(root.path);
  let found = 0;

  const tx = db.transaction(() => {
    for (const file of files) {
      const rel = path.relative(root.path, file);
      const name = path.basename(file);
      const facts = fileFacts(file);
      if (!facts) continue;
      if (root.kind === 'movies') upsertMovie(db, root, rel, file, name, facts, at);
      else if (root.kind === 'series') upsertEpisode(db, root, rel, file, name, facts, at);
      else upsertRecording(db, root, rel, file, name, facts, at);
      found++;
    }
    const gone = sweep(db, root, at);
    const count =
      root.kind === 'movies' ? db.prepare('SELECT COUNT(*) n FROM movies WHERE root_id = ?').get(rootId).n
      : root.kind === 'series' ? db.prepare(`SELECT COUNT(*) n FROM episodes e
            JOIN series s ON s.id = e.series_id WHERE s.root_id = ?`).get(rootId).n
      : db.prepare('SELECT COUNT(*) n FROM recordings WHERE root_id = ?').get(rootId).n;
    db.prepare('UPDATE media_roots SET last_scan_at = ?, last_error = NULL, item_count = ?, updated_at = ? WHERE id = ?')
      .run(at, count, at, rootId);
    scanRoot.lastRemoved = gone;
  });
  tx();

  return { found, removed: scanRoot.lastRemoved || 0, scannedAt: at };
}

function upsertMovie(db, root, rel, file, name, facts, at) {
  const title = cleanTitle(name);
  db.prepare(`INSERT INTO movies
      (root_id, rel_path, path, title, title_key, year, poster, container, size_bytes, modified_at, added_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, rel_path) DO UPDATE SET
        path = excluded.path, title = excluded.title, title_key = excluded.title_key,
        year = excluded.year, poster = excluded.poster, container = excluded.container,
        size_bytes = excluded.size_bytes, modified_at = excluded.modified_at, seen_at = excluded.seen_at`)
    .run(root.id, rel, file, title, title.toLowerCase(), yearOf(name) ?? yearOf(rel),
         posterFor(file), facts.container, facts.size, facts.modified, at, at);
}

function upsertEpisode(db, root, rel, file, name, facts, at) {
  const seriesTitle = seriesOf(rel, name);
  const key = seriesTitle.toLowerCase();
  db.prepare(`INSERT INTO series (root_id, title, title_key, year, poster, added_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, title_key) DO UPDATE SET seen_at = excluded.seen_at`)
    .run(root.id, seriesTitle, key, yearOf(rel), '', at, at);
  const series = db.prepare('SELECT id, poster FROM series WHERE root_id = ? AND title_key = ?').get(root.id, key);
  if (!series.poster) {
    const art = posterFor(file) || posterFor(path.join(path.dirname(path.dirname(file)), 'x'));
    if (art) db.prepare('UPDATE series SET poster = ? WHERE id = ?').run(art, series.id);
  }

  const ep = episodeOf(name) || episodeOf(rel) || { season: 1, episode: 0 };
  db.prepare(`INSERT INTO episodes
      (series_id, season, episode, title, rel_path, path, container, size_bytes, modified_at, added_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id, rel_path) DO UPDATE SET
        season = excluded.season, episode = excluded.episode, title = excluded.title,
        path = excluded.path, container = excluded.container, size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at, seen_at = excluded.seen_at`)
    .run(series.id, ep.season, ep.episode, episodeTitleOf(name), rel, file,
         facts.container, facts.size, facts.modified, at, at);
}

function upsertRecording(db, root, rel, file, name, facts, at) {
  const m = REC_DATE.exec(name);
  const recordedAt = m ? `${m[1]}-${m[2]}-${m[3]}` : facts.modified.slice(0, 10);
  // "BBC One - 2024.03.01 - Doctor Who.ts" is the shape every recorder uses:
  // the part before the first dash is the channel often enough to be useful.
  const bits = name.replace(/\.[^.]+$/, '').split(/\s+-\s+/);
  const channel = bits.length > 1 ? titleCase(bits[0]) : '';
  // The date is one of the dash-separated parts, so taking it out can leave a
  // dangling separator: "- Doctor Who" is not a title.
  const title = cleanTitle(bits.length > 1 ? bits.slice(1).join(' - ') : name)
    .replace(REC_DATE, '')
    .replace(/^[\s.\-–—_]+|[\s.\-–—_]+$/g, '')
    .trim() || cleanTitle(name);
  db.prepare(`INSERT INTO recordings
      (root_id, rel_path, path, title, title_key, channel_name, recorded_at, container, size_bytes, modified_at, added_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, rel_path) DO UPDATE SET
        path = excluded.path, title = excluded.title, title_key = excluded.title_key,
        channel_name = excluded.channel_name, recorded_at = excluded.recorded_at,
        container = excluded.container, size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at, seen_at = excluded.seen_at`)
    .run(root.id, rel, file, title, title.toLowerCase(), channel, recordedAt,
         facts.container, facts.size, facts.modified, at, at);
}

/** Rows this scan did not see: the files are gone from disk. */
function sweep(db, root, at) {
  let n = 0;
  if (root.kind === 'movies') {
    n = db.prepare('DELETE FROM movies WHERE root_id = ? AND seen_at <> ?').run(root.id, at).changes;
  } else if (root.kind === 'series') {
    n = db.prepare(`DELETE FROM episodes WHERE series_id IN (SELECT id FROM series WHERE root_id = ?)
                    AND seen_at <> ?`).run(root.id, at).changes;
    db.prepare(`DELETE FROM series WHERE root_id = ?
                AND id NOT IN (SELECT series_id FROM episodes)`).run(root.id);
  } else {
    n = db.prepare('DELETE FROM recordings WHERE root_id = ? AND seen_at <> ?').run(root.id, at).changes;
  }
  return n;
}

export function scanAll() {
  const out = [];
  for (const r of listRoots()) {
    if (!r.enabled) continue;
    try { out.push({ id: r.id, label: r.label, ...scanRoot(r.id) }); }
    catch (e) { out.push({ id: r.id, label: r.label, error: e.message }); }
  }
  return out;
}

/* --------------------------------------------------------------- reading -- */

/** The client's view. No path, ever — playback goes through an id and a ticket. */
export function publicMovie(m) {
  return {
    id: m.id, kind: 'movie', title: m.title, year: m.year, genre: m.genre,
    description: m.description, poster: m.poster ? `/api/v1/art/movie/${m.id}` : '',
    container: m.container, sizeBytes: m.size_bytes, durationMs: m.duration_ms,
    addedAt: m.added_at, playback: `/api/v1/stream/media/movie/${m.id}`
  };
}

export function publicSeries(s, extra = {}) {
  return {
    id: s.id, kind: 'series', title: s.title, year: s.year, genre: s.genre,
    description: s.description, poster: s.poster ? `/api/v1/art/series/${s.id}` : '',
    addedAt: s.added_at, ...extra
  };
}

export function publicEpisode(e) {
  return {
    id: e.id, kind: 'episode', seriesId: e.series_id, season: e.season, episode: e.episode,
    title: e.title || `Episode ${e.episode}`, container: e.container, sizeBytes: e.size_bytes,
    durationMs: e.duration_ms, playback: `/api/v1/stream/media/episode/${e.id}`
  };
}

export function publicRecording(r) {
  return {
    id: r.id, kind: 'recording', title: r.title, channel: r.channel_name,
    recordedAt: r.recorded_at, container: r.container, sizeBytes: r.size_bytes,
    durationMs: r.duration_ms, playback: `/api/v1/stream/media/recording/${r.id}`
  };
}

function page(limit, offset) {
  return { limit: Math.min(Math.max(Number(limit) || 200, 1), 1000), offset: Math.max(Number(offset) || 0, 0) };
}

export function movies({ search, year, genre, limit, offset } = {}) {
  const { limit: l, offset: o } = page(limit, offset);
  const where = ['1 = 1'], args = [];
  if (search) { where.push('title_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }
  if (year) { where.push('year = ?'); args.push(Number(year)); }
  if (genre) { where.push('genre = ?'); args.push(String(genre)); }
  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM movies WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM movies WHERE ${where.join(' AND ')}
      ORDER BY title_key LIMIT ? OFFSET ?`).all(...args, l, o);
  return { total, items: rows.map(publicMovie) };
}

export function movie(id) {
  const row = openDb().prepare('SELECT * FROM movies WHERE id = ?').get(id);
  if (!row) throw notFound('No such film.');
  return row;
}

export function seriesList({ search, limit, offset } = {}) {
  const { limit: l, offset: o } = page(limit, offset);
  const where = ['1 = 1'], args = [];
  if (search) { where.push('title_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }
  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM series WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id) AS episode_count,
        (SELECT COUNT(DISTINCT season) FROM episodes e WHERE e.series_id = s.id) AS season_count
      FROM series s WHERE ${where.join(' AND ')} ORDER BY title_key LIMIT ? OFFSET ?`).all(...args, l, o);
  return {
    total,
    items: rows.map(r => publicSeries(r, { episodeCount: r.episode_count, seasonCount: r.season_count }))
  };
}

export function oneSeries(id) {
  const row = openDb().prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id) AS episode_count,
        (SELECT COUNT(DISTINCT season) FROM episodes e WHERE e.series_id = s.id) AS season_count
      FROM series s WHERE s.id = ?`).get(id);
  if (!row) throw notFound('No such series.');
  return row;
}

export function episodesOf(seriesId, { season } = {}) {
  oneSeries(seriesId);
  const where = ['series_id = ?'], args = [seriesId];
  if (season != null && season !== '') { where.push('season = ?'); args.push(Number(season)); }
  const rows = openDb().prepare(`SELECT * FROM episodes WHERE ${where.join(' AND ')}
      ORDER BY season, episode, rel_path`).all(...args);
  return rows.map(publicEpisode);
}

export function recordings({ search, limit, offset } = {}) {
  const { limit: l, offset: o } = page(limit, offset);
  const where = ['1 = 1'], args = [];
  if (search) { where.push('title_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }
  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM recordings WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM recordings WHERE ${where.join(' AND ')}
      ORDER BY recorded_at DESC, title_key LIMIT ? OFFSET ?`).all(...args, l, o);
  return { total, items: rows.map(publicRecording) };
}

/** The row behind a playable id, with its path — for this process only. */
export function playableMedia(kind, id) {
  const db = openDb();
  const row =
    kind === 'movie' ? db.prepare('SELECT id, path, container, title FROM movies WHERE id = ?').get(id)
    : kind === 'episode' ? db.prepare('SELECT id, path, container, title FROM episodes WHERE id = ?').get(id)
    : kind === 'recording' ? db.prepare('SELECT id, path, container, title FROM recordings WHERE id = ?').get(id)
    : null;
  if (!row) throw notFound('No such item.');
  return row;
}

/** Artwork is served from disk by id, so the path stays on the server. */
export function artworkPath(kind, id) {
  const db = openDb();
  const row = kind === 'movie' ? db.prepare('SELECT poster FROM movies WHERE id = ?').get(id)
            : kind === 'series' ? db.prepare('SELECT poster FROM series WHERE id = ?').get(id)
            : null;
  if (!row || !row.poster) throw notFound('No artwork for that.');
  return row.poster;
}
