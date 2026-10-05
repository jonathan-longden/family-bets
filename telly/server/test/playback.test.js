import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { createRoot, scanRoot } = await import('../src/services/media.js');
const { decide, parseRange, ffmpegArgs } = await import('../src/services/playback.js');
const { closeDb } = await import('../src/db/index.js');

/* Known bytes, so a range can be checked against what should come back. */
const MP4_BODY = Array.from({ length: 1000 }, (_, i) => String(i % 10)).join('');
let app, token, mp4Id, mkvId;

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'john', password: 'johnspassword' });
  const dir = path.join(box.dir, 'Movies');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'Direct Play (2001).mp4'), MP4_BODY);
  writeFileSync(path.join(dir, 'Matroska Film (2002).mkv'), 'K'.repeat(500));
  const root = createRoot({ label: 'Films', kind: 'movies', path: dir });
  scanRoot(root.id);
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000001', name: 'TV' })).json().accessToken;
  const list = (await app.inject({ method: 'GET', url: '/api/v1/movies', headers: auth(token) })).json();
  mp4Id = list.items.find(m => /Direct Play/.test(m.title)).id;
  mkvId = list.items.find(m => /Matroska Film/.test(m.title)).id;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('deciding what to do with a file', () => {
  test('a browser gets the containers it can open, untouched', () => {
    assert.equal(decide('mp4').mode, 'direct');
    assert.equal(decide('webm').mode, 'direct');
    assert.equal(decide('mp4').mime, 'video/mp4');
  });

  test('a real player gets more of them untouched, because it can open more', () => {
    assert.equal(decide('mkv', { capability: 'native' }).mode, 'direct');
    assert.equal(decide('avi', { capability: 'native' }).mode, 'direct');
    assert.equal(decide('ts', { capability: 'native' }).mode, 'direct');
  });

  test('a browser and an .mkv is the one case that needs FFmpeg', () => {
    const plan = decide('mkv', { capability: 'browser' });
    assert.equal(plan.mode, 'remux');
    assert.equal(plan.mime, 'video/mp4');
  });

  test('remuxing copies the streams: nothing is re-encoded unless asked', () => {
    const copy = ffmpegArgs('/x/film.mkv');
    assert.ok(copy.includes('-c'), copy.join(' '));
    assert.ok(copy.includes('copy'), copy.join(' '));
    assert.ok(!copy.includes('libx264'), 'no encoder on the cheap path');
    assert.ok(copy.join(' ').includes('frag_keyframe'), 'fragmented mp4, so it plays while it arrives');

    const encoded = ffmpegArgs('/x/film.mkv', { encode: true });
    assert.ok(encoded.includes('libx264'));
    assert.ok(!encoded.includes('copy'));
  });

  test('with no FFmpeg the answer is a clear no, not a broken player', () => {
    const { config } = require_config();
    const was = config.ffmpeg.enabled;
    config.ffmpeg.enabled = false;
    const plan = decide('mkv', { capability: 'browser' });
    assert.equal(plan.mode, 'unsupported');
    assert.match(plan.reason, /no FFmpeg/);
    config.ffmpeg.enabled = was;
  });
});

describe('byte ranges', () => {
  test('the forms a player actually sends', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.equal(parseRange('', 1000), null);
    assert.equal(parseRange('bytes=0-0', 1000).end, 0);
  });

  test('a range past the end of the file is refused, not clamped silently', () => {
    assert.deepEqual(parseRange('bytes=2000-3000', 1000), { invalid: true });
  });
});

describe('playing a file from the library', () => {
  async function ticketFor(kind, id, query = '') {
    return app.inject({
      method: 'POST', url: `/api/v1/stream/media/${kind}/${id}/ticket${query}`, headers: auth(token)
    });
  }

  test('a ticket says what will happen before the player commits to it', async () => {
    const res = await ticketFor('movie', mp4Id);
    assert.equal(res.statusCode, 200);
    const t = res.json();
    assert.equal(t.mode, 'direct');
    assert.equal(t.seekable, true);
    assert.equal(t.mimeType, 'video/mp4');
    assert.match(t.url, /^\/api\/v1\/stream\/media\/movie\/\d+\?ticket=/);
    assert.equal(JSON.stringify(t).includes(box.dir), false, 'no path in the reply');
  });

  test('an .mkv tells a browser it will be remuxed, and a phone that it will not', async () => {
    assert.equal((await ticketFor('movie', mkvId)).json().mode, 'remux');
    assert.equal((await ticketFor('movie', mkvId, '?capability=native')).json().mode, 'direct');
  });

  test('the whole file comes back, with ranges offered', async () => {
    const { url } = (await ticketFor('movie', mp4Id)).json();
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-length'], String(MP4_BODY.length));
    assert.equal(res.body, MP4_BODY);
  });

  test('a range comes back as a range, with the right bytes in it', async () => {
    const { url } = (await ticketFor('movie', mp4Id)).json();
    const res = await app.inject({ method: 'GET', url, headers: { range: 'bytes=10-19' } });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['content-range'], `bytes 10-19/${MP4_BODY.length}`);
    assert.equal(res.headers['content-length'], '10');
    assert.equal(res.body, MP4_BODY.slice(10, 20));
  });

  test('an impossible range is a 416, as a player expects', async () => {
    const { url } = (await ticketFor('movie', mp4Id)).json();
    const res = await app.inject({ method: 'GET', url, headers: { range: 'bytes=99999-' } });
    assert.equal(res.statusCode, 416);
    assert.equal(res.headers['content-range'], `bytes */${MP4_BODY.length}`);
  });

  test('without a ticket there is nothing to play', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/stream/media/movie/${mp4Id}` });
    assert.equal(res.statusCode, 403);
  });

  test('a ticket for one film does not open another', async () => {
    const { url } = (await ticketFor('movie', mp4Id)).json();
    const ticket = url.split('ticket=')[1];
    const res = await app.inject({ method: 'GET', url: `/api/v1/stream/media/movie/${mkvId}?ticket=${ticket}` });
    assert.equal(res.statusCode, 403);
  });

  test('a ticket for a film does not open a channel, or the other way round', async () => {
    const { url } = (await ticketFor('movie', mp4Id)).json();
    const ticket = url.split('ticket=')[1];
    const res = await app.inject({ method: 'GET', url: `/api/v1/stream/1?ticket=${ticket}` });
    assert.equal(res.statusCode, 403);
  });

  test('asking for a kind that is not a kind is refused', async () => {
    assert.equal((await ticketFor('wallpaper', 1)).statusCode, 400);
  });

  test('a film that is not there is a 404 before any ticket is cut', async () => {
    assert.equal((await ticketFor('movie', 999999)).statusCode, 404);
  });

  test('nothing is playable without signing in', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/stream/media/movie/${mp4Id}/ticket` });
    assert.equal(res.statusCode, 401);
  });
});

/* The config module is read at import time by the service; this reaches the
   same live object the service holds. */
function require_config() {
  return configModule;
}
const configModule = await import('../src/config.js');
