import { readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

/* A row whose file is missing is kept — favourites, progress and the row's
   own history are worth more than the few seconds a share takes to come
   back — but it is not offered to a client, because it cannot be played.
   It returns on its own the moment a scan sees the file again. */
const PRESENT = 'missing_since IS NULL';

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

/* ------------------------------------------------------- technical facts -- *
 *
 * Duration, codecs and resolution, read locally with ffprobe where it is
 * installed. Optional on purpose: without it a library still works, it simply
 * knows less, and the columns are there for a metadata provider to fill in
 * later.
 */
let ffprobeMissing = false;

export function probeFile(file) {
  if (!config.ffmpeg.enabled || ffprobeMissing) return null;
  let r;
  try {
    r = spawnSync(config.ffmpeg.ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-of', 'json', file
    ], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  } catch { ffprobeMissing = true; return null; }
  if (r.error && (r.error.code === 'ENOENT' || /ENOENT/.test(String(r.error.message)))) {
    ffprobeMissing = true;
    return null;
  }
  if (r.status !== 0 || !r.stdout) return null;
  let j;
  try { j = JSON.parse(r.stdout); } catch { return null; }
  const streams = j.streams || [];
  const v = streams.find(s => s.codec_type === 'video') || {};
  const a = streams.find(s => s.codec_type === 'audio') || {};
  const secs = Number(j.format && j.format.duration);
  return {
    durationMs: Number.isFinite(secs) ? Math.round(secs * 1000) : 0,
    videoCodec: v.codec_name || '',
    audioCodec: a.codec_name || '',
    width: Number(v.width) || 0,
    height: Number(v.height) || 0
  };
}

/* ------------------------------------------------------------ scan jobs -- *
 *
 * "Scanning…" against three thousand files tells nobody anything, so a scan
 * is a row with a count on it that a client can poll.
 */
export function startJob(kind) {
  const at = nowIso();
  const info = openDb().prepare(`INSERT INTO scan_jobs (kind, status, started_at) VALUES (?, 'running', ?)`)
    .run(kind, at);
  return Number(info.lastInsertRowid);
}

/* The columns a progress report may touch, named here rather than taken from
   whatever the caller happened to put in the object: a scan must not fall over
   because a count was added to the figures it carries around. */
const JOB_FIELDS = new Set(['total', 'processed', 'movies', 'series', 'episodes',
  'recordings', 'unmatched', 'missing', 'removed', 'errors']);

export function jobProgress(jobId, patch) {
  if (!jobId) return;
  const sets = [], args = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!JOB_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`); args.push(v);
  }
  if (!sets.length) return;
  openDb().prepare(`UPDATE scan_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args, jobId);
}

export function finishJob(jobId, status = 'done', message = '') {
  if (!jobId) return;
  openDb().prepare('UPDATE scan_jobs SET status = ?, finished_at = ?, message = ? WHERE id = ?')
    .run(status, nowIso(), String(message || '').slice(0, 500), jobId);
}

export function getJob(id) {
  const row = openDb().prepare('SELECT * FROM scan_jobs WHERE id = ?').get(id);
  if (!row) throw notFound('No such scan.');
  return publicJob(row);
}

export function latestJob() {
  const row = openDb().prepare('SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1').get();
  return row ? publicJob(row) : null;
}

export function publicJob(j) {
  return {
    id: j.id, kind: j.kind, status: j.status,
    startedAt: j.started_at, finishedAt: j.finished_at,
    total: j.total, processed: j.processed,
    found: { movies: j.movies, series: j.series, episodes: j.episodes, recordings: j.recordings },
    unmatched: j.unmatched, missing: j.missing, removed: j.removed, errors: j.errors,
    message: j.message
  };
}

/* ------------------------------------------------------ unmatched media -- */

/** A file the scanner would not guess at. Listed, not filed wrongly. */
export function noteUnmatched(db, folder, rel, file, name, size, reason, at) {
  db.prepare(`INSERT INTO unmatched_media (folder_id, rel_path, path, file_name, kind, reason, size_bytes, seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_id, rel_path) DO UPDATE SET
        path = excluded.path, file_name = excluded.file_name, reason = excluded.reason,
        size_bytes = excluded.size_bytes, seen_at = excluded.seen_at`)
    .run(folder.id, rel, file, name, folder.kind, reason, size, at, at);
}

export function unmatched({ limit = 200, offset = 0 } = {}) {
  const db = openDb();
  const total = db.prepare('SELECT COUNT(*) n FROM unmatched_media').get().n;
  const rows = db.prepare(`SELECT u.*, f.label AS folder_label FROM unmatched_media u
      JOIN media_folders f ON f.id = u.folder_id
      ORDER BY u.file_name LIMIT ? OFFSET ?`)
    .all(Math.min(Number(limit) || 200, 1000), Number(offset) || 0);
  return {
    total,
    items: rows.map(r => ({
      id: r.id, fileName: r.file_name, relPath: r.rel_path, folder: r.folder_label,
      kind: r.kind, reason: r.reason, sizeBytes: r.size_bytes, seenAt: r.seen_at
    }))
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
  const info = openDb().prepare(`INSERT INTO media_folders (label, path, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(String(label || clean).trim(), clean, kind, now, now);
  return getRoot(Number(info.lastInsertRowid));
}

export function getRoot(id) {
  const row = openDb().prepare('SELECT * FROM media_folders WHERE id = ?').get(id);
  if (!row) throw notFound('No such media folder.');
  return row;
}

export function listRoots() {
  return openDb().prepare('SELECT * FROM media_folders ORDER BY kind, label').all();
}

export function updateRoot(id, patch) {
  const row = getRoot(id);
  const next = {
    label: patch.label === undefined ? row.label : String(patch.label).trim(),
    enabled: patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0)
  };
  openDb().prepare('UPDATE media_folders SET label = ?, enabled = ?, updated_at = ? WHERE id = ?')
    .run(next.label, next.enabled, nowIso(), id);
  return getRoot(id);
}

export function deleteRoot(id) {
  getRoot(id);
  openDb().prepare('DELETE FROM media_folders WHERE id = ?').run(id);
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
 * that were not seen are marked missing rather than deleted, and dropped only
 * once they have been missing for the grace period — see sweep(). A file that
 * moved within the root arrives again under its new relative path, and the row
 * at the old path waits out the grace period before going.
 */
export function* scanRootSteps(rootId, { jobId = null } = {}) {
  const db = openDb();
  const root = getRoot(rootId);
  const at = nowIso();

  if (!existsSync(root.path)) {
    db.prepare('UPDATE media_folders SET last_error = ?, last_scan_at = ?, updated_at = ? WHERE id = ?')
      .run('That folder does not exist on the server.', at, at, rootId);
    /* The whole folder is not there — an unplugged drive, a share not yet
       mounted. Nothing is marked missing and nothing is dropped: a scan that
       can see no files is not evidence that the files are gone. */
    return { found: 0, removed: 0, missing: 0, unmatched: 0, errors: 1, error: 'missing' };
  }

  const files = walk(root.path);
  const stats = { found: 0, unmatched: 0, errors: 0, missing: 0, removed: 0, total: files.length };
  if (jobId) jobProgress(jobId, { total: files.length });

  /* One file at a time rather than one transaction for the lot: a scan of a
     few thousand should show progress as it goes, and one unreadable file
     must not roll back the three thousand that were fine. */
  const handle = (file, rel, name) => {
    const facts = fileFacts(file);
    if (!facts) { stats.errors++; return; }
    if (root.kind === 'movies') upsertMovie(db, root, rel, file, name, facts, at);
    else if (root.kind === 'series') {
      if (!upsertEpisode(db, root, rel, file, name, facts, at)) { stats.unmatched++; return; }
    }
    else upsertRecording(db, root, rel, file, name, facts, at);
    stats.found++;
  };

  for (const file of files) {
    const rel = path.relative(root.path, file);
    const name = path.basename(file);
    try {
      handle(file, rel, name);
    } catch (e) {
      /* One bad file does not end a scan. */
      stats.errors++;
      try { noteUnmatched(db, root, rel, file, name, 0, String((e && e.message) || e).slice(0, 200), at); }
      catch { /* if even that fails, the count still records it */ }
    }
    const processed = stats.found + stats.unmatched + stats.errors;
    if (jobId && processed % 25 === 0) jobProgress(jobId, { processed });
    /* One file done. A caller draining this slowly lets the event loop run
       here, so a client polling the job is answered mid-scan. */
    yield stats;
  }

  const tx = db.transaction(() => {
    const gone = sweep(db, root, at);
    stats.missing = gone.missing;
    stats.removed = gone.dropped;
    db.prepare('DELETE FROM unmatched_media WHERE folder_id = ? AND seen_at <> ?').run(rootId, at);
    const count =
      root.kind === 'movies' ? db.prepare('SELECT COUNT(*) n FROM movies WHERE root_id = ?').get(rootId).n
      : root.kind === 'series' ? db.prepare(`SELECT COUNT(*) n FROM episodes e
            JOIN series s ON s.id = e.series_id WHERE s.root_id = ?`).get(rootId).n
      : db.prepare('SELECT COUNT(*) n FROM recordings WHERE root_id = ?').get(rootId).n;
    db.prepare('UPDATE media_folders SET last_scan_at = ?, last_error = NULL, item_count = ?, updated_at = ? WHERE id = ?')
      .run(at, count, at, rootId);
  });
  tx();

  if (jobId) jobProgress(jobId, { processed: stats.found + stats.unmatched + stats.errors });
  return { ...stats, scannedAt: at };
}

/* Probing costs a process per file, so it is only done for a file that is new
   or has changed since the last time it was looked at. */
function probeIfNeeded(db, table, row, file, facts) {
  if (row && row.probed_at && row.modified_at === facts.modified) return null;
  return probeFile(file);
}

function upsertMovie(db, root, rel, file, name, facts, at) {
  const title = cleanTitle(name);
  const existing = db.prepare('SELECT id, modified_at, probed_at FROM movies WHERE root_id = ? AND rel_path = ?')
    .get(root.id, rel);
  const tech = probeIfNeeded(db, 'movies', existing, file, facts);
  db.prepare(`INSERT INTO movies
      (root_id, rel_path, path, title, title_key, year, poster, container, size_bytes, modified_at,
       duration_ms, video_codec, audio_codec, width, height, probed_at, added_at, updated_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, rel_path) DO UPDATE SET
        path = excluded.path, title = excluded.title, title_key = excluded.title_key,
        year = excluded.year, poster = excluded.poster, container = excluded.container,
        size_bytes = excluded.size_bytes, modified_at = excluded.modified_at,
        duration_ms = CASE WHEN excluded.probed_at IS NULL THEN movies.duration_ms ELSE excluded.duration_ms END,
        video_codec = CASE WHEN excluded.probed_at IS NULL THEN movies.video_codec ELSE excluded.video_codec END,
        audio_codec = CASE WHEN excluded.probed_at IS NULL THEN movies.audio_codec ELSE excluded.audio_codec END,
        width       = CASE WHEN excluded.probed_at IS NULL THEN movies.width ELSE excluded.width END,
        height      = CASE WHEN excluded.probed_at IS NULL THEN movies.height ELSE excluded.height END,
        probed_at   = COALESCE(excluded.probed_at, movies.probed_at),
        updated_at = excluded.updated_at, seen_at = excluded.seen_at`)
    .run(root.id, rel, file, title, title.toLowerCase(), yearOf(name) ?? yearOf(rel),
         posterFor(file), facts.container, facts.size, facts.modified,
         tech ? tech.durationMs : 0, tech ? tech.videoCodec : '', tech ? tech.audioCodec : '',
         tech ? tech.width : 0, tech ? tech.height : 0, tech ? at : null, at, at, at);
}

/**
 * Returns false when the file could not be confidently placed, so the caller
 * can list it rather than file it in the wrong series. A video in a TV folder
 * with nothing in its name or its path saying which episode it is is exactly
 * the case where guessing does harm.
 */
function upsertEpisode(db, root, rel, file, name, facts, at) {
  const ep = episodeOf(name) || episodeOf(rel);
  if (!ep) {
    noteUnmatched(db, root, rel, file, name, facts.size,
      'No season and episode in the name or the folders above it.', at);
    return false;
  }

  const seriesTitle = seriesOf(rel, name);
  if (!seriesTitle) {
    noteUnmatched(db, root, rel, file, name, facts.size, 'No series name could be read from it.', at);
    return false;
  }
  const key = seriesTitle.toLowerCase();
  const folder = path.dirname(file);

  db.prepare(`INSERT INTO series (root_id, title, title_key, year, poster, folder_path, added_at, updated_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, title_key) DO UPDATE SET seen_at = excluded.seen_at, updated_at = excluded.updated_at`)
    .run(root.id, seriesTitle, key, yearOf(rel), '', seriesFolder(root.path, rel), at, at, at);
  const series = db.prepare('SELECT id, poster FROM series WHERE root_id = ? AND title_key = ?').get(root.id, key);
  if (!series.poster) {
    const art = posterFor(file) || posterFor(path.join(path.dirname(folder), 'x'));
    if (art) db.prepare('UPDATE series SET poster = ? WHERE id = ?').run(art, series.id);
  }

  /* A season is a record of its own, so an episode belongs to one rather than
     carrying a number that happens to match. */
  db.prepare(`INSERT INTO seasons (series_id, season_number, created_at) VALUES (?, ?, ?)
      ON CONFLICT(series_id, season_number) DO NOTHING`).run(series.id, ep.season, at);
  const season = db.prepare('SELECT id FROM seasons WHERE series_id = ? AND season_number = ?')
    .get(series.id, ep.season);

  const existing = db.prepare('SELECT id, modified_at, probed_at FROM episodes WHERE series_id = ? AND rel_path = ?')
    .get(series.id, rel);
  const tech = probeIfNeeded(db, 'episodes', existing, file, facts);

  db.prepare(`INSERT INTO episodes
      (series_id, season_id, season, episode, title, rel_path, path, container, size_bytes, modified_at,
       duration_ms, video_codec, audio_codec, width, height, probed_at, added_at, updated_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_id, rel_path) DO UPDATE SET
        season_id = excluded.season_id, season = excluded.season, episode = excluded.episode,
        title = excluded.title, path = excluded.path, container = excluded.container,
        size_bytes = excluded.size_bytes, modified_at = excluded.modified_at,
        duration_ms = CASE WHEN excluded.probed_at IS NULL THEN episodes.duration_ms ELSE excluded.duration_ms END,
        video_codec = CASE WHEN excluded.probed_at IS NULL THEN episodes.video_codec ELSE excluded.video_codec END,
        audio_codec = CASE WHEN excluded.probed_at IS NULL THEN episodes.audio_codec ELSE excluded.audio_codec END,
        width       = CASE WHEN excluded.probed_at IS NULL THEN episodes.width ELSE excluded.width END,
        height      = CASE WHEN excluded.probed_at IS NULL THEN episodes.height ELSE excluded.height END,
        probed_at   = COALESCE(excluded.probed_at, episodes.probed_at),
        updated_at = excluded.updated_at, seen_at = excluded.seen_at`)
    .run(series.id, season.id, ep.season, ep.episode, episodeTitleOf(name), rel, file,
         facts.container, facts.size, facts.modified,
         tech ? tech.durationMs : 0, tech ? tech.videoCodec : '', tech ? tech.audioCodec : '',
         tech ? tech.width : 0, tech ? tech.height : 0, tech ? at : null, at, at, at);
  return true;
}

/** The series' own folder: the one above "Season 1", where there is one. */
function seriesFolder(rootPath, rel) {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  parts.pop();                                     // the file
  while (parts.length && /^(season|series|s)[ ._-]?\d+$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.length ? path.join(rootPath, ...parts) : rootPath;
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

  const existing = db.prepare('SELECT id, modified_at, probed_at FROM recordings WHERE root_id = ? AND rel_path = ?')
    .get(root.id, rel);
  const tech = probeIfNeeded(db, 'recordings', existing, file, facts);

  db.prepare(`INSERT INTO recordings
      (root_id, rel_path, path, title, title_key, channel_name, recorded_at, container, size_bytes, modified_at,
       duration_ms, video_codec, audio_codec, width, height, probed_at, added_at, updated_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_id, rel_path) DO UPDATE SET
        path = excluded.path, title = excluded.title, title_key = excluded.title_key,
        channel_name = excluded.channel_name, recorded_at = excluded.recorded_at,
        container = excluded.container, size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at,
        duration_ms = CASE WHEN excluded.probed_at IS NULL THEN recordings.duration_ms ELSE excluded.duration_ms END,
        video_codec = CASE WHEN excluded.probed_at IS NULL THEN recordings.video_codec ELSE excluded.video_codec END,
        audio_codec = CASE WHEN excluded.probed_at IS NULL THEN recordings.audio_codec ELSE excluded.audio_codec END,
        width       = CASE WHEN excluded.probed_at IS NULL THEN recordings.width ELSE excluded.width END,
        height      = CASE WHEN excluded.probed_at IS NULL THEN recordings.height ELSE excluded.height END,
        probed_at   = COALESCE(excluded.probed_at, recordings.probed_at),
        updated_at = excluded.updated_at, seen_at = excluded.seen_at`)
    .run(root.id, rel, file, title, title.toLowerCase(), channel, recordedAt,
         facts.container, facts.size, facts.modified,
         tech ? tech.durationMs : 0, tech ? tech.videoCodec : '', tech ? tech.audioCodec : '',
         tech ? tech.width : 0, tech ? tech.height : 0, tech ? at : null, at, at, at);
}

/** Rows this scan did not see: the files are gone from disk. */
function sweep(db, root, at) {
  /* The cut-off for dropping a row: missing since before this is gone for
     good, missing since after it is being waited for. */
  const cutoff = new Date(Date.parse(at) - config.media.missingGraceSeconds * 1000).toISOString();
  const table = root.kind === 'series' ? 'episodes' : root.kind === 'movies' ? 'movies' : 'recordings';
  const scope = table === 'episodes'
    ? 'series_id IN (SELECT id FROM series WHERE root_id = ?)'
    : 'root_id = ?';

  /* Seen again: whatever was being waited for is back. */
  db.prepare(`UPDATE ${table} SET missing_since = NULL
      WHERE ${scope} AND seen_at = ? AND missing_since IS NOT NULL`).run(root.id, at);

  /* Not seen, and not already being waited for: start waiting. */
  const marked = db.prepare(`UPDATE ${table} SET missing_since = ?
      WHERE ${scope} AND seen_at <> ? AND missing_since IS NULL`).run(at, root.id, at).changes;

  /* Waited long enough. */
  const dropped = db.prepare(`DELETE FROM ${table}
      WHERE ${scope} AND seen_at <> ? AND missing_since IS NOT NULL AND missing_since < ?`)
    .run(root.id, at, cutoff).changes;

  if (root.kind === 'series') {
    /* A season or a series is only ever a container for episodes, so it goes
       when the last episode under it has gone — never while one is merely
       being waited for. */
    db.prepare(`DELETE FROM seasons WHERE series_id IN (SELECT id FROM series WHERE root_id = ?)
                AND id NOT IN (SELECT season_id FROM episodes WHERE season_id IS NOT NULL)`).run(root.id);
    db.prepare(`DELETE FROM series WHERE root_id = ?
                AND id NOT IN (SELECT series_id FROM episodes)`).run(root.id);
  }
  return { missing: marked, dropped };
}

/**
 * Scan everything, or everything of one kind, as a job that can be watched.
 * A generator again, for the same reason: it yields once per file, so the
 * caller decides whether to drain it in one go or let the event loop run in
 * between and keep the server answering.
 */
export function* scanAllSteps({ kind = 'all', jobId = null } = {}) {
  const out = [];
  const totals = { movies: 0, series: 0, episodes: 0, recordings: 0, unmatched: 0, missing: 0, removed: 0, errors: 0 };
  const wanted = kind === 'all' ? ['movies', 'series', 'recordings']
    : kind === 'tv' ? ['series'] : [kind];

  for (const r of listRoots()) {
    if (!r.enabled || !wanted.includes(r.kind)) continue;
    try {
      const got = yield* scanRootSteps(r.id, { jobId });
      out.push({ id: r.id, label: r.label, kind: r.kind, ...got });
      totals.unmatched += got.unmatched || 0;
      totals.missing += got.missing || 0;
      totals.removed += got.removed || 0;
      totals.errors += got.errors || 0;
    } catch (e) {
      totals.errors++;
      out.push({ id: r.id, label: r.label, kind: r.kind, error: e.message });
    }
  }

  /* The completion summary counts what the library now holds, which is what
     somebody reading "Movies found: 412" takes it to mean — so a row waiting
     out the grace period is not counted among them. */
  const db = openDb();
  totals.movies = db.prepare(`SELECT COUNT(*) n FROM movies WHERE ${PRESENT}`).get().n;
  totals.series = db.prepare(`SELECT COUNT(*) n FROM series s
      WHERE EXISTS (SELECT 1 FROM episodes e WHERE e.series_id = s.id AND e.${PRESENT})`).get().n;
  totals.episodes = db.prepare(`SELECT COUNT(*) n FROM episodes WHERE ${PRESENT}`).get().n;
  totals.recordings = db.prepare(`SELECT COUNT(*) n FROM recordings WHERE ${PRESENT}`).get().n;
  if (jobId) jobProgress(jobId, totals);
  return { folders: out, totals };
}

/* ---------------------------------------------------- draining the above --
   Two ways to run the same scan. `drain` is the straight loop, for the
   scheduler and for a test that wants the answer and nothing else.
   `drainSlowly` hands the event loop back every so often, so a request
   asking "how far along is it?" is answered while the scan is still going:
   better-sqlite3 is synchronous, and without this the server would sit mute
   for the length of the scan and the progress figure would only ever arrive
   once it was already finished. */

function drain(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

async function drainSlowly(steps, every = 40) {
  let n = 0;
  let r = steps.next();
  while (!r.done) {
    if (++n % every === 0) await new Promise(resolve => setImmediate(resolve));
    r = steps.next();
  }
  return r.value;
}

export function scanRoot(rootId, opts = {}) { return drain(scanRootSteps(rootId, opts)); }
export function scanAll(opts = {}) { return drain(scanAllSteps(opts)); }

/** The whole thing as a job: start it, run it, record how it went. */
export function runScan(kind = 'all') {
  const jobId = startJob(kind);
  try {
    const result = scanAll({ kind, jobId });
    finishJob(jobId, 'done');
    return { job: getJob(jobId), ...result };
  } catch (e) {
    finishJob(jobId, 'failed', e.message);
    throw e;
  }
}

/**
 * The same scan, run so the server stays answerable.
 *
 * One at a time: a second request while a scan is running is told about the
 * one already going rather than starting a rival pass over the same folders.
 */
let scanning = null;

export function scanInFlight() {
  return scanning ? getJob(scanning.jobId) : null;
}

export function runScanLive(kind = 'all') {
  if (scanning) return scanning.promise;
  const jobId = startJob(kind);
  const promise = (async () => {
    try {
      const result = await drainSlowly(scanAllSteps({ kind, jobId }));
      finishJob(jobId, 'done');
      return { job: getJob(jobId), ...result };
    } catch (e) {
      finishJob(jobId, 'failed', e.message);
      throw e;
    } finally {
      scanning = null;
    }
  })();
  scanning = { jobId, promise };
  return promise;
}

/* --------------------------------------------------------------- reading -- */

/** The client's view. No path, ever — playback goes through an id and a ticket. */
export function publicMovie(m) {
  return {
    id: m.id, kind: 'movie', title: m.title, year: m.year, genre: m.genre,
    description: m.description, poster: m.poster ? `/api/v1/art/movie/${m.id}` : '',
    container: m.container, sizeBytes: m.size_bytes, durationMs: m.duration_ms,
    videoCodec: m.video_codec || '', audioCodec: m.audio_codec || '',
    width: m.width || 0, height: m.height || 0,
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
    seasonDbId: e.season_id || null,
    title: e.title || `Episode ${e.episode}`, container: e.container, sizeBytes: e.size_bytes,
    durationMs: e.duration_ms,
    videoCodec: e.video_codec || '', audioCodec: e.audio_codec || '',
    width: e.width || 0, height: e.height || 0,
    seriesTitle: e.series_title || undefined,
    playback: `/api/v1/stream/media/episode/${e.id}`
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
  const where = [PRESENT], args = [];
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
  /* A series is listed while it still has an episode anybody could play. */
  const where = [`EXISTS (SELECT 1 FROM episodes e WHERE e.series_id = s.id AND e.${PRESENT})`], args = [];
  if (search) { where.push('s.title_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }
  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM series s WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id AND e.${PRESENT}) AS episode_count,
        (SELECT COUNT(DISTINCT season) FROM episodes e WHERE e.series_id = s.id AND e.${PRESENT}) AS season_count
      FROM series s WHERE ${where.join(' AND ')} ORDER BY s.title_key LIMIT ? OFFSET ?`).all(...args, l, o);
  return {
    total,
    items: rows.map(r => publicSeries(r, { episodeCount: r.episode_count, seasonCount: r.season_count }))
  };
}

export function oneSeries(id) {
  const row = openDb().prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id AND e.${PRESENT}) AS episode_count,
        (SELECT COUNT(DISTINCT season) FROM episodes e WHERE e.series_id = s.id AND e.${PRESENT}) AS season_count
      FROM series s WHERE s.id = ?`).get(id);
  if (!row) throw notFound('No such series.');
  return row;
}

export function episodesOf(seriesId, { season } = {}) {
  oneSeries(seriesId);
  const where = ['series_id = ?', PRESENT], args = [seriesId];
  if (season != null && season !== '') { where.push('season = ?'); args.push(Number(season)); }
  const rows = openDb().prepare(`SELECT * FROM episodes WHERE ${where.join(' AND ')}
      ORDER BY season, episode, rel_path`).all(...args);
  return rows.map(publicEpisode);
}

export function recordings({ search, limit, offset } = {}) {
  const { limit: l, offset: o } = page(limit, offset);
  const where = [PRESENT], args = [];
  if (search) { where.push('title_key LIKE ?'); args.push(`%${String(search).toLowerCase()}%`); }
  const db = openDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM recordings WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM recordings WHERE ${where.join(' AND ')}
      ORDER BY recorded_at DESC, title_key LIMIT ? OFFSET ?`).all(...args, l, o);
  return { total, items: rows.map(publicRecording) };
}

/**
 * Is this path inside a folder the operator approved?
 *
 * The client only ever sends an id, so a path cannot be smuggled in — but a
 * row could still be wrong, through a bad import, a renamed folder, or a
 * symlink inside a media folder pointing somewhere else entirely. So the
 * answer is checked rather than assumed, on the way out, every time.
 *
 * Compared after resolution, and on a boundary: /srv/media-private must not
 * pass because /srv/media was approved.
 */
export function withinApprovedFolder(file, folders = null) {
  const target = path.resolve(String(file || ''));
  if (!target) return false;
  const roots = folders || openDb().prepare('SELECT path FROM media_folders').all().map(r => r.path);
  for (const root of roots) {
    const base = path.resolve(root);
    if (target === base) return true;
    if (target.startsWith(base.endsWith(path.sep) ? base : base + path.sep)) return true;
  }
  return false;
}

/**
 * The row behind a playable id, with its path — for this process only, and
 * only once the path has been checked against the approved folders.
 */
export function playableMedia(kind, id) {
  const db = openDb();
  const row =
    kind === 'movie' ? db.prepare('SELECT id, path, container, title FROM movies WHERE id = ?').get(id)
    : kind === 'episode' ? db.prepare('SELECT id, path, container, title FROM episodes WHERE id = ?').get(id)
    : kind === 'recording' ? db.prepare('SELECT id, path, container, title FROM recordings WHERE id = ?').get(id)
    : null;
  if (!row) throw notFound('No such item.');
  if (!withinApprovedFolder(row.path)) {
    // Refused rather than served: a row pointing outside the approved folders
    // is a fault, and serving it would be the fault that matters.
    throw forbidden('That file is not inside a configured media folder.');
  }
  return row;
}

/** Artwork is served from disk by id, so the path stays on the server. */
export function artworkPath(kind, id) {
  const db = openDb();
  const row = kind === 'movie' ? db.prepare('SELECT poster FROM movies WHERE id = ?').get(id)
            : kind === 'series' ? db.prepare('SELECT poster FROM series WHERE id = ?').get(id)
            : null;
  if (!row || !row.poster) throw notFound('No artwork for that.');
  if (!withinApprovedFolder(row.poster)) throw forbidden('That artwork is not inside a configured media folder.');
  return row.poster;
}

/* ------------------------------------------------------------- seasons -- */

export function seasonsOf(seriesId) {
  oneSeries(seriesId);
  return openDb().prepare(`SELECT s.id, s.season_number, s.title, s.poster,
        (SELECT COUNT(*) FROM episodes e WHERE e.season_id = s.id AND e.${PRESENT}) AS episode_count
      FROM seasons s WHERE s.series_id = ? ORDER BY s.season_number`).all(seriesId)
    .map(r => ({ id: r.id, seriesId: Number(seriesId), season: r.season_number,
                 title: r.title, episodes: r.episode_count }));
}

export function episode(id) {
  const row = openDb().prepare(`SELECT e.*, s.title AS series_title FROM episodes e
      JOIN series s ON s.id = e.series_id WHERE e.id = ?`).get(id);
  if (!row) throw notFound('No such episode.');
  return row;
}
