import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { createSource, updateSource, syncSource, getSource, listSources } =
  await import('../src/services/sources.js');
const { runImport, publicImport } = await import('../src/services/importer.js');
const { ensureProviders, providerByKey, setProviderEnabled } =
  await import('../src/services/providers/index.js');
const { movies, movieSources, publicMovie, movie, facets } =
  await import('../src/services/catalogue.js');
const {
  LICENCES, DEFAULT_LICENCES, permittedLicences, licenceOf, hostOf, instanceAllowed,
  searchUrl, videoUrl, playbackFor, admissible, movieWork, looksLikeAnExtra, instanceOf,
  attributionFor, authorOf, sourceSettings, canonicalUrlFor
} = await import('../src/services/peertube.js');
const { closeDb, openDb } = await import('../src/db/index.js');
const { config } = await import('../src/config.js');

/**
 * PeerTube: openly licensed film, and the rights that let Telly carry it.
 *
 * The licence is the permission, so most of this file is about refusing
 * things. A video that is not taken is the importer working — the counters
 * say so — and the cases below are every way a video can fail to qualify,
 * each asserted separately, because "it imported two of forty" is not
 * evidence that the right thirty-eight were refused.
 *
 * The instance below answers the way PeerTube does, including the ways its
 * own records disagree: `licence` as an object on the full record and
 * sometimes as a bare number, files under `files` on a modern instance and
 * `webVideoFiles` on one a version behind, a thumbnail as a path on one and
 * an absolute URL on the next.
 */

const HOST = 'films.test';
const BASE = `https://${HOST}`;

/* ------------------------------------------------------------ the videos -- */

const video = (over = {}) => ({
  uuid: over.uuid || 'uuid-0000',
  shortUUID: over.shortUUID || 'short0000',
  name: 'A Perfectly Ordinary Film',
  description: 'A film that exists, at length, and says nothing about trailers.',
  duration: 95 * 60,
  nsfw: false,
  isLive: false,
  licence: { id: 1, label: 'Attribution' },
  originallyPublishedAt: '2019-04-02T00:00:00.000Z',
  publishedAt: '2020-01-01T00:00:00.000Z',
  thumbnailPath: '/lazy-static/thumbnails/ordinary.jpg',
  previewPath: '/lazy-static/previews/ordinary.jpg',
  category: { id: 1, label: 'Films' },
  language: { id: 'en', label: 'English' },
  tags: ['drama', 'independent'],
  account: { name: 'adirector', displayName: 'A Director', host: HOST },
  channel: { name: 'films', displayName: 'Films' },
  url: `${BASE}/w/short0000`,
  streamingPlaylists: [{
    type: 1,
    playlistUrl: `${BASE}/static/streaming-playlists/hls/uuid-0000/master.m3u8`,
    files: [{ resolution: { id: 1080, label: '1080p' }, fileUrl: `${BASE}/f/1080.mp4` },
            { resolution: { id: 480, label: '480p' }, fileUrl: `${BASE}/f/480.mp4` }]
  }],
  files: [],
  ...over
});

/* A library covering every verdict the importer can reach. */
const LIBRARY = [
  video({ uuid: 'ok-ccby', name: 'The Permitted Feature', licence: { id: 1, label: 'Attribution' } }),
  video({ uuid: 'ok-ccbysa', name: 'Share Alike Story', licence: { id: 2, label: 'Attribution - Share Alike' } }),
  video({ uuid: 'ok-cc0', name: 'Public Domain Picture', licence: { id: 7, label: 'Public Domain Dedication' } }),
  /* Web video only, no HLS: acceptable unless HLS is required. */
  video({ uuid: 'ok-webvideo', name: 'Progressive Only', streamingPlaylists: [],
          files: [{ resolution: { id: 720 }, fileUrl: `${BASE}/f/progressive-720.mp4` }] }),
  /* And every refusal. */
  video({ uuid: 'no-arr', name: 'All Rights Reserved Film', licence: { id: 0, label: 'All rights reserved' } }),
  video({ uuid: 'no-unknown', name: 'No Licence Film', licence: null }),
  video({ uuid: 'no-missing', name: 'Missing Licence Field', licence: undefined }),
  video({ uuid: 'no-nc', name: 'Non Commercial Film', licence: { id: 4, label: 'Attribution - Non Commercial' } }),
  video({ uuid: 'no-nd', name: 'No Derivatives Film', licence: { id: 3, label: 'Attribution - No Derivatives' } }),
  video({ uuid: 'no-nsfw', name: 'Adult Film', nsfw: true }),
  video({ uuid: 'no-nsfw-absent', name: 'Unflagged Film', nsfw: undefined }),
  video({ uuid: 'no-short', name: 'A Short Film', duration: 7 * 60 }),
  video({ uuid: 'no-live', name: 'A Live Broadcast', isLive: true }),
  video({ uuid: 'no-media', name: 'Nothing To Play', streamingPlaylists: [], files: [] }),
  video({ uuid: 'no-signed', name: 'Private Film', streamingPlaylists: [],
          files: [{ resolution: { id: 720 }, fileUrl: `${BASE}/f/secret.mp4?token=abc123` }] }),
  video({ uuid: 'no-trailer', name: 'The Permitted Feature — Official Trailer' })
];

const PERMITTED = ['The Permitted Feature', 'Share Alike Story', 'Public Domain Picture',
                   'Progressive Only'];

/* ----------------------------------------------------------- the instance -- */

const asked = [];
function instanceFetch(url) {
  const u = String(url);
  asked.push(u);
  const json = (body) => Promise.resolve({
    ok: true, status: 200, headers: new Map([['content-type', 'application/json']]),
    json: async () => body
  });

  const one = u.match(/\/api\/v1\/videos\/([^/?]+)$/);
  if (one) {
    const found = LIBRARY.find(v => v.uuid === decodeURIComponent(one[1]));
    if (!found) return Promise.resolve({ ok: false, status: 404, headers: new Map() });
    return json(found);
  }

  if (u.includes('/api/v1/search/videos')) {
    const q = new URL(u);
    const start = Number(q.searchParams.get('start') || 0);
    const count = Number(q.searchParams.get('count') || 25);
    /* A real instance filters server-side. This one deliberately does NOT
       apply the licence or duration parameters, so the tests prove Telly's
       own checks rather than the fixture's helpfulness. */
    const page = LIBRARY.slice(start, start + count);
    return json({ total: LIBRARY.length, data: page });
  }

  return Promise.resolve({ ok: false, status: 404, headers: new Map() });
}

let app, adminToken, token, sourceId;

before(async () => {
  app = await buildServer({ logger: false });
  ensureProviders();
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-pt-admin01', name: 'PC' }))
    .json().accessToken;
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-pt-user001', name: 'TV' }))
    .json().accessToken;
  /* The fixture instance, allowed for the duration of this file. */
  config.peertube.allowedHosts = [HOST, 'another.test'];
});

after(async () => { await app.close(); closeDb(); box.cleanup(); });

/* ======================================================================== */

describe('a PeerTube source', () => {
  test('1 · can be created for an allowed instance', () => {
    const src = createSource({ name: 'Films Test', kind: 'peertube', url: BASE });
    sourceId = src.id;
    assert.equal(src.kind, 'peertube');
    assert.equal(src.url, BASE);
    assert.equal(Boolean(src.enabled), true);
  });

  test('2 · and is refused for an instance that is not on the allowlist', () => {
    assert.throws(
      () => createSource({ name: 'Somewhere Else', kind: 'peertube', url: 'https://random.example' }),
      /allowlist/i);
    /* And the allowlist is a list of hosts, not a substring match: a host
       that merely ends with an allowed one is a different server. */
    assert.throws(
      () => createSource({ name: 'Lookalike', kind: 'peertube', url: 'https://evil-films.test.attacker.example' }),
      /allowlist/i);
  });

  test('and re-pointing an existing source faces the same list', () => {
    assert.throws(() => updateSource(sourceId, { url: 'https://random.example' }), /allowlist/i);
    assert.equal(getSource(sourceId).url, BASE, 'and it was not changed');
  });

  test('a PeerTube source needs an address at all', () => {
    assert.throws(() => createSource({ name: 'Nowhere', kind: 'peertube' }), /address/i);
  });

  test('it carries its own settings, defaulted where unset', () => {
    const got = sourceSettings(getSource(sourceId));
    assert.equal(got.minDuration, config.peertube.minDurationSeconds);
    assert.deepEqual(got.licences, DEFAULT_LICENCES);
    assert.deepEqual(got.searches, []);
  });

  test('and the admin screen is told what it will take, and whether it may', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/sources',
                                   headers: auth(adminToken) });
    const src = res.json().sources.find(s => s.id === sourceId);
    assert.equal(src.kind, 'peertube');
    assert.equal(src.peertube.host, HOST);
    assert.equal(src.peertube.allowed, true);
    assert.deepEqual(src.peertube.licenceNames, ['CC0', 'CC BY', 'CC BY-SA']);
  });
});

describe('3 · the licence allowlist', () => {
  test('4 · CC BY is accepted', () => {
    const got = licenceOf({ licence: { id: 1 } });
    assert.equal(got.short, 'CC BY');
    assert.equal(got.permitted, true);
    assert.equal(got.known, true);
  });

  test('5 · CC BY-SA is accepted', () => {
    const got = licenceOf({ licence: { id: 2 } });
    assert.equal(got.short, 'CC BY-SA');
    assert.equal(got.permitted, true);
  });

  test('6 · CC0 / public domain is accepted', () => {
    const got = licenceOf({ licence: { id: 7 } });
    assert.equal(got.short, 'CC0');
    assert.equal(got.permitted, true);
  });

  test('7 · an unknown licence is rejected, however reassuring its label', () => {
    for (const licence of [null, undefined, { id: 99, label: 'Totally Fine Honest' },
                           { label: 'CC BY' }, 'CC BY', {}]) {
      const got = licenceOf({ licence });
      assert.equal(got.known, false, JSON.stringify(licence));
      assert.equal(got.permitted, false);
      assert.equal(got.short, 'Unknown');
    }
  });

  test('8 · All Rights Reserved is rejected', () => {
    /* PeerTube uses 0 or omits it; either way it is not in the table. */
    assert.equal(licenceOf({ licence: { id: 0, label: 'All rights reserved' } }).permitted, false);
  });

  test('the non-commercial and no-derivatives families are rejected', () => {
    for (const id of [3, 4, 5, 6]) {
      assert.equal(LICENCES[id].permitted, false, LICENCES[id].short);
    }
  });

  test('a source may narrow the list but never widen it', () => {
    assert.deepEqual(permittedLicences([1]), [1], 'narrowing is allowed');
    /* Asking for the ones Telly refuses yields the default, not the ask. */
    assert.deepEqual(permittedLicences([3, 4, 5, 6]), DEFAULT_LICENCES);
    assert.deepEqual(permittedLicences([1, 4]), [1], 'the permitted part survives, the rest does not');
    assert.deepEqual(permittedLicences('everything'), DEFAULT_LICENCES);
    assert.deepEqual(permittedLicences([]), DEFAULT_LICENCES);
    assert.deepEqual(permittedLicences([0, 99]), DEFAULT_LICENCES);
  });
});

describe('what counts as a film', () => {
  const opts = () => ({ baseUrl: BASE, hosts: [HOST], licences: DEFAULT_LICENCES,
                        minDuration: 45 * 60, maxDuration: 6 * 3600 });

  test('9 · NSFW is rejected — and so is a video that never said', () => {
    assert.equal(admissible(video({ nsfw: true }), opts()).reason, 'nsfw');
    assert.equal(admissible(video({ nsfw: undefined }), opts()).reason, 'nsfw');
    assert.equal(admissible(video({ nsfw: null }), opts()).reason, 'nsfw');
  });

  test('10 · a short video is rejected', () => {
    const got = admissible(video({ duration: 12 * 60 }), opts());
    assert.equal(got.reason, 'short');
    assert.match(got.detail, /12 min/);
  });

  test('11 · a live stream is rejected', () => {
    assert.equal(admissible(video({ isLive: true }), opts()).reason, 'live');
    assert.equal(admissible(video({ state: 2 }), opts()).reason, 'live');
  });

  test('a trailer or clip is rejected however long it claims to be', () => {
    assert.equal(looksLikeAnExtra({ name: 'Dune — Official Trailer' }), true);
    assert.equal(looksLikeAnExtra({ name: 'Making of Blender Open Movie' }), true);
    assert.equal(looksLikeAnExtra({ name: 'A Film', description: 'Behind the scenes footage.' }), true);
    /* But a synopsis that merely mentions one is still a film. */
    assert.equal(looksLikeAnExtra({ name: 'A Film',
      description: 'A'.repeat(400) + ' trailer' }), false);
    assert.equal(admissible(video({ name: 'Nice Film — Teaser' }), opts()).reason, 'other');
  });

  test('a video longer than the ceiling is rejected', () => {
    assert.equal(admissible(video({ duration: 9 * 3600 }), opts()).reason, 'other');
  });

  test('an instance that is not allowed is refused before anything else', () => {
    const got = admissible(video(), { ...opts(), hosts: ['somewhere.else'] });
    assert.equal(got.reason, 'instance');
  });
});

describe('playable media', () => {
  test('12 · HLS is accepted and preferred', () => {
    const got = playbackFor(video());
    assert.equal(got.type, 'hls');
    assert.match(got.url, /master\.m3u8$/);
    assert.equal(got.quality, '1080p', 'the best resolution behind the playlist');
  });

  test('13 · web video is accepted where there is no HLS', () => {
    const got = playbackFor(video({ streamingPlaylists: [],
      files: [{ resolution: { id: 720 }, fileUrl: `${BASE}/f/720.mp4` },
              { resolution: { id: 1080 }, fileUrl: `${BASE}/f/1080.mp4` }] }));
    assert.equal(got.type, 'direct');
    assert.match(got.url, /1080\.mp4$/, 'the best one');
  });

  test('an instance a version behind, which calls them webVideoFiles', () => {
    const got = playbackFor(video({ streamingPlaylists: [], files: [],
      webVideoFiles: [{ resolution: { id: 480 }, fileUrl: `${BASE}/f/old.mp4` }] }));
    assert.equal(got.type, 'direct');
  });

  test('14 · no playable media is rejected', () => {
    assert.equal(playbackFor(video({ streamingPlaylists: [], files: [] })), null);
    assert.equal(admissible(video({ streamingPlaylists: [], files: [] }),
      { baseUrl: BASE, hosts: [HOST] }).reason, 'unplayable');
  });

  test('an HLS playlist with nothing behind it is not playable', () => {
    assert.equal(playbackFor(video({ streamingPlaylists: [{ type: 1, playlistUrl: `${BASE}/x.m3u8`, files: [] }],
                                     files: [] })), null);
  });

  test('a signed or expiring address is not treated as permanent', () => {
    /* Storing one would give the catalogue an address that stops working in
       an hour. The identity is kept instead and the address re-derived. */
    for (const url of [`${BASE}/f/a.mp4?token=x`, `${BASE}/f/a.mp4?expires=123`,
                       `${BASE}/f/a.mp4?X-Amz-Signature=abc`]) {
      assert.equal(playbackFor(video({ streamingPlaylists: [],
        files: [{ resolution: { id: 720 }, fileUrl: url }] })), null, url);
    }
  });

  test('requiring HLS refuses an instance that only has progressive files', () => {
    const only = video({ streamingPlaylists: [],
      files: [{ resolution: { id: 720 }, fileUrl: `${BASE}/f/720.mp4` }] });
    assert.equal(playbackFor(only, { requireHls: true }), null);
    assert.ok(playbackFor(only, { requireHls: false }));
  });

  test('and refusing web video leaves only HLS', () => {
    const only = video({ streamingPlaylists: [],
      files: [{ resolution: { id: 720 }, fileUrl: `${BASE}/f/720.mp4` }] });
    assert.equal(playbackFor(only, { webVideoAccepted: false }), null);
  });
});

describe('the search Telly actually sends', () => {
  test('it asks one named instance, never the global index', () => {
    const u = new URL(searchUrl(BASE, { search: 'documentary', durationMin: 2700,
                                        licenceOneOf: [1, 2, 7], count: 50, start: 0 }));
    assert.equal(u.host, HOST);
    assert.equal(u.pathname, '/api/v1/search/videos');
    assert.equal(u.searchParams.get('searchTarget'), null,
      'no searchTarget means this instance, not the federation-wide index');
  });

  test('and it asks the server for the same things it will check itself', () => {
    const u = new URL(searchUrl(BASE, { durationMin: 2700, durationMax: 21600,
                                        licenceOneOf: [1, 2, 7], count: 50 }));
    assert.equal(u.searchParams.get('nsfw'), 'false');
    assert.equal(u.searchParams.get('isLive'), 'false');
    assert.equal(u.searchParams.get('durationMin'), '2700');
    assert.equal(u.searchParams.get('durationMax'), '21600');
    assert.deepEqual(u.searchParams.getAll('licenceOneOf'), ['1', '2', '7']);
  });

  test('a page size is clamped, so a source cannot ask for ten thousand', () => {
    assert.equal(new URL(searchUrl(BASE, { count: 9999 })).searchParams.get('count'), '100');
  });

  test('the allowlist matches a host; identity keeps the port', () => {
    /* Two different questions. An allowlist is about who runs the server, and
       a port is not a different operator — so allowing an instance allows it
       on whatever socket it listens on. But two instances on one machine,
       told apart by port, are two libraries with two sets of rights, so the
       port is part of who published a video and part of the dedup key. */
    assert.equal(hostOf('https://films.test:8443/x'), 'films.test');
    assert.equal(instanceAllowed('https://films.test:8443', ['films.test']), true);

    assert.equal(instanceOf('https://films.test:8443'), 'films.test:8443');
    assert.equal(instanceOf('https://films.test'), 'films.test', 'the default port is nobody\'s name');
    assert.equal(instanceOf('https://films.test:443'), 'films.test');
    assert.equal(instanceOf('http://films.test:80'), 'films.test');

    /* And the content id, which is the first rung of the deduplicator, is
       built from the identity rather than from the host. */
    const work = movieWork('https://films.test:8443', { id: 1, name: 'x' }, video(),
      { licence: licenceOf({ licence: { id: 1 } }),
        playback: { url: 'https://films.test:8443/a.m3u8', type: 'hls', quality: '' } });
    assert.equal(work.source.contentId, 'films.test:8443:uuid-0000');
    assert.equal(work.source.sourceInstance, 'films.test:8443');
  });

  test('hostOf and instanceAllowed agree on what a host is', () => {
    assert.equal(hostOf('https://films.test/'), 'films.test');
    assert.equal(hostOf('films.test'), 'films.test');
    assert.equal(hostOf('https://FILMS.TEST:443/x'), 'films.test');
    assert.equal(hostOf('not a url at all /'), '');
    assert.equal(instanceAllowed('https://films.test', [HOST]), true);
    assert.equal(instanceAllowed('https://notfilms.test', [HOST]), false);
    assert.equal(instanceAllowed('', [HOST]), false);
  });
});

/* ===================== the import, end to end ========================== */

describe('importing', () => {
  let run;

  test('it imports exactly the videos that qualify', async () => {
    setProviderEnabled(providerByKey('peertube').id, true);
    const got = await runImport(providerByKey('peertube').id, { fetchImpl: instanceFetch });
    run = got.run;
    assert.equal(run.status, 'done', run.message);

    const titles = movies({ limit: 100, provider: 'peertube' }).items.map(m => m.title).sort();
    assert.deepEqual(titles, [...PERMITTED].sort());
  });

  test('17 · and the run says what it refused, and why', () => {
    assert.equal(run.instancesChecked, 1);
    assert.ok(run.queriesRun >= 1);
    assert.equal(run.videosDiscovered, LIBRARY.length);
    assert.equal(run.moviesDiscovered, PERMITTED.length);
    assert.equal(run.newItems, PERMITTED.length);

    const s = run.skipped;
    /* Four licence refusals: all-rights-reserved, unknown, missing, NC, ND —
       five, and the trailer is refused for its title before its licence is
       reached. */
    assert.equal(s.licence, 5, JSON.stringify(s));
    assert.equal(s.nsfw, 2, 'flagged, and never flagged at all');
    assert.equal(s.tooShort, 1);
    assert.equal(s.live, 1);
    assert.equal(s.noPlayableMedia, 2, 'nothing to play, and a signed address');
    assert.equal(s.other, 1, 'the trailer');
    assert.equal(s.total, LIBRARY.length - PERMITTED.length);
  });

  test('19 · and nothing that failed the licence is anywhere in the catalogue', () => {
    const all = movies({ limit: 200 }).items.map(m => m.title);
    for (const refused of ['All Rights Reserved Film', 'No Licence Film', 'Missing Licence Field',
                           'Non Commercial Film', 'No Derivatives Film', 'Adult Film',
                           'A Short Film', 'A Live Broadcast', 'Nothing To Play', 'Private Film']) {
      assert.ok(!all.includes(refused), `${refused} should not be in the catalogue`);
    }
  });

  test('18 · attribution, licence and provenance are kept with the copy', () => {
    const m = movies({ limit: 10, search: 'The Permitted Feature' }).items[0];
    const src = movieSources(m.id).find(s => s.providerKey === 'peertube');
    assert.equal(src.licence, 'CC BY');
    assert.equal(src.licenceUrl, 'https://creativecommons.org/licenses/by/4.0/');
    assert.equal(src.openLicence, true);
    assert.equal(src.author, 'A Director');
    assert.equal(src.sourceInstance, HOST);
    assert.match(src.sourceUrl, /^https:\/\/films\.test\/w\//);
    assert.match(src.attribution, /"The Permitted Feature"/);
    assert.match(src.attribution, /by A Director/);
    assert.match(src.attribution, /licensed CC BY/);

    /* And the raw row keeps the identity, which is what a re-derived
       playback address is rebuilt from. */
    const row = openDb().prepare(`SELECT * FROM catalogue_movie_sources
        WHERE provider_content_id = ?`).get(`${HOST}:ok-ccby`);
    assert.equal(row.external_uuid, 'ok-ccby');
    assert.equal(row.source_instance, HOST);
    assert.ok(row.last_seen_at, 'and when a sync last saw it');
  });

  test('CC0 is credited even though it need not be', () => {
    const m = movies({ limit: 10, search: 'Public Domain Picture' }).items[0];
    const src = movieSources(m.id).find(s => s.providerKey === 'peertube');
    assert.match(src.attribution, /public domain/i);
    assert.equal(src.licence, 'CC0');
  });

  test('20 · playback is remote: an address on the instance, nothing downloaded', () => {
    const m = publicMovie(movie(movies({ limit: 10, search: 'The Permitted Feature' }).items[0].id),
                          { sources: movieSources(movies({ limit: 10, search: 'The Permitted Feature' }).items[0].id) });
    const src = m.sources.find(s => s.providerKey === 'peertube');

    assert.equal(src.playbackType, 'hls');
    assert.equal(src.playable, true);
    /* The client is handed the instance's own address and opens it itself.
       Not a path on this server, and not a ticket: there is no credential to
       keep back and nothing to relay. */
    assert.match(src.url, new RegExp(`^${BASE}/`));
    assert.equal(src.playback, undefined, 'no path on this server');
    assert.equal(src.credentialed, undefined);
    assert.equal(src.local, undefined);

    /* And nothing resembling a video was fetched by the import. */
    const fetched = asked.filter(u => /\.(mp4|m3u8|mkv|webm)(\?|$)/i.test(u));
    assert.deepEqual(fetched, [], 'the importer reads JSON, never media');
  });

  test('web video gives a direct address, also remote', () => {
    const m = movies({ limit: 10, search: 'Progressive Only' }).items[0];
    const src = movieSources(m.id).find(s => s.providerKey === 'peertube');
    assert.equal(src.playbackType, 'direct');
    assert.match(src.url, /progressive-720\.mp4$/);
  });

  test('15 · running it again updates rather than duplicating', async () => {
    const before = movies({ limit: 200, provider: 'peertube' }).total;
    const got = await runImport(providerByKey('peertube').id, { fetchImpl: instanceFetch });

    assert.equal(movies({ limit: 200, provider: 'peertube' }).total, before,
      'the same videos are the same films');
    assert.equal(got.run.newItems, 0);
    assert.equal(got.run.updatedItems, PERMITTED.length);

    /* One row per instance+uuid, which is the first rung of the deduplicator
       and the reason two films with similar names cannot collide. */
    const rows = openDb().prepare(`SELECT provider_content_id, COUNT(*) n
        FROM catalogue_movie_sources WHERE provider_content_id LIKE ?
        GROUP BY provider_content_id HAVING n > 1`).all(`${HOST}:%`);
    assert.deepEqual(rows, []);
  });

  test('the same video answering two searches is counted once', async () => {
    updateSource(sourceId, { settings: { searches: ['one', 'two'] } });
    const got = await runImport(providerByKey('peertube').id, { fetchImpl: instanceFetch });
    assert.ok(got.run.skipped.duplicate >= LIBRARY.length,
      `the second search saw the same library again: ${got.run.skipped.duplicate}`);
    assert.equal(got.run.newItems, 0);
    updateSource(sourceId, { settings: {} });
  });

  test('16 · the catalogue can be filtered by source', () => {
    const mine = movies({ limit: 200, provider: 'peertube' });
    assert.equal(mine.total, PERMITTED.length);
    assert.ok(mine.items.every(m => m.sources.some(s => s.providerKey === 'peertube')));

    /* And the filter menu offers it, which is how the UI gets the option
       without knowing that PeerTube exists. */
    const offered = facets('movie').providers.map(p => p.value);
    assert.ok(offered.includes('peertube'), JSON.stringify(offered));
  });

  test('a disabled instance is not read', async () => {
    updateSource(sourceId, { enabled: false });
    const got = await runImport(providerByKey('peertube').id, { fetchImpl: instanceFetch });
    assert.equal(got.run.instancesChecked, 0);
    assert.equal(got.run.videosDiscovered, 0);
    updateSource(sourceId, { enabled: true });
  });

  test('an instance taken off the allowlist stops being read, source or no source', async () => {
    /* The case the creation-time check alone would miss: the source was
       legitimate when it was added and the list has since been tightened. */
    const was = config.peertube.allowedHosts;
    config.peertube.allowedHosts = ['somewhere.else'];
    try {
      const got = await runImport(providerByKey('peertube').id, { fetchImpl: instanceFetch });
      assert.equal(got.run.instancesChecked, 0);
      assert.equal(got.run.skipped.instanceNotAllowed, 1);
      assert.equal(got.run.videosDiscovered, 0, 'and it was never asked');
    } finally { config.peertube.allowedHosts = was; }
  });
});

describe('TMDB may improve a record but never licenses it', () => {
  test('19b · a TMDB match cannot make a refused licence importable', () => {
    /* The rule stated as a test: the licence decision is made from the
       PeerTube record alone, and admissible() has no way to be told about
       TMDB at all. A refused video with a perfect TMDB match is still
       refused. */
    const refused = video({ uuid: 'no-arr2', name: 'Arrival',
                            licence: { id: 0, label: 'All rights reserved' } });
    assert.equal(admissible(refused, { baseUrl: BASE, hosts: [HOST] }).reason, 'licence');

    /* And it is not in the catalogue, though "Arrival" is a title TMDB knows
       perfectly well. */
    assert.ok(!movies({ limit: 200, provider: 'peertube' }).items.some(m => m.title === 'Arrival'));
  });

  test('and the licence recorded on a copy is the provider\'s, not a guess', () => {
    const m = movies({ limit: 10, search: 'Share Alike Story' }).items[0];
    const src = movieSources(m.id).find(s => s.providerKey === 'peertube');
    assert.equal(src.licence, 'CC BY-SA');
    assert.equal(src.licenceUrl, LICENCES[2].url);
  });
});

describe('the rest of Telly is untouched', () => {
  test('an Xtream source is still created and validated as it was', () => {
    const src = createSource({ name: 'A Panel', kind: 'xtream', url: 'http://panel.test:8080',
                              username: 'u', password: 'p' });
    assert.equal(src.kind, 'xtream');
    assert.equal(src.url, 'http://panel.test:8080');
    /* No allowlist applies to a subscription the household pays for. */
  });

  test('and an unknown kind is still refused', () => {
    assert.throws(() => createSource({ name: 'Nope', kind: 'gopher' }), /kind must be/);
  });

  test('a source with no licence reports none, rather than claiming one', () => {
    const rows = openDb().prepare(`SELECT * FROM catalogue_movie_sources
        WHERE licence = '' LIMIT 1`).all();
    /* Nothing asserts there IS such a row here; if there is, it must not
       pretend to an open licence. */
    for (const r of rows) {
      const pub = movieSources(r.movie_id).find(s => s.id === r.id);
      assert.equal(pub.openLicence, undefined);
      assert.equal(pub.licence, undefined);
    }
  });
});
