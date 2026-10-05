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
  failed: 'failed'
};

/* How long to wait before looking at a channel again. A working channel is
   not worth rechecking often; a failing one is backed off until it is barely
   worth the connection, and never dropped. */
export function nextCheckDue(row, now = Date.now()) {
  // Never looked at: due now.
  if (!row.last_checked_at) return true;
  const since = now - Date.parse(row.last_checked_at);
  const h = 3600e3;
  if (row.health_status === STATUS.working) return since >= config.health.workingIntervalHours * h;
  const fails = Math.max(row.consecutive_failures, 1);
  const wait = Math.min(config.health.retryBaseMinutes * Math.pow(2, fails - 1), config.health.maxRetryHours * 60);
  return since >= wait * 60e3;
}

/* A stream address that cannot be played by anything is not worth a
   connection: say so at once and spend the check on something else. */
export function addressProblem(url) {
  const u = String(url || '').trim();
  if (!u) return 'The playlist gives no address for this channel.';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return 'That is not a stream address.';
  const scheme = u.slice(0, u.indexOf(':')).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return `A ${scheme}:// stream is not something this can check or play.`;
  return null;
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
    '-show_entries', 'stream=codec_name,width,height',
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
        return done({ ok: true, kind: 'ffprobe', codec: stream.codec_name, width: stream.width || 0, height: stream.height || 0 });
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
  if (bad) return { ok: false, reason: bad, method: 'address' };

  if (config.ffmpeg.enabled && !ffprobeMissing && !opts.bytesOnly) {
    const r = await probeByFfprobe(url, opts);
    if (r.unavailable) {
      ffprobeMissing = true;                 // say it once, then stop trying
    } else {
      return { ...r, method: 'ffprobe' };
    }
  }
  const r = await probeByBytes(url, opts);
  return { ...r, method: 'bytes' };
}

/** Write what a check found against the channel. */
export function record(channelId, result, at = nowIso()) {
  const db = openDb();
  if (result.ok) {
    db.prepare(`UPDATE channels SET health_status = ?, last_checked_at = ?, last_success_at = ?,
        failure_reason = '', consecutive_failures = 0 WHERE id = ?`)
      .run(STATUS.working, at, at, channelId);
    return STATUS.working;
  }
  const row = db.prepare('SELECT consecutive_failures FROM channels WHERE id = ?').get(channelId);
  const fails = (row ? row.consecutive_failures : 0) + 1;
  // One bad check is a bad afternoon; several in a row is a dead channel. It
  // is still never deleted, and it is still rechecked.
  const status = fails >= config.health.failAfter ? STATUS.failed : STATUS.temporary;
  db.prepare(`UPDATE channels SET health_status = ?, last_checked_at = ?, last_failure_at = ?,
      failure_reason = ?, consecutive_failures = ? WHERE id = ?`)
    .run(status, at, at, String(result.reason || 'Unavailable.').slice(0, 300), fails, channelId);
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
  const counts = { checked: 0, working: 0, unavailable: 0, failed: 0 };
  let i = 0;

  const worker = async () => {
    for (;;) {
      const row = rows[i++];
      if (!row) return;
      let result;
      try { result = await checker(row.stream_url); }
      catch (e) { result = { ok: false, reason: `The check itself failed: ${(e && e.message) || e}` }; }
      const status = record(row.id, result);
      counts.checked++;
      if (status === STATUS.working) counts.working++;
      else if (status === STATUS.failed) counts.failed++;
      else counts.unavailable++;
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 32)) }, worker));

  if (sourceId) {
    openDb().prepare('UPDATE sources SET last_health_at = ? WHERE id = ?').run(nowIso(), sourceId);
  }
  return counts;
}

/** The figures a settings screen shows for one source. */
export function healthSummary(sourceId = null) {
  const where = sourceId ? 'WHERE source_id = ? AND active = 1' : 'WHERE active = 1';
  const args = sourceId ? [sourceId] : [];
  const rows = openDb().prepare(`SELECT health_status, COUNT(*) n FROM channels ${where}
      GROUP BY health_status`).all(...args);
  const out = { total: 0, working: 0, temporarily_unavailable: 0, failed: 0, unchecked: 0 };
  for (const r of rows) { out[r.health_status] = r.n; out.total += r.n; }
  const inactive = openDb().prepare(`SELECT COUNT(*) n FROM channels
      ${sourceId ? 'WHERE source_id = ? AND active = 0' : 'WHERE active = 0'}`).get(...args).n;
  out.inactive = inactive;
  return out;
}
