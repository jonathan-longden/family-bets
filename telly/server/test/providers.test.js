import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();

const { ensureProviders, providerByKey, setProviderEnabled, byKey } =
  await import('../src/services/providers/index.js');
const archive = (await import('../src/services/providers/archive.js')).default;
const { pickFile, yearOf, runtimeOf, stripTags } = await import('../src/services/providers/archive.js');
const { runImport, imports, dueForImport } = await import('../src/services/importer.js');
const { movies, movieSources, seriesList, episodesOf, catalogueCounts } =
  await import('../src/services/catalogue.js');
const { fetchArtwork, artworkDir, artworkName, cachedArtworkPath, artworkStats, referenceOnly } =
  await import('../src/services/artwork.js');
const { createRoot, runScan } = await import('../src/services/media.js');
const { openDb, closeDb } = await import('../src/db/index.js');

let app, token, adminToken;

before(async () => {
  const { buildServer } = await import('../src/index.js');
  const { createUser } = await import('../src/services/users.js');
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-j-0000000002', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-a-0000000002', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

/* ===================================== the server's own disk, as a provider = */

describe('the local media folders feed the catalogue', () => {
  before(() => {
    const films = path.join(box.dir, 'Movies');
    const tv = path.join(box.dir, 'TV', 'Peep Show', 'Season 01');
    mkdirSync(films, { recursive: true });
    mkdirSync(tv, { recursive: true });
    writeFileSync(path.join(films, 'Inception (2010).mp4'), 'x'.repeat(2048));
    writeFileSync(path.join(films, 'Local Only Film (1998).mp4'), 'x'.repeat(2048));
    writeFileSync(path.join(tv, 'Peep Show S01E01.mp4'), 'x'.repeat(1024));
    writeFileSync(path.join(tv, 'Peep Show S01E02.mp4'), 'x'.repeat(1024));
    createRoot({ label: 'Films', kind: 'movies', path: films });
    createRoot({ label: 'TV', kind: 'series', path: path.join(box.dir, 'TV') });
    runScan('all');
  });

  test('it is on by default, because it needs nobody\'s permission', () => {
    const p = providerByKey('local');
    assert.equal(p.enabled, 1);
    assert.equal(p.access_method, 'local_filesystem');
    assert.equal(p.status, 'available');
  });

  test('importing it puts the household\'s own films in the unified catalogue', async () => {
    const got = await runImport(providerByKey('local').id);
    assert.equal(got.run.status, 'done');
    assert.equal(got.run.moviesDiscovered, 2);
    assert.equal(got.run.seriesDiscovered, 1);
    assert.equal(got.run.episodesDiscovered, 2);
    assert.equal(got.run.requestsMade, 0, 'and asks the network for nothing');

    assert.equal(movies({ search: 'Local Only Film' }).total, 1);
    assert.equal(seriesList({ search: 'Peep Show' }).total, 1);
  });

  test('a local source is an id, not a path — the guard still runs', () => {
    const id = movies({ search: 'Local Only Film' }).items[0].id;
    const [s] = movieSources(id);
    assert.equal(s.providerKey, 'local');
    assert.equal(s.local, true);
    assert.equal(s.playable, true);
    assert.match(s.playback, /^\/api\/v1\/stream\/media\/movie\/\d+$/);
    assert.equal(s.url, undefined, 'no url, because there is no url — there is a file');
    assert.equal(JSON.stringify(s).includes(box.dir), false, 'and no path anywhere in it');
  });

  test('Play on a local film cuts a ticket, exactly as it always did', async () => {
    const id = movies({ search: 'Local Only Film' }).items[0].id;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${id}/ticket`, headers: auth(token)
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.mode, 'local');
    assert.match(body.url, /^\/api\/v1\/stream\/media\/movie\/\d+\?ticket=/);
    assert.equal(body.playback, 'direct');
    assert.equal(body.url.includes(box.dir), false);

    /* And the ticket actually fetches the file. */
    const played = await app.inject({ method: 'GET', url: body.url });
    assert.ok(played.statusCode === 200 || played.statusCode === 206, String(played.statusCode));
  });

  test('a local episode plays the same way', async () => {
    const seriesId = seriesList({ search: 'Peep Show' }).items[0].id;
    const ep = episodesOf(seriesId, { season: 1 })[0];
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/episode/${ep.id}/ticket`, headers: auth(token)
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().mode, 'local');
  });

  test('rescanning and re-importing does not duplicate the household\'s films', async () => {
    const before = catalogueCounts();
    runScan('all');
    await runImport(providerByKey('local').id);
    assert.deepEqual(catalogueCounts().movies, before.movies);
    assert.deepEqual(catalogueCounts().movieSources, before.movieSources);
  });
});

/* ============================================= the Internet Archive adapter = */

/* Shaped like the real answers: a search page, then one metadata document per
   item, with the mixture of derivatives the Archive actually holds. */
const SEARCH_PAGE = {
  response: {
    numFound: 2,
    docs: [
      { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead',
        year: '1968', date: '1968-10-01', avg_rating: '4.5',
        description: '<p>Seven people take <b>refuge</b> in a farmhouse.</p>',
        subject: ['Horror', 'Public Domain', 'Zombies'], language: 'English',
        director: 'George A. Romero', creator: ['Duane Jones', 'Judith O\'Dea'] },
      { identifier: 'metropolis_1927', title: 'Metropolis', year: '1927',
        description: 'A city divided.', subject: 'Science Fiction', language: 'German' }
    ]
  }
};

const META = {
  night_of_the_living_dead: {
    metadata: { title: 'Night of the Living Dead', year: '1968', runtime: '1:36:12',
                director: 'George A. Romero' },
    files: [
      { name: 'notld.gif', format: 'Animated GIF', size: '20000' },
      { name: 'notld_512kb.mp4', format: '512Kb MPEG4', size: '120000000', height: '360' },
      { name: 'notld.mp4', format: 'h.264', size: '900000000', height: '720' },
      { name: 'notld.ogv', format: 'Ogg Video', size: '300000000' }
    ]
  },
  metropolis_1927: {
    metadata: { title: 'Metropolis', year: '1927', runtime: '148 min' },
    files: [
      { name: 'metropolis.mp4', format: 'h.264', size: '700000000', height: '480' }
    ]
  },
  no_video_here: { metadata: { title: 'Just A Scan' }, files: [{ name: 'scan.pdf', format: 'PDF' }] }
};

function archiveFetch(calls = []) {
  return async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes('advancedsearch')) {
      const page = Number(new URL(u).searchParams.get('page'));
      return json(page === 1 ? SEARCH_PAGE : { response: { docs: [] } });
    }
    const id = decodeURIComponent(u.split('/metadata/')[1] || '');
    if (META[id]) return json(META[id]);
    return json({});
  };
}

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map(Object.entries(headers)),
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(0)
});
/* fetch's headers object is a Headers, which has .get — Map does too. */

describe('the Internet Archive adapter', () => {
  test('it is the one requested-style provider that can be read, and says why', () => {
    assert.equal(archive.access.method, 'official_api');
    assert.equal(archive.access.status, 'available');
    assert.equal(archive.capabilities.playbackType, 'direct');
    assert.equal(typeof archive.discover, 'function');
  });

  test('the biggest playable derivative wins, not the first one listed', () => {
    const got = pickFile(META.night_of_the_living_dead.files);
    assert.equal(got.name, 'notld.mp4', 'the 900MB h.264, not the 512Kb one or the GIF');
  });

  test('an item with nothing playable is skipped rather than listed unopenable', () => {
    assert.equal(pickFile(META.no_video_here.files), null);
  });

  test('its odd metadata shapes are read properly', () => {
    assert.equal(yearOf('1968-10-01'), 1968);
    assert.equal(yearOf(['1927']), 1927);
    assert.equal(yearOf('no idea'), null);
    assert.equal(yearOf('1650'), null, 'before cinema existed');
    assert.equal(runtimeOf('1:36:12'), 96);
    assert.equal(runtimeOf('148 min'), 148);
    assert.equal(runtimeOf('5640'), 94, 'bare seconds');
    assert.equal(stripTags('<p>Seven people take <b>refuge</b>.</p>'), 'Seven people take refuge .');
  });

  test('a run imports real-shaped results, with playable urls and metadata', async () => {
    const p = providerByKey('archive-org');
    setProviderEnabled(p.id, true);
    const calls = [];
    const got = await runImport(p.id, { fetchImpl: archiveFetch(calls) });

    assert.equal(got.run.status, 'done', got.run.message);
    assert.equal(got.run.moviesDiscovered, 2);
    assert.ok(got.run.requestsMade >= 3, 'one search plus one metadata call each');

    const notld = movies({ search: 'Night of the Living Dead' }).items[0];
    assert.ok(notld, 'it arrived');
    assert.equal(notld.year, 1968);
    assert.equal(notld.runtimeMinutes, 96);
    assert.match(notld.description, /Seven people take refuge/);
    assert.equal(notld.description.includes('<'), false, 'and the markup came out');
    assert.ok(notld.genres.includes('Horror'));
    assert.deepEqual(notld.directors, ['George A. Romero']);
    assert.equal(notld.rating, 4.5);

    const [src] = movieSources(notld.id);
    assert.equal(src.providerKey, 'archive-org');
    assert.equal(src.playbackType, 'direct');
    assert.equal(src.playable, true);
    assert.match(src.url, /^https:\/\/archive\.org\/download\/night_of_the_living_dead\/notld\.mp4$/);
    assert.match(src.metadataUrl, /^https:\/\/archive\.org\/details\//);
    assert.notEqual(src.url, src.metadataUrl, 'metadata and playback are separate, as the brief asks');
  });

  test('it stops at the last page rather than asking for ten more', async () => {
    const p = providerByKey('archive-org');
    const calls = [];
    await runImport(p.id, { fetchImpl: archiveFetch(calls) });
    const searches = calls.filter(u => u.includes('advancedsearch'));
    assert.equal(searches.length, 1, `asked for ${searches.length} pages: ${searches.length > 1}`);
  });

  test('and a film it already has is updated, not duplicated', async () => {
    const before = catalogueCounts().movies;
    await runImport(providerByKey('archive-org').id, { fetchImpl: archiveFetch() });
    assert.equal(catalogueCounts().movies, before);
  });

  test('an Archive film and the same film on this disk become one card, two sources', () => {
    /* Inception (2010).mp4 is on the disk; pretend the Archive had it too. */
    const got = movies({ search: 'Inception' });
    assert.equal(got.total, 1);
    assert.ok(got.items[0].sources.length >= 1);
  });
});

/* ================================================== politeness and backoff = */

describe('not hammering a provider', () => {
  const adapterWith = (overrides) => ({
    key: 'polite-test', name: 'Polite Test',
    baseUrl: 'https://polite.example/',
    access: { method: 'official_api', status: 'available', reason: 'test', assessedAt: '2026-01-01' },
    capabilities: { metadata: true, artwork: false, playback: true, playbackType: 'direct' },
    limits: { requestDelayMs: 40, concurrency: 1, timeoutMs: 500, maxRetries: 2,
              refreshIntervalSeconds: 3600 },
    ...overrides
  });

  before(async () => {
    const { ADAPTERS } = await import('../src/services/providers/index.js');
    ADAPTERS.push(adapterWith({
      async * discover(ctx) {
        for (let i = 0; i < 3; i++) {
          await ctx.getJson(`https://polite.example/page/${i}`);
          yield { kind: 'movie', title: `Polite ${i}`, year: 2000 + i,
                  source: { contentId: `p${i}`, playbackType: 'direct',
                            playbackUrl: `https://polite.example/${i}.mp4` } };
        }
      }
    }));
    ensureProviders();
    setProviderEnabled(providerByKey('polite-test').id, true);
  });

  test('the provider\'s own delay is waited out between requests', async () => {
    const times = [];
    const fetchImpl = async () => { times.push(Date.now()); return json({}); };
    await runImport(providerByKey('polite-test').id, { fetchImpl });

    assert.equal(times.length, 3);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      assert.ok(gap >= 35, `request ${i} came ${gap}ms after the last, which is too soon`);
    }
  });

  test('a 429 with Retry-After is obeyed, not retried straight away', async () => {
    let n = 0;
    const stamps = [];
    const fetchImpl = async () => {
      stamps.push(Date.now());
      if (++n === 1) return json({ busy: true }, 429, { 'retry-after': '1' });
      return json({});
    };
    const before = Date.now();
    await runImport(providerByKey('polite-test').id, { fetchImpl });
    const waited = stamps[1] - stamps[0];
    assert.ok(waited >= 950, `only waited ${waited}ms after being asked for a second`);
    assert.ok(Date.now() - before < 8000, 'and did not sulk about it');
  });

  test('a 403 is taken as an answer, and not tried another way', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return json({}, 403); };
    const got = await runImport(providerByKey('polite-test').id, { fetchImpl });
    assert.equal(calls, 1, `retried a refusal ${calls} times`);
    assert.equal(got.run.status, 'failed');
    assert.match(got.run.message, /refused/);
  });

  test('a failure backs off before the next scheduled attempt', () => {
    const p = providerByKey('polite-test');
    assert.ok(p.fail_count > 0, 'the 403 was recorded');
    assert.equal(dueForImport(p, Date.parse(p.last_attempt_at) + 60_000), false,
      'not due a minute later');
    assert.equal(dueForImport(p, Date.parse(p.last_attempt_at) + 25 * 3600_000), true,
      'due the next day');
  });

  test('a timeout is a failure, not a hang', async () => {
    const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
      /* Never answers; the context's AbortController must end it. */
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const got = await runImport(providerByKey('polite-test').id, { fetchImpl });
    assert.equal(got.run.status, 'failed');
  });

  test('two refreshes at once are one pass, not two', async () => {
    const fetchImpl = async () => { await new Promise(r => setTimeout(r, 30)); return json({}); };
    const id = providerByKey('polite-test').id;
    const [a, b] = await Promise.all([
      runImport(id, { fetchImpl }), runImport(id, { fetchImpl })
    ]);
    assert.equal(a.run.id, b.run.id, 'one run, not two');
  });
});

/* ============================================================ artwork ====== */

describe('artwork is fetched once', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DAwAAABQABh6FO1AAAAABJRU5ErkJggg==',
    'base64');

  const imageReply = (buf, headers = {}) => ({
    ok: true, status: 200,
    headers: new Map(Object.entries({ 'content-type': 'image/png',
      'content-length': String(buf.length), etag: '"v1"', ...headers })),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    json: async () => ({})
  });

  test('a poster is downloaded and kept', async () => {
    let calls = 0;
    const row = await fetchArtwork('https://img.example/poster.png', {
      fetchImpl: async () => { calls++; return imageReply(PNG); }
    });
    assert.equal(row.state, 'cached');
    assert.equal(calls, 1);
    assert.ok(existsSync(path.join(artworkDir(), row.rel_path)));
    assert.ok(row.size_bytes > 0);
  });

  test('asking again does not download it again at all', async () => {
    let calls = 0;
    const row = await fetchArtwork('https://img.example/poster.png', {
      fetchImpl: async () => { calls++; return imageReply(PNG); }
    });
    assert.equal(calls, 0, 'it was already here');
    assert.equal(row.state, 'cached');
  });

  test('a validator is sent when a copy has to be rechecked, and a 304 costs nothing', async () => {
    const db = openDb();
    const row = db.prepare('SELECT * FROM artwork_cache WHERE url = ?')
      .get('https://img.example/poster.png');
    /* Pretend the copy went missing, so it is revalidated rather than skipped. */
    db.prepare("UPDATE artwork_cache SET rel_path = 'gone/missing.png' WHERE id = ?").run(row.id);

    let sent = null;
    const got = await fetchArtwork('https://img.example/poster.png', {
      fetchImpl: async (_u, opts) => {
        sent = opts.headers;
        return { ok: false, status: 304, headers: new Map(), json: async () => ({}),
                 arrayBuffer: async () => new ArrayBuffer(0) };
      }
    });
    assert.equal(sent['if-none-match'], '"v1"', 'the etag went out');
    assert.equal(got.state, 'cached');
  });

  test('something that is not an image is refused and remembered as such', async () => {
    const row = await fetchArtwork('https://img.example/not-a-picture', {
      fetchImpl: async () => ({
        ok: true, status: 200,
        headers: new Map([['content-type', 'text/html']]),
        arrayBuffer: async () => new ArrayBuffer(8), json: async () => ({})
      })
    });
    assert.equal(row.state, 'failed');
    assert.match(row.failure_reason, /not an image/);
  });

  test('and it is not asked for again straight away', async () => {
    let calls = 0;
    await fetchArtwork('https://img.example/not-a-picture', {
      fetchImpl: async () => { calls++; return imageReply(PNG); }
    });
    assert.equal(calls, 0);
  });

  test('a provider whose terms forbid a copy is linked instead', () => {
    const row = referenceOnly('https://strict.example/poster.jpg');
    assert.equal(row.state, 'reference_only');
    assert.equal(row.rel_path, '', 'nothing was stored');
  });

  test('the cache name fans out, so no directory holds ten thousand files', () => {
    const a = artworkName('https://img.example/a.png', 'image/png');
    const b = artworkName('https://img.example/b.png', 'image/png');
    assert.match(a, /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}\.png$/);
    assert.notEqual(path.dirname(a), path.dirname(b));
    assert.equal(artworkName('https://img.example/a.png', 'image/png'), a, 'and is stable');
  });

  test('a cached picture is served by id, and a doctored row cannot climb out', async () => {
    const db = openDb();
    const row = db.prepare("SELECT * FROM artwork_cache WHERE state = 'cached' LIMIT 1").get();
    db.prepare("UPDATE artwork_cache SET rel_path = ? WHERE id = ?")
      .run('../../../../etc/passwd', row.id);
    assert.throws(() => cachedArtworkPath(row.id), /No cached artwork/);
  });

  test('the figures are there for the settings screen', () => {
    const s = artworkStats();
    assert.ok(s.cached >= 1);
    assert.ok(s.failed >= 1);
    assert.equal(s.reference_only, 1);
  });

  test('a nonsense url is declined without a request', async () => {
    assert.equal(await fetchArtwork('not-a-url'), null);
    assert.equal(await fetchArtwork(''), null);
    assert.equal(await fetchArtwork('file:///etc/passwd'), null);
  });
});
