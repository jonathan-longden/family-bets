import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createSource, syncSource, assign, deleteSource } = await import('../src/services/sources.js');
const { runImport, syncLocalProvider, short } = await import('../src/services/importer.js');
const { createRoot, scanRoot } = await import('../src/services/media.js');
const { openReviews } = await import('../src/services/dedupe.js');
const { decideReview } = await import('../src/services/catalogue.js');
const { ensureProviders, providerByKey } = await import('../src/services/providers/index.js');
const { movies, seriesList, seasonsOf, episodesOf, movieSources, episodeSources,
        catalogueCounts, sourceAddress } = await import('../src/services/catalogue.js');
const { splitTitleYear, movieWork, seriesWork, probeXtream, episodesBySeason,
        asMinutes, asRating, firstUrl, infoOf, safeExt, contentId } =
  await import('../src/services/xtream.js');
const { closeDb, openDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');

/**
 * An Xtream panel's films and series.
 *
 * The panel below answers the way real ones do, including the ways they
 * disagree with each other: a number as a string, a backdrop as an array on
 * one record and a bare string on another, `releasedate` on a film and
 * `releaseDate` on a series, an `info` that is an empty array when the panel
 * has nothing, episodes keyed by season on one series and a flat array on the
 * next. If Telly only coped with the tidy version it would import a third of
 * a real catalogue and call it done.
 */

const PANEL = {
  user_info: {
    username: 'housename', password: 'housepass', auth: 1, status: 'Active',
    exp_date: '2000000000', max_connections: '2', allowed_output_formats: ['m3u8', 'ts']
  },
  server_info: { url: 'panel.example', port: '8080', https_port: '8443' }
};

const LIVE_CATEGORIES = [{ category_id: '1', category_name: 'UK News' }];
const LIVE_STREAMS = [
  { num: 1, name: 'Sky News', stream_type: 'live', stream_id: 501, category_id: '1',
    stream_icon: 'http://panel.example/sky.png', epg_channel_id: 'sky.uk' },
  { num: 2, name: 'BBC News', stream_type: 'live', stream_id: 502, category_id: '1' }
];

const VOD_CATEGORIES = [
  { category_id: '10', category_name: 'Science Fiction' },
  { category_id: '11', category_name: 'Classics' }
];
const VOD_STREAMS = [
  { num: 1, name: 'Arrival (2016) 1080p', stream_type: 'movie', stream_id: 9001,
    stream_icon: 'http://panel.example/arrival.jpg', rating: '7.9', rating_5based: 3.95,
    category_id: '10', container_extension: 'mkv' },
  { num: 2, name: 'Casablanca', stream_type: 'movie', stream_id: 9002,
    stream_icon: 'http://panel.example/casa.jpg', category_id: '11',
    container_extension: 'mp4' },
  /* A panel that knows nothing about a film beyond its name. It still has to
     import, and it still has to be playable. */
  { num: 3, name: 'Night Runner', stream_type: 'movie', stream_id: 9003, category_id: '11' }
];

const VOD_INFO = {
  9001: {
    info: {
      movie_image: 'http://panel.example/arrival-poster.jpg',
      backdrop_path: ['http://panel.example/arrival-back.jpg'],
      tmdb_id: '329865', genre: 'Science Fiction, Drama',
      plot: 'A linguist is recruited to communicate with visitors.',
      cast: 'Amy Adams, Jeremy Renner, Forest Whitaker', director: 'Denis Villeneuve',
      releasedate: '2016-11-11', rating: '7.9', duration_secs: '6960', duration: '01:56:00',
      country: 'United States', age: '12', o_name: 'Arrival',
      video: { height: 1080, width: 1920 }, audio: { codec_name: 'aac' }
    },
    movie_data: { stream_id: 9001, name: 'Arrival (2016) 1080p', container_extension: 'mkv',
                  direct_source: '' }
  },
  9002: {
    /* The quirk from the field: nothing to say, sent as an empty array rather
       than an empty object. Reading .plot off that throws in the obvious
       implementation. */
    info: [],
    movie_data: { stream_id: 9002, name: 'Casablanca', container_extension: 'mp4' }
  },
  9003: { info: { backdrop_path: 'http://panel.example/night.jpg', rating: 0 },
          movie_data: { stream_id: 9003, container_extension: 'avi' } }
};

const SERIES_CATEGORIES = [{ category_id: '20', category_name: 'Drama' }];
const SERIES = [
  { num: 1, name: 'The Bear', series_id: 7001, cover: 'http://panel.example/bear.jpg',
    plot: 'A chef comes home.', cast: 'Jeremy Allen White', director: 'Christopher Storer',
    genre: 'Drama, Comedy', releaseDate: '2022-06-23', rating: '8',
    backdrop_path: ['http://panel.example/bear-back.jpg'], episode_run_time: '30',
    category_id: '20' },
  { num: 2, name: 'Harbour Lights', series_id: 7002, category_id: '20' }
];

const SERIES_INFO = {
  7001: {
    info: { name: 'The Bear', cover: 'http://panel.example/bear.jpg', plot: 'A chef comes home.',
            cast: 'Jeremy Allen White, Ayo Edebiri', director: 'Christopher Storer',
            genre: 'Drama', releaseDate: '2022-06-23', rating: '8',
            backdrop_path: ['http://panel.example/bear-back.jpg'], episode_run_time: '30',
            tmdb_id: '136315' },
    seasons: [
      { season_number: 1, name: 'Season 1', overview: 'The first one.', air_date: '2022-06-23',
        cover_big: 'http://panel.example/bear-s1.jpg', episode_count: 2 },
      { season_number: 2, name: 'Season 2', air_date: '2023-06-22', episode_count: 1 }
    ],
    /* Keyed by season, which is the common shape. */
    episodes: {
      1: [
        { id: '80001', episode_num: 1, title: 'System', container_extension: 'mkv', season: 1,
          info: { plot: 'Carmy takes over.', duration_secs: '1680', duration: '00:28:00',
                  movie_image: 'http://panel.example/bear-s1e1.jpg', air_date: '2022-06-23',
                  rating: '8.1', video: { height: 1080 } } },
        { id: '80002', episode_num: 2, title: 'Hands', container_extension: 'mkv', season: 1,
          info: { plot: 'The kitchen pushes back.', duration_secs: '1620' } }
      ],
      2: [
        { id: '80003', episode_num: 1, title: 'Beef', container_extension: 'mp4', season: 2,
          info: { plot: 'A new start.' } }
      ]
    }
  },
  7002: {
    info: { name: 'Harbour Lights', plot: 'A village mystery.' },
    /* A flat array, no seasons block, and one episode that does not say which
       season it is in. A real panel does this. */
    episodes: [
      { id: '80010', episode_num: 1, title: 'Low Tide', container_extension: 'mp4', season: 1 },
      { id: '80011', episode_num: 2, title: 'High Water', container_extension: 'mp4' }
    ]
  }
};

/** The panel, as a fetch. Every request is recorded so the test can see it. */
const asked = [];
async function panelFetch(url) {
  asked.push(String(url));
  const u = new URL(String(url));
  const action = u.searchParams.get('action') || '';
  const body = (() => {
    if (!u.pathname.endsWith('/player_api.php')) return null;
    if (u.searchParams.get('username') !== 'housename' ||
        u.searchParams.get('password') !== 'housepass') {
      return { user_info: { auth: 0 } };
    }
    switch (action) {
      case '': return PANEL;
      case 'get_live_categories': return LIVE_CATEGORIES;
      case 'get_live_streams': return LIVE_STREAMS;
      case 'get_vod_categories': return VOD_CATEGORIES;
      case 'get_vod_streams': return VOD_STREAMS;
      case 'get_vod_info': return VOD_INFO[Number(u.searchParams.get('vod_id'))] || { info: [] };
      case 'get_series_categories': return SERIES_CATEGORIES;
      case 'get_series': return SERIES;
      case 'get_series_info': return SERIES_INFO[Number(u.searchParams.get('series_id'))] || {};
      default: return null;
    }
  })();
  if (body == null) return { ok: false, status: 404, statusText: 'Not Found', headers: new Map(), text: async () => 'no' };
  const text = JSON.stringify(body);
  return { ok: true, status: 200, statusText: 'OK',
           headers: { get: () => null },
           text: async () => text, json: async () => JSON.parse(text) };
}

let app, token, adminToken, sourceId, john;
const CRED = { host: 'http://panel.example:8080', username: 'housename', password: 'housepass' };

before(async () => {
  app = await buildServer({ logger: false });
  ensureProviders();
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  john = findByUsername('john');
  sourceId = createSource({ name: 'Archive Watch', kind: 'xtream',
    url: CRED.host, username: CRED.username, password: CRED.password }).id;
  assign(john.id, sourceId);
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000003', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-admin-0000003', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

const xtreamProvider = () => providerByKey('xtream');

describe('reading a panel the way panels actually answer', () => {
  test('a film with everything on it', () => {
    const w = movieWork(CRED, 2, VOD_STREAMS[0], VOD_INFO[9001]);
    assert.equal(w.kind, 'movie');
    assert.equal(w.title, 'Arrival', 'the year and the quality come out of the title');
    assert.equal(w.year, 2016);
    assert.equal(w.releaseDate, '2016-11-11');
    assert.match(w.description, /linguist/);
    assert.equal(w.runtimeMinutes, 116);
    assert.equal(w.rating, 7.9);
    assert.equal(w.ageRating, '12');
    assert.deepEqual(w.genres, ['Science Fiction', 'Drama']);
    assert.equal(w.poster, 'http://panel.example/arrival-poster.jpg');
    assert.equal(w.backdrop, 'http://panel.example/arrival-back.jpg');
    assert.deepEqual(w.externalIds, { tmdb: '329865' });
    assert.deepEqual(w.cast.map(c => c.name), ['Amy Adams', 'Jeremy Renner', 'Forest Whitaker']);
    assert.deepEqual(w.directors, ['Denis Villeneuve']);
    assert.equal(w.source.quality, '1080p');
  });

  test('its playback address is the panel\'s own, built from the stream id', () => {
    const w = movieWork(CRED, 2, VOD_STREAMS[0], VOD_INFO[9001]);
    assert.equal(w.source.playbackUrl, 'http://panel.example:8080/movie/housename/housepass/9001.mkv');
    assert.equal(w.source.playbackType, 'direct');
    assert.equal(w.source.credentialed, true, 'because the address carries the subscription');
    assert.equal(w.source.contentId, 's2:movie:9001');
    assert.equal(w.source.sourceId, 2);
  });

  test('a film the panel knows nothing about still imports and still plays', () => {
    const w = movieWork(CRED, 2, VOD_STREAMS[1], VOD_INFO[9002]);
    assert.equal(w.title, 'Casablanca');
    assert.equal(w.description, '');
    assert.equal(w.rating, null, 'no rating is not a rating of zero');
    assert.equal(w.source.playbackUrl, 'http://panel.example:8080/movie/housename/housepass/9002.mp4');
  });

  test('an info that came back as an empty array is not an error', () => {
    assert.deepEqual(infoOf({ info: [] }), {});
    assert.deepEqual(infoOf({ info: null }), {});
    assert.doesNotThrow(() => movieWork(CRED, 2, VOD_STREAMS[1], { info: [] }));
  });

  test('a container extension cannot put anything into the address', () => {
    assert.equal(safeExt('../../etc/passwd'), 'mp4');
    assert.equal(safeExt('mkv?x=1'), 'mp4');
    assert.equal(safeExt('.MKV'), 'mkv');
    const w = movieWork(CRED, 2, { stream_id: 5, name: 'X', container_extension: '/../y' }, null);
    assert.equal(w.source.playbackUrl, 'http://panel.example:8080/movie/housename/housepass/5.mp4');
  });

  test('a series, with its seasons and episodes in one piece', () => {
    const w = seriesWork(CRED, 2, SERIES[0], SERIES_INFO[7001]);
    assert.equal(w.kind, 'series');
    assert.equal(w.title, 'The Bear');
    assert.equal(w.year, 2022, 'releaseDate, with the capital D a series uses');
    assert.equal(w.rating, 8);
    assert.equal(w.poster, 'http://panel.example/bear.jpg');
    assert.deepEqual(w.externalIds, { tmdb: '136315' });
    assert.equal(w.seasons.length, 2);

    const s1 = w.seasons[0];
    assert.equal(s1.number, 1);
    assert.equal(s1.title, 'Season 1');
    assert.equal(s1.poster, 'http://panel.example/bear-s1.jpg');
    assert.equal(s1.episodes.length, 2);
    assert.equal(s1.episodes[0].title, 'System');
    assert.equal(s1.episodes[0].runtimeMinutes, 28);
    assert.equal(s1.episodes[0].airDate, '2022-06-23');
    assert.equal(s1.episodes[0].source.playbackUrl,
      'http://panel.example:8080/series/housename/housepass/80001.mkv');
    assert.equal(s1.episodes[0].source.contentId, 's2:episode:80001');
    assert.equal(s1.episodes[0].source.credentialed, true);
    assert.equal(w.seasons[1].episodes.length, 1);
  });

  test('episodes sent as a flat array land in seasons all the same', () => {
    const w = seriesWork(CRED, 2, SERIES[1], SERIES_INFO[7002]);
    assert.equal(w.seasons.length, 1);
    assert.deepEqual(w.seasons[0].episodes.map(e => e.number), [1, 2]);
    assert.deepEqual(episodesBySeason({ episodes: [{ id: '1', episode_num: 1 }] })[1].length, 1,
      'and an episode that does not name its season is filed under one');
  });

  test('the coercions a real panel needs', () => {
    assert.equal(asMinutes({ duration: '01:56:00' }), 116);
    assert.equal(asMinutes({ duration_secs: 6960 }), 116);
    assert.equal(asMinutes({ episode_run_time: '42' }), 42);
    assert.equal(asRating({ rating: '7.4' }), 7.4);
    assert.equal(asRating({ rating: 0, rating_5based: '4.2' }), 8.4, 'five-based, doubled');
    assert.equal(firstUrl(['http://a/b.jpg']), 'http://a/b.jpg');
    assert.equal(firstUrl('http://c/d.jpg'), 'http://c/d.jpg');
    assert.equal(firstUrl(['not a url']), '');
    assert.deepEqual(splitTitleYear('Blade Runner 2049'), { title: 'Blade Runner 2049', year: null });
  });

  test('the content id names the Telly source, so two panels do not collide', () => {
    assert.equal(contentId(2, 'movie', 9001), 's2:movie:9001');
    assert.notEqual(contentId(3, 'movie', 9001), contentId(2, 'movie', 9001));
  });

  test('probing says what the panel exposes without importing anything', async () => {
    const got = await probeXtream(CRED, panelFetch);
    assert.equal(got.account.status, 'Active');
    assert.deepEqual(got.counts, {
      liveCategories: 1, liveStreams: 2, vodCategories: 2, vodStreams: 3,
      seriesCategories: 1, series: 2
    });
    assert.equal(got.sampleMovie.has.plot, true);
    assert.equal(got.sampleMovie.has.tmdbId, true);
    assert.equal(got.sampleSeries.seasons, 2);
    assert.equal(got.sampleSeries.episodes, 3);
    assert.equal(catalogueCounts().movies, 0, 'a probe writes nothing');
  });
});

describe('importing a panel into the Movies and Series library', () => {
  test('the live sync still brings in the live channels, and only those', async () => {
    const r = await syncSource(sourceId, { fetchImpl: panelFetch });
    assert.equal(r.channels, 2, 'the two live streams');
    const names = openDb().prepare('SELECT name FROM channels ORDER BY name').all().map(c => c.name);
    assert.deepEqual(names, ['BBC News', 'Sky News']);
    assert.ok(!names.includes('Arrival (2016) 1080p'), 'a film is not a channel');
    assert.equal(catalogueCounts().movies, 0, 'and the live sync does not touch the catalogue');
  });

  test('the import brings in the films, the series, the seasons and the episodes', async () => {
    const got = await runImport(xtreamProvider().id, { fetchImpl: panelFetch });
    assert.equal(got.run.status, 'done', got.run.message);
    assert.equal(got.run.moviesDiscovered, 3);
    assert.equal(got.run.seriesDiscovered, 2);
    assert.equal(got.run.episodesDiscovered, 5, 'three of The Bear, two of Harbour Lights');

    const counts = catalogueCounts();
    assert.equal(counts.movies, 3);
    assert.equal(counts.series, 2);
    assert.equal(counts.episodes, 5);
  });

  test('a season is a season and an episode is an episode', () => {
    const bear = seriesList({ search: 'Bear' }).items[0];
    assert.ok(bear, 'the series is in the catalogue');
    const seasons = seasonsOf(bear.id);
    assert.deepEqual(seasons.map(s => s.season), [1, 2]);
    assert.equal(seasons[0].title, 'Season 1');
    const eps = episodesOf(bear.id);
    assert.equal(eps.length, 3);
    assert.deepEqual(eps.filter(e => e.season === 1).map(e => e.title), ['System', 'Hands']);
    assert.equal(episodesOf(bear.id, { season: 2 }).length, 1);
  });

  test('the metadata the panel supplied is on the row', () => {
    const arrival = movies({ search: 'Arrival' }).items[0];
    assert.equal(arrival.title, 'Arrival');
    assert.equal(arrival.year, 2016);
    assert.equal(arrival.rating, 7.9);
    assert.match(arrival.description, /linguist/);
    assert.equal(arrival.runtimeMinutes, 116);
    assert.ok(arrival.genres.includes('Science Fiction'));
    assert.ok(arrival.cast.some(c => c.name === 'Amy Adams'));
    assert.ok(arrival.directors.includes('Denis Villeneuve'));
    assert.equal(arrival.externalIds.tmdb, '329865');
    /* The panel's poster address is on the row; what the API hands out is a
       different question — see the artwork tests. This fixture serves no
       images, so the cache records the fetch as failed and the work is
       answered with no poster rather than a broken one. */
    const stored = openDb().prepare('SELECT poster_url FROM catalogue_movies WHERE id = ?')
      .get(arrival.id).poster_url;
    assert.equal(stored, 'http://panel.example/arrival-poster.jpg', 'the panel\'s own address');
    assert.equal(arrival.poster, '', 'and not handed out, because it would not load');
  });

  test('a film with no metadata of its own takes the panel\'s category as its genre', () => {
    const night = movies({ search: 'Night Runner' }).items[0];
    assert.deepEqual(night.genres, ['Classics']);
  });

  test('importing the same panel again changes nothing and duplicates nothing', async () => {
    const before = catalogueCounts();
    const got = await runImport(xtreamProvider().id, { fetchImpl: panelFetch });
    assert.equal(got.run.status, 'done');
    assert.equal(got.run.newItems, 0, 'every record was already filed under its panel id');
    assert.deepEqual(catalogueCounts(), before);
  });

  test('a second panel carrying the same film gives it a second way to play', async () => {
    const second = createSource({ name: 'Another panel', kind: 'xtream',
      url: CRED.host, username: CRED.username, password: CRED.password }).id;
    const got = await runImport(xtreamProvider().id, { fetchImpl: panelFetch });
    assert.equal(got.run.status, 'done');

    const arrival = movies({ search: 'Arrival' }).items[0];
    const srcs = movieSources(arrival.id);
    assert.equal(srcs.length, 2, 'one card, two subscriptions');
    assert.deepEqual(srcs.map(s => s.sourceLabel).sort(), ['Another panel', 'Archive Watch']);
    assert.equal(movies({ search: 'Arrival' }).total, 1, 'and still one film');

    /* Put it back, so the rest of the suite sees one panel. */
    deleteSource(second);
    assert.equal(movieSources(arrival.id).length, 1);
    assert.equal(movies({ search: 'Arrival' }).total, 1, 'removing one panel keeps the film');
  });
});

describe('what a client is told, and what it is not', () => {
  test('/api/movies returns the panel\'s films', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/movies?limit=50', headers: auth(token) });
    assert.equal(res.statusCode, 200);
    const titles = res.json().items.map(m => m.title);
    assert.ok(titles.includes('Arrival'), titles.join(', '));
    assert.ok(titles.includes('Casablanca'));
  });

  test('/api/series/:id/seasons and /episodes return the panel\'s box set', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/series', headers: auth(token) });
    const bear = list.json().items.find(s => s.title === 'The Bear');
    assert.ok(bear);

    const seasons = await app.inject({
      method: 'GET', url: `/api/series/${bear.id}/seasons`, headers: auth(token) });
    assert.deepEqual(seasons.json().seasons.map(s => s.season), [1, 2]);

    const eps = await app.inject({
      method: 'GET', url: `/api/series/${bear.id}/episodes`, headers: auth(token) });
    assert.equal(eps.json().episodes.length, 3);
    assert.equal(eps.json().episodes[0].title, 'System');

    const one = await app.inject({
      method: 'GET', url: `/api/series/${bear.id}/episodes?season=2`, headers: auth(token) });
    assert.equal(one.json().episodes.length, 1);
  });

  test('no response anywhere carries the subscription\'s password', async () => {
    const bear = seriesList({ search: 'Bear' }).items[0];
    const paths = ['/api/movies?limit=50', '/api/series', `/api/series/${bear.id}`,
                   `/api/series/${bear.id}/episodes`, '/api/v1/catalogue/movies?limit=50',
                   '/api/search?q=arrival'];
    for (const path of paths) {
      const res = await app.inject({ method: 'GET', url: path, headers: auth(token) });
      const body = res.body;
      assert.ok(!body.includes('housepass'), `${path} leaked the password`);
      assert.ok(!body.includes('/movie/housename/'), `${path} leaked the address`);
    }
  });

  test('a film page offers a playback path on this server, not the panel\'s address', async () => {
    const arrival = movies({ search: 'Arrival' }).items[0];
    const res = await app.inject({
      method: 'GET', url: `/api/v1/catalogue/movies/${arrival.id}`, headers: auth(token) });
    const src = res.json().sources[0];
    assert.equal(src.playable, true);
    assert.equal(src.credentialed, true);
    assert.equal(src.url, undefined, 'the address is not handed over');
    assert.match(src.playback, /^\/api\/v1\/stream\/catalogue\/movie\/\d+$/);
    assert.equal(src.sourceLabel, 'Archive Watch');
  });

  test('the server can still find the address itself', () => {
    const arrival = movies({ search: 'Arrival' }).items[0];
    const src = movieSources(arrival.id)[0];
    const address = sourceAddress('movie', src.id);
    assert.equal(address.url, 'http://panel.example:8080/movie/housename/housepass/9001.mkv');
    assert.equal(address.credentialed, true);
  });
});

describe('playing one', () => {
  let arrivalId, episodeId;
  before(() => {
    arrivalId = movies({ search: 'Arrival' }).items[0].id;
    const bear = seriesList({ search: 'Bear' }).items[0];
    episodeId = episodesOf(bear.id).find(e => e.title === 'System').id;
  });

  test('a ticket comes back as a path on this server, with no address in it', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${arrivalId}/ticket`, headers: auth(token) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.mode, 'remote');
    assert.equal(body.source, 'Archive Watch');
    assert.match(body.url, new RegExp(`^/api/v1/stream/catalogue/movie/${arrivalId}\\?source=\\d+&ticket=`));
    assert.ok(!res.body.includes('housepass'));
  });

  test('presenting the ticket gets the film, with the address kept back', async () => {
    const t = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${arrivalId}/ticket`, headers: auth(token) });
    const res = await app.inject({ method: 'GET', url: t.json().url });
    /* Relayed, not redirected: a 302 would put the subscription's username
       and password in a Location header on the television. */
    assert.notEqual(res.statusCode, 302, 'no redirect to a credentialed address');
    assert.equal(res.headers.location, undefined);
    assert.ok(!String(res.body).includes('housepass'));
  });

  test('with TELLY_VOD_MODE=redirect the operator gets the cheap path instead', async () => {
    const was = config.vodMode;
    config.vodMode = 'redirect';
    try {
      const t = await app.inject({
        method: 'POST', url: `/api/v1/stream/catalogue/movie/${arrivalId}/ticket`, headers: auth(token) });
      const res = await app.inject({ method: 'GET', url: t.json().url });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location,
        'http://panel.example:8080/movie/housename/housepass/9001.mkv');
    } finally { config.vodMode = was; }
  });

  test('without a ticket or a token, nothing is redirected anywhere', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/stream/catalogue/movie/${arrivalId}` });
    assert.equal(res.statusCode, 401, res.body);
    assert.ok(!res.body.includes('housepass'));
    assert.ok(!(res.headers.location || '').includes('housepass'));
  });

  test('a ticket for one film does not open another', async () => {
    const t = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${arrivalId}/ticket`, headers: auth(token) });
    const ticket = new URL('http://x' + t.json().url).searchParams.get('ticket');
    const other = movies({ search: 'Casablanca' }).items[0].id;
    const res = await app.inject({
      method: 'GET', url: `/api/v1/stream/catalogue/movie/${other}?ticket=${encodeURIComponent(ticket)}` });
    assert.equal(res.statusCode, 403);
  });

  test('an episode plays the same way, from the series path', async () => {
    const t = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/episode/${episodeId}/ticket`, headers: auth(token) });
    assert.equal(t.json().mode, 'remote');
    const was = config.vodMode;
    config.vodMode = 'redirect';          // the address is what this checks
    try {
      const res = await app.inject({ method: 'GET', url: t.json().url });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location,
        'http://panel.example:8080/series/housename/housepass/80001.mkv');
    } finally { config.vodMode = was; }
  });

  test('/api/movies/:id/stream needs an account, and then redirects', async () => {
    const open = await app.inject({ method: 'GET', url: `/api/movies/${arrivalId}/stream` });
    assert.equal(open.statusCode, 401, 'it used to redirect anybody at all');
    assert.ok(!(open.headers.location || '').includes('housepass'));

    const was = config.vodMode;
    config.vodMode = 'redirect';
    try {
      const withToken = await app.inject({
        method: 'GET', url: `/api/movies/${arrivalId}/stream`, headers: auth(token) });
      assert.equal(withToken.statusCode, 302);
      assert.equal(withToken.headers.location,
        'http://panel.example:8080/movie/housename/housepass/9001.mkv');
    } finally { config.vodMode = was; }
  });

  test('/api/episodes/:id/stream likewise', async () => {
    const was = config.vodMode;
    config.vodMode = 'redirect';
    try {
      const res = await app.inject({
        method: 'GET', url: `/api/episodes/${episodeId}/stream`, headers: auth(token) });
      assert.equal(res.statusCode, 302);
      assert.match(res.headers.location, /\/series\/housename\/housepass\/80001\.mkv$/);
    } finally { config.vodMode = was; }
  });

  test('and by default even that path keeps the address back', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/episodes/${episodeId}/stream`, headers: auth(token) });
    assert.notEqual(res.statusCode, 302);
    assert.equal(res.headers.location, undefined);
  });

  test('nothing was downloaded: the row holds an address, not a file', () => {
    const row = openDb().prepare(`SELECT playback_url, local_kind, local_id
        FROM catalogue_movie_sources WHERE provider_content_id = ?`).get(`s${sourceId}:movie:9001`);
    assert.match(row.playback_url, /^http:\/\//);
    assert.equal(row.local_kind, '');
    assert.equal(row.local_id, null);
  });
});

describe('the rest of Telly is where it was', () => {
  test('a panel\'s films are not channels, in Live TV or anywhere near it', async () => {
    for (const kind of ['live', 'movie', 'series']) {
      const res = await app.inject({
        method: 'GET', url: `/api/v1/channels?kind=${kind}&limit=100`, headers: auth(token) });
      const names = res.json().items.map(c => c.name);
      assert.ok(!names.some(n => /Arrival|Casablanca|The Bear|Night Runner/.test(n)),
        `${kind}: ${names.join(', ')}`);
    }
    const chans = openDb().prepare('SELECT COUNT(*) n FROM channels').get().n;
    assert.equal(chans, 2, 'the two live channels and nothing else');
  });

  test('the live channels are still playable the way they always were', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    const sky = res.json().items.find(c => c.name === 'Sky News');
    assert.ok(sky);
    assert.equal(sky.playback, `/api/v1/stream/${sky.id}`);
    const t = await app.inject({
      method: 'POST', url: `/api/v1/stream/${sky.id}/ticket`, headers: auth(token), payload: {} });
    assert.equal(t.statusCode, 200);
    const play = await app.inject({ method: 'GET', url: t.json().url });
    assert.equal(play.statusCode, 302);
    assert.match(play.headers.location, /\/live\/housename\/housepass\/501\./);
  });

  test('the local media provider is untouched and still on', () => {
    const local = providerByKey('local');
    assert.ok(local);
    assert.equal(Boolean(local.enabled), true);
    assert.equal(local.status, 'available');
  });

  test('the Xtream provider is registered, on, and says what it reads', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/providers', headers: auth(adminToken) });
    const x = res.json().providers.find(p => p.key === 'xtream');
    assert.ok(x, 'listed in Settings');
    assert.equal(x.importable, true);
    assert.equal(x.enabled, true);
    assert.match(x.statusReason, /player API/);
    assert.match(x.statusReason, /Films and series only/);
  });
});

describe('a panel that will not let us in', () => {
  test('wrong credentials are reported, not retried another way', async () => {
    const bad = createSource({ name: 'Expired panel', kind: 'xtream',
      url: CRED.host, username: 'housename', password: 'wrong' }).id;
    const got = await runImport(xtreamProvider().id, { fetchImpl: panelFetch });
    assert.equal(got.run.status, 'done', 'one bad panel does not fail the import');
    assert.match(got.run.message || '', /rejected those credentials/);
    deleteSource(bad);
  });

  test('and a source that is switched off is not read at all', async () => {
    const before = asked.length;
    const off = createSource({ name: 'Off panel', kind: 'xtream', url: 'http://nowhere.example',
      username: 'u', password: 'p' }).id;
    openDb().prepare('UPDATE sources SET enabled = 0 WHERE id = ?').run(off);
    await runImport(xtreamProvider().id, { fetchImpl: panelFetch });
    assert.ok(!asked.slice(before).some(u => u.includes('nowhere.example')));
    deleteSource(off);
  });
});

describe('a panel and the household\'s own shelf, in one catalogue', () => {
  let localRoots = [];

  before(async () => {
    /* The same two titles the panel carries, on this server's disk — which is
       the point of a unified catalogue: one card, two ways to play. */
    const films = path.join(box.dir, 'Films');
    const tv = path.join(box.dir, 'TV');
    mkdirSync(films, { recursive: true });
    mkdirSync(path.join(tv, 'The Bear', 'Season 1'), { recursive: true });
    writeFileSync(path.join(films, 'Arrival (2016).mp4'), 'x'.repeat(200));
    writeFileSync(path.join(tv, 'The Bear', 'Season 1', 'The.Bear.S01E01.System.mp4'), 'x'.repeat(100));

    localRoots = [createRoot({ label: 'Films', kind: 'movies', path: films }).id,
                  createRoot({ label: 'TV', kind: 'series', path: tv }).id];
    for (const id of localRoots) scanRoot(id);
    await syncLocalProvider();
  });

  test('the scanner still finds what is on the disk', () => {
    const films = openDb().prepare('SELECT COUNT(*) n FROM movies WHERE missing_since IS NULL').get().n;
    const eps = openDb().prepare('SELECT COUNT(*) n FROM episodes WHERE missing_since IS NULL').get().n;
    assert.equal(films, 1);
    assert.equal(eps, 1);
  });

  test('the film the household owns and the film the panel carries are one card', () => {
    const found = movies({ search: 'Arrival' });
    assert.equal(found.total, 1, 'one film, not two');
    const srcs = movieSources(found.items[0].id);
    assert.equal(srcs.length, 2);
    assert.deepEqual(srcs.map(s => s.providerKey).sort(), ['local', 'xtream']);
    /* The one that needs no internet is offered first. */
    assert.equal(srcs[0].providerKey, 'local');
    assert.equal(srcs[0].local, true);
    assert.equal(srcs[1].credentialed, true);
  });

  test('a yearless series is queued for a person rather than merged on a guess', () => {
    const open = openReviews({ kind: 'series' });
    const r = open.items.find(x => x.left.canonical_title === 'The Bear');
    assert.ok(r, `no review about The Bear in ${JSON.stringify(open.items)}`);
    assert.equal(r.workKind, 'series');
    assert.equal(r.right.canonical_title, 'The Bear');
    assert.match(r.reason, /no year/);
    /* Every review names two rows that are both still there — a question
       about a row that has been deleted is not answerable. */
    for (const x of open.items) { assert.ok(x.left, 'left'); assert.ok(x.right, 'right'); }
    /* This threw before: a series has no runtime_minutes column, so the
       duplicate list broke the moment a series was ever queued — which
       nothing did until a panel and a scanned folder carried the same show. */
    assert.doesNotThrow(() => openReviews());
  });

  test('merging it by hand gives the episode both ways to play', () => {
    const r = openReviews({ kind: 'series' }).items.find(x => x.left.canonical_title === 'The Bear');
    decideReview(r.id, 'merge');
    const bears = seriesList({ search: 'Bear' });
    assert.equal(bears.total, 1);
    const eps = episodesOf(bears.items[0].id);
    assert.equal(eps.length, 3, 'the panel\'s three, with the local file folded into one of them');
    const first = eps.find(e => e.episode === 1 && e.season === 1);
    const srcs = episodeSources(first.id);
    assert.deepEqual(srcs.map(s => s.providerKey).sort(), ['local', 'xtream']);
  });

  test('and the local library is still served the way it always was', async () => {
    const arrival = movies({ search: 'Arrival' }).items[0];
    const res = await app.inject({
      method: 'POST', url: `/api/v1/stream/catalogue/movie/${arrival.id}/ticket`, headers: auth(token) });
    assert.equal(res.json().mode, 'local', 'the disk is preferred over the subscription');
    assert.match(res.json().url, /^\/api\/v1\/stream\/media\/movie\/\d+\?ticket=/);
  });
});

describe('the import log is safe to look at', () => {
  test('a URL recorded against a run has its credentials blanked', () => {
    assert.equal(
      short('http://panel:8080/player_api.php?username=housename&password=housepass&action=get_vod_streams'),
      'http://panel:8080/player_api.php?username=…&password=…&action=get_vod_streams');
    assert.equal(short('http://panel:8080/movie/housename/housepass/9001.mkv'),
      'http://panel:8080/movie/…/…/9001.mkv');
    assert.equal(short('http://panel:8080/series/housename/housepass/80001.mp4'),
      'http://panel:8080/series/…/…/80001.mp4');
    /* A public provider's address is not mangled. */
    assert.equal(short('https://archive.org/metadata/some-film'),
      'https://archive.org/metadata/some-film');
  });

  test('and a panel that answers badly does not write its password into the log', async () => {
    /* A panel that refuses every catalogue call after signing in: the run
       records what went wrong, and what it records is readable in Settings. */
    const rude = async (url) => {
      const u = new URL(String(url));
      if (!u.searchParams.get('action')) return panelFetch(url);
      return { ok: false, status: 500, statusText: 'Server Error',
               headers: { get: () => null }, text: async () => 'nope' };
    };
    const got = await runImport(xtreamProvider().id, { fetchImpl: rude });
    const run = got.run;
    const text = JSON.stringify(run);
    assert.ok(!text.includes('housepass'), text.slice(0, 300));
    const rows = openDb().prepare('SELECT message FROM provider_imports').all();
    for (const r of rows) assert.ok(!String(r.message).includes('housepass'), r.message);
  });
});
