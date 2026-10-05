import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth } from './helpers.js';

const box = isolate();

const { ADAPTERS, ensureProviders, listProviders, providerByKey, setProviderEnabled, byKey,
        importable, ACCESS, STATUS, PLAYBACK, NO_INTERFACE } =
  await import('../src/services/providers/index.js');
const { normalizeTitle, betterTitle, matchKey, resolve, openReviews } =
  await import('../src/services/dedupe.js');
const { ingestMovie, ingestSeries, movies, seriesList, oneSeries, seasonsOf, episodesOf,
        movieSources, episodeSources, search, facets, catalogueCounts, preferredSource,
        decideReview, mergeWorks } = await import('../src/services/catalogue.js');
const { runImport, runAllImports, imports, dueForImport } = await import('../src/services/importer.js');
const { openDb, closeDb } = await import('../src/db/index.js');

/* ---------------------------------------------------------------------------
   Two stub providers, registered the way a real one would be. They also prove
   the point of the architecture: adding a provider is this list plus a file.
   --------------------------------------------------------------------------- */
let stubAFeed = [], stubBFeed = [];

const stub = (key, name, feed, extra = {}) => ({
  key, name,
  baseUrl: `https://${key}.example/`,
  access: { method: ACCESS.officialApi, status: STATUS.available, reason: 'test', assessedAt: '2026-01-01' },
  capabilities: { metadata: true, artwork: false, playback: true, playbackType: PLAYBACK.direct },
  limits: { requestDelayMs: 0, concurrency: 1, timeoutMs: 1000, maxRetries: 0, refreshIntervalSeconds: 3600 },
  ...extra,
  async * discover() { for (const w of feed()) yield w; }
});

ADAPTERS.push(stub('stub-a', 'Stub A', () => stubAFeed));
ADAPTERS.push(stub('stub-b', 'Stub B', () => stubBFeed));

let app, token, adminToken, A, B;

before(async () => {
  const { buildServer } = await import('../src/index.js');
  const { createUser } = await import('../src/services/users.js');
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-j-0000000001', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-a-0000000001', name: 'PC' })).json().accessToken;
  A = providerByKey('stub-a');
  B = providerByKey('stub-b');
  setProviderEnabled(A.id, true);
  setProviderEnabled(B.id, true);
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

/* =================================================== the provider answers == */

describe('what each provider actually permits', () => {
  test('all of them are registered, importable or not', () => {
    const keys = listProviders().map(p => p.key);
    for (const k of ['local', 'archive-org', 'tubi', 'roku', 'fawesome', 'xumo', 'movy']) {
      assert.ok(keys.includes(k), `${k} is missing: ${keys.join(', ')}`);
    }
  });

  test('the five commercial services report no permitted interface, and say so in those words', () => {
    for (const key of ['tubi', 'roku', 'fawesome', 'xumo']) {
      const p = providerByKey(key);
      const a = byKey(key);
      assert.equal(importable(a), false, key);
      assert.equal(a.access.method, ACCESS.none, key);
      assert.ok([STATUS.noOfficialApi, STATUS.noPermittedAccess].includes(p.status), `${key}: ${p.status}`);
      assert.match(p.status_reason, new RegExp(NO_INTERFACE.replace(/[.]/g, '\\.')), key);
      assert.equal(p.enabled, 0, `${key} must not be on`);
    }
  });

  test('none of them has a discover function at all, so none can be run', () => {
    for (const key of ['tubi', 'roku', 'fawesome', 'xumo', 'movy']) {
      assert.equal(typeof byKey(key).discover, 'undefined', key);
    }
  });

  test('movy is refused on licensing, not on a missing API', () => {
    const a = byKey('movy');
    assert.match(a.access.reason, /licens/i);
    assert.equal(a.capabilities.playbackType, PLAYBACK.none);
  });

  test('every one of them says what would have to change', () => {
    for (const key of ['tubi', 'roku', 'fawesome', 'xumo', 'movy']) {
      assert.ok((byKey(key).access.recheck || []).length > 0, key);
    }
  });

  test('turning one on is refused, with the reason rather than a shrug', async () => {
    const p = providerByKey('tubi');
    assert.throws(() => setProviderEnabled(p.id, true), /No permitted automated catalogue interface/);

    const res = await app.inject({
      method: 'PUT', url: `/api/v1/admin/providers/${p.id}/enabled`,
      headers: auth(adminToken), payload: { enabled: true }
    });
    assert.equal(res.statusCode, 409);
    assert.match(res.json().error.message, /No permitted automated catalogue interface/);
    assert.equal(providerByKey('tubi').enabled, 0);
  });

  test('importing one is skipped with the reason, not recorded as a fault', async () => {
    const p = providerByKey('tubi');
    const got = await runImport(p.id);
    assert.equal(got.skipped, true);
    assert.match(got.reason, /No permitted automated catalogue interface/);
    assert.equal(got.run.status, 'skipped');
    assert.equal(got.run.errors, 0, 'skipped is not an error');
  });

  test('and it is never due for a refresh', () => {
    assert.equal(dueForImport(providerByKey('tubi')), false);
    assert.equal(dueForImport(providerByKey('movy')), false);
  });

  test('the local folders and the Internet Archive are the ones that can be read', () => {
    assert.equal(importable(byKey('local')), true);
    assert.equal(importable(byKey('archive-org')), true);
    assert.equal(byKey('local').access.method, ACCESS.localFilesystem);
    assert.equal(byKey('archive-org').access.method, ACCESS.officialApi);
  });

  test('an administrator sees all of this, a viewer sees none of it', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/v1/admin/providers', headers: auth(adminToken) });
    assert.equal(ok.statusCode, 200);
    const body = ok.json();
    assert.equal(body.providers.length >= 7, true);
    const tubi = body.providers.find(p => p.key === 'tubi');
    assert.equal(tubi.importable, false);
    assert.equal(tubi.state, 'disabled');
    assert.equal(tubi.supports.playbackType, 'web_only');
    assert.ok(tubi.statusReason);

    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/providers', headers: auth(token) }))
      .statusCode, 403);
  });
});

/* ======================================================== normalizing ===== */

describe('comparing titles', () => {
  test('articles, punctuation and case come out', () => {
    assert.equal(normalizeTitle('The Matrix'), 'matrix');
    assert.equal(normalizeTitle('the  matrix!'), 'matrix');
    assert.equal(normalizeTitle("Schindler's List"), 'schindlers list');
    assert.equal(normalizeTitle('WALL·E'), 'wall e');
    assert.equal(normalizeTitle('Amélie'), 'amelie');
    assert.equal(normalizeTitle('Lock, Stock and Two Smoking Barrels'),
                 normalizeTitle('Lock Stock & Two Smoking Barrels'));
  });

  test('roman numerals and "part" fold, so sequels line up either way round', () => {
    assert.equal(normalizeTitle('Rocky II'), normalizeTitle('Rocky 2'));
    assert.equal(normalizeTitle('Kill Bill: Vol. 2'), normalizeTitle('Kill Bill 2'));
  });

  test('but a different film is still a different string', () => {
    assert.notEqual(normalizeTitle('The Matrix'), normalizeTitle('The Matrix Reloaded'));
    assert.notEqual(normalizeTitle('Heat'), normalizeTitle('Heats'));
  });

  test('a year restated in the title comes off, because the year is a field', () => {
    /* What a scan off disk produces: Arrival.2016.1080p.mkv reads as
       "Arrival 2016", and has to compare equal to a provider's "Arrival". */
    assert.equal(normalizeTitle('Arrival 2016', 2016), 'arrival');
    assert.equal(normalizeTitle('Arrival (2016)', 2016), 'arrival');
    assert.equal(normalizeTitle('Arrival', 2016), 'arrival');
  });

  test('but a number that is part of the name stays', () => {
    /* 2049 is not the year it came out, so it is part of the title. */
    assert.equal(normalizeTitle('Blade Runner 2049', 2017), 'blade runner 2049');
    assert.notEqual(normalizeTitle('Blade Runner 2049', 2017), normalizeTitle('Blade Runner', 1982));
    /* And a film called nothing but a year keeps its name. */
    assert.equal(normalizeTitle('1917', 1917), '1917');
    assert.equal(normalizeTitle('2001: A Space Odyssey', 1968), '2001 a space odyssey');
  });

  test('the title shown prefers the one that is not restating the year', () => {
    assert.equal(betterTitle('Arrival 2016', 'Arrival', 2016), 'Arrival');
    assert.equal(betterTitle('Arrival (2016)', 'Arrival', 2016), 'Arrival');
    /* And does not churn otherwise. */
    assert.equal(betterTitle('Arrival', 'ARRIVAL', 2016), 'Arrival');
    assert.equal(betterTitle('Blade Runner 2049', 'Blade Runner 2049 ', 2017), 'Blade Runner 2049');
  });

  test('the key carries the year, because the title alone is not an identity', () => {
    assert.equal(matchKey('The Matrix', 1999), 'matrix|1999');
    assert.equal(matchKey('The Matrix', null), 'matrix|');
  });
});

/* ====================================================== deduplication ===== */

const film = (over = {}) => ({
  kind: 'movie', title: 'Inception', year: 2010, runtimeMinutes: 148,
  description: 'A thief who steals secrets.', genres: ['Action', 'Science Fiction'],
  languages: ['English'], countries: ['United States'],
  directors: ['Christopher Nolan'], cast: [{ name: 'Leonardo DiCaprio', character: 'Cobb' }],
  source: { contentId: 'x1', metadataUrl: 'https://a.example/1', playbackUrl: 'https://a.example/1.mp4',
            playbackType: PLAYBACK.direct, availability: 'available' },
  ...over
});

describe('one film, however many providers have it', () => {
  test('the same film from two providers is one row with two sources', () => {
    const first = ingestMovie(A.id, film());
    const second = ingestMovie(B.id, film({
      source: { contentId: 'y9', metadataUrl: 'https://b.example/9',
                playbackUrl: 'https://b.example/9.m3u8', playbackType: PLAYBACK.hls,
                availability: 'available' }
    }));
    assert.equal(second.movieId, first.movieId, 'one film');
    assert.equal(second.decision, 'merge');

    const sources = movieSources(first.movieId);
    assert.equal(sources.length, 2);
    assert.deepEqual(sources.map(s => s.providerKey).sort(), ['stub-a', 'stub-b']);
  });

  test('and Movies shows it once', () => {
    const list = movies({ search: 'Inception' });
    assert.equal(list.total, 1, JSON.stringify(list.items.map(i => i.title)));
    assert.equal(list.items[0].sources.length, 2);
  });

  test('an IMDb id decides on its own, even when the title is written differently', () => {
    const a = ingestMovie(A.id, film({
      title: 'Blade Runner 2049', year: 2017, externalIds: { imdb: 'tt1856101' },
      source: { contentId: 'br-a', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/x.mp4' }
    }));
    const b = ingestMovie(B.id, film({
      title: 'BLADE RUNNER: 2049', year: 2018, externalIds: { imdb: 'tt1856101' },
      source: { contentId: 'br-b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/x.mp4' }
    }));
    assert.equal(b.movieId, a.movieId);
    assert.equal(b.confidence, 1);
  });

  test('a year out, with a runtime that agrees, is the same film', () => {
    const a = ingestMovie(A.id, film({ title: 'The Lighthouse', year: 2019, runtimeMinutes: 109,
      source: { contentId: 'lh-a', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/l.mp4' } }));
    const b = ingestMovie(B.id, film({ title: 'The Lighthouse', year: 2020, runtimeMinutes: 110,
      source: { contentId: 'lh-b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/l.mp4' } }));
    assert.equal(b.movieId, a.movieId);
    assert.match(String(b.decision), /merge/);
  });

  test('a year out with nothing else to compare is queued, not merged', () => {
    const a = ingestMovie(A.id, film({ title: 'Solaris', year: 1972, runtimeMinutes: 0,
      source: { contentId: 'sol-a', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/s.mp4' } }));
    const b = ingestMovie(B.id, film({ title: 'Solaris', year: 1973, runtimeMinutes: 0, directors: [],
      source: { contentId: 'sol-b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/s.mp4' } }));
    assert.notEqual(b.movieId, a.movieId, 'both kept');
    assert.equal(b.decision, 'review');

    const queue = openReviews({ kind: 'movie' });
    assert.ok(queue.items.some(r =>
      (r.left && /Solaris/.test(r.left.canonical_title)) || (r.right && /Solaris/.test(r.right.canonical_title))),
      JSON.stringify(queue.items.map(i => i.reason)));
  });

  test('a remake is not its original: same title, no year to lean on, never merged', () => {
    const a = ingestMovie(A.id, film({ title: 'The Thing', year: 1982, runtimeMinutes: 109,
      source: { contentId: 'th-a', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/t.mp4' } }));
    const b = ingestMovie(B.id, film({ title: 'The Thing', year: null, runtimeMinutes: 0, directors: [],
      source: { contentId: 'th-b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/t.mp4' } }));
    assert.notEqual(b.movieId, a.movieId);
    assert.equal(b.decision, 'review');
  });

  test('a runtime half an hour apart is evidence against, so it stays for review', () => {
    const a = ingestMovie(A.id, film({ title: 'Nosferatu', year: 1922, runtimeMinutes: 94,
      source: { contentId: 'nos-a', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/n.mp4' } }));
    const b = ingestMovie(B.id, film({ title: 'Nosferatu', year: 1923, runtimeMinutes: 150, directors: [],
      source: { contentId: 'nos-b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/n.mp4' } }));
    assert.notEqual(b.movieId, a.movieId);
  });

  test('two genuinely different films are two films', () => {
    ingestMovie(A.id, film({ title: 'Heat', year: 1995, runtimeMinutes: 170,
      source: { contentId: 'heat', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/h.mp4' } }));
    ingestMovie(A.id, film({ title: 'Interstellar', year: 2014, runtimeMinutes: 169,
      source: { contentId: 'inter', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/i.mp4' } }));
    assert.equal(movies({ search: 'Heat' }).total, 1);
    assert.equal(movies({ search: 'Interstellar' }).total, 1);
  });

  test('a file scanned off disk merges with the same film from a provider', () => {
    /* The real case this exists for: the scanner writes the year into the
       title, the provider does not, and they are one film. */
    const disk = ingestMovie(A.id, film({
      title: 'Sicario 2015', year: 2015, runtimeMinutes: 121,
      source: { contentId: 'sic-disk', playbackType: PLAYBACK.direct, playbackUrl: '',
                localKind: 'movie', localId: 4242, availability: 'available' }
    }));
    const provider = ingestMovie(B.id, film({
      title: 'Sicario', year: 2015, runtimeMinutes: 121,
      source: { contentId: 'sic-prov', playbackType: PLAYBACK.hls,
                playbackUrl: 'https://b/sicario.m3u8', availability: 'available' }
    }));
    assert.equal(provider.movieId, disk.movieId, 'one film');
    const list = movies({ search: 'Sicario' });
    assert.equal(list.total, 1);
    assert.equal(list.items[0].title, 'Sicario', 'and shown under the cleaner name');
    assert.equal(list.items[0].sources.length, 2);
  });

  test('and the local copy is the one Play prefers, because it needs no internet', () => {
    const id = movies({ search: 'Sicario' }).items[0].id;
    const pick = preferredSource('movie', id);
    assert.equal(pick.local, true, JSON.stringify(pick));
  });

  test('a work with no year at all still only ever exists once', () => {
    /* The case that bit: a series scanned off disk has no year, so no rung
       that compares metadata can confirm a match — rung 2 needs a year and
       rungs 4 and 5 only queue for review. Without rung 0, every refresh
       filed another copy and the catalogue grew a duplicate a week. */
    const yearless = { kind: 'series', title: 'No Year Here', year: null,
      source: { contentId: 'ny-1', availability: 'available' },
      seasons: [{ number: 1, episodes: [
        { number: 1, title: 'One', source: { contentId: 'ny-1-s1e1',
          playbackType: PLAYBACK.direct, playbackUrl: 'https://a/ny1.mp4' } } ] }] };

    const first = ingestSeries(A.id, yearless);
    for (let i = 0; i < 4; i++) {
      const again = ingestSeries(A.id, yearless);
      assert.equal(again.seriesId, first.seriesId, `refresh ${i + 2} filed a second copy`);
    }
    assert.equal(seriesList({ search: 'No Year Here' }).total, 1);
    assert.equal(episodesOf(first.seriesId).length, 1);
  });

  test('a yearless film is the same, and does not queue itself for review', () => {
    const f = film({ title: 'Untitled Short', year: null, runtimeMinutes: 0, directors: [],
      source: { contentId: 'us-1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/us.mp4' } });
    const first = ingestMovie(A.id, f);
    const before = openReviews({ kind: 'movie' }).total;
    const again = ingestMovie(A.id, f);
    assert.equal(again.movieId, first.movieId);
    assert.equal(movies({ search: 'Untitled Short' }).total, 1);
    assert.equal(openReviews({ kind: 'movie' }).total, before,
      'and it is not queued against itself');
  });

  test('a scruffy title does not overwrite a clean one, whichever imports last', () => {
    /* Both providers have it; the disk one restates the year in the name.
       Importing them in either order has to leave the clean name showing. */
    const mk = (prov, title, cid) => ingestMovie(prov, film({
      title, year: 2013, runtimeMinutes: 180,
      source: { contentId: cid, playbackType: PLAYBACK.direct, playbackUrl: 'https://x/w.mp4' } }));

    mk(A.id, 'The Wolf of Wall Street', 'wolf-clean');
    mk(B.id, 'The Wolf of Wall Street 2013', 'wolf-scruffy');
    assert.equal(movies({ search: 'Wolf of Wall Street' }).items[0].title,
      'The Wolf of Wall Street', 'the clean one survived a scruffy arrival');

    /* And again, with that provider refreshing its own scruffy record. */
    mk(B.id, 'The Wolf of Wall Street 2013', 'wolf-scruffy');
    assert.equal(movies({ search: 'Wolf of Wall Street' }).items[0].title,
      'The Wolf of Wall Street', 'and survived its refresh too');
    assert.equal(movies({ search: 'Wolf of Wall Street' }).total, 1);
  });

  test('a provider that renames a title still lands on the same work', () => {
    const before = ingestMovie(A.id, film({
      title: 'Working Title', year: 1994, runtimeMinutes: 100,
      source: { contentId: 'ren-1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/r.mp4' } }));
    const after = ingestMovie(A.id, film({
      title: 'The Proper Name At Last', year: 1994, runtimeMinutes: 100,
      source: { contentId: 'ren-1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/r.mp4' } }));
    assert.equal(after.movieId, before.movieId, 'the provider\'s own id decided it');
    assert.equal(movies({ search: 'Working Title' }).total, 0, 'and the old name is gone');
  });

  test('re-importing is counted as updated, not as a duplicate merged', () => {
    const stats = {};
    ingestMovie(A.id, film({ title: 'Counted Once', year: 1999, runtimeMinutes: 90,
      source: { contentId: 'co-1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/c.mp4' } }),
      stats);
    const second = {};
    ingestMovie(A.id, film({ title: 'Counted Once', year: 1999, runtimeMinutes: 90,
      source: { contentId: 'co-1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/c.mp4' } }),
      second);
    assert.equal(second.updated_items, 1);
    assert.equal(second.duplicates_merged, undefined,
      'its own item coming round again is not a duplicate it merged');
  });

  test('a provider re-importing the same thing changes nothing', () => {
    const before = catalogueCounts();
    ingestMovie(A.id, film());
    ingestMovie(A.id, film());
    const after = catalogueCounts();
    assert.equal(after.movies, before.movies);
    assert.equal(after.movieSources, before.movieSources);
  });

  test('the counts say how much the merging is doing', () => {
    const c = catalogueCounts();
    assert.ok(c.multiSourceMovies >= 1, JSON.stringify(c));
  });
});

/* ======================================================= metadata kept ==== */

describe('what gets kept', () => {
  test('everything the provider gave, on one row', () => {
    const got = movies({ search: 'Inception' }).items[0];
    assert.equal(got.title, 'Inception');
    assert.equal(got.year, 2010);
    assert.equal(got.runtimeMinutes, 148);
    assert.deepEqual(got.genres, ['Action', 'Science Fiction']);
    assert.deepEqual(got.languages, ['English']);
    assert.deepEqual(got.countries, ['United States']);
    assert.deepEqual(got.directors, ['Christopher Nolan']);
    assert.equal(got.cast[0].name, 'Leonardo DiCaprio');
    assert.equal(got.cast[0].character, 'Cobb');
  });

  test('the fuller description wins when providers disagree', () => {
    ingestMovie(A.id, film({ title: 'Arrival', year: 2016, description: 'Short.',
      source: { contentId: 'arr-a', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/a.mp4' } }));
    ingestMovie(B.id, film({ title: 'Arrival', year: 2016,
      description: 'A linguist is recruited to communicate with visitors, at length.',
      source: { contentId: 'arr-b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/a.mp4' } }));
    const got = movies({ search: 'Arrival' }).items[0];
    assert.match(got.description, /at length/);
  });

  test('an external id is readable back off the work', () => {
    const got = movies({ search: 'Blade Runner' }).items[0];
    assert.equal(got.externalIds.imdb, 'tt1856101');
  });
});

/* ========================================================== series ======== */

const show = (over = {}) => ({
  kind: 'series', title: 'Breaking Bad', year: 2008,
  description: 'A chemistry teacher.', genres: ['Drama'],
  source: { contentId: 'bb-a', metadataUrl: 'https://a.example/bb', availability: 'available' },
  seasons: [{
    number: 1,
    episodes: [
      { number: 1, title: 'Pilot', runtimeMinutes: 58,
        source: { contentId: 'bb-a-s1e1', playbackType: PLAYBACK.direct,
                  playbackUrl: 'https://a.example/bb101.mp4', availability: 'available' } },
      { number: 2, title: "Cat's in the Bag...", runtimeMinutes: 48,
        source: { contentId: 'bb-a-s1e2', playbackType: PLAYBACK.direct,
                  playbackUrl: 'https://a.example/bb102.mp4', availability: 'available' } }
    ]
  }],
  ...over
});

describe('one series, one episode, several providers', () => {
  test('the same series from two providers is one series', () => {
    const a = ingestSeries(A.id, show());
    const b = ingestSeries(B.id, show({
      source: { contentId: 'bb-b', metadataUrl: 'https://b.example/bb' },
      seasons: [{
        number: 1,
        episodes: [
          { number: 1, title: 'Pilot',
            source: { contentId: 'bb-b-s1e1', playbackType: PLAYBACK.hls,
                      playbackUrl: 'https://b.example/bb101.m3u8', availability: 'available' } },
          { number: 3, title: 'And the Bag\'s in the River',
            source: { contentId: 'bb-b-s1e3', playbackType: PLAYBACK.hls,
                      playbackUrl: 'https://b.example/bb103.m3u8', availability: 'available' } }
        ]
      }]
    }));
    assert.equal(b.seriesId, a.seriesId, 'one series');
    assert.equal(seriesList({ search: 'Breaking Bad' }).total, 1);
  });

  test('the same episode is one episode with two sources', () => {
    const id = seriesList({ search: 'Breaking Bad' }).items[0].id;
    const eps = episodesOf(id, { season: 1 });
    assert.deepEqual(eps.map(e => e.episode), [1, 2, 3], 'the union of both line-ups, each once');

    const first = eps.find(e => e.episode === 1);
    assert.equal(first.sources.length, 2, 'one row, two providers');
    assert.deepEqual(first.sources.map(s => s.providerKey).sort(), ['stub-a', 'stub-b']);

    const third = eps.find(e => e.episode === 3);
    assert.equal(third.sources.length, 1, 'only one provider has that one');
  });

  test('seasons are records, and the series counts what it holds', () => {
    const id = seriesList({ search: 'Breaking Bad' }).items[0].id;
    const seasons = seasonsOf(id);
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0].season, 1);
    assert.equal(seasons[0].episodes, 3);
    assert.equal(oneSeries(id).episode_count, 3);
  });

  test('an episode with no number is counted as unmatched rather than guessed at', () => {
    const stats = {};
    ingestSeries(A.id, show({
      title: 'Half Read', year: 2001,
      source: { contentId: 'hr-a' },
      seasons: [{ number: 1, episodes: [{ number: null, title: 'who knows' },
                                        { number: 1, title: 'fine' }] }]
    }), stats);
    assert.equal(stats.unmatched_items, 1);
  });
});

/* ========================================================= filters ======== */

describe('filtering and searching the one catalogue', () => {
  test('by provider, which narrows without becoming part of the identity', () => {
    const onlyB = movies({ provider: 'stub-b' });
    const onlyA = movies({ provider: 'stub-a' });
    assert.ok(onlyA.total > onlyB.total, `${onlyA.total} vs ${onlyB.total}`);
    assert.ok(onlyB.items.every(m => m.sources.some(s => s.providerKey === 'stub-b')));
    /* Inception is on both, and is one card under either filter. */
    assert.equal(onlyA.items.filter(m => m.title === 'Inception').length, 1);
    assert.equal(onlyB.items.filter(m => m.title === 'Inception').length, 1);
  });

  test('by genre, year, language and country', () => {
    assert.ok(movies({ genre: 'action' }).total >= 1);
    assert.equal(movies({ year: 2010 }).items.every(m => m.year === 2010), true);
    assert.ok(movies({ language: 'english' }).total >= 1);
    assert.ok(movies({ country: 'united states' }).total >= 1);
    assert.equal(movies({ genre: 'nothing-is-this-genre' }).total, 0);
  });

  test('by whether anything can actually play it', () => {
    const playable = movies({ playable: true });
    assert.ok(playable.total >= 1);
    assert.equal(playable.items.every(m => m.sources.some(s => s.playable)), true);
  });

  test('the filter menus are built from what is in the catalogue', () => {
    const f = facets('movie');
    assert.ok(f.genres.some(g => g.key === 'action'));
    assert.ok(f.providers.some(p => p.value === 'stub-a'));
    assert.ok(f.years.some(y => y.value === 2010));
    assert.ok(f.languages.some(l => l.key === 'english'));
  });

  test('search runs over the canonical rows, so each title comes back once', () => {
    ingestMovie(A.id, film({ title: 'The Matrix', year: 1999, runtimeMinutes: 136,
      source: { contentId: 'm1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/m1.mp4' } }));
    ingestMovie(B.id, film({ title: 'The Matrix', year: 1999, runtimeMinutes: 136,
      source: { contentId: 'm1b', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/m1.mp4' } }));
    ingestMovie(A.id, film({ title: 'The Matrix Reloaded', year: 2003, runtimeMinutes: 138,
      source: { contentId: 'm2', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/m2.mp4' } }));
    ingestMovie(A.id, film({ title: 'The Matrix Revolutions', year: 2003, runtimeMinutes: 129,
      source: { contentId: 'm3', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/m3.mp4' } }));

    const got = search('Matrix');
    const titles = got.movies.map(m => m.title).sort();
    assert.deepEqual(titles, ['The Matrix', 'The Matrix Reloaded', 'The Matrix Revolutions']);
    assert.equal(got.movies.filter(m => m.title === 'The Matrix').length, 1, 'once, not twice');
  });

  test('and it finds an episode by its own title', () => {
    const got = search('Pilot');
    assert.ok(got.episodes.some(e => e.title === 'Pilot'), JSON.stringify(got.episodes));
  });
});

/* ========================================================= playback ======= */

describe('pressing Play', () => {
  test('the preferred source is the one that can actually be played', () => {
    const id = movies({ search: 'Inception' }).items[0].id;
    const pick = preferredSource('movie', id);
    assert.ok(pick);
    assert.equal(pick.playable, true);
  });

  test('a direct provider stream is handed over as the provider published it', async () => {
    const id = movies({ search: 'Inception' }).items[0].id;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${id}/ticket`, headers: auth(token)
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.mode, 'direct');
    assert.match(body.url, /^https:\/\//);
    assert.ok(['direct', 'hls'].includes(body.playbackType));
    assert.ok(body.alternatives.length >= 1, 'the other provider is offered too');
  });

  test('a particular provider can be asked for by name', async () => {
    const id = movies({ search: 'Inception' }).items[0].id;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${id}/ticket?provider=stub-b`,
      headers: auth(token)
    });
    assert.equal(res.json().provider, 'Stub B');
  });

  test('a web-only source is refused with that word, and never turned into a stream', async () => {
    const webby = ingestMovie(A.id, film({
      title: 'Only On Their Site', year: 2024, runtimeMinutes: 90,
      source: { contentId: 'web-1', metadataUrl: 'https://a.example/watch/1',
                playbackUrl: '', playbackType: PLAYBACK.webOnly, availability: 'available' }
    }));
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${webby.movieId}/ticket`,
      headers: auth(token)
    });
    assert.equal(res.statusCode, 409);
    const err = res.json().error;
    assert.equal(err.code, 'WEB_ONLY');
    assert.equal(err.detail.playbackType, 'web_only');
    assert.equal(err.detail.webUrl, 'https://a.example/watch/1');
    assert.match(err.message, /own app or site/);
  });

  test('a source whose address is not http is not offered as playable', () => {
    const odd = ingestMovie(A.id, film({
      title: 'Odd Address', year: 2007, runtimeMinutes: 90,
      source: { contentId: 'odd-1', metadataUrl: 'https://a.example/odd',
                playbackUrl: 'javascript:alert(1)', playbackType: PLAYBACK.direct,
                availability: 'available' }
    }));
    const [s] = movieSources(odd.movieId);
    assert.equal(s.playable, false, 'claiming direct does not make it playable');
    assert.equal(s.url, undefined);
    assert.equal(s.webOnly, true);
    assert.equal(preferredSource('movie', odd.movieId), null);
  });

  test('and neither is one with no address at all', () => {
    const empty = ingestMovie(A.id, film({
      title: 'No Address', year: 2008, runtimeMinutes: 90,
      source: { contentId: 'noaddr-1', metadataUrl: 'https://a.example/n',
                playbackUrl: '', playbackType: PLAYBACK.hls, availability: 'available' }
    }));
    const [s] = movieSources(empty.movieId);
    assert.equal(s.playable, false);
  });

  test('a web-only source carries a link out, not a playback url', () => {
    const id = movies({ search: 'Only On Their Site' }).items[0].id;
    const [s] = movieSources(id);
    assert.equal(s.playable, false);
    assert.equal(s.webOnly, true);
    assert.equal(s.url, undefined, 'no stream is invented for it');
  });

  test('an episode plays the same way', async () => {
    const seriesId = seriesList({ search: 'Breaking Bad' }).items[0].id;
    const ep = episodesOf(seriesId, { season: 1 }).find(e => e.episode === 1);
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/episode/${ep.id}/ticket`, headers: auth(token)
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().mode, 'direct');
  });

  test('a work nobody has is a 404, not a ticket', async () => {
    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/stream/catalogue/movie/999999/ticket', headers: auth(token)
    })).statusCode, 404);
  });

  test('and a kind that is not a kind is refused', async () => {
    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/stream/catalogue/wallpaper/1/ticket', headers: auth(token)
    })).statusCode, 400);
  });
});

/* ==================================================== review and merge ==== */

describe('the duplicate review', () => {
  test('an administrator can see what the matcher would not decide', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/admin/catalogue/reviews', headers: auth(adminToken)
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().total >= 1);
    const one = res.json().items[0];
    assert.ok(one.left && one.right, JSON.stringify(one));
    assert.ok(one.reason);
    assert.ok(one.confidence > 0 && one.confidence < 1);
  });

  test('a viewer cannot', async () => {
    assert.equal((await app.inject({
      method: 'GET', url: '/api/v1/admin/catalogue/reviews', headers: auth(token)
    })).statusCode, 403);
  });

  test('accepting one folds the two together, sources and all', async () => {
    const queue = openReviews({ kind: 'movie' });
    const sol = queue.items.find(r => /Solaris/.test((r.left && r.left.canonical_title) || '') ||
                                      /Solaris/.test((r.right && r.right.canonical_title) || ''));
    assert.ok(sol, 'the Solaris pair should be queued');
    assert.equal(movies({ search: 'Solaris' }).total, 2, 'two until somebody decides');

    const res = await app.inject({
      method: 'POST', url: `/api/v1/admin/catalogue/reviews/${sol.id}`,
      headers: auth(adminToken), payload: { decision: 'merge' }
    });
    assert.equal(res.statusCode, 200);

    const after = movies({ search: 'Solaris' });
    assert.equal(after.total, 1, 'one now');
    assert.equal(after.items[0].sources.length, 2, 'and it kept both providers');
  });

  test('rejecting one leaves both alone, and does not ask again', async () => {
    const queue = openReviews({ kind: 'movie' });
    const thing = queue.items.find(r => /The Thing/.test((r.left && r.left.canonical_title) || '') ||
                                        /The Thing/.test((r.right && r.right.canonical_title) || ''));
    assert.ok(thing);
    await app.inject({
      method: 'POST', url: `/api/v1/admin/catalogue/reviews/${thing.id}`,
      headers: auth(adminToken), payload: { decision: 'reject' }
    });
    assert.equal(movies({ search: 'The Thing' }).total, 2, 'still two, as decided');
    const still = openReviews({ kind: 'movie' }).items.map(r => r.id);
    assert.equal(still.includes(thing.id), false, 'and not asked again');
  });

  test('two can be merged by hand, for a pair nothing queued', () => {
    const a = ingestMovie(A.id, film({ title: 'Twin One', year: 1990,
      source: { contentId: 't1', playbackType: PLAYBACK.direct, playbackUrl: 'https://a/t1.mp4' } }));
    const b = ingestMovie(B.id, film({ title: 'Twin Two', year: 1991,
      source: { contentId: 't2', playbackType: PLAYBACK.direct, playbackUrl: 'https://b/t2.mp4' } }));
    mergeWorks('movie', a.movieId, b.movieId);
    assert.equal(movies({ search: 'Twin Two' }).total, 0);
    assert.equal(movieSources(a.movieId).length, 2);
  });
});

/* ======================================================== import log ====== */

describe('the import log', () => {
  test('a run records every figure the brief asks for', async () => {
    stubAFeed = [
      film({ title: 'Logged One', year: 2001, source: { contentId: 'l1', playbackType: PLAYBACK.direct,
             playbackUrl: 'https://a/l1.mp4' } }),
      film({ title: 'Logged Two', year: 2002, source: { contentId: 'l2', playbackType: PLAYBACK.direct,
             playbackUrl: 'https://a/l2.mp4' } }),
      show({ title: 'Logged Show', year: 2003, source: { contentId: 'ls' } })
    ];
    const got = await runImport(A.id);
    const run = got.run;
    assert.equal(run.status, 'done');
    assert.equal(run.moviesDiscovered, 2);
    assert.equal(run.seriesDiscovered, 1);
    assert.equal(run.episodesDiscovered, 2);
    assert.ok(run.newItems >= 3, JSON.stringify(run));
    for (const k of ['updatedItems', 'duplicatesMerged', 'unmatchedItems', 'errors', 'requestsMade']) {
      assert.equal(typeof run[k], 'number', k);
    }
    assert.equal(run.provider, 'Stub A');
  });

  test('importing the same feed again updates rather than duplicates', async () => {
    const before = catalogueCounts();
    const got = await runImport(A.id);
    assert.equal(catalogueCounts().movies, before.movies);
    assert.ok(got.run.updatedItems >= 2, JSON.stringify(got.run));
    assert.equal(got.run.newItems, 0);
  });

  test('a bad record is counted and the rest of the import carries on', async () => {
    stubAFeed = [
      film({ title: 'Fine One', year: 2004, source: { contentId: 'f1', playbackType: PLAYBACK.direct,
             playbackUrl: 'https://a/f1.mp4' } }),
      { kind: 'movie', title: null, get year() { throw new Error('this record is broken'); } },
      film({ title: 'Fine Two', year: 2005, source: { contentId: 'f2', playbackType: PLAYBACK.direct,
             playbackUrl: 'https://a/f2.mp4' } })
    ];
    const got = await runImport(A.id);
    assert.equal(got.run.status, 'done', 'one bad record does not fail the run');
    assert.equal(got.run.errors, 1);
    assert.equal(movies({ search: 'Fine Two' }).total, 1, 'and the one after it still arrived');
    stubAFeed = [];
  });

  test('the log is readable per provider and across all of them', async () => {
    const all = await app.inject({
      method: 'GET', url: '/api/v1/admin/providers/imports', headers: auth(adminToken)
    });
    assert.equal(all.statusCode, 200);
    assert.ok(all.json().total >= 3);

    const mine = imports({ providerId: A.id });
    assert.ok(mine.total >= 3);
    assert.equal(mine.items.every(i => i.providerKey === 'stub-a'), true);
  });

  test('refreshing all of them skips the ones that cannot be read, with the reason', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers/refresh', headers: auth(adminToken)
    });
    assert.equal(res.statusCode, 200);
    const runs = res.json().runs;
    /* Only the ones that are on are attempted; the five are not on, and the
       earlier single-provider run recorded their reason. */
    assert.ok(runs.length >= 2, JSON.stringify(runs.map(r => r.provider)));
    const log = imports({ limit: 200 }).items;
    const tubi = log.find(i => i.providerKey === 'tubi');
    assert.ok(tubi, 'Tubi appears in the log');
    assert.equal(tubi.status, 'skipped');
    assert.match(tubi.message, /No permitted automated catalogue interface/);
  });
});

/* ============================================= what clients actually see == */

describe('the catalogue over the API', () => {
  test('Movies is the unified list, with who has each film', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/catalogue/movies?search=Inception', headers: auth(token)
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.total, 1);
    const m = body.items[0];
    assert.equal(m.title, 'Inception');
    assert.equal(m.sources.length, 2);
    assert.ok(m.sources.every(s => s.providerName));
  });

  test('one film carries the lot, and which source Play would use', async () => {
    const id = movies({ search: 'Inception' }).items[0].id;
    const got = (await app.inject({
      method: 'GET', url: `/api/v1/catalogue/movies/${id}`, headers: auth(token)
    })).json();
    assert.equal(got.runtimeMinutes, 148);
    assert.deepEqual(got.genres, ['Action', 'Science Fiction']);
    assert.equal(got.cast[0].name, 'Leonardo DiCaprio');
    assert.ok(got.preferred && got.preferred.playable);
  });

  test('a series lists its seasons and then its episodes', async () => {
    const id = seriesList({ search: 'Breaking Bad' }).items[0].id;
    const one = (await app.inject({
      method: 'GET', url: `/api/v1/catalogue/series/${id}`, headers: auth(token)
    })).json();
    assert.equal(one.seasons.length, 1);
    const eps = (await app.inject({
      method: 'GET', url: `/api/v1/catalogue/series/${id}/episodes?season=1`, headers: auth(token)
    })).json().episodes;
    assert.deepEqual(eps.map(e => e.episode), [1, 2, 3]);
  });

  test('search, facets and counts are all there', async () => {
    const s = (await app.inject({
      method: 'GET', url: '/api/v1/catalogue/search?q=Matrix', headers: auth(token)
    })).json();
    assert.equal(s.movies.filter(m => m.title === 'The Matrix').length, 1);

    const f = (await app.inject({
      method: 'GET', url: '/api/v1/catalogue/facets?kind=movie', headers: auth(token)
    })).json();
    assert.ok(f.providers.length >= 2);

    const c = (await app.inject({
      method: 'GET', url: '/api/v1/catalogue/counts', headers: auth(token)
    })).json();
    assert.ok(c.movies >= 5);
  });

  test('pagination behaves, and never repeats a film across pages', async () => {
    const page1 = (await app.inject({
      method: 'GET', url: '/api/v1/catalogue/movies?limit=3&page=1&sort=title', headers: auth(token)
    })).json();
    const page2 = (await app.inject({
      method: 'GET', url: '/api/v1/catalogue/movies?limit=3&page=2&sort=title', headers: auth(token)
    })).json();
    assert.equal(page1.items.length, 3);
    assert.equal(page1.page, 1);
    assert.equal(page2.page, 2);
    const overlap = page1.items.map(i => i.id).filter(id => page2.items.some(j => j.id === id));
    assert.deepEqual(overlap, []);
  });

  test('signing in is required for all of it', async () => {
    for (const url of ['/api/v1/catalogue/movies', '/api/v1/catalogue/series',
                       '/api/v1/catalogue/search?q=matrix', '/api/v1/catalogue/counts']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
    }
  });

  test('and no provider page URL is mistaken for a stream anywhere in a reply', async () => {
    const body = (await app.inject({
      method: 'GET', url: '/api/v1/catalogue/movies?limit=200', headers: auth(token)
    })).body;
    const parsed = JSON.parse(body);
    for (const m of parsed.items) {
      for (const s of m.sources) {
        if (s.playbackType === 'web_only') {
          assert.equal(s.url, undefined, `${m.title}: a web-only source must carry no stream url`);
          assert.equal(s.playable, false);
        }
      }
    }
  });
});
