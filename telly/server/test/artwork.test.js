import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { ingestMovie, ingestSeries, movies, seriesList, publicMovie, movie } =
  await import('../src/services/catalogue.js');
const { ensureProviders, providerByKey } = await import('../src/services/providers/index.js');
const { fetchArtwork, artworkStats, artworkDir, artworkState, cacheBytes, pruneArtwork,
        diskUsage, reconcileArtwork, makeRoom, ceilingBytes, reviveEvicted, cacheFull } =
  await import('../src/services/artwork.js');
const { artworkPass, resolveArtwork, needingArtwork, artworkSummary, storedTmdbId } =
  await import('../src/services/posters.js');
const tmdb = await import('../src/services/tmdb.js');
const { placeholderSvg, initialsOf } = await import('../src/services/placeholder.js');
const { artSignature } = await import('../src/lib/tickets.js');
const { config } = await import('../src/config.js');
const { closeDb, openDb } = await import('../src/db/index.js');

/**
 * Getting a poster onto every card.
 *
 * The order is the thing being tested: a provider's own poster wins, TMDB is
 * the fallback and only where it is configured, an id is preferred to a
 * search, searches are rationed, and a title nothing has a picture for is
 * recorded as such so a catalogue of twenty-four thousand films does not
 * become twenty-four thousand searches every night.
 */

/* A one-pixel JPEG, so "it cached a real image" means real bytes. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAA' +
  'AAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/a' +
  'AAwDAQACEQMRAD8AmAA/9k=', 'base64');

/* Everything the fake internet serves, and a record of what was asked for. */
const asked = [];
const IMAGES = {
  'http://art.example/good-poster.jpg': { type: 'image/jpeg', body: JPEG },
  'http://art.example/good-backdrop.jpg': { type: 'image/jpeg', body: JPEG },
  'http://art.example/not-an-image': { type: 'text/html', body: Buffer.from('<html>sorry</html>') },
  'http://art.example/enormous.jpg': { type: 'image/jpeg', body: Buffer.alloc(4 * 1024 * 1024, 7) },
  'http://images.test/w342/tmdb-poster.jpg': { type: 'image/jpeg', body: JPEG },
  'http://images.test/w780/tmdb-backdrop.jpg': { type: 'image/jpeg', body: JPEG },
  /* One picture that revalidates, so the ETag path is exercised. */
  'http://art.example/etagged.jpg': { type: 'image/jpeg', body: JPEG, etag: '"abc123"' }
};

/* Every request's headers, so a test can ask what was actually sent. */
const sent = [];

const TMDB = {
  /* by id */
  '/movie/329865': { id: 329865, title: 'Arrival', release_date: '2016-11-11',
    poster_path: '/tmdb-poster.jpg', backdrop_path: '/tmdb-backdrop.jpg',
    overview: 'A linguist and some visitors.', vote_average: 7.9,
    genres: [{ name: 'Science Fiction' }], runtime: 116, imdb_id: 'tt2543164' },
  '/movie/424242': { id: 424242, title: 'Has A Plot', release_date: '2010-05-05',
    poster_path: '/tmdb-poster.jpg', overview: 'What TMDB said.', vote_average: 6.1 },
  /* by title and year */
  'search/movie:Zodiac:2007': { results: [
    { id: 1949, title: 'Zodiac', release_date: '2007-03-02', poster_path: '/tmdb-poster.jpg',
      overview: 'A cartoonist becomes obsessed.', vote_average: 7.4 }
  ] },
  /* a search whose only answer is the wrong film */
  'search/movie:Mystery Film:1999': { results: [
    { id: 55, title: 'Something Else Entirely', release_date: '1999-01-01',
      poster_path: '/tmdb-poster.jpg' }
  ] },
  /* a series */
  'search/tv:Zealots:2019': { results: [
    { id: 777, name: 'Zealots', first_air_date: '2019-04-01', poster_path: '/tmdb-poster.jpg' }
  ] }
};

function fakeFetch(url, opts = {}) {
  const u = String(url);
  asked.push(u);
  sent.push({ url: u, headers: (opts && opts.headers) || {} });

  if (IMAGES[u]) {
    const img = IMAGES[u];
    /* A host that was given a validator answers the way a real one does. */
    if (img.etag && ((opts && opts.headers) || {})['if-none-match'] === img.etag) {
      return Promise.resolve({ ok: false, status: 304, headers: { get: () => null } });
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (h) => (h === 'content-type' ? img.type
        : h === 'content-length' ? String(img.body.length)
        : h === 'etag' ? (img.etag || null) : null) },
      arrayBuffer: async () => img.body
    });
  }

  if (u.includes('/api.test/')) {
    const parsed = new URL(u);
    const p = parsed.pathname.replace('/api.test', '');
    let body = TMDB[p];
    if (!body && p.startsWith('/search/')) {
      const kind = p.split('/')[2];
      const q = parsed.searchParams.get('query');
      const y = parsed.searchParams.get('year') || parsed.searchParams.get('first_air_date_year');
      body = TMDB[`search/${kind}:${q}:${y}`] || { results: [] };
    }
    if (!body) {
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
                             json: async () => body });
  }

  return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found',
                           headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0) });
}

const film = (title, extra = {}) => ({
  kind: 'movie', title, year: extra.year ?? 2016,
  source: { contentId: `art:${title}`, playbackType: 'direct', availability: 'available',
            playbackUrl: `http://streams.example/${encodeURIComponent(title)}.mp4` },
  ...extra
});

let app, token, adminToken, providerId;
const idOf = (title) => movies({ search: title }).items[0].id;
const rowOf = (title) => openDb().prepare(
  'SELECT * FROM catalogue_movies WHERE canonical_title = ?').get(title);

before(async () => {
  app = await buildServer({ logger: false });
  ensureProviders();
  providerId = providerByKey('local').id;
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-art-000001', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-art-admin1', name: 'PC' })).json().accessToken;

  /* Point TMDB at the fake internet. */
  config.tmdb.apiBase = 'http://api.test';
  config.tmdb.imageBase = 'http://images.test';
  config.tmdb.requestDelayMs = 0;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('a provider poster that works is the answer', () => {
  before(() => {
    ingestMovie(providerId, film('Good Poster', { poster: 'http://art.example/good-poster.jpg' }));
  });

  test('it is fetched, stored and recorded as the provider\'s', async () => {
    const row = rowOf('Good Poster');
    assert.equal(row.art_state, '', 'nobody has looked yet');
    const got = await resolveArtwork('movie', row, { fetchImpl: fakeFetch });
    assert.equal(got, 'provider');
    assert.equal(rowOf('Good Poster').art_state, 'provider');
  });

  test('the bytes really are on disk', () => {
    const st = artworkState('http://art.example/good-poster.jpg');
    assert.ok(st.id, 'cached');
    const cached = openDb().prepare('SELECT * FROM artwork_cache WHERE id = ?').get(st.id);
    const file = path.join(artworkDir(), cached.rel_path);
    assert.ok(existsSync(file));
    assert.deepEqual(readFileSync(file), JPEG);
    assert.equal(cached.content_type, 'image/jpeg');
    assert.equal(cached.size_bytes, JPEG.length);
  });

  test('and the API hands out an address on this server, not the provider\'s', async () => {
    const id = idOf('Good Poster');
    const res = await app.inject({ method: 'GET', url: `/api/v1/catalogue/movies/${id}`,
                                   headers: auth(token) });
    const m = res.json();
    assert.match(m.poster, /^\/api\/v1\/catalogue\/art\/\d+\/[A-Za-z0-9_-]+$/);
    assert.ok(!m.poster.includes('art.example'));
  });

  test('that address serves the picture with no header at all', async () => {
    const id = idOf('Good Poster');
    const m = (await app.inject({ method: 'GET', url: `/api/v1/catalogue/movies/${id}`,
                                  headers: auth(token) })).json();
    /* An <img> cannot send an Authorization header, which is why the old
       authenticated-only route never worked in a browser. */
    const res = await app.inject({ method: 'GET', url: m.poster });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.deepEqual(res.rawPayload, JPEG);
  });

  test('and a wrong signature gets nothing', async () => {
    const st = artworkState('http://art.example/good-poster.jpg');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/catalogue/art/${st.id}/wrong` }))
      .statusCode, 404);
    /* The signature is for that one picture. */
    assert.equal((await app.inject({
      method: 'GET', url: `/api/v1/catalogue/art/${st.id + 1}/${artSignature(st.id)}` })).statusCode, 404);
  });

  test('a second pass over it asks for nothing', async () => {
    const before = asked.length;
    const got = await resolveArtwork('movie', rowOf('Good Poster'), { fetchImpl: fakeFetch });
    assert.equal(got, 'provider');
    assert.equal(asked.length, before, 'a settled poster costs no requests');
  });

  test('and TMDB was never asked about it', () => {
    assert.ok(!asked.some(u => u.includes('api.test')), asked.filter(u => u.includes('api.test')).join(' '));
  });
});

describe('a provider poster that does not work is not handed out', () => {
  before(() => {
    ingestMovie(providerId, film('Broken Poster', { poster: 'http://art.example/missing.jpg' }));
    ingestMovie(providerId, film('Html Poster', { poster: 'http://art.example/not-an-image' }));
  });

  test('a 404 is recorded as failed, not retried, and not offered', async () => {
    await resolveArtwork('movie', rowOf('Broken Poster'), { fetchImpl: fakeFetch });
    assert.equal(artworkState('http://art.example/missing.jpg').state, 'failed');

    const before = asked.length;
    await fetchArtwork('http://art.example/missing.jpg', { fetchImpl: fakeFetch });
    assert.equal(asked.length, before, 'a known-dead URL is not fetched again');

    const m = publicMovie(movie(idOf('Broken Poster')));
    assert.equal(m.poster, '', 'and the client is not given a broken image to try');
  });

  test('a page pretending to be a poster is refused on its content type', async () => {
    await resolveArtwork('movie', rowOf('Html Poster'), { fetchImpl: fakeFetch });
    const st = artworkState('http://art.example/not-an-image');
    assert.equal(st.state, 'failed');
    const reason = openDb().prepare('SELECT failure_reason FROM artwork_cache WHERE url = ?')
      .get('http://art.example/not-an-image').failure_reason;
    assert.match(reason, /not an image/);
  });

  test('a failure is reconsidered after a while, not written off for ever', () => {
    const { staleFailure } = require_staleFailure();
    const fresh = { fetched_at: new Date().toISOString() };
    const old = { fetched_at: new Date(Date.now() - 30 * 86400e3).toISOString() };
    assert.equal(staleFailure(fresh), false);
    assert.equal(staleFailure(old), true);
  });
});

/* Imported lazily so the describe above reads in order. */
function require_staleFailure() {
  return { staleFailure: artworkModule.staleFailure };
}
const artworkModule = await import('../src/services/artwork.js');

describe('a poster bigger than the limit is refused rather than stored', () => {
  test('four megabytes does not get in', async () => {
    const got = await fetchArtwork('http://art.example/enormous.jpg', { fetchImpl: fakeFetch });
    assert.equal(got.state, 'failed');
    assert.match(got.failure_reason, /too large/);
    assert.ok(config.artwork.maxPosterBytes < 4 * 1024 * 1024,
      'the limit is poster-sized, not film-sized');
  });

  test('and the cache total is what the settings screen reports', () => {
    const stats = artworkStats();
    assert.equal(stats.cached, 1, 'only the good poster');
    assert.equal(stats.bytes, JPEG.length);
    assert.equal(stats.perImageLimit, config.artwork.maxPosterBytes);
    assert.ok(stats.maxBytes > stats.bytes);
    assert.equal(stats.full, false);
  });

  test('a full cache makes room rather than refusing the picture', async () => {
    const was = config.artwork.maxMb;
    config.artwork.maxMb = 1;                     // the smallest the floor allows
    /* Pretend two megabytes of posters are already here, which is over. */
    openDb().prepare(`INSERT INTO artwork_cache (url, state, size_bytes, rel_path,
          etag, created_at, last_used_at)
        VALUES ('http://art.example/pretend-big.jpg', 'cached', ?, 'x/y/pretend.jpg',
          '"old"', ?, ?)`)
      .run(2 * 1024 * 1024, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
    try {
      cacheBytes({ fresh: true });
      assert.equal(artworkStats().full, true, 'the cache reports itself full');

      const before = asked.length;
      const got = await fetchArtwork('http://art.example/good-backdrop.jpg', { fetchImpl: fakeFetch });
      assert.ok(asked.length > before, 'it was fetched, not dropped on the floor');
      assert.equal(got.state, 'cached', 'and it is here');
      assert.ok(cacheBytes({ fresh: true }) <= ceilingBytes(), 'and the limit still holds');

      /* The oldest one paid for it, and left nothing behind to 304 against. */
      const old = openDb().prepare(`SELECT * FROM artwork_cache WHERE url = ?`)
        .get('http://art.example/pretend-big.jpg');
      assert.notEqual(old.state, 'cached');
      assert.equal(old.size_bytes, 0);
      assert.equal(old.etag, '');
    } finally {
      openDb().prepare(`DELETE FROM artwork_cache WHERE url = 'http://art.example/pretend-big.jpg'`).run();
      config.artwork.maxMb = was;
      cacheBytes({ fresh: true });
    }
  });
});

describe('TMDB, when a provider has nothing', () => {
  test('it does nothing at all without a key', async () => {
    config.tmdb.key = '';
    ingestMovie(providerId, film('No Key Film', { year: 2001 }));
    const before = asked.filter(u => u.includes('api.test')).length;
    const got = await resolveArtwork('movie', rowOf('No Key Film'), { fetchImpl: fakeFetch });
    /* Not 'none' — 'none' means somebody looked and nobody had one, and it is
       left alone for a month on the strength of that. This was nowhere to
       look, which is a different answer and a much shorter sentence. */
    assert.equal(got, 'nokey');
    assert.equal(asked.filter(u => u.includes('api.test')).length, before,
      'no key means no request');
    assert.equal(tmdb.configured(), false);
  });

  test('and reconsiders it the moment a key is set', async () => {
    /* The point of recording 'nokey' separately: a catalogue imported before
       the operator got a TMDB key must not wait out the 'none' month before
       anybody looks at it. */
    assert.equal(rowOf('No Key Film').art_state, 'nokey');
    assert.ok(needingArtwork('movie', 500).some(r => r.canonical_title === 'No Key Film'),
      'due again straight away, not in thirty days');

    config.tmdb.key = 'test-key';
    const budget = tmdb.makeBudget(5);
    const got = await resolveArtwork('movie', rowOf('No Key Film'), { budget, fetchImpl: fakeFetch });
    /* The fake internet has no 'No Key Film', so the answer is still nothing
       — but it is now a considered nothing, and it cost a search to find out. */
    assert.equal(got, 'none');
    assert.equal(budget.searches, 1);
    assert.ok(!needingArtwork('movie', 500).some(r => r.canonical_title === 'No Key Film'),
      'and now it is settled, so the next pass leaves it alone');
  });

  test('an id the provider supplied is used directly', async () => {
    config.tmdb.key = 'test-key';
    ingestMovie(providerId, film('Arrival', { year: 2016, externalIds: { tmdb: '329865' } }));
    const row = rowOf('Arrival');
    assert.equal(storedTmdbId('movie', row.id), '329865', 'the id came in with the import');

    const budget = tmdb.makeBudget(5);
    const got = await resolveArtwork('movie', row, { budget, fetchImpl: fakeFetch });
    assert.equal(got, 'tmdb');
    assert.equal(budget.byId, 1);
    assert.equal(budget.searches, 0, 'an id costs no part of the search ration');
    assert.ok(asked.some(u => u.includes('/movie/329865')));
  });

  test('its poster is cached here and served from here', async () => {
    const m = publicMovie(movie(idOf('Arrival')));
    assert.match(m.poster, /^\/api\/v1\/catalogue\/art\/\d+\//);
    const res = await app.inject({ method: 'GET', url: m.poster });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.rawPayload, JPEG);
    assert.ok(asked.some(u => u === 'http://images.test/w342/tmdb-poster.jpg'),
      'fetched at the configured poster size, not at print resolution');
  });

  test('and the gaps it filled are the empty ones only', () => {
    const row = rowOf('Arrival');
    assert.match(row.description, /linguist/, 'the plot was empty, so it was filled');
    assert.equal(row.rating, 7.9);
    assert.ok(row.backdrop_url.includes('w780'), 'a backdrop at backdrop size');
  });

  test('a provider\'s own plot is never overwritten', async () => {
    /* Its own TMDB id, not Arrival's: two works quoting one id are one work,
       which is the deduplication ladder doing its job. */
    ingestMovie(providerId, film('Has A Plot', {
      year: 2010, description: 'What the provider said.', externalIds: { tmdb: '424242' } }));
    const row = rowOf('Has A Plot');
    assert.ok(row, 'filed as its own work');
    await resolveArtwork('movie', row, { budget: tmdb.makeBudget(5), fetchImpl: fakeFetch });
    assert.equal(rowOf('Has A Plot').description, 'What the provider said.',
      'the provider said it, so it stands');
    assert.ok(rowOf('Has A Plot').poster_url.includes('tmdb-poster'),
      'but the poster it had none of was filled in');
  });

  test('the resolved ids are stored in the catalogue\'s own table', () => {
    const id = idOf('Arrival');
    const ids = openDb().prepare('SELECT scheme, value FROM catalogue_ids WHERE work_kind = ? AND work_id = ?')
      .all('movie', id);
    const map = Object.fromEntries(ids.map(r => [r.scheme, r.value]));
    assert.equal(map.tmdb, '329865');
    assert.equal(map.imdb, 'tt2543164', 'and the imdb id it reported, stored but never followed');
  });

  test('with no id, a title and year search is used', async () => {
    ingestMovie(providerId, film('Zodiac', { year: 2007 }));
    const budget = tmdb.makeBudget(5);
    const got = await resolveArtwork('movie', rowOf('Zodiac'), { budget, fetchImpl: fakeFetch });
    assert.equal(got, 'tmdb');
    assert.equal(budget.searches, 1, 'and it costs one of the ration');
    assert.equal(storedTmdbId('movie', idOf('Zodiac')), '1949', 'the id it found is kept');
  });

  test('a search that only finds the wrong film is refused', async () => {
    ingestMovie(providerId, film('Mystery Film', { year: 1999 }));
    const got = await resolveArtwork('movie', rowOf('Mystery Film'),
      { budget: tmdb.makeBudget(5), fetchImpl: fakeFetch });
    assert.equal(got, 'none', 'a wrong poster is worse than none');
    assert.equal(rowOf('Mystery Film').poster_url, '');
  });

  test('a title with no year is not searched for at all', async () => {
    ingestMovie(providerId, film('No Year At All', { year: null }));
    const budget = tmdb.makeBudget(5);
    const before = asked.filter(u => u.includes('/search/')).length;
    const got = await resolveArtwork('movie', rowOf('No Year At All'), { budget, fetchImpl: fakeFetch });
    assert.equal(got, 'none');
    assert.equal(budget.searches, 0, 'nothing to narrow a search with');
    assert.equal(asked.filter(u => u.includes('/search/')).length, before);
  });

  test('a series is searched as a series, not as a film', async () => {
    ingestSeries(providerId, { kind: 'series', title: 'Zealots', year: 2019,
      source: { contentId: 'art:series:zealots', availability: 'available' },
      seasons: [{ number: 1, episodes: [{ number: 1, title: 'One',
        source: { contentId: 'art:ep:1', playbackType: 'direct', playbackUrl: 'http://x/1.mp4' } }] }] });
    const row = openDb().prepare('SELECT * FROM catalogue_series WHERE canonical_title = ?').get('Zealots');
    const got = await resolveArtwork('series', row, { budget: tmdb.makeBudget(5), fetchImpl: fakeFetch });
    assert.equal(got, 'tmdb');
    assert.ok(asked.some(u => u.includes('/search/tv')), 'the tv endpoint, not the movie one');
    assert.ok(!asked.some(u => u.includes('/search/movie?query=Zealots')));
  });
});

describe('the ration is real', () => {
  test('a pass stops searching once the budget is spent', async () => {
    for (let i = 0; i < 6; i++) ingestMovie(providerId, film(`Unknown Film ${i}`, { year: 1990 + i }));
    const budget = tmdb.makeBudget(2);
    const before = asked.filter(u => u.includes('/search/')).length;
    const got = await artworkPass({ limit: 50, budget, fetchImpl: fakeFetch });
    const searches = asked.filter(u => u.includes('/search/')).length - before;
    assert.equal(searches, 2, `two searches, not ${searches}`);
    assert.equal(budget.left, 0);
    assert.ok(got.looked >= 6, 'it still looked at every one of them');
  });

  test('what it could not resolve is marked, so it is not retried tomorrow', () => {
    const none = openDb().prepare(
      `SELECT COUNT(*) n FROM catalogue_movies WHERE art_state = 'none'`).get().n;
    assert.ok(none >= 4, `${none} recorded as having nothing`);
    /* And those rows are not offered to the next pass. */
    const due = needingArtwork('movie', 500).map(r => r.canonical_title);
    assert.ok(!due.includes('Mystery Film'), due.join(', '));
  });

  test('a settled catalogue gives a pass almost nothing to do', async () => {
    const before = asked.length;
    const got = await artworkPass({ limit: 500, budget: tmdb.makeBudget(50), fetchImpl: fakeFetch });
    assert.equal(got.looked, 0, 'nothing is due');
    assert.equal(asked.length, before, 'and nothing was asked of anybody');
  });
});

describe('the placeholder', () => {
  test('it is a poster-shaped SVG, served without a header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalogue/art/placeholder/movie' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /image\/svg\+xml/);
    assert.match(res.body, /viewBox="0 0 400 600"/);
    assert.match(res.body, /No poster/);
  });

  test('series get their own', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalogue/art/placeholder/series' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /No artwork/);
  });

  test('every work offers it, so a client never has nothing to draw', async () => {
    const m = (await app.inject({ method: 'GET', url: `/api/v1/catalogue/movies/${idOf('Mystery Film')}`,
                                  headers: auth(token) })).json();
    assert.equal(m.poster, '', 'no poster was found for it');
    assert.equal(m.posterFallback, '/api/v1/catalogue/art/placeholder/movie');
    const img = await app.inject({ method: 'GET', url: m.posterFallback });
    assert.equal(img.statusCode, 200);
  });

  test('a title only changes its colour, and cannot inject markup', () => {
    const a = placeholderSvg('movie', 'Zodiac');
    const b = placeholderSvg('movie', 'Arrival');
    assert.notEqual(a, b, 'two films do not look like the same missing poster');
    assert.equal(placeholderSvg('movie', 'Zodiac'), a, 'and the same film always looks the same');
    const nasty = placeholderSvg('movie', '"><script>alert(1)</script>');
    assert.ok(!nasty.includes('<script>'));
    assert.deepEqual([initialsOf('The Zone of Interest'), initialsOf('Zodiac')], ['ZI', 'Z']);
  });

  test('an unknown kind is a movie, not an error', () => {
    assert.match(placeholderSvg('../../etc/passwd'), /viewBox/);
  });
});

describe('what an operator sees, and what the pass reports', () => {
  test('the summary counts how each poster was found', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/catalogue/artwork',
                                   headers: auth(adminToken) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.summary.movies.total > 0);
    assert.ok(body.summary.movies.provider >= 1);
    assert.ok(body.summary.movies.tmdb >= 2);
    assert.ok(body.summary.movies.none >= 1);
    assert.equal(body.summary.movies.withPoster,
      body.summary.movies.provider + body.summary.movies.tmdb);
    assert.ok(body.artwork.cached >= 2);
  });

  test('it says whether TMDB is configured, and acknowledges it', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/v1/admin/catalogue/artwork',
                                     headers: auth(adminToken) })).json();
    assert.equal(body.summary.tmdb.configured, true);
    assert.match(body.summary.tmdb.attribution, /not endorsed or certified by TMDB/);
    assert.equal(body.summary.tmdb.posterSize, 'w342');
  });

  test('and never the key itself', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/v1/admin/catalogue/artwork',
                                     headers: auth(adminToken) })).body;
    assert.ok(!body.includes('test-key'));
  });

  test('the Settings panel is given the same figures', async () => {
    /* Settings reads /admin/providers, not /admin/catalogue/artwork, so the
       count of titles with a poster — and TMDB's required acknowledgement —
       have to be on that answer too, or the panel shows a cache size and
       says nothing about the holes in the wall. */
    const body = (await app.inject({ method: 'GET', url: '/api/v1/admin/providers',
                                     headers: auth(adminToken) })).json();
    assert.ok(body.posters, 'the providers answer carries the poster summary');
    assert.equal(body.posters.movies.withPoster,
      body.posters.movies.provider + body.posters.movies.tmdb);
    assert.match(body.posters.tmdb.attribution, /not endorsed or certified by TMDB/);
    assert.ok(!JSON.stringify(body).includes('test-key'), 'and still not the key');
  });

  test('running a pass is an admin action', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/catalogue/artwork',
      headers: auth(token), payload: {} })).statusCode, 403);
  });

  test('no video was fetched by any of this', () => {
    const video = asked.filter(u => /\.(mp4|mkv|ts|avi|m3u8)(\?|$)/i.test(u));
    assert.deepEqual(video, [], 'artwork is pictures');
  });

  test('a prune frees room and lets fetching resume', () => {
    const before = artworkStats();
    const got = pruneArtwork({ keepDays: -1, limit: 10 });
    assert.ok(got.dropped > 0);
    assert.ok(artworkStats().bytes < before.bytes);
  });

  test('and what was pruned is fetched whole again, not revalidated away', async () => {
    /* The trap: a pruned row still remembers the ETag. Ask "has it changed?"
       about a picture that is no longer here and the answer is 304 — which
       would mark it cached with nothing on disk, and hand every device in
       the house an address that cannot be served. */
    const url = 'http://art.example/etagged.jpg';
    const first = await fetchArtwork(url, { fetchImpl: fakeFetch });
    assert.equal(first.state, 'cached');
    assert.equal(first.etag, '"abc123"', 'the validator was stored');
    assert.ok(existsSync(path.join(artworkDir(), first.rel_path)));

    pruneArtwork({ keepDays: -1, limit: 50 });
    const pruned = openDb().prepare('SELECT * FROM artwork_cache WHERE url = ?').get(url);
    assert.equal(pruned.state, 'pending');
    assert.equal(pruned.rel_path, '');

    sent.length = 0;
    const again = await fetchArtwork(url, { fetchImpl: fakeFetch });
    const ask = sent.find(r => r.url === url);
    assert.ok(ask, 'it asked again');
    assert.equal(ask.headers['if-none-match'], undefined,
      'it must not ask whether a picture it no longer holds has changed');
    assert.equal(again.state, 'cached');
    assert.ok(existsSync(path.join(artworkDir(), again.rel_path)),
      'and the file is really back on disk');

    /* And the address a client is given actually serves it. */
    const res = await app.inject({ method: 'GET',
      url: `/api/v1/catalogue/art/${again.id}/${artSignature(again.id)}` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.rawPayload, JPEG);
  });
});

/**
 * The limit is a limit.
 *
 * It was not: the cache checked its ceiling before fetching and refused what
 * came after, which meant the picture that crossed the line was still written
 * and everything after it was simply dropped on the floor. On a real
 * catalogue the folder passed the ceiling anyway, because the ledger in the
 * database and the files in the folder had drifted apart.
 *
 * So: the ceiling is enforced against the picture's real size, at the moment
 * it is about to be written, by evicting the least recently used pictures to
 * fit it — and it is enforced against what is on the disk, not only against
 * what a column says is on the disk.
 */
describe('the cache cannot grow past its limit', () => {
  /* A picture host serving pictures of a known size, so "the cache is this
     big" is a number this test chose rather than one it discovered. */
  const SIZE = 64 * 1024;
  const CEILING_MB = 1;                                   // 16 pictures' worth
  const pic = (n) => Buffer.alloc(SIZE, n % 251);
  const served = [];
  const host = (n) => async () => {
    served.push(n);
    const b = pic(n);
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'image/jpeg'], ['content-length', String(SIZE)],
                        ['etag', `"v${n}"`]]),
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    };
  };
  const url = (n) => `http://cap.example/poster-${n}.jpg`;

  let wasMb;
  before(() => { wasMb = config.artwork.maxMb; config.artwork.maxMb = CEILING_MB; });
  after(() => { config.artwork.maxMb = wasMb; });

  test('forty pictures into a cache that holds sixteen', async () => {
    let cached = 0;
    for (let n = 0; n < 40; n++) {
      const row = await fetchArtwork(url(n), { fetchImpl: host(n) });
      if (row && row.state === 'cached') cached += 1;
      /* The invariant, checked after EVERY fetch rather than at the end —
         a cache that goes over and comes back has still gone over. */
      assert.ok(cacheBytes({ fresh: true }) <= ceilingBytes(),
        `over the limit after ${n + 1}: ${cacheBytes()} > ${ceilingBytes()}`);
    }
    assert.equal(cached, 40, 'every one was fetched — nothing was refused for want of room');
  });

  test('and the folder on disk is under it too, which is the number that matters', () => {
    const disk = diskUsage();
    assert.ok(disk.bytes <= ceilingBytes(),
      `${disk.bytes} bytes across ${disk.files} files, limit ${ceilingBytes()}`);
    /* And the ledger is telling the truth about the folder. */
    assert.equal(disk.bytes, cacheBytes({ fresh: true }),
      'the ledger and the folder agree');
  });

  test('what it kept is the most recently used, and it is really readable', async () => {
    const last = openDb().prepare(`SELECT url, rel_path FROM artwork_cache
        WHERE state = 'cached' AND url LIKE 'http://cap.example/%'
        ORDER BY last_used_at DESC LIMIT 1`).get();
    assert.ok(last, 'something survived');
    assert.ok(existsSync(path.join(artworkDir(), last.rel_path)), 'and its file is on disk');
    assert.equal(readFileSync(path.join(artworkDir(), last.rel_path)).length, SIZE);
  });

  test('the ones it dropped are marked evicted, not failed', () => {
    const stats = artworkStats();
    assert.ok(stats.evicted > 0, 'something was evicted to make room');
    const failed = openDb().prepare(`SELECT COUNT(*) n FROM artwork_cache
        WHERE url LIKE 'http://cap.example/%' AND state = 'failed'`).get().n;
    assert.equal(failed, 0, 'running out of room is not the picture\'s fault');
  });

  test('an evicted picture keeps no validator, so it cannot 304 into nothing', () => {
    const rows = openDb().prepare(`SELECT etag, last_modified, rel_path, size_bytes
        FROM artwork_cache WHERE state = 'evicted'`).all();
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.etag, '', 'no etag');
      assert.equal(r.last_modified, '', 'no last-modified');
      assert.equal(r.rel_path, '', 'and no path to a file that is not there');
      assert.equal(r.size_bytes, 0);
    }
  });

  test('and an evicted picture downloads again, whole, when it is asked for', async () => {
    const gone = openDb().prepare(`SELECT url FROM artwork_cache
        WHERE state = 'evicted' AND url LIKE 'http://cap.example/%' LIMIT 1`).get();
    assert.ok(gone, 'there is one to ask for');
    const n = Number(gone.url.match(/poster-(\d+)/)[1]);

    let sentHeaders = null;
    const row = await fetchArtwork(gone.url, {
      fetchImpl: async (_u, opts) => { sentHeaders = (opts && opts.headers) || {}; return host(n)(); }
    });
    assert.equal(sentHeaders['if-none-match'], undefined,
      'no validator for a picture we no longer hold');
    assert.equal(row.state, 'cached');
    assert.ok(existsSync(path.join(artworkDir(), row.rel_path)), 'the file is back');
    assert.equal(readFileSync(path.join(artworkDir(), row.rel_path)).length, SIZE,
      'and it is the whole picture, not an empty file left by a 304');

    /* Taking it back cost somebody else their place, and the limit still holds. */
    assert.ok(cacheBytes({ fresh: true }) <= ceilingBytes());
  });

  test('and it is served over the wire from its signed address', async () => {
    const row = openDb().prepare(`SELECT id FROM artwork_cache
        WHERE state = 'cached' AND url LIKE 'http://cap.example/%' LIMIT 1`).get();
    const res = await app.inject({ method: 'GET',
      url: `/api/v1/catalogue/art/${row.id}/${artSignature(row.id)}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.rawPayload.length, SIZE);
  });

  test('an evicted poster falls back to its provider, not to a dead address here', async () => {
    /* The failure this guards against is a wall of broken images: handing a
       client /catalogue/art/<id> for a picture that has just been evicted
       would 404 on every card at once. */
    const ev = openDb().prepare(`SELECT id, url FROM artwork_cache
        WHERE state = 'evicted' LIMIT 1`).get();
    assert.ok(ev);
    const { id, state } = artworkState(ev.url);
    assert.equal(id, null, 'no id is offered for a picture that is not here');
    assert.equal(state, 'evicted');

    /* And if somebody did ask for it by id, it is a plain not-found. */
    const res = await app.inject({ method: 'GET',
      url: `/api/v1/catalogue/art/${ev.id}/${artSignature(ev.id)}` });
    assert.equal(res.statusCode, 404);
  });

  test('no catalogue record was harmed in the making of this room', () => {
    const db = openDb();
    /* The films seeded by the rest of this file are all still here, with
       their sources and their poster URLs — only pictures were deleted. */
    assert.ok(db.prepare('SELECT COUNT(*) n FROM catalogue_movies').get().n > 0);
    assert.ok(db.prepare('SELECT COUNT(*) n FROM catalogue_movie_sources').get().n > 0);
    const blanked = db.prepare(`SELECT COUNT(*) n FROM catalogue_movies
        WHERE art_state IN ('provider','tmdb') AND poster_url = ''`).get().n;
    assert.equal(blanked, 0, 'a film that had a poster URL still has it');
  });

  test('a picture larger than the whole cache is refused rather than endlessly evicted for',
    async () => {
      const huge = Buffer.alloc(ceilingBytes() + 1024, 3);
      const wasPer = config.artwork.maxPosterBytes;
      config.artwork.maxPosterBytes = huge.length + 1;      // let it past the per-image cap
      try {
        const before = openDb().prepare(`SELECT COUNT(*) n FROM artwork_cache
            WHERE state = 'cached'`).get().n;
        assert.equal(makeRoom(huge.length), false, 'eviction cannot help with this one');
        const row = await fetchArtwork('http://cap.example/colossus.jpg', {
          fetchImpl: async () => ({
            ok: true, status: 200,
            headers: new Map([['content-type', 'image/jpeg']]),
            arrayBuffer: async () => huge.buffer.slice(huge.byteOffset,
                                                       huge.byteOffset + huge.byteLength)
          })
        });
        assert.notEqual(row.state, 'cached');
        assert.notEqual(row.state, 'failed', 'and it is not blamed for being big');
        assert.ok(cacheBytes({ fresh: true }) <= ceilingBytes());
        assert.equal(openDb().prepare(`SELECT COUNT(*) n FROM artwork_cache
            WHERE state = 'cached'`).get().n, before,
          'and it did not evict the whole cache trying');
      } finally { config.artwork.maxPosterBytes = wasPer; }
    });

  test('raising the limit brings the evicted pictures back into the queue', () => {
    assert.ok(artworkStats().evicted > 0);
    assert.equal(reviveEvicted(), 0, 'not while the cache is still this full');

    config.artwork.maxMb = CEILING_MB * 8;
    cacheBytes({ fresh: true });
    const revived = reviveEvicted();
    assert.ok(revived > 0, 'there is room now, so they are due again');
    assert.equal(artworkStats().evicted, 0);
    config.artwork.maxMb = CEILING_MB;
  });
});

describe('the folder and the ledger are kept in step', () => {
  test('a file nothing claims is reclaimed, and the total corrected', () => {
    /* Exactly the drift that put a 2 GB cache at 2.78 GB on disk: bytes in
       the folder that no row points at, which no prune would ever have
       looked at because a prune reads the table. */
    const orphanDir = path.join(artworkDir(), 'ff', 'ee');
    mkdirSync(orphanDir, { recursive: true });
    const orphan = path.join(orphanDir, 'ffee00112233445566778899aabbccdd.jpg');
    writeFileSync(orphan, Buffer.alloc(300 * 1024, 1));

    const before = diskUsage();
    assert.ok(before.bytes > cacheBytes({ fresh: true }),
      'the folder weighs more than the ledger says');

    const got = reconcileArtwork();
    assert.equal(got.orphans, 1);
    assert.ok(got.freed >= 300 * 1024);
    assert.equal(existsSync(orphan), false, 'the file is gone');

    const after = diskUsage();
    assert.equal(after.bytes, cacheBytes({ fresh: true }),
      'and now the folder and the ledger agree');
  });

  test('a cached row whose file has vanished is relisted, validators and all', () => {
    const row = openDb().prepare(`SELECT * FROM artwork_cache
        WHERE state = 'cached' AND rel_path <> '' LIMIT 1`).get();
    assert.ok(row);
    rmSync(path.join(artworkDir(), row.rel_path));          // a half-restored backup

    const got = reconcileArtwork();
    assert.ok(got.relisted >= 1);
    const now = openDb().prepare('SELECT * FROM artwork_cache WHERE id = ?').get(row.id);
    assert.equal(now.state, 'pending', 'not cached, because there is nothing there');
    assert.equal(now.etag, '');
    assert.equal(now.last_modified, '');
    assert.equal(now.size_bytes, 0);
  });

  test('but it will not touch a file it did not write', () => {
    /* It deletes things, so it deletes only its own: an operator who put a
       note or a backup in this folder keeps it. */
    const mine = path.join(artworkDir(), 'README-from-the-operator.txt');
    writeFileSync(mine, 'do not delete me');
    const sub = path.join(artworkDir(), 'aa', 'bb');
    mkdirSync(sub, { recursive: true });
    const odd = path.join(sub, 'holiday-photo.jpg');          // right place, wrong name
    writeFileSync(odd, Buffer.alloc(1024, 4));

    const got = reconcileArtwork();
    assert.ok(got.skipped >= 2, 'it left them alone and said so');
    assert.equal(existsSync(mine), true);
    assert.equal(existsSync(odd), true);
    rmSync(mine); rmSync(odd);
  });

  test('and a prune by hand reclaims orphans as well as old pictures', () => {
    const orphanDir = path.join(artworkDir(), 'fd', 'dc');
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(path.join(orphanDir, 'fddc00112233445566778899aabbccdd.jpg'),
                  Buffer.alloc(120 * 1024, 2));
    const got = pruneArtwork({ keepDays: 90, reconcile: true });
    assert.equal(got.orphans, 1);
    assert.ok(got.orphanBytes >= 120 * 1024);
    assert.equal(diskUsage().bytes, cacheBytes({ fresh: true }));
  });
});
