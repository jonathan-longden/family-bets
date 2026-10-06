import { spawn } from 'node:child_process';
import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';

/**
 * Channel health.
 *
 * A public playlist is mostly dead links, and an HTTP 200 proves almost
 * nothing: a dead IPTV endpoint commonly answers 200 with an HTML error page,
 * an empty body, or a manifest listing segments that 404. So a channel is
 * only called working when something has looked at what came back and found
 * media in it.
 *
 * Two ways of looking, in order of preference:
 *
 *   ffprobe   where it is installed. It is asked for the stream's first few
 *             packets and nothing else — analyzeduration and probesize are
 *             held down and the whole thing is killed on a timeout — so a
 *             check costs a few hundred kilobytes, not a film.
 *
 *   the bytes themselves, otherwise. An HLS manifest has to start #EXTM3U and
 *             name at least one segment or variant; an MPEG-TS has to carry
 *             the 0x47 sync byte every 188 bytes; anything calling itself
 *             video has to be more than a stub. That is weaker than ffprobe
 *             and stronger than a status code, and it is said plainly rather
 *             than being passed off as a media probe.
 *
 * Nothing is deleted for failing. A channel that fails goes temporarily
 * unavailable, is checked again later on a widening interval, and comes back
 * on its own if the stream does.
 */

export const STATUS = {
  unchecked: 'unchecked',
  working: 'working',
  temporary: 'temporarily_unavailable',
  failed: 'failed',
  /* Reachable, answering, and in a format no browser can decode — a raw
     MPEG-TS stream, or an rtmp:// address. Kept apart from the unavailable
     ones on purpose: calling it offline would be untrue, and it is a
     different problem with a different answer (a native player opens it). */
  incompatible: 'browser_incompatible'
};

/**
 * Which statuses Live TV shows.
 *
 * `working` because it was proved to play, and `unchecked` because a channel
 * nobody has looked at yet is not evidence of a broken channel — a library
 * imported thirty seconds ago would otherwise be an empty screen. A sync now
 * checks what it imports, so `unchecked` is a short-lived state rather than a
 * standing excuse.
 *
 * Everything else is hidden and kept: the row, its metadata, its history and
 * anybody's favourite of it all stay exactly where they were.
 */
export const VISIBLE = [STATUS.working, STATUS.unchecked];
export const HIDDEN = [STATUS.temporary, STATUS.failed, STATUS.incompatible];

/** The four words the settings screen and the API speak. */
export function plainStatus(status) {
  if (status === STATUS.working) return 'working';
  if (status === STATUS.incompatible) return 'browser_incompatible';
  if (status === STATUS.unchecked) return 'unknown';
  return 'unavailable';                  // temporarily_unavailable and failed
}

/* How long to wait before looking at a channel again. A working channel is
   not worth rechecking often; a failing one is backed off until it is barely
   worth the connection, and never dropped. */
export function nextCheckDue(row, now = Date.now()) {
  // Never looked at: due now.
  if (!row.last_checked_at) return true;
  const since = now - Date.parse(row.last_checked_at);
  const h = 3600e3;
  /* Answering, and nothing has gone wrong since: leave it alone for a day.
     browser_incompatible counts as settled — the stream answered, it is the
     format that is wrong, and a format does not heal in half an hour.
     A channel still shown as working but carrying a failure is inside the
     grace period, so it goes on the retry clock instead: the point of the
     grace is a second look soon, not a day's reprieve. */
  const settled = row.health_status === STATUS.working || row.health_status === STATUS.incompatible;
  if (settled && !row.consecutive_failures) return since >= config.health.workingIntervalHours * h;
  const fails = Math.max(row.consecutive_failures || 0, 1);
  const wait = Math.min(config.health.retryBaseMinutes * Math.pow(2, fails - 1), config.health.maxRetryHours * 60);
  return since >= wait * 60e3;
}

/* A stream address that cannot be played by anything is not worth a
   connection: say so at once and spend the check on something else. */
export function addressProblem(url) {
  const u = String(url || '').trim();
  if (!u) return { reason: 'The playlist gives no address for this channel.', incompatible: false };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    return { reason: 'That is not a stream address.', incompatible: false };
  }
  const scheme = u.slice(0, u.indexOf(':')).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    /* rtmp, rtsp, udp. Nothing is wrong with the channel — a browser simply
       does not speak the protocol, and a desktop player does. Reported as an
       incompatibility so it is not counted among the dead. */
    return {
      reason: `A ${scheme}:// stream cannot be opened by a browser. A player such as VLC can.`,
      incompatible: true
    };
  }
  return null;
}

/** Does this address advertise itself as HLS, which a browser can play? */
const looksLikeHls = (url) => /\.m3u8(\?|$)|[?&](?:type|ext)=m3u8/i.test(String(url || ''));

/**
 * What a probe result means for a browser.
 *
 * The distinction the brief asks for: a stream that cannot be reached and a
 * stream that is reachable but unplayable here are different findings.
 *
 *   an HLS manifest        hls.js plays it — working
 *   an MP4 or fragmented   <video> plays it — working
 *   raw MPEG-TS bytes      nothing in a browser decodes these, and the
 *                          address is not a manifest, so there is no variant
 *                          to fall back to — browser_incompatible
 *   mpegts via ffprobe     the same finding, found the other way
 */
export function classify(result, url = '') {
  if (!result.ok) {
    return { status: result.incompatible ? STATUS.incompatible : null, ok: false };
  }
  const raw = result.kind === 'mpegts' ||
    (result.kind === 'ffprobe' && /mpegts/i.test(String(result.format || '')));
  if (raw && !looksLikeHls(url)) {
    return {
      ok: true,
      status: STATUS.incompatible,
      reason: 'This is a raw MPEG-TS stream. It answers, but no browser can decode it; ' +
        'the Android app can.'
    };
  }
  return { ok: true, status: STATUS.working };
}

/** Does this actually look like media, rather than a page saying sorry? */
export function looksLikeMedia(bytes, contentType = '', url = '') {
  const ct = String(contentType).toLowerCase();
  if (/text\/html/.test(ct)) return { ok: false, reason: 'The server answered with a web page, not a stream.' };
  if (!bytes || !bytes.length) return { ok: false, reason: 'The stream answered with nothing.' };

  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('utf8');
  if (/^\s*#EXTM3U/.test(head)) {
    // A manifest that names nothing is a manifest for nothing.
    if (!/#EXT-X-STREAM-INF|#EXTINF|\.ts|\.m4s|\.aac|\.mp4/i.test(head)) {
      return { ok: false, reason: 'The playlist came back empty — no segments and no variants in it.' };
    }
    return { ok: true, kind: 'hls' };
  }
  if (/^\s*</.test(head)) return { ok: false, reason: 'The server answered with a page, not a stream.' };

  // MPEG-TS: 0x47 every 188 bytes. Three in a row is not a coincidence.
  if (bytes.length >= 188 * 3) {
    let hits = 0;
    for (let i = 0; i + 188 * 2 < bytes.length && i < 188; i++) {
      if (bytes[i] === 0x47 && bytes[i + 188] === 0x47 && bytes[i + 376] === 0x47) { hits++; break; }
    }
    if (hits) return { ok: true, kind: 'mpegts' };
  }
  // An MP4/fMP4 begins with a box, usually ftyp or styp.
  if (bytes.length > 12 && /ftyp|styp|moov|moof/.test(Buffer.from(bytes.subarray(0, 16)).toString('latin1'))) {
    return { ok: true, kind: 'mp4' };
  }
  if (/^(video|audio|application\/(x-mpegurl|vnd\.apple\.mpegurl|octet-stream|dash))/.test(ct) && bytes.length >= 1024) {
    return { ok: true, kind: 'bytes' };
  }
  return { ok: false, reason: 'What came back does not look like a playable stream.' };
}

/** Read a little of the stream — never a lot of it — and look at it. */
export async function probeByBytes(url, { timeoutMs = config.health.timeoutMs, fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Telly-Server/1.0', range: 'bytes=0-65535' }
    });
    if (!res.ok && res.status !== 206) {
      return { ok: false, reason: `The stream answered ${res.status}${res.statusText ? ' ' + res.statusText : ''}.` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return looksLikeMedia(buf, res.headers.get('content-type') || '', url);
  } catch (e) {
    const why = e && e.name === 'AbortError'
      ? `Nothing came back within ${Math.round(timeoutMs / 1000)} seconds.`
      : `Could not reach the stream: ${(e && e.message) || e}`;
    return { ok: false, reason: why };
  } finally {
    clearTimeout(timer);
  }
}

/** ffprobe, asked for as little as it can be asked for. */
export function ffprobeArgs(url, timeoutMs) {
  return [
    '-v', 'error',
    '-rw_timeout', String(timeoutMs * 1000),      // microseconds, for network reads
    '-analyzeduration', String(config.health.analyzeMicroseconds),
    '-probesize', String(config.health.probeBytes),
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height:format=format_name',
    '-of', 'json',
    url
  ];
}

export function probeByFfprobe(url, { timeoutMs = config.health.timeoutMs } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(config.ffmpeg.ffprobePath, ffprobeArgs(url, timeoutMs), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, reason: `ffprobe would not start: ${e.message}`, unavailable: true });
    }
    let out = '', err = '', settled = false;
    const done = (r) => { if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch {} resolve(r); } };
    const timer = setTimeout(() => done({ ok: false, reason: `Nothing came back within ${Math.round(timeoutMs / 1000)} seconds.` }), timeoutMs + 2000);
    child.stdout.on('data', d => { if (out.length < 20000) out += d; });
    child.stderr.on('data', d => { if (err.length < 4000) err += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, reason: `ffprobe would not start: ${e.message}`, unavailable: true }); });
    child.on('close', () => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch {}
      const stream = parsed && parsed.streams && parsed.streams[0];
      if (stream && stream.codec_name) {
        return done({
          ok: true, kind: 'ffprobe', codec: stream.codec_name,
          format: (parsed.format && parsed.format.format_name) || '',
          width: stream.width || 0, height: stream.height || 0
        });
      }
      const line = String(err).split('\n').find(Boolean) || 'ffprobe found no video stream in it.';
      done({ ok: false, reason: line.slice(0, 200) });
    });
  });
}

let ffprobeMissing = false;

/** One channel, checked the best way available. */
export async function checkStream(url, opts = {}) {
  const bad = addressProblem(url);
  if (bad) {
    return {
      ok: false, reason: bad.reason, incompatible: bad.incompatible,
      method: 'address', url, responseTimeMs: 0
    };
  }

  const started = Date.now();
  const out = (r, method) => ({ ...r, method, url, responseTimeMs: Date.now() - started });

  if (config.ffmpeg.enabled && !ffprobeMissing && !opts.bytesOnly) {
    const r = await probeByFfprobe(url, opts);
    if (r.unavailable) {
      ffprobeMissing = true;                 // say it once, then stop trying
    } else {
      return out(r, 'ffprobe');
    }
  }
  const r = await probeByBytes(url, opts);
  return out(r, 'bytes');
}

/**
 * Write what a check found against the channel.
 *
 * Three things this does and one it never does.
 *
 *   It gives a channel that was working the benefit of the doubt. One failed
 *   check leaves it visible and on the short retry clock; it takes
 *   `hideAfter` in a row to take it off Live TV. Somebody else's server
 *   hiccuping should not make the channel list flicker.
 *
 *   It restores on one good check. A stream that answers with media is
 *   answering with media, and the brief asks for it back straight away.
 *
 *   It separates "cannot be reached" from "reachable and no browser can
 *   decode it", because they are different findings and the second one is not
 *   an outage.
 *
 * What it never does is delete a row, or forget one. Everything the playlist
 * said about the channel stays exactly as it was imported.
 */
export function record(channelId, result, at = nowIso()) {
  const db = openDb();
  const row = db.prepare(`SELECT health_status, consecutive_failures, consecutive_successes
      FROM channels WHERE id = ?`).get(channelId);
  if (!row) return null;

  const verdict = classify(result, result.url || '');
  const ms = Math.max(0, Math.round(Number(result.responseTimeMs) || 0));

  if (verdict.ok) {
    const successes = (row.consecutive_successes || 0) + 1;
    if (verdict.status === STATUS.incompatible) {
      /* It answered — so last_success_at is not touched, because that column
         means "last seen working in a browser" and this was not that. The
         reason is kept so the settings screen can say which it is. */
      db.prepare(`UPDATE channels SET health_status = ?, last_checked_at = ?,
          failure_reason = ?, consecutive_failures = 0, consecutive_successes = ?,
          response_time_ms = ? WHERE id = ?`)
        .run(STATUS.incompatible, at, String(verdict.reason || '').slice(0, 300), successes, ms, channelId);
      return STATUS.incompatible;
    }
    db.prepare(`UPDATE channels SET health_status = ?, last_checked_at = ?, last_success_at = ?,
        failure_reason = '', consecutive_failures = 0, consecutive_successes = ?,
        response_time_ms = ? WHERE id = ?`)
      .run(STATUS.working, at, at, successes, ms, channelId);
    return STATUS.working;
  }

  /* An address no browser speaks is not an outage, however many times it is
     looked at. It is stored as what it is and left alone. */
  if (verdict.status === STATUS.incompatible) {
    db.prepare(`UPDATE channels SET health_status = ?, last_checked_at = ?,
        failure_reason = ?, consecutive_failures = 0, consecutive_successes = 0,
        response_time_ms = ? WHERE id = ?`)
      .run(STATUS.incompatible, at, String(result.reason || '').slice(0, 300), ms, channelId);
    return STATUS.incompatible;
  }

  const fails = (row.consecutive_failures || 0) + 1;
  let status;
  if (row.health_status === STATUS.working && fails < config.health.hideAfter) {
    status = STATUS.working;                 // the grace: still shown, looked at again soon
  } else if (fails >= config.health.failAfter) {
    status = STATUS.failed;                  // a dead channel, kept and still rechecked
  } else {
    status = STATUS.temporary;
  }
  db.prepare(`UPDATE channels SET health_status = ?, last_checked_at = ?, last_failure_at = ?,
      failure_reason = ?, consecutive_failures = ?, consecutive_successes = 0,
      response_time_ms = ? WHERE id = ?`)
    .run(status, at, at, String(result.reason || 'Unavailable.').slice(0, 300), fails, ms, channelId);
  return status;
}

/** The channels worth looking at now, oldest check first. */
export function dueChannels({ sourceId = null, limit = 200, force = false } = {}) {
  const where = ['active = 1'], args = [];
  if (sourceId) { where.push('source_id = ?'); args.push(sourceId); }
  const rows = openDb().prepare(`SELECT id, stream_url, health_status, last_checked_at, consecutive_failures
      FROM channels WHERE ${where.join(' AND ')}
      ORDER BY last_checked_at IS NOT NULL, last_checked_at
      LIMIT ?`).all(...args, Math.min(Number(limit) || 200, 5000));
  return force ? rows : rows.filter(r => nextCheckDue(r));
}

/**
 * Check a batch, a few at a time.
 *
 * The concurrency limit is the point: a thousand channels checked at once is
 * a thousand sockets, and on a home connection that is indistinguishable from
 * something going wrong.
 */
export async function sweep({ sourceId = null, limit = 200, force = false,
                              concurrency = config.health.concurrency, checker = checkStream } = {}) {
  const rows = dueChannels({ sourceId, limit, force });
  const counts = { checked: 0, working: 0, unavailable: 0, failed: 0, browser_incompatible: 0 };
  let i = 0;

  const worker = async () => {
    for (;;) {
      const row = rows[i++];
      if (!row) return;
      let result;
      try { result = await checker(row.stream_url); }
      catch (e) { result = { ok: false, reason: `The check itself failed: ${(e && e.message) || e}` }; }
      /* The address goes with the result, because deciding whether what came
         back is playable in a browser needs to know what was asked for: the
         same mpegts bytes are fine behind a manifest and useless on their
         own. checkStream carries it; a stand-in checker need not. */
      const status = record(row.id, result.url ? result : { ...result, url: row.stream_url });
      counts.checked++;
      if (status === STATUS.working) counts.working++;
      else if (status === STATUS.failed) counts.failed++;
      else if (status === STATUS.incompatible) counts.browser_incompatible++;
      else counts.unavailable++;
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 32)) }, worker));

  if (sourceId) {
    openDb().prepare('UPDATE sources SET last_health_at = ? WHERE id = ?').run(nowIso(), sourceId);
  }
  return counts;
}

/* Channels of one source that nobody has looked at yet — what a fresh import
   leaves behind. Ordered so the newest import is dealt with first. */
export function uncheckedChannels(sourceId, limit = 5000) {
  return openDb().prepare(`SELECT id, stream_url FROM channels
      WHERE source_id = ? AND active = 1 AND (health_status = ? OR last_checked_at IS NULL)
      ORDER BY id LIMIT ?`).all(sourceId, STATUS.unchecked, Math.min(Number(limit) || 5000, 20000));
}

/**
 * Check what an import just brought in.
 *
 * The brief's step four: a sync imports everything and then finds out which of
 * it plays, so the ones that do appear in Live TV and the ones that do not are
 * kept and hidden. Only the never-checked rows are touched, which is what
 * keeps a re-import from resurrecting a channel already known to be bad: its
 * row carries its history, it is not in this list, and nothing here reopens
 * the question until its own retry falls due.
 */
export async function checkImported({ sourceId, limit = 5000,
                                      concurrency = config.health.concurrency,
                                      checker = checkStream } = {}) {
  const rows = uncheckedChannels(sourceId, limit);
  const counts = { checked: 0, working: 0, unavailable: 0, failed: 0, browser_incompatible: 0 };
  let i = 0;
  const worker = async () => {
    for (;;) {
      const row = rows[i++];
      if (!row) return;
      let result;
      try { result = await checker(row.stream_url); }
      catch (e) { result = { ok: false, reason: `The check itself failed: ${(e && e.message) || e}` }; }
      /* The address goes with the result, because deciding whether what came
         back is playable in a browser needs to know what was asked for: the
         same mpegts bytes are fine behind a manifest and useless on their
         own. checkStream carries it; a stand-in checker need not. */
      const status = record(row.id, result.url ? result : { ...result, url: row.stream_url });
      counts.checked++;
      if (status === STATUS.working) counts.working++;
      else if (status === STATUS.failed) counts.failed++;
      else if (status === STATUS.incompatible) counts.browser_incompatible++;
      else counts.unavailable++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 32)) }, worker));
  if (rows.length) {
    openDb().prepare('UPDATE sources SET last_health_at = ? WHERE id = ?').run(nowIso(), sourceId);
  }
  return counts;
}

/* One check per source at a time. Three hundred channels take a few minutes
   to look at, which is far longer than anybody should hold an HTTP request
   open for, so the sync answers at once and the checking carries on behind
   it. The channels appear in Live TV as they are found. */
const checking = new Set();

export function checkInProgress(sourceId = null) {
  return sourceId == null ? checking.size > 0 : checking.has(Number(sourceId));
}

/**
 * Start checking an import without waiting for it.
 *
 * Returns whether it started. Nothing is thrown out of here: a failed check
 * must not be able to fail the sync that asked for it.
 */
export function startImportCheck(sourceId, { log = null, ...opts } = {}) {
  const id = Number(sourceId);
  if (!config.health.enabled || checking.has(id)) return false;
  if (!uncheckedChannels(id, 1).length) return false;
  checking.add(id);
  Promise.resolve()
    .then(() => checkImported({ sourceId: id, ...opts }))
    .then((counts) => {
      if (log) log.info({ source: id, ...counts }, 'checked the channels a sync imported');
    })
    .catch((e) => { if (log) log.warn(`Checking imported channels failed: ${e.message}`); })
    .finally(() => { checking.delete(id); });
  return true;
}

/**
 * The figures a settings screen shows for one source.
 *
 * Imported, working, temporarily unavailable, browser incompatible, and when
 * the last check ran — the five things the brief asks to be able to see, plus
 * the two totals the hidden-channel view needs.
 */
export function healthSummary(sourceId = null) {
  const db = openDb();
  const where = sourceId ? 'WHERE source_id = ? AND active = 1' : 'WHERE active = 1';
  const args = sourceId ? [sourceId] : [];
  const rows = db.prepare(`SELECT health_status, COUNT(*) n FROM channels ${where}
      GROUP BY health_status`).all(...args);
  const out = {
    total: 0, working: 0, temporarily_unavailable: 0, failed: 0, unchecked: 0,
    browser_incompatible: 0
  };
  for (const r of rows) { out[r.health_status] = r.n; out.total += r.n; }

  /* Deactivated rows — channels the playlist stopped carrying. Still in
     SQLite, still counted, because "imported" means imported. */
  out.inactive = db.prepare(`SELECT COUNT(*) n FROM channels
      ${sourceId ? 'WHERE source_id = ? AND active = 0' : 'WHERE active = 0'}`).get(...args).n;
  out.imported = out.total + out.inactive;

  out.visible = VISIBLE.reduce((n, k) => n + (out[k] || 0), 0);
  out.hidden = HIDDEN.reduce((n, k) => n + (out[k] || 0), 0) + out.inactive;
  out.unavailable = out.temporarily_unavailable + out.failed;

  const last = sourceId
    ? db.prepare('SELECT MAX(last_checked_at) t FROM channels WHERE source_id = ?').get(sourceId)
    : db.prepare('SELECT MAX(last_checked_at) t FROM channels').get();
  out.lastHealthAt = (last && last.t) || null;
  return out;
}
