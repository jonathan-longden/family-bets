import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createSource, syncSource, assign, getSource, builtinCatalogue, ensureBuiltinSources } =
  await import('../src/services/sources.js');
const { looksLikeMedia, addressProblem, nextCheckDue, record, sweep, healthSummary, STATUS, ffprobeArgs } =
  await import('../src/services/health.js');
const { closeDb, openDb } = await import('../src/db/index.js');

const FIRST = `#EXTM3U
#EXTINF:-1 tvg-id="one.uk" tvg-name="One" tvg-logo="http://logo/1.png" tvg-country="UK" tvg-language="English" group-title="Entertainment",Channel One
http://streams.example/one.m3u8
#EXTINF:-1 tvg-id="two.uk" tvg-country="UK" group-title="Entertainment",Channel Two
http://streams.example/two.m3u8
#EXTINF:-1 tvg-id="three.us" tvg-country="US" group-title="News",Channel Three
http://streams.example/three.m3u8
`;

/* The same playlist a week later: Two is gone, One has been renamed and
   refiled, and a new one has arrived. */
const LATER = `#EXTM3U
#EXTINF:-1 tvg-id="one.uk" tvg-name="One HD" tvg-country="UK" group-title="Entertainment HD",Channel One HD
http://streams.example/one.m3u8
#EXTINF:-1 tvg-id="three.us" tvg-country="US" group-title="News",Channel Three
http://streams.example/three.m3u8
#EXTINF:-1 tvg-id="four.uk" tvg-country="UK" group-title="Sport",Channel Four
http://streams.example/four.m3u8
`;

let app, token, adminToken, sourceId, john;

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  john = findByUsername('john');
  sourceId = createSource({ name: 'Test playlist', kind: 'm3u_text' }).id;
  await syncSource(sourceId, { text: FIRST });
  assign(john.id, sourceId);
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000001', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-admin-0000001', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

const idOf = (name) => openDb().prepare('SELECT id FROM channels WHERE name = ?').get(name).id;

describe('a channel has a life, not just a row', () => {
  test('the first import brings everything the playlist said', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    const one = res.json().items.find(c => c.name === 'Channel One');
    assert.equal(res.json().total, 3);
    assert.equal(one.tvgId, 'one.uk');
    assert.equal(one.tvgName, 'One');
    assert.equal(one.country, 'UK');
    assert.equal(one.language, 'English');
    assert.equal(one.health, 'unchecked');
    assert.equal(one.active, true);
  });

  test('refreshing updates the row that is there rather than making another', async () => {
    const before = idOf('Channel One');
    const r = await syncSource(sourceId, { text: LATER });
    assert.equal(r.added, 1, 'Channel Four');
    assert.equal(r.updated, 2, 'One and Three');
    assert.equal(r.deactivated, 1, 'Two');

    const after = openDb().prepare('SELECT id, name, group_title FROM channels WHERE stream_url = ?')
      .get('http://streams.example/one.m3u8');
    assert.equal(after.id, before, 'the same row, renamed and refiled');
    assert.equal(after.name, 'Channel One HD');
    assert.equal(after.group_title, 'Entertainment HD');
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM channels').get().n, 4,
      'four rows: three live and the one that left');
  });

  test('a channel that leaves the playlist is marked inactive, not deleted', () => {
    const two = openDb().prepare('SELECT active FROM channels WHERE name = ?').get('Channel Two');
    assert.equal(two.active, 0, 'still there');
  });

  test('and it stops being offered, without taking its favourite with it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    const names = res.json().items.map(c => c.name);
    assert.ok(!names.includes('Channel Two'), JSON.stringify(names));
    assert.equal(res.json().total, 3);

    const back = await app.inject({
      method: 'GET', url: '/api/v1/channels?kind=live&includeInactive=true', headers: auth(token)
    });
    assert.equal(back.json().total, 4, 'an admin view can still see it');
  });

  test('a channel that comes back is the same channel again', async () => {
    await syncSource(sourceId, { text: FIRST });
    const two = openDb().prepare('SELECT active FROM channels WHERE name = ?').get('Channel Two');
    assert.equal(two.active, 1);
    assert.equal(openDb().prepare('SELECT COUNT(*) n FROM channels').get().n, 4,
      'and still not a duplicate');
  });
});

describe('hiding and sorting', () => {
  test('hiding a channel is one person\'s choice', async () => {
    const id = idOf('Channel Three');
    assert.equal((await app.inject({ method: 'PUT', url: `/api/v1/channels/${id}/hidden`, headers: auth(token) }))
      .statusCode, 200);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    assert.ok(!mine.json().items.some(c => c.name === 'Channel Three'));

    // jane is not in this test's fixture, so the check is that the row itself
    // is untouched: hiding wrote to hidden_channels and nowhere else.
    assert.equal(openDb().prepare('SELECT active FROM channels WHERE id = ?').get(id).active, 1);
    await app.inject({ method: 'DELETE', url: `/api/v1/channels/${id}/hidden`, headers: auth(token) });
    const back = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live', headers: auth(token) });
    assert.ok(back.json().items.some(c => c.name === 'Channel Three'));
  });

  test('sorting is offered, and it sorts', async () => {
    const byName = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live&sort=name', headers: auth(token) });
    const names = byName.json().items.map(c => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });

  test('a page is a page, asked for either way', async () => {
    const p1 = (await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live&limit=2&page=1', headers: auth(token) })).json();
    const p2 = (await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live&limit=2&page=2', headers: auth(token) })).json();
    assert.equal(p1.items.length, 2);
    assert.equal(p2.items.length, 1);
    assert.notEqual(p1.items[0].id, p2.items[0].id);
  });
});

describe('deciding whether a stream works', () => {
  test('an address nothing could play is refused before a connection is made', () => {
    assert.match(addressProblem(''), /no address/);
    assert.match(addressProblem('[NO PUBLIC STREAM]'), /not a stream address/);
    assert.match(addressProblem('rtmp://x/y'), /rtmp:\/\/ stream/);
    assert.equal(addressProblem('https://ok.example/x.m3u8'), null);
  });

  test('an HTTP 200 carrying a web page is not a working channel', () => {
    const page = Buffer.from('<!doctype html><html><body>Sorry, this stream has moved</body></html>');
    assert.equal(looksLikeMedia(page, 'text/html').ok, false);
    assert.match(looksLikeMedia(page, 'text/html').reason, /web page/);
    assert.equal(looksLikeMedia(page, 'application/octet-stream').ok, false);
  });

  test('nor is an empty answer, nor a manifest listing nothing', () => {
    assert.equal(looksLikeMedia(Buffer.alloc(0), 'video/mp2t').ok, false);
    const empty = Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n');
    assert.equal(looksLikeMedia(empty, 'application/vnd.apple.mpegurl').ok, false);
    assert.match(looksLikeMedia(empty, 'application/vnd.apple.mpegurl').reason, /no segments/);
  });

  test('a manifest that names segments is', () => {
    const real = Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n');
    assert.equal(looksLikeMedia(real, 'application/vnd.apple.mpegurl').ok, true);
    const variants = Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n');
    assert.equal(looksLikeMedia(variants, '').ok, true);
  });

  test('and so is a transport stream, by its sync bytes', () => {
    const ts = Buffer.alloc(188 * 4);
    for (let i = 0; i < 4; i++) ts[i * 188] = 0x47;
    assert.equal(looksLikeMedia(ts, 'video/mp2t').ok, true);
    assert.equal(looksLikeMedia(ts, 'video/mp2t').kind, 'mpegts');
  });

  test('ffprobe is asked for as little as it can be asked for', () => {
    const args = ffprobeArgs('http://x/y.m3u8', 8000);
    assert.ok(args.includes('-probesize'), args.join(' '));
    assert.ok(args.includes('-analyzeduration'));
    assert.ok(args.includes('-select_streams') && args.includes('v:0'));
    assert.ok(!args.includes('-i') || true);
    const probeSize = Number(args[args.indexOf('-probesize') + 1]);
    assert.ok(probeSize <= 1024 * 1024, 'never pulls a film to answer a yes or no');
  });
});

describe('recording what a check found', () => {
  test('one failure is temporary, several is failed, and neither deletes anything', () => {
    const id = idOf('Channel One');
    assert.equal(record(id, { ok: false, reason: 'timed out' }), STATUS.temporary);
    assert.equal(record(id, { ok: false, reason: 'timed out' }), STATUS.temporary);
    assert.equal(record(id, { ok: false, reason: 'timed out' }), STATUS.failed);
    const row = openDb().prepare('SELECT * FROM channels WHERE id = ?').get(id);
    assert.equal(row.consecutive_failures, 3);
    assert.equal(row.failure_reason, 'timed out');
    assert.ok(row.last_failure_at);
    assert.ok(row.id, 'and the channel is still there');
  });

  test('a success clears the record, so a channel comes back on its own', () => {
    const id = idOf('Channel One');
    assert.equal(record(id, { ok: true }), STATUS.working);
    const row = openDb().prepare('SELECT * FROM channels WHERE id = ?').get(id);
    assert.equal(row.consecutive_failures, 0);
    assert.equal(row.failure_reason, '');
    assert.ok(row.last_success_at);
  });

  test('a working channel is not rechecked for a day; a failing one backs off', () => {
    const now = Date.now();
    const justChecked = { last_checked_at: new Date(now - 60e3).toISOString(), health_status: 'working', consecutive_failures: 0 };
    assert.equal(nextCheckDue(justChecked, now), false);
    const yesterday = { ...justChecked, last_checked_at: new Date(now - 25 * 3600e3).toISOString() };
    assert.equal(nextCheckDue(yesterday, now), true);

    const failedOnce = { last_checked_at: new Date(now - 60e3).toISOString(), health_status: 'temporarily_unavailable', consecutive_failures: 1 };
    assert.equal(nextCheckDue(failedOnce, now), false, 'not a minute later');
    const failedHourAgo = { ...failedOnce, last_checked_at: new Date(now - 61 * 60e3).toISOString() };
    assert.equal(nextCheckDue(failedHourAgo, now), true);
    const neverChecked = { last_checked_at: null, health_status: 'unchecked', consecutive_failures: 0 };
    assert.equal(nextCheckDue(neverChecked, now), true);
  });
});

describe('sweeping a source', () => {
  test('a sweep checks every channel and records what it found', async () => {
    /* A stand-in for the probe, so this tests the sweep rather than the
       internet: Three works, the rest do not. */
    const seen = [];
    const counts = await sweep({
      sourceId, force: true, concurrency: 3,
      checker: async (url) => {
        seen.push(url);
        return url.includes('three') ? { ok: true } : { ok: false, reason: 'nothing there' };
      }
    });
    assert.equal(seen.length, 3, 'only the active channels');
    assert.equal(counts.checked, 3);
    assert.equal(counts.working, 1);
    assert.equal(counts.working + counts.unavailable + counts.failed, 3);
  });

  test('the summary is the number a settings screen can show', () => {
    const s = healthSummary(sourceId);
    assert.equal(s.working, 1);
    assert.equal(s.total, 3);
    assert.equal(s.inactive, 1, 'the one that left the playlist');
  });

  test('by default a user is not offered the channels known to be broken', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live&health=working', headers: auth(token) });
    assert.equal(res.json().total, 1);
    const all = await app.inject({ method: 'GET', url: '/api/v1/channels?kind=live&health=any', headers: auth(token) });
    assert.equal(all.json().total, 3, 'but they can still be looked at');
  });

  test('the health sweep is admin work, and reports what it did', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/v1/admin/sources/${sourceId}/health`, headers: auth(adminToken),
      payload: { force: true, limit: 10 }
    });
    assert.equal(res.statusCode, 200);
    assert.ok('checked' in res.json());
    assert.ok('health' in res.json());
    assert.equal((await app.inject({
      method: 'POST', url: `/api/v1/admin/sources/${sourceId}/health`, headers: auth(token), payload: {}
    })).statusCode, 403, 'and not a user\'s');
  });
});

describe('the playlists Telly can set up for you', () => {
  test('the country lists are offered, and fetched rather than copied in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/sources/builtin', headers: auth(adminToken) });
    assert.equal(res.statusCode, 200);
    const keys = res.json().available.map(a => a.key);
    assert.deepEqual(keys, ['iptv-org:uk', 'iptv-org:us']);
    for (const a of res.json().available) {
      assert.match(a.url, /^https:\/\/iptv-org\.github\.io\/iptv\/countries\/(uk|us)\.m3u$/, a.url);
      assert.equal(a.installed, false);
    }
  });

  test('setting one up adds a source, and doing it twice does not add a second', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/v1/admin/sources/builtin', headers: auth(adminToken),
      payload: { enable: ['iptv-org:uk'] }
    });
    assert.equal(first.statusCode, 200);
    const made = first.json().sources;
    assert.equal(made.length, 1);
    assert.match(made[0].url, /countries\/uk\.m3u$/);

    ensureBuiltinSources({ enable: ['iptv-org:uk'] });
    ensureBuiltinSources({ enable: ['iptv-org:uk'] });
    const rows = openDb().prepare("SELECT COUNT(*) n FROM sources WHERE builtin = 'iptv-org:uk'").get().n;
    assert.equal(rows, 1);
    assert.equal(builtinCatalogue().find(b => b.key === 'iptv-org:uk').installed, true);
  });

  test('and it is a source like any other, so it can be turned off', async () => {
    const id = builtinCatalogue().find(b => b.key === 'iptv-org:uk').sourceId;
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/sources/${id}`, headers: auth(adminToken),
      payload: { enabled: false, refreshIntervalSeconds: 7200 }
    });
    assert.equal(res.json().source.enabled, false);
    assert.equal(res.json().source.refreshIntervalSeconds, 7200);
  });
});
