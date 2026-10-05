import { createReadStream, statSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { config } from '../config.js';
import { notFound, upstreamFailed } from '../lib/errors.js';

/**
 * Serving a file from the server's own disk.
 *
 * The rule is: move the bytes, do not re-encode them. Transcoding a film ties
 * up a PC that is also running the house's television, so it happens only when
 * the container genuinely cannot be played as it is.
 *
 *   direct    the browser or the phone can open this container itself. The
 *             file is served with byte ranges, so seeking works and the server
 *             does nothing but read from disk.
 *   remux     the video and audio are fine, the container is not (an .mkv of
 *             H.264/AAC). FFmpeg copies both streams into fragmented MP4 —
 *             no re-encoding, a few percent of one core.
 *   transcode the codecs themselves cannot be played. Only then is anything
 *             re-encoded, and the request has to ask for it.
 *
 * Nothing here takes a path from a client. A client holds an id and a ticket;
 * the path is looked up on this side and never appears in a reply.
 */

export const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv', ts: 'video/mp2t', m2ts: 'video/mp2t',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', flv: 'video/x-flv'
};

/* What a browser opens without help. Everything else needs FFmpeg or a native
   player; the Android app has one, a browser does not. */
const BROWSER_NATIVE = new Set(['mp4', 'm4v', 'webm', 'ogv']);
/* Containers a real media player on a phone or desktop opens directly. */
const PLAYER_NATIVE = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mkv', 'mov', 'ts', 'm2ts', 'avi', 'mpg', 'mpeg']);

/**
 * Is FFmpeg actually here?
 *
 * `config.ffmpeg.enabled` is a wish, not a fact: it is a flag somebody set,
 * and it says nothing about whether the binary exists. Asking it was enough
 * to decide to remux an .mkv on a PC with no FFmpeg installed — and then the
 * spawn failed asynchronously, the connection was destroyed, and the player
 * got neither video nor an explanation. A film that will not play has to say
 * so, so the question is answered properly, once, and remembered.
 */
let ffmpegThere = null;

export function ffmpegAvailable({ recheck = false } = {}) {
  if (!config.ffmpeg.enabled) return false;
  if (ffmpegThere !== null && !recheck) return ffmpegThere;
  try {
    const r = spawnSync(config.ffmpeg.path, ['-version'], { timeout: 4000, stdio: 'ignore' });
    ffmpegThere = !r.error && r.status === 0;
  } catch {
    ffmpegThere = false;
  }
  return ffmpegThere;
}

/**
 * How to serve this file to this client.
 *
 * `capability` is what the caller says it can play: 'native' for a real media
 * player (the Android app), 'browser' for a page using hls.js or <video>.
 * Asking for more than you can play only costs CPU, so the default is the
 * cheapest thing that works.
 */
export function decide(container, { capability = 'browser', allowTranscode = true,
                                    ffmpeg = null } = {}) {
  const ext = String(container || '').replace('.', '').toLowerCase();
  const native = capability === 'native' ? PLAYER_NATIVE : BROWSER_NATIVE;
  /* `ffmpeg` is for callers that know, and for tests: whether a machine has
     FFmpeg changes the answer, so it has to be possible to ask both ways
     without installing or removing anything. */
  const haveFfmpeg = ffmpeg == null ? ffmpegAvailable() : Boolean(ffmpeg);
  if (native.has(ext)) return { mode: 'direct', container: ext, mime: MIME[ext] || 'application/octet-stream' };
  if (!haveFfmpeg) {
    return {
      mode: 'unsupported', container: ext, mime: MIME[ext] || 'application/octet-stream',
      reason: `A .${ext || 'file'} cannot be played as it is, and this server has no FFmpeg to ` +
        'repackage it. Install FFmpeg and restart Telly, or set TELLY_FFMPEG to where it is. ' +
        'Files already in mp4, m4v or webm play without it.'
    };
  }
  // A container problem, not a codec one: copy the streams across.
  if (allowTranscode) return { mode: 'remux', container: ext, mime: 'video/mp4' };
  return { mode: 'unsupported', container: ext, mime: MIME[ext] || 'application/octet-stream',
           reason: 'That file needs remuxing and this request asked for none.' };
}

/** A byte range from a Range header, or null for the whole file. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start, end;
  if (a === '') { start = Math.max(size - Number(b), 0); end = size - 1; }
  else { start = Number(a); end = b === '' ? size - 1 : Math.min(Number(b), size - 1); }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { invalid: true };
  return { start, end };
}

export function fileSize(file) {
  if (!existsSync(file)) throw notFound('That file is no longer on the server.');
  return statSync(file).size;
}

/**
 * Serve the file itself, honouring Range so a player can seek. This is the
 * path almost everything takes: no FFmpeg, no copy, just the disk.
 */
export function sendDirect(file, reply, rangeHeader, mime) {
  const size = fileSize(file);
  const range = parseRange(rangeHeader, size);
  reply.header('accept-ranges', 'bytes');
  reply.header('content-type', mime || 'application/octet-stream');

  if (range && range.invalid) {
    reply.header('content-range', `bytes */${size}`);
    return reply.status(416).send();
  }
  if (!range) {
    reply.header('content-length', String(size));
    return reply.status(200).send(createReadStream(file));
  }
  reply.header('content-range', `bytes ${range.start}-${range.end}/${size}`);
  reply.header('content-length', String(range.end - range.start + 1));
  return reply.status(206).send(createReadStream(file, { start: range.start, end: range.end }));
}

/**
 * Remux (or, where the codecs demand it, transcode) through FFmpeg into
 * fragmented MP4, which plays in a browser from a single progressive request.
 *
 * `-c copy` first: that is the cheap path, and the one almost every .mkv in a
 * personal library takes. A caller that knows better can ask for an encode.
 */
export function ffmpegArgs(file, { encode = false, startSeconds = 0 } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (startSeconds > 0) args.push('-ss', String(startSeconds));
  args.push('-i', file);
  if (encode) {
    args.push('-c:v', config.ffmpeg.videoCodec, '-preset', config.ffmpeg.preset, '-crf', String(config.ffmpeg.crf),
              '-c:a', 'aac', '-b:a', '160k', '-ac', '2');
  } else {
    args.push('-c', 'copy');
  }
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');
  return args;
}

export function sendTranscoded(file, reply, opts = {}) {
  fileSize(file);                                   // 404 before spawning anything
  if (!config.ffmpeg.enabled) throw upstreamFailed('This server has no FFmpeg configured.');

  /* Asked before anything is committed to, so a missing binary is an answer
     rather than a dropped connection. */
  if (!ffmpegAvailable()) {
    throw upstreamFailed(
      'This server has no FFmpeg, so it cannot repackage that file. Install FFmpeg and restart ' +
      'Telly, or set TELLY_FFMPEG to where it is.');
  }

  const args = ffmpegArgs(file, opts);
  let child;
  try {
    child = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw upstreamFailed(`FFmpeg would not start: ${e.message}`);
  }

  let stderr = '';
  child.stderr.on('data', d => { if (stderr.length < 4000) stderr += String(d); });
  child.on('error', (e) => {
    /* It vanished between the check and the spawn. If nothing has been sent
       yet there is still time to say why; otherwise the stream has to end,
       and ending it is all that is left. */
    ffmpegThere = null;                               // ask again next time
    if (!reply.sent && !reply.raw.headersSent) {
      reply.status(502).send({
        error: { code: 'upstream_failed', message: `FFmpeg would not start: ${e.message}` }
      });
      return;
    }
    try { reply.raw.destroy(); } catch {}
  });
  // A client that closes the tab must not leave an encoder running.
  reply.raw.on('close', () => { try { child.kill('SIGKILL'); } catch {} });

  reply.header('content-type', 'video/mp4');
  reply.header('cache-control', 'no-store');
  // Length is unknown while it is being produced, so no ranges are offered:
  // a fragmented MP4 plays from the start of the stream.
  reply.header('accept-ranges', 'none');
  return reply.status(200).send(child.stdout);
}

export function containerOf(file) {
  return path.extname(file || '').replace('.', '').toLowerCase();
}
