import { config } from '../config.js';
import { openDb, nowIso } from '../db/index.js';
import { listSources, syncSource } from './sources.js';
import { listEpgSources, syncEpgSource, epgNeedsSync } from './xmltv.js';
import { listRoots, scanRoot } from './media.js';
import { sweep } from './health.js';
import { runAllImports, syncLocalProvider } from './importer.js';
import { artworkPass } from './posters.js';

/**
 * The background refresher.
 *
 * One timer, one pass. It does the least surprising thing at every turn:
 *
 *  · a source is refreshed on its own interval, not a global one;
 *  · a failure never empties the catalogue. syncSource replaces channels only
 *    after a successful fetch, so a source that cannot be reached keeps the
 *    channels it had, gets its error recorded, and is tried again later;
 *  · failures back off. The second attempt waits fifteen minutes, the next
 *    half an hour, and so on to a ceiling, so a dead address is not fetched
 *    three hundred times a day;
 *  · nothing overlaps. A pass that is still running is not started again.
 */

let timer = null;
let running = false;

export function dueForRefresh(source, now = Date.now()) {
  if (!source.enabled) return false;
  const interval = Number(source.refresh_interval_seconds) || config.playlistTtlSeconds;
  if (!source.last_synced_at && !source.last_attempt_at) return true;

  // A failing source waits longer each time, from its last attempt.
  if (source.fail_count > 0 && source.last_attempt_at) {
    const wait = Math.min(
      config.refresh.backoffSeconds * Math.pow(2, Math.min(source.fail_count - 1, 8)),
      config.refresh.maxBackoffSeconds);
    return (now - Date.parse(source.last_attempt_at)) / 1000 >= wait;
  }
  if (!source.last_synced_at) return true;
  return (now - Date.parse(source.last_synced_at)) / 1000 >= interval;
}

export function dueForEpg(src, now = Date.now()) {
  if (!src.enabled) return false;
  if (src.fail_count > 0 && src.last_attempt_at) {
    const wait = Math.min(
      config.refresh.backoffSeconds * Math.pow(2, Math.min(src.fail_count - 1, 8)),
      config.refresh.maxBackoffSeconds);
    return (now - Date.parse(src.last_attempt_at)) / 1000 >= wait;
  }
  return epgNeedsSync(src, now);
}

export function dueForScan(root, now = Date.now()) {
  if (!root.enabled || !config.media.scanEnabled) return false;
  if (!root.last_scan_at) return true;
  return (now - Date.parse(root.last_scan_at)) / 1000 >= config.media.scanIntervalSeconds;
}

/** One pass. Returns what it did, which is what the tests read. */
export async function runOnce({ log = null, fetchImpl = fetch, now = Date.now(), checker = null } = {}) {
  const done = { playlists: [], guides: [], scans: [], health: null, imports: [], artwork: null };
  const db = openDb();

  for (const src of listSources()) {
    if (!dueForRefresh(src, now)) continue;
    db.prepare('UPDATE sources SET last_attempt_at = ? WHERE id = ?').run(nowIso(), src.id);
    try {
      const r = await syncSource(src.id, { fetchImpl });
      db.prepare('UPDATE sources SET fail_count = 0 WHERE id = ?').run(src.id);
      done.playlists.push({ id: src.id, name: src.name, ok: true, channels: r.channels });
    } catch (e) {
      // The channels it already had are untouched: see syncSource.
      db.prepare('UPDATE sources SET fail_count = fail_count + 1 WHERE id = ?').run(src.id);
      done.playlists.push({ id: src.id, name: src.name, ok: false, error: e.message });
      if (log) log.warn(`Playlist "${src.name}" did not refresh: ${e.message}. Its channels are kept.`);
    }
  }

  for (const src of listEpgSources()) {
    if (!dueForEpg(src, now)) continue;
    try {
      const r = await syncEpgSource(src.id, { fetchImpl });
      done.guides.push({ id: src.id, name: src.name, ok: true, programmes: r.programmes });
    } catch (e) {
      done.guides.push({ id: src.id, name: src.name, ok: false, error: e.message });
      if (log) log.warn(`Guide "${src.name}" did not refresh: ${e.message}. The last one is kept.`);
    }
  }

  for (const root of listRoots()) {
    if (!dueForScan(root, now)) continue;
    try {
      const r = scanRoot(root.id);
      done.scans.push({ id: root.id, label: root.label, ok: true, found: r.found, removed: r.removed });
    } catch (e) {
      done.scans.push({ id: root.id, label: root.label, ok: false, error: e.message });
      if (log) log.warn(`Media folder "${root.label}" did not scan: ${e.message}`);
    }
  }
  /* Anything a scan found goes into the catalogue in the same pass, for the
     same reason it does when somebody presses the button. */
  if (done.scans.some(s => s.ok)) await syncLocalProvider({ log });

  /* Catalogue providers, each on its own interval, and only the ones that are
     due — which is never one that may not be imported from, because such a
     provider cannot be enabled. A provider having a bad day backs off on its
     own; see dueForImport. */
  try {
    done.imports = await runAllImports({ fetchImpl, log, dueOnly: true });
  } catch (e) {
    if (log) log.warn(`Catalogue import pass failed: ${e.message}`);
  }

  /* Posters for whatever has not got one, a batch at a time. Deliberately
     after the imports, so anything that has just arrived is considered, and
     deliberately bounded: the TMDB ration is per pass, and a title nothing
     has a poster for is marked so the next pass leaves it alone. */
  try {
    done.artwork = await artworkPass({ log });
  } catch (e) {
    if (log) log.warn(`Artwork pass failed: ${e.message}`);
  }

  /* A slice of the channels whose checks are due, never all of them: a few
     at a time, on a widening interval, so this is a trickle rather than the
     server opening a thousand sockets at once. */
  if (config.health.enabled) {
    try {
      done.health = await sweep(Object.assign(
        { limit: config.health.batch },
        checker ? { checker } : {}));
    } catch (e) {
      if (log) log.warn(`Channel health sweep failed: ${e.message}`);
    }
  }

  return done;
}

export function startScheduler(app) {
  if (!config.refresh.enabled || timer) return null;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runOnce({ log: app && app.log }); }
    catch (e) { if (app) app.log.error({ err: e }, 'refresh pass failed'); }
    finally { running = false; }
  };
  timer = setInterval(tick, config.refresh.tickSeconds * 1000);
  if (timer.unref) timer.unref();          // never hold the process open
  setTimeout(tick, 2000).unref?.();        // one pass shortly after boot
  return timer;
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
