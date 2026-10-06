import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { ingestMovie, ingestSeries, movies, seriesList } = await import('../src/services/catalogue.js');
const { ensureProviders, providerByKey } = await import('../src/services/providers/index.js');
const { closeDb } = await import('../src/db/index.js');

/**
 * Searching the catalogue.
 *
 * The point of doing it in SQL rather than in the browser is the thing these
 * tests are about: a catalogue runs to thousands of titles and only a page of
 * it is ever loaded, so a search that sieved the loaded page would simply not
 * find most of what it was asked for. Every case below looks for something
 * that is NOT on the first page.
 */

/* Enough titles to make paging real, with the ones being searched for placed
   deliberately: 'Zodiac' sorts last of all, so it can only be found by asking
   the database. */
const FILLER = 240;
let app, token, providerId;

const movieWork = (title, extra = {}) => ({
  kind: 'movie', title, year: 2000, description: `${title} description`,
  genres: ['Drama'], poster: `http://art.example/${encodeURIComponent(title)}.jpg`,
  source: { contentId: `t:movie:${title}`, playbackUrl: `http://streams.example/${encodeURIComponent(title)}.mp4`,
            playbackType: 'direct', availability: 'available' },
  ...extra
});

const seriesWork = (title, seasons, extra = {}) => ({
  kind: 'series', title, year: 2001, description: `${title} description`,
  genres: ['Drama'], poster: `http://art.example/${encodeURIComponent(title)}.jpg`,
  source: { contentId: `t:series:${title}`, availability: 'available' },
  seasons: seasons.map((episodes, i) => ({
    number: i + 1,
    episodes: Array.from({ length: episodes }, (_, e) => ({
      number: e + 1, title: `${title} S${i + 1}E${e + 1}`,
      source: { contentId: `t:ep:${title}:${i + 1}:${e + 1}`,
                playbackUrl: `http://streams.example/${encodeURIComponent(title)}-${i + 1}-${e + 1}.mp4`,
                playbackType: 'direct', availability: 'available' }
    }))
  })),
  ...extra
});

before(async () => {
  app = await buildServer({ logger: false });
  ensureProviders();
  providerId = providerByKey('local').id;
  await createUser({ username: 'john', password: 'johnspassword' });
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-search-00001', name: 'TV' }))
    .json().accessToken;

  /* A-named filler, so anything later in the alphabet is off page one. */
  for (let i = 0; i < FILLER; i++) {
    ingestMovie(providerId, movieWork(`Assorted Filler ${String(i).padStart(3, '0')}`));
  }
  /* The needles. */
  ingestMovie(providerId, movieWork('Zodiac', { year: 2007 }));
  ingestMovie(providerId, movieWork('The Zone of Interest', { year: 2023 }));
  ingestMovie(providerId, movieWork('Arrival', { year: 2016, originalTitle: 'Première Rencontre' }));

  for (let i = 0; i < FILLER; i++) {
    ingestSeries(providerId, seriesWork(`Assorted Show ${String(i).padStart(3, '0')}`, [1]));
  }
  ingestSeries(providerId, seriesWork('Zealots', [3, 4, 2], { year: 2019 }));
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

const get = (url) => app.inject({ method: 'GET', url, headers: auth(token) });

describe('a search looks at the whole catalogue, not the loaded page', () => {
  test('there is more than one page of films to begin with', async () => {
    const page1 = await get('/api/v1/catalogue/movies?sort=title&limit=60&page=1');
    const body = page1.json();
    assert.equal(body.total, FILLER + 3);
    assert.equal(body.items.length, 60);
    assert.ok(!body.items.some(m => m.title === 'Zodiac'),
      'Zodiac must NOT be on page one, or this proves nothing');
  });

  test('and a film on the last page is still found', async () => {
    const res = await get('/api/v1/catalogue/movies?sort=title&search=zodiac&limit=60&page=1');
    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(body.total, 1);
    assert.equal(body.items[0].title, 'Zodiac');
    assert.equal(body.items[0].year, 2007);
  });

  test('a search is case-insensitive and matches part of a title', async () => {
    for (const term of ['ZODIAC', 'zodi', 'odia']) {
      const body = (await get(`/api/v1/catalogue/movies?search=${term}`)).json();
      assert.equal(body.total, 1, term);
      assert.equal(body.items[0].title, 'Zodiac', term);
    }
  });

  test('a leading article is not in the way', async () => {
    /* "The Zone of Interest" is filed with a comparison form of "zone of
       interest", so both spellings find it. */
    for (const term of ['The Zone of Interest', 'zone of interest']) {
      const body = (await get(`/api/v1/catalogue/movies?search=${encodeURIComponent(term)}`)).json();
      assert.equal(body.total, 1, term);
      assert.equal(body.items[0].title, 'The Zone of Interest', term);
    }
  });

  test('the original title is searched too', async () => {
    const body = (await get('/api/v1/catalogue/movies?search=' +
      encodeURIComponent('Rencontre'))).json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].title, 'Arrival');
  });

  test('a film result keeps its poster, year and sources', async () => {
    const m = (await get('/api/v1/catalogue/movies?search=zodiac')).json().items[0];
    assert.equal(m.year, 2007);
    assert.ok(m.poster, 'a poster');
    assert.equal(m.description, 'Zodiac description');
    assert.deepEqual(m.genres, ['Drama']);
    assert.ok(Array.isArray(m.sources) && m.sources.length === 1);
    assert.equal(m.sources[0].playable, true, 'so Play still works from a result');
  });

  test('a term matching nothing is an empty result, not an error', async () => {
    const res = await get('/api/v1/catalogue/movies?search=' + encodeURIComponent('qqzzxx nothing'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 0);
    assert.deepEqual(res.json().items, []);
  });

  test('an empty search is the whole catalogue again', async () => {
    const body = (await get('/api/v1/catalogue/movies?search=&limit=60&page=1')).json();
    assert.equal(body.total, FILLER + 3);
  });
});

describe('the same for series, with their counts', () => {
  test('the series needle is not on page one either', async () => {
    const body = (await get('/api/v1/catalogue/series?sort=title&limit=60&page=1')).json();
    assert.equal(body.total, FILLER + 1);
    assert.ok(!body.items.some(s => s.title === 'Zealots'));
  });

  test('and it is found, with its season and episode counts', async () => {
    const res = await get('/api/v1/catalogue/series?search=zealots');
    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(body.total, 1);
    const show = body.items[0];
    assert.equal(show.title, 'Zealots');
    assert.equal(show.year, 2019);
    assert.ok(show.poster, 'a poster');
    assert.equal(show.seasonCount, 3, 'three seasons');
    assert.equal(show.episodeCount, 9, 'nine episodes across them');
  });

  test('its seasons and episodes are reachable from the result', async () => {
    const id = (await get('/api/v1/catalogue/series?search=zealots')).json().items[0].id;
    const seasons = (await get(`/api/v1/catalogue/series/${id}/seasons`)).json().seasons;
    assert.deepEqual(seasons.map(s => s.season), [1, 2, 3]);
    assert.deepEqual(seasons.map(s => s.episodes), [3, 4, 2]);
    const eps = (await get(`/api/v1/catalogue/series/${id}/episodes`)).json().episodes;
    assert.equal(eps.length, 9);
  });

  test('a series search matching nothing is empty, not an error', async () => {
    const res = await get('/api/v1/catalogue/series?search=' + encodeURIComponent('no such show'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 0);
  });
});

describe('searching composes with the filters and the paging', () => {
  test('a search can be paged, and the pages do not overlap', async () => {
    const p1 = (await get('/api/v1/catalogue/movies?sort=title&search=Assorted&limit=60&page=1')).json();
    const p2 = (await get('/api/v1/catalogue/movies?sort=title&search=Assorted&limit=60&page=2')).json();
    assert.equal(p1.total, FILLER);
    assert.equal(p2.total, FILLER);
    assert.equal(p1.items.length, 60);
    assert.equal(p2.items.length, 60);
    const ids = new Set(p1.items.map(m => m.id));
    assert.ok(!p2.items.some(m => ids.has(m.id)), 'page two is different films');
  });

  test('the last page of a search is short, not empty', async () => {
    const last = (await get('/api/v1/catalogue/movies?sort=title&search=Assorted&limit=100&page=3')).json();
    assert.equal(last.total, FILLER);
    assert.equal(last.items.length, 40);
  });

  test('a filter narrows a search rather than replacing it', async () => {
    const both = (await get('/api/v1/catalogue/movies?search=zodiac&genre=Drama')).json();
    assert.equal(both.total, 1);
    const wrong = (await get('/api/v1/catalogue/movies?search=zodiac&genre=Comedy')).json();
    assert.equal(wrong.total, 0, 'the filter still applies');
  });

  test('a year filter and a search work together', async () => {
    assert.equal((await get('/api/v1/catalogue/movies?search=zodiac&year=2007')).json().total, 1);
    assert.equal((await get('/api/v1/catalogue/movies?search=zodiac&year=1999')).json().total, 0);
  });

  test('searching needs an account, like the rest of the catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalogue/movies?search=zodiac' });
    assert.equal(res.statusCode, 401);
  });

  test('the unversioned paths search too', async () => {
    const m = (await get('/api/movies?search=zodiac')).json();
    assert.equal(m.total, 1);
    assert.equal(m.items[0].title, 'Zodiac');
    const s = (await get('/api/series?search=zealots')).json();
    assert.equal(s.total, 1);
    assert.equal(s.items[0].episodeCount, 9);
  });

  test('a search never reaches Live TV', async () => {
    /* Channels are a different endpoint with a different filter; a catalogue
       term has no business there and the screens are separate. */
    const res = await get('/api/v1/channels?kind=live&search=zodiac');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 0, 'no channel is called Zodiac');
    const all = await get('/api/v1/channels?kind=live');
    assert.equal(all.json().total, 0, 'and this account has no channels at all');
  });
});

describe('the service functions behind it', () => {
  test('movies(search) and seriesList(search) are what the routes use', () => {
    assert.equal(movies({ search: 'zodiac' }).total, 1);
    assert.equal(movies({ search: 'zodiac' }).items[0].title, 'Zodiac');
    assert.equal(seriesList({ search: 'zealots' }).total, 1);
    assert.equal(seriesList({ search: 'zealots' }).items[0].seasonCount, 3);
  });

  test('a search with surrounding space still matches', () => {
    assert.equal(movies({ search: '  zodiac  ' }).total, 1);
  });

  test('and paging a search through the service agrees with the route', () => {
    const page2 = movies({ search: 'Assorted', sort: 'title', limit: 60, offset: 60 });
    assert.equal(page2.total, FILLER);
    assert.equal(page2.items.length, 60);
    assert.equal(page2.items[0].title, 'Assorted Filler 060');
  });
});
