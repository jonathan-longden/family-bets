import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { createRoot, deleteRoot, runScan, scanAllSteps, startJob, finishJob, getJob, latestJob,
        unmatched, withinApprovedFolder, playableMedia } = await import('../src/services/media.js');

/** Run a generator out, for a test that only wanted to look at the middle. */
const drainRest = (steps) => { let r = steps.next(); while (!r.done) r = steps.next(); };
const { closeDb, openDb } = await import('../src/db/index.js');

let app, token, adminToken, tvRoot, movieRoot;

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });

  const movies = path.join(box.dir, 'Movies');
  const tv = path.join(box.dir, 'TV');
  mkdirSync(movies, { recursive: true });
  mkdirSync(path.join(tv, 'Breaking Bad', 'Season 01'), { recursive: true });
  mkdirSync(path.join(tv, 'The Office', 'Season 1'), { recursive: true });
  mkdirSync(path.join(tv, 'Loose'), { recursive: true });

  writeFileSync(path.join(movies, 'The Matrix (1999).mkv'), 'x'.repeat(100));
  writeFileSync(path.join(movies, 'Inception.2010.1080p.mkv'), 'x'.repeat(100));
  writeFileSync(path.join(movies, 'A Film Nobody Named Properly.mp4'), 'x'.repeat(100));

  // the three shapes the brief asks for
  writeFileSync(path.join(tv, 'Breaking Bad', 'Season 01', 'Breaking Bad S01E01.mkv'), 'x'.repeat(50));
  writeFileSync(path.join(tv, 'Breaking Bad', 'Season 01', 'Breaking Bad S01E02.mkv'), 'x'.repeat(50));
  writeFileSync(path.join(tv, 'The Office', 'Season 1', "S01E01 - Pilot.mkv"), 'x'.repeat(50));
  writeFileSync(path.join(tv, 'The Office', 'Season 1', "S01E02 - Cat's in the Bag.mkv"), 'x'.repeat(50));
  writeFileSync(path.join(tv, 'Stranger Things S01E01.mkv'), 'x'.repeat(50));       // no season folder
  writeFileSync(path.join(tv, 'Taskmaster 1x03.mp4'), 'x'.repeat(50));              // the 1x02 form
  writeFileSync(path.join(tv, 'Loose', 'some home video.mkv'), 'x'.repeat(50));     // unparseable

  movieRoot = createRoot({ label: 'Films', kind: 'movies', path: movies });
  tvRoot = createRoot({ label: 'TV', kind: 'series', path: tv });

  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000001', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-admin-0000001', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('a scan is a job with a number on it', () => {
  test('it runs, and says what it found', () => {
    const r = runScan('all');
    assert.equal(r.job.status, 'done');
    assert.equal(r.job.found.movies, 3);
    assert.equal(r.job.found.series, 4, 'Breaking Bad, The Office, Stranger Things, Taskmaster');
    assert.equal(r.job.found.episodes, 6);
    assert.equal(r.job.unmatched, 1, 'the home video');
    assert.ok(r.job.total > 0 && r.job.processed > 0, JSON.stringify(r.job));
  });

  test('the job can be read back while or after it runs', () => {
    const latest = latestJob();
    assert.equal(latest.status, 'done');
    assert.equal(getJob(latest.id).id, latest.id);
    assert.ok(latest.finishedAt);
  });

  test('scanning twice changes nothing', () => {
    const before = openDb().prepare('SELECT COUNT(*) n FROM episodes').get().n;
    const r = runScan('all');
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM episodes').get().n, before);
    assert.equal(r.job.found.episodes, before);
  });
});

describe('the three folder shapes', () => {
  const seriesTitles = () => openDb().prepare('SELECT title FROM series ORDER BY title').all().map(r => r.title);

  test('Season 01, Season 1 and no season folder at all', () => {
    assert.deepEqual(seriesTitles(), ['Breaking Bad', 'Stranger Things', 'Taskmaster', 'The Office']);
  });

  test('an episode title is kept where the filename gives one', () => {
    const office = openDb().prepare("SELECT id FROM series WHERE title = 'The Office'").get();
    const eps = openDb().prepare('SELECT season, episode, title FROM episodes WHERE series_id = ? ORDER BY episode')
      .all(office.id);
    assert.deepEqual(eps, [
      { season: 1, episode: 1, title: 'Pilot' },
      { season: 1, episode: 2, title: "Cat's in the Bag" }
    ]);
  });

  test('seasons are records, with episodes hanging off them', () => {
    const bb = openDb().prepare("SELECT id FROM series WHERE title = 'Breaking Bad'").get();
    const seasons = openDb().prepare('SELECT * FROM seasons WHERE series_id = ?').all(bb.id);
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0].season_number, 1);
    const eps = openDb().prepare('SELECT COUNT(*) n FROM episodes WHERE season_id = ?').get(seasons[0].id).n;
    assert.equal(eps, 2);
  });

  test('the series folder is recorded, above the season folder', () => {
    const bb = openDb().prepare("SELECT folder_path FROM series WHERE title = 'Breaking Bad'").get();
    assert.ok(bb.folder_path.endsWith(path.join('TV', 'Breaking Bad')), bb.folder_path);
  });
});

describe('what it would not guess at', () => {
  test('a file it cannot read is listed, not filed in the wrong series', () => {
    const list = unmatched();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].fileName, 'some home video.mkv');
    assert.match(list.items[0].reason, /No season and episode/);
    assert.equal(list.items[0].folder, 'TV');
    // and it did not become a series of its own
    assert.equal(openDb().prepare("SELECT 1 FROM series WHERE title LIKE '%home video%'").get(), undefined);
  });

  test('an administrator can see the list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/library/unmatched', headers: auth(adminToken) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 1);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/library/unmatched', headers: auth(token) }))
      .statusCode, 403);
  });

  test('a film with no year keeps its filename as the title rather than inventing one', () => {
    const row = openDb().prepare("SELECT title, year FROM movies WHERE rel_path LIKE 'A Film%'").get();
    assert.equal(row.title, 'A Film Nobody Named Properly');
    assert.equal(row.year, null);
  });

  test('and the two named properly are read properly', () => {
    const rows = openDb().prepare('SELECT title, year FROM movies ORDER BY title').all();
    assert.deepEqual(rows.filter(r => r.year), [
      { title: 'Inception 2010', year: 2010 },
      { title: 'The Matrix (1999)', year: 1999 }
    ]);
  });
});

describe('a scan the server can be asked about while it runs', () => {
  /* A library big enough to have a middle: the figures are stamped every
     twenty-five files, so thirteen fixtures would go from nothing to done
     with no "part way" to read. */
  let bulkRoot, bulkDir;
  before(() => {
    bulkDir = path.join(box.dir, 'Bulk');
    mkdirSync(bulkDir, { recursive: true });
    for (let i = 1; i <= 150; i++) {
      writeFileSync(path.join(bulkDir, `Clip ${String(i).padStart(3, '0')}.mp4`), 'x'.repeat(20));
    }
    bulkRoot = createRoot({ label: 'Bulk', kind: 'recordings', path: bulkDir });
  });
  after(() => { deleteRoot(bulkRoot.id); rmSync(bulkDir, { recursive: true, force: true }); });

  test('the job carries a figure part way through, not only at the end', () => {
    const jobId = startJob('recordings');
    const steps = scanAllSteps({ kind: 'recordings', jobId });
    for (let i = 0; i < 60; i++) steps.next();
    const mid = getJob(jobId);
    assert.ok(mid.total >= 150, 'it knows how many files there are: ' + mid.total);
    assert.ok(mid.processed >= 25 && mid.processed < mid.total,
      `part way through: ${mid.processed} of ${mid.total}`);
    assert.equal(mid.status, 'running');
    drainRest(steps);
    finishJob(jobId, 'done');
  });

  test('and the server answers while the scan is still going', async () => {
    /* The point of running it a few files at a time: this poll must come
       back during the POST. Drained in one go it would queue behind it and
       only ever see a finished job. */
    const answers = [];
    const poll = setInterval(() => {
      app.inject({ method: 'GET', url: '/api/v1/admin/library/scan', headers: auth(adminToken) })
        .then(r => answers.push(r.json())).catch(() => {});
    }, 1);
    const done = await app.inject({
      method: 'POST', url: '/api/v1/admin/library/scan/recordings', headers: auth(adminToken)
    });
    clearInterval(poll);
    await new Promise(r => setImmediate(r));

    assert.equal(done.statusCode, 200);
    assert.equal(done.json().job.status, 'done');
    assert.ok(answers.length > 0, 'the server answered during the scan');
    assert.ok(answers.some(a => a.running === true),
      'and said a scan was running: ' + JSON.stringify(answers.slice(0, 3)));
  });

  test('a second scan joins the one already running rather than racing it', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/admin/library/scan/recordings', headers: auth(adminToken) }),
      app.inject({ method: 'POST', url: '/api/v1/admin/library/scan/recordings', headers: auth(adminToken) })
    ]);
    assert.equal(a.json().job.id, b.json().job.id, 'one job, not two passes over the same folders');
  });
});

describe('scanning one library at a time', () => {
  test('movies only, tv only', async () => {
    const m = await app.inject({ method: 'POST', url: '/api/v1/admin/library/scan/movies', headers: auth(adminToken) });
    assert.equal(m.statusCode, 200);
    assert.equal(m.json().job.kind, 'movies');
    assert.deepEqual(m.json().folders.map(f => f.kind), ['movies']);

    const tv = await app.inject({ method: 'POST', url: '/api/v1/admin/library/scan/tv', headers: auth(adminToken) });
    assert.deepEqual(tv.json().folders.map(f => f.kind), ['series']);
  });

  test('a kind that is not a kind is refused', async () => {
    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/admin/library/scan/wallpaper', headers: auth(adminToken)
    })).statusCode, 400);
  });

  test('and scanning is not something a user may start', async () => {
    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/admin/library/scan/all', headers: auth(token)
    })).statusCode, 403);
  });
});

describe('a file outside an approved folder is never served', () => {
  test('the boundary is a boundary, not a prefix', () => {
    assert.equal(withinApprovedFolder(path.join(box.dir, 'Movies', 'The Matrix (1999).mkv')), true);
    assert.equal(withinApprovedFolder(path.join(box.dir, 'Movies-private', 'secret.mkv')), false,
      'Movies-private must not pass because Movies was approved');
    assert.equal(withinApprovedFolder('/etc/passwd'), false);
    assert.equal(withinApprovedFolder(''), false);
  });

  test('and neither is a path that climbs out of one', () => {
    assert.equal(withinApprovedFolder(path.join(box.dir, 'Movies', '..', '..', 'etc', 'passwd')), false);
    assert.equal(withinApprovedFolder(path.join(box.dir, 'Movies', '..', 'TV')), true, 'still inside an approved one');
  });

  test('a row pointing outside them is refused rather than streamed', () => {
    const id = openDb().prepare('SELECT id FROM movies LIMIT 1').get().id;
    openDb().prepare('UPDATE movies SET path = ? WHERE id = ?').run('/etc/passwd', id);
    assert.throws(() => playableMedia('movie', id), /not inside a configured media folder/);
  });

  test('which the stream endpoint reports rather than serving the file', async () => {
    const id = openDb().prepare("SELECT id FROM movies WHERE path = '/etc/passwd'").get().id;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/media/movie/${id}/ticket`, headers: auth(token)
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /configured media folder/);
  });

  test('the client has no way to name a file in the first place', async () => {
    // There is no path parameter anywhere to try: the only handle is an id.
    for (const url of [
      '/api/v1/stream/media/movie/1?path=/etc/passwd',
      '/api/v1/stream/media/movie/../../etc/passwd',
      '/api/v1/movies?path=/etc/passwd'
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: auth(token) });
      assert.ok(res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 400 || res.statusCode === 200,
        `${url} -> ${res.statusCode}`);
      assert.equal(/root:|passwd/.test(res.body || ''), false, `${url} returned file contents`);
    }
  });
});
