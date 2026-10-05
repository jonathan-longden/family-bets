import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createRoot, scanRoot, listRoots, cleanTitle, yearOf, episodeOf, seriesOf } = await import('../src/services/media.js');
const { closeDb, openDb } = await import('../src/db/index.js');

let app, token, adminToken, movieRoot, seriesRoot, recRoot;

/** A library on disk, with the shapes a real one has. */
function buildLibrary(dir) {
  const movies = path.join(dir, 'Movies');
  const tv = path.join(dir, 'TV');
  const recs = path.join(dir, 'Recordings');
  mkdirSync(path.join(movies, 'Arrival (2016)'), { recursive: true });
  mkdirSync(path.join(tv, 'The Bear', 'Season 1'), { recursive: true });
  mkdirSync(path.join(tv, 'The Bear', 'Season 2'), { recursive: true });
  mkdirSync(path.join(tv, 'Taskmaster'), { recursive: true });
  mkdirSync(path.join(movies, 'Extras'), { recursive: true });        // must be skipped
  mkdirSync(recs, { recursive: true });

  writeFileSync(path.join(movies, 'Arrival (2016)', 'Arrival.2016.1080p.BluRay.x264-GROUP.mkv'), 'A'.repeat(2048));
  writeFileSync(path.join(movies, 'Arrival (2016)', 'poster.jpg'), 'JPEGDATA');
  writeFileSync(path.join(movies, 'Heat (1995).mp4'), 'B'.repeat(4096));
  writeFileSync(path.join(movies, 'Heat (1995).sample.mp4'), 'x');     // a sample is not a film
  writeFileSync(path.join(movies, 'notes.txt'), 'not a film');
  writeFileSync(path.join(movies, 'Extras', 'Making Of.mkv'), 'x');

  writeFileSync(path.join(tv, 'The Bear', 'Season 1', 'The.Bear.S01E01.System.1080p.mkv'), 'C'.repeat(1024));
  writeFileSync(path.join(tv, 'The Bear', 'Season 1', 'The.Bear.S01E02.Hands.1080p.mkv'), 'D'.repeat(1024));
  writeFileSync(path.join(tv, 'The Bear', 'Season 2', 'The.Bear.S02E01.Beef.1080p.mkv'), 'E'.repeat(1024));
  writeFileSync(path.join(tv, 'Taskmaster', 'Taskmaster 1x03.mp4'), 'F'.repeat(1024));

  writeFileSync(path.join(recs, 'BBC One - 2024.03.01 - Doctor Who.ts'), 'G'.repeat(512));
  return { movies, tv, recs };
}

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  const dirs = buildLibrary(box.dir);
  movieRoot = createRoot({ label: 'Films', kind: 'movies', path: dirs.movies });
  seriesRoot = createRoot({ label: 'TV', kind: 'series', path: dirs.tv });
  recRoot = createRoot({ label: 'Recordings', kind: 'recordings', path: dirs.recs });
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000001', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-admin-0000001', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('reading a filename', () => {
  test('the release noise comes off the title', () => {
    assert.equal(cleanTitle('Arrival.2016.1080p.BluRay.x264-GROUP.mkv'), 'Arrival 2016');
    assert.equal(cleanTitle('The.Bear.S01E01.System.1080p.mkv'), 'The Bear S01E01 System');
    assert.equal(cleanTitle('Heat (1995).mp4'), 'Heat (1995)');
  });

  test('a year is only a year when it could be one', () => {
    assert.equal(yearOf('Arrival (2016).mkv'), 2016);
    assert.equal(yearOf('Blade Runner 2049 (2017).mkv'), 2017);   // the bracketed one wins
    assert.equal(yearOf('Episode 1080.mkv'), null);
  });

  test('season and episode, in each of the three ways a filename says it', () => {
    assert.deepEqual(episodeOf('The.Bear.S01E02.mkv'), { season: 1, episode: 2 });
    assert.deepEqual(episodeOf('Taskmaster 1x03.mp4'), { season: 1, episode: 3 });
    assert.deepEqual(episodeOf('Show - Season 2 Episode 10.mkv'), { season: 2, episode: 10 });
    assert.equal(episodeOf('Arrival (2016).mkv'), null);
  });

  test('the series is read from the filename, or from the folder above it', () => {
    assert.equal(seriesOf('The Bear/Season 1/The.Bear.S01E01.mkv', 'The.Bear.S01E01.mkv'), 'The Bear');
    assert.equal(seriesOf('Taskmaster/ep.mkv', 'ep.mkv'), 'Taskmaster');
  });
});

describe('scanning', () => {
  test('a scan finds the films and leaves everything else alone', () => {
    const r = scanRoot(movieRoot.id);
    assert.equal(r.found, 2, 'Arrival and Heat');
    const rows = openDb().prepare('SELECT title, year, container, size_bytes, poster FROM movies ORDER BY title').all();
    assert.deepEqual(rows.map(x => x.title), ['Arrival 2016', 'Heat (1995)']);
    assert.equal(rows[0].year, 2016);
    assert.equal(rows[0].container, 'mkv');
    assert.equal(rows[0].size_bytes, 2048);
    assert.match(rows[0].poster, /poster\.jpg$/, 'artwork beside the file is found');
  });

  test('samples, extras folders and non-video files are not a library', () => {
    const titles = openDb().prepare('SELECT title FROM movies').all().map(r => r.title);
    assert.ok(!titles.some(t => /sample/i.test(t)), JSON.stringify(titles));
    assert.ok(!titles.some(t => /making of/i.test(t)), JSON.stringify(titles));
    assert.ok(!titles.some(t => /notes/i.test(t)), JSON.stringify(titles));
  });

  test('episodes are grouped into series and seasons', () => {
    scanRoot(seriesRoot.id);
    const series = openDb().prepare('SELECT * FROM series ORDER BY title').all();
    assert.deepEqual(series.map(s => s.title), ['Taskmaster', 'The Bear']);
    const bear = series.find(s => s.title === 'The Bear');
    const eps = openDb().prepare('SELECT season, episode, title FROM episodes WHERE series_id = ? ORDER BY season, episode')
      .all(bear.id);
    assert.deepEqual(eps, [
      { season: 1, episode: 1, title: 'System' },
      { season: 1, episode: 2, title: 'Hands' },
      { season: 2, episode: 1, title: 'Beef' }
    ]);
  });

  test('a recording keeps the channel and the date its name carries', () => {
    scanRoot(recRoot.id);
    const rec = openDb().prepare('SELECT * FROM recordings').get();
    assert.equal(rec.channel_name, 'BBC One');
    assert.equal(rec.recorded_at, '2024-03-01');
    assert.equal(rec.title, 'Doctor Who', 'the date comes out without leaving its separator behind');
  });

  test('scanning twice does not duplicate anything', () => {
    const before = openDb().prepare('SELECT COUNT(*) n FROM movies').get().n;
    scanRoot(movieRoot.id);
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM movies').get().n, before);
  });

  test('a file deleted from disk leaves the catalogue on the next scan', () => {
    const extra = path.join(listRoots().find(r => r.id === movieRoot.id).path, 'Temp Film (2001).mp4');
    writeFileSync(extra, 'z'.repeat(10));
    scanRoot(movieRoot.id);
    assert.ok(openDb().prepare('SELECT 1 FROM movies WHERE title_key = ?').get('temp film (2001)'));
    rmSync(extra);
    const r = scanRoot(movieRoot.id);
    assert.equal(r.removed, 1);
    assert.equal(openDb().prepare('SELECT 1 FROM movies WHERE title_key = ?').get('temp film (2001)'), undefined);
  });

  test('the files are never moved: every path is still where it was', () => {
    for (const row of openDb().prepare('SELECT path FROM movies').all()) {
      assert.ok(existsSync(row.path), row.path);
    }
  });
});

describe('the catalogue over the API', () => {
  test('films come back with what the client needs and nothing it must not have', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/movies', headers: auth(token) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.total, 2);
    const m = body.items.find(x => /Arrival/.test(x.title));
    assert.equal(m.year, 2016);
    assert.equal(m.container, 'mkv');
    assert.match(m.playback, /^\/api\/v1\/stream\/media\/movie\/\d+$/);
    assert.match(m.poster, /^\/api\/v1\/art\/movie\/\d+$/);
    assert.equal(JSON.stringify(body).includes(box.dir), false, 'no filesystem path reaches the client');
  });

  test('a series lists its seasons, and its episodes come separately', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/series', headers: auth(token) })).json();
    const bear = list.items.find(s => s.title === 'The Bear');
    assert.equal(bear.seasonCount, 2);
    assert.equal(bear.episodeCount, 3);

    const one = (await app.inject({ method: 'GET', url: `/api/v1/series/${bear.id}`, headers: auth(token) })).json();
    assert.deepEqual(one.seasons, [{ season: 1, episodes: 2 }, { season: 2, episodes: 1 }]);

    const eps = (await app.inject({
      method: 'GET', url: `/api/v1/series/${bear.id}/episodes?season=1`, headers: auth(token)
    })).json();
    assert.equal(eps.episodes.length, 2);
    assert.deepEqual(eps.episodes.map(e => e.title), ['System', 'Hands']);
    assert.equal(JSON.stringify(eps).includes(box.dir), false);
  });

  test('recordings come back newest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/recordings', headers: auth(token) });
    assert.equal(res.json().total, 1);
    assert.equal(res.json().items[0].channel, 'BBC One');
  });

  test('search reaches the personal library as well as the channels', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=bear', headers: auth(token) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().series.length, 1);
    assert.equal(res.json().series[0].title, 'The Bear');
  });

  test('none of it is readable without signing in', async () => {
    for (const url of ['/api/v1/movies', '/api/v1/series', '/api/v1/recordings', '/api/v1/search?q=bear']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
    }
  });

  test('artwork is served by id, not by path', async () => {
    const m = (await app.inject({ method: 'GET', url: '/api/v1/movies', headers: auth(token) })).json()
      .items.find(x => /Arrival/.test(x.title));
    const art = await app.inject({ method: 'GET', url: m.poster, headers: auth(token) });
    assert.equal(art.statusCode, 200);
    assert.equal(art.headers['content-type'], 'image/jpeg');
    assert.equal(art.body, 'JPEGDATA');
  });
});

describe('managing media folders', () => {
  test('only an administrator may configure one', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/media-roots', headers: auth(token),
      payload: { label: 'Sneaky', kind: 'movies', path: '/tmp' }
    });
    assert.equal(res.statusCode, 403);
  });

  test('an administrator sees the folders, with their real paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/media-roots', headers: auth(adminToken) });
    assert.equal(res.statusCode, 200);
    const films = res.json().roots.find(r => r.label === 'Films');
    assert.ok(films.path.includes('Movies'));
    assert.equal(films.itemCount, 2);
  });

  test('a relative path is refused: the server would be guessing where it is', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/media-roots', headers: auth(adminToken),
      payload: { label: 'Nope', kind: 'movies', path: 'Media/Movies' }
    });
    assert.equal(res.statusCode, 400);
  });

  test('a folder that is not there is recorded, not thrown', async () => {
    const r = createRoot({ label: 'Gone', kind: 'movies', path: path.join(box.dir, 'no-such-folder') });
    const out = scanRoot(r.id);
    assert.equal(out.error, 'missing');
    const row = listRoots().find(x => x.id === r.id);
    assert.match(row.last_error, /does not exist/);
  });
});
