import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { ingestMovie, ingestSeries, movies, seriesList, publicMovie, movie } =
  await import('../src/services/catalogue.js');
const { ensureProviders, providerByKey } = await import('../src/services/providers/index.js');
const { fetchArtwork, artworkStats, artworkDir, artworkState, cacheBytes, pruneArtwork } =
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

  test('a full cache stops fetching rather than filling the disk', async () => {
    const was = config.artwork.maxMb;
    config.artwork.maxMb = 1;                     // the smallest the floor allows
    /* Pretend a megabyte of posters is already here. */
    openDb().prepare(`INSERT INTO artwork_cache (url, state, size_bytes, rel_path, created_at)
        VALUES ('http://art.example/pretend-big.jpg', 'cached', ?, 'x/y/pretend.jpg', ?)`)
      .run(2 * 1024 * 1024, new Date().toISOString());
    try {
      cacheBytes({ fresh: true });
      assert.equal(artworkStats().full, true, 'the cache reports itself full');
      const before = asked.length;
      const got = await fetchArtwork('http://art.example/good-backdrop.jpg', { fetchImpl: fakeFetch });
      assert.equal(asked.length, before, 'nothing was fetched');
      assert.equal(got.state, 'pending', 'and it is left for later, not failed');
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
