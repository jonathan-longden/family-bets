import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createSource, syncSource, assign, updateSource, getSource } = await import('../src/services/sources.js');
const { createEpgSource, syncEpgSource, parseXmltv, xmltvTime, listEpgSources } = await import('../src/services/xmltv.js');
const { exportM3u } = await import('../src/services/library.js');
const { dueForRefresh, runOnce } = await import('../src/services/scheduler.js');
const { closeDb, openDb } = await import('../src/db/index.js');

/* A playlist with the facts a well-kept one carries: tvg-id to match a guide
   on, and the country and language the old parser dropped. */
const PLAYLIST = `#EXTM3U url-tvg="http://example.org/epg.xml"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://logo/1.png" tvg-country="UK" tvg-language="English" group-title="UK | Entertainment",BBC One HD
http://provider.example/live/u/p/1.m3u8
#EXTINF:-1 tvg-id="itv1.uk" tvg-country="UK" tvg-language="English" group-title="UK | Entertainment",ITV 1
http://provider.example/live/u/p/2.m3u8
#EXTINF:-1 tvg-id="nhk.jp" tvg-country="JP" tvg-language="Japanese" group-title="Japan",NHK World
http://provider.example/live/u/p/3.m3u8
`;

/* An XMLTV document with the awkward parts real ones have: an entity in a
   title, a comma and a colon in a description, a self-closing icon, an
   offset that is not UTC, and a programme for a channel nobody carries. */
const XMLTV = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="bbc1.uk">
    <display-name>BBC One</display-name>
    <icon src="http://logo/bbc1.png" />
  </channel>
  <channel id="itv1.uk"><display-name>ITV 1</display-name></channel>
  <channel id="unused.xx"><display-name>Nobody</display-name></channel>
  <programme start="20240301200000 +0000" stop="20240301210000 +0000" channel="bbc1.uk">
    <title>Fish &amp; Chips</title>
    <sub-title>Episode 1</sub-title>
    <desc>A programme about: fish, chips, and &lt;everything&gt; else.</desc>
    <category>Factual</category>
    <icon src="http://img/1.png" />
  </programme>
  <programme start="20240301210000 +0000" stop="20240301220000 +0000" channel="bbc1.uk">
    <title>The Ten O'Clock News</title>
  </programme>
  <programme start="20240301220000 +0100" stop="20240301230000 +0100" channel="itv1.uk">
    <title>Late Film</title>
  </programme>
  <programme start="20240301200000 +0000" stop="20240301210000 +0000" channel="unused.xx">
    <title>Not in anyone's line-up</title>
  </programme>
</tv>`;

let app, token, adminToken, sourceId, epgId;

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  const john = findByUsername('john');
  sourceId = createSource({ name: 'House playlist', kind: 'm3u_text' }).id;
  await syncSource(sourceId, { text: PLAYLIST });
  assign(john.id, sourceId);
  epgId = createEpgSource({ name: 'Test guide', url: 'http://example.org/epg.xml' }).id;
  await syncEpgSource(epgId, { text: XMLTV });
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000001', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-admin-0000001', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('reading XMLTV', () => {
  test('a time is read with its offset, and comes out as UTC', () => {
    assert.equal(xmltvTime('20240301200000 +0000'), '2024-03-01T20:00:00.000Z');
    assert.equal(xmltvTime('20240301220000 +0100'), '2024-03-01T21:00:00.000Z');
    assert.equal(xmltvTime('20240301200000'), '2024-03-01T20:00:00.000Z');
    assert.equal(xmltvTime('nonsense'), null);
  });

  test('entities and punctuation survive the parse', () => {
    const { programmes } = parseXmltv(XMLTV);
    const p = programmes.find(x => /Fish/.test(x.title));
    assert.equal(p.title, 'Fish & Chips');
    assert.equal(p.description, 'A programme about: fish, chips, and <everything> else.');
    assert.equal(p.subtitle, 'Episode 1');
    assert.equal(p.category, 'Factual');
    assert.equal(p.icon, 'http://img/1.png');
  });

  test('channels and programmes are both found, self-closing icon included', () => {
    const { channels, programmes } = parseXmltv(XMLTV);
    assert.equal(channels.length, 3);
    assert.equal(channels[0].icon, 'http://logo/bbc1.png');
    assert.equal(programmes.length, 4);
  });

  test('a truncated document gives back what it has rather than throwing', () => {
    const cut = XMLTV.slice(0, XMLTV.indexOf('<programme', XMLTV.indexOf('<programme') + 10));
    const { programmes } = parseXmltv(cut + '<programme start="2024" ');
    assert.equal(programmes.length, 1);
  });
});

describe('the guide over the API', () => {
  test('a channel\'s own programmes come back in order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/epg?tvgId=bbc1.uk&from=2024-03-01T00:00:00Z&to=2024-03-02T00:00:00Z',
      headers: auth(token)
    });
    assert.equal(res.statusCode, 200);
    const got = res.json().programmes;
    assert.deepEqual(got.map(p => p.title), ['Fish & Chips', "The Ten O'Clock News"]);
    assert.equal(got[0].startsAt, '2024-03-01T20:00:00.000Z');
  });

  test('now and next are answered for the whole line-up at once', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/epg', headers: auth(token) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok('nowNext' in body);
    // Coverage is the honest number: two of this account's three tvg-ids are
    // in the guide, and the guide's spare channel is nobody's business.
    assert.deepEqual(body.coverage, { matched: 2, total: 3 });
  });

  test('a guide refresh replaces the programmes rather than doubling them', async () => {
    const before = openDb().prepare('SELECT COUNT(*) n FROM epg_programmes').get().n;
    await syncEpgSource(epgId, { text: XMLTV });
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM epg_programmes').get().n, before);
  });

  test('a guide that will not download keeps the one already loaded', async () => {
    const before = openDb().prepare('SELECT COUNT(*) n FROM epg_programmes').get().n;
    await assert.rejects(
      syncEpgSource(epgId, { fetchImpl: async () => { throw new Error('no route to host'); } }),
      /no route to host/);
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM epg_programmes').get().n, before,
      'the programmes are still there');
    const src = listEpgSources().find(s => s.id === epgId);
    assert.match(src.last_error, /no route to host/);
    assert.equal(src.fail_count, 1);
  });
});

describe('country and language', () => {
  test('the parser keeps what the playlist said', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    const bbc = res.json().items.find(c => /BBC/.test(c.name));
    assert.equal(bbc.country, 'UK');
    assert.equal(bbc.language, 'English');
  });

  test('and they are offered as shelves to filter by', async () => {
    const c = (await app.inject({ method: 'GET', url: '/api/v1/countries', headers: auth(token) })).json();
    assert.deepEqual(c.countries, [{ name: 'UK', count: 2 }, { name: 'JP', count: 1 }]);
    const l = (await app.inject({ method: 'GET', url: '/api/v1/languages', headers: auth(token) })).json();
    assert.equal(l.languages.find(x => x.name === 'Japanese').count, 1);
  });

  test('filtering by country returns only that country', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live&country=JP', headers: auth(token) });
    assert.equal(res.json().total, 1);
    assert.equal(res.json().items[0].name, 'NHK World');
  });
});

describe('source management', () => {
  test('a source can be turned off without losing its channels', async () => {
    const before = openDb().prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ?').get(sourceId).n;
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/sources/${sourceId}`, headers: auth(adminToken),
      payload: { enabled: false }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().source.enabled, false);
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ?').get(sourceId).n, before);

    // Off means off for the client, immediately.
    const seen = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    assert.equal(seen.json().total, 0);

    updateSource(sourceId, { enabled: true });
    const back = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    assert.equal(back.json().total, 3, 'and back on without another download');
  });

  test('a refresh interval is a property of the source', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/sources/${sourceId}`, headers: auth(adminToken),
      payload: { refreshIntervalSeconds: 3600 }
    });
    assert.equal(res.json().source.refreshIntervalSeconds, 3600);
  });

  test('a source is due when its own interval has elapsed, not a global one', () => {
    const src = getSource(sourceId);
    const hourAgo = Date.now() - 3601e3;
    assert.equal(dueForRefresh({ ...src, last_synced_at: new Date(hourAgo).toISOString(), fail_count: 0 }), true);
    assert.equal(dueForRefresh({ ...src, last_synced_at: new Date().toISOString(), fail_count: 0 }), false);
    assert.equal(dueForRefresh({ ...src, enabled: 0 }), false, 'a disabled source is never due');
  });

  test('a failing source backs off rather than being hammered', () => {
    const src = { ...getSource(sourceId), fail_count: 1, last_attempt_at: new Date().toISOString() };
    assert.equal(dueForRefresh(src), false);
    const later = { ...src, last_attempt_at: new Date(Date.now() - 1000e3).toISOString() };
    assert.equal(dueForRefresh(later), true);
  });

  test('a refresh pass that fails keeps the channels and records the failure', async () => {
    const urlSource = createSource({ name: 'Flaky', kind: 'm3u_url', url: 'http://nowhere.invalid/x.m3u' });
    await syncSource(urlSource.id, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => PLAYLIST }) });
    const before = openDb().prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ?').get(urlSource.id).n;
    assert.equal(before, 3);

    openDb().prepare('UPDATE sources SET last_synced_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 999999e3).toISOString(), urlSource.id);

    const pass = await runOnce({ fetchImpl: async () => { throw new Error('upstream down'); } });
    const mine = pass.playlists.find(p => p.id === urlSource.id);
    assert.equal(mine.ok, false);
    assert.match(mine.error, /upstream down/);
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ?').get(urlSource.id).n, 3,
      'the channels it had are still there');
    assert.equal(getSource(urlSource.id).fail_count, 1);
  });
});

describe('M3U export', () => {
  test('the catalogue comes back out as a playlist another player can open', () => {
    const m3u = exportM3u({ sourceId });
    assert.match(m3u, /^#EXTM3U/);
    assert.match(m3u, /tvg-id="bbc1\.uk"/);
    assert.match(m3u, /tvg-country="UK"/);
    assert.match(m3u, /tvg-language="English"/);
    assert.match(m3u, /group-title="UK \| Entertainment",BBC One HD/);
    assert.match(m3u, /http:\/\/provider\.example\/live\/u\/p\/1\.m3u8/);
    assert.equal(m3u.split('\n').filter(l => l.startsWith('#EXTINF')).length, 3);
  });

  test('it carries real addresses, so only an administrator may ask for it', async () => {
    assert.equal((await app.inject({
      method: 'GET', url: '/api/v1/admin/sources/export.m3u', headers: auth(token)
    })).statusCode, 403);
    const ok = await app.inject({
      method: 'GET', url: '/api/v1/admin/sources/export.m3u', headers: auth(adminToken)
    });
    assert.equal(ok.statusCode, 200);
    assert.match(ok.headers['content-type'], /mpegurl/);
    assert.match(ok.body, /^#EXTM3U/);
  });
});
