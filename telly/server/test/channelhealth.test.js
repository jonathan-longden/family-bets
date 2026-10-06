import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createSource, syncSource, assign } = await import('../src/services/sources.js');
const { record, sweep, classify, checkImported, healthSummary, plainStatus,
        STATUS, VISIBLE, HIDDEN, nextCheckDue } = await import('../src/services/health.js');
const { closeDb, openDb } = await import('../src/db/index.js');

/**
 * Hiding what does not work, and bringing it back when it does.
 *
 * Five channels standing in for the five things a public playlist contains:
 * one that plays, one that answers with a web page, one that cannot be
 * reached at all, one that answers with raw transport-stream bytes no browser
 * can decode, and one published over rtmp. Nothing here touches the network —
 * the probe is a function in the test — so what is being tested is the rule,
 * not somebody else's server.
 */
const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="great.uk" tvg-name="GREAT! movies" tvg-logo="http://logo/great.png" tvg-country="UK" tvg-language="English" group-title="Movies",GREAT! movies
http://streams.example/great/index.m3u8
#EXTINF:-1 tvg-id="gone.uk" tvg-country="UK" group-title="Entertainment",Gone Channel
http://streams.example/gone/index.m3u8
#EXTINF:-1 tvg-id="dead.uk" tvg-country="UK" group-title="News",Dead Channel
http://streams.example/dead/index.m3u8
#EXTINF:-1 tvg-id="cult.de" tvg-name="Pluto TV Cult Films" tvg-country="DE" group-title="Movies",Pluto TV Cult Films (Germany)
http://streams.example/cult/stream.ts
#EXTINF:-1 tvg-id="old.uk" tvg-country="UK" group-title="Entertainment",Old Protocol
rtmp://streams.example/old/live
`;

/* The stand-in probe: what each of those addresses answers with. */
async function probe(url) {
  if (url.startsWith('rtmp://')) {
    return { ok: false, url, responseTimeMs: 0, method: 'address', incompatible: true,
             reason: 'A rtmp:// stream cannot be opened by a browser. A player such as VLC can.' };
  }
  if (url.includes('/great/')) return { ok: true, kind: 'hls', url, responseTimeMs: 120 };
  if (url.includes('/cult/')) return { ok: true, kind: 'mpegts', url, responseTimeMs: 200 };
  if (url.includes('/gone/')) return { ok: false, url, responseTimeMs: 90,
                                       reason: 'The server answered with a web page, not a stream.' };
  return { ok: false, url, responseTimeMs: 0, reason: 'Could not reach the stream: ECONNREFUSED' };
}

let app, token, adminToken, sourceId, john;
const idOf = (name) => openDb().prepare('SELECT id FROM channels WHERE name = ? AND active = 1').get(name).id;
const rowOf = (name) => openDb().prepare('SELECT * FROM channels WHERE name = ? AND active = 1').get(name);
/* Everything the Live TV screen offers. A channel filed under "Movies" by the
   publisher is a film channel, which Telly shows in Live TV under that
   heading — it is not a film in the library — so both kinds are asked for,
   exactly as the app asks for them. */
const liveNames = async () => {
  const out = [];
  for (const kind of ['live', 'movie']) {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/channels?kind=${kind}&limit=100`, headers: auth(token) });
    out.push(...res.json().items.map(c => c.name));
  }
  return out.sort();
};

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  john = findByUsername('john');
  sourceId = createSource({ name: 'UK playlist', kind: 'm3u_text' }).id;
  await syncSource(sourceId, { text: PLAYLIST });
  assign(john.id, sourceId);
  token = (await login(app, 'john', 'johnspassword', { key: 'dev-john-00000002', name: 'TV' })).json().accessToken;
  adminToken = (await login(app, 'admin', 'adminpassword', { key: 'dev-admin-0000002', name: 'PC' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('an import keeps everything and then finds out what plays', () => {
  test('everything the playlist named is in the database', () => {
    const n = openDb().prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ?').get(sourceId).n;
    assert.equal(n, 5);
    const live = openDb().prepare("SELECT COUNT(*) n FROM channels WHERE health_status = 'unchecked'").get().n;
    assert.equal(live, 5, 'nothing has been looked at yet');
  });

  test('and until it has been checked, it is all offered', async () => {
    assert.equal((await liveNames()).length, 5, 'an unchecked library is not an empty screen');
  });

  test('checking what the import brought in sorts them out', async () => {
    const counts = await checkImported({ sourceId, checker: probe, concurrency: 2 });
    assert.equal(counts.checked, 5);
    assert.deepEqual(
      { working: counts.working, unavailable: counts.unavailable, incompatible: counts.browser_incompatible },
      { working: 1, unavailable: 2, incompatible: 2 });
  });

  test('a working channel is what Live TV offers', async () => {
    assert.deepEqual(await liveNames(), ['GREAT! movies']);
  });

  test('a channel that does not work is still in SQLite, with everything the playlist said', () => {
    const gone = rowOf('Gone Channel');
    assert.ok(gone, 'not deleted');
    assert.equal(gone.tvg_id, 'gone.uk');
    assert.equal(gone.group_title, 'Entertainment');
    assert.equal(gone.country, 'UK');
    assert.equal(gone.stream_url, 'http://streams.example/gone/index.m3u8');
    assert.equal(gone.active, 1, 'the playlist still carries it');
    assert.equal(gone.health_status, STATUS.temporary);
    assert.match(gone.failure_reason, /web page/);
  });

  test('nothing anywhere in the source was deleted by checking it', () => {
    const n = openDb().prepare('SELECT COUNT(*) n FROM channels WHERE source_id = ?').get(sourceId).n;
    assert.equal(n, 5);
  });
});

describe('reachable but unplayable here is its own answer', () => {
  test('raw transport-stream bytes are browser_incompatible, not offline', () => {
    const cult = rowOf('Pluto TV Cult Films (Germany)');
    assert.equal(cult.health_status, STATUS.incompatible);
    assert.equal(cult.health_status, 'browser_incompatible');
    assert.equal(cult.consecutive_failures, 0, 'it answered — it is not failing');
    assert.match(cult.failure_reason, /no browser can decode/);
    assert.ok(!/offline|unavailable/i.test(cult.failure_reason), 'and it does not claim to be off');
  });

  test('so is an rtmp address, and for the same reason', () => {
    const old = rowOf('Old Protocol');
    assert.equal(old.health_status, 'browser_incompatible');
    assert.match(old.failure_reason, /VLC/);
    assert.equal(old.consecutive_failures, 0);
  });

  test('a manifest that happens to carry mpegts segments is still playable', () => {
    const asManifest = classify({ ok: true, kind: 'mpegts' }, 'http://x/y.m3u8');
    assert.equal(asManifest.status, STATUS.working, 'hls.js plays this');
    const bare = classify({ ok: true, kind: 'mpegts' }, 'http://x/stream.ts');
    assert.equal(bare.status, 'browser_incompatible');
  });

  test('both are hidden from Live TV, and both are kept', async () => {
    const names = await liveNames();
    assert.ok(!names.includes('Pluto TV Cult Films (Germany)'));
    assert.ok(!names.includes('Old Protocol'));
    assert.ok(rowOf('Pluto TV Cult Films (Germany)'));
    assert.ok(rowOf('Old Protocol'));
  });

  test('the plain words the API speaks', () => {
    assert.equal(plainStatus('working'), 'working');
    assert.equal(plainStatus('browser_incompatible'), 'browser_incompatible');
    assert.equal(plainStatus('unchecked'), 'unknown');
    assert.equal(plainStatus('temporarily_unavailable'), 'unavailable');
    assert.equal(plainStatus('failed'), 'unavailable');
  });
});

describe('a channel that was working is given the benefit of the doubt', () => {
  const name = 'GREAT! movies';

  test('one bad check does not take it off the list', async () => {
    const status = record(idOf(name), { ok: false, url: 'http://x', reason: 'timed out' });
    assert.equal(status, STATUS.working, 'still shown');
    assert.equal(rowOf(name).consecutive_failures, 1, 'but the failure is on the record');
    assert.ok((await liveNames()).includes(name));
  });

  test('and it is looked at again soon rather than tomorrow', () => {
    const row = rowOf(name);
    assert.equal(nextCheckDue(row, Date.parse(row.last_checked_at) + 31 * 60e3), true);
  });

  test('the second one does', async () => {
    const status = record(idOf(name), { ok: false, url: 'http://x', reason: 'timed out' });
    assert.equal(status, STATUS.temporary);
    assert.ok(!(await liveNames()).includes(name));
    assert.equal(rowOf(name).active, 1, 'hidden, not deactivated');
  });

  test('a third makes it failed, and still nothing is deleted', () => {
    assert.equal(record(idOf(name), { ok: false, url: 'http://x', reason: 'timed out' }), STATUS.failed);
    const row = rowOf(name);
    assert.equal(row.consecutive_failures, 3);
    assert.equal(row.tvg_id, 'great.uk', 'and it is still the channel the playlist described');
    assert.equal(row.logo, 'http://logo/great.png');
  });

  test('one good check brings it straight back', async () => {
    const before = rowOf(name).last_success_at;
    const status = record(idOf(name), { ok: true, kind: 'hls', url: 'http://x/y.m3u8', responseTimeMs: 140 });
    assert.equal(status, STATUS.working);
    const row = rowOf(name);
    assert.equal(row.consecutive_failures, 0);
    assert.equal(row.consecutive_successes, 1);
    assert.equal(row.failure_reason, '');
    assert.equal(row.response_time_ms, 140);
    assert.notEqual(row.last_success_at, before, 'and last worked at is now');
    assert.ok((await liveNames()).includes(name), 'back on the list without anybody resyncing');
  });

  test('a channel nobody has seen working has no grace to spend', () => {
    const id = idOf('Dead Channel');
    assert.equal(rowOf('Dead Channel').health_status, STATUS.temporary);
    assert.equal(record(id, { ok: false, url: 'http://x', reason: 'ECONNREFUSED' }), STATUS.temporary);
    assert.equal(record(id, { ok: false, url: 'http://x', reason: 'ECONNREFUSED' }), STATUS.failed);
  });
});

describe('a refresh does not undo what is known', () => {
  test('re-importing the same playlist leaves every health record where it was', async () => {
    const before = openDb().prepare(`SELECT name, health_status, consecutive_failures, last_success_at
        FROM channels WHERE source_id = ? ORDER BY name`).all(sourceId);
    const r = await syncSource(sourceId, { text: PLAYLIST });
    assert.equal(r.updated, 5, 'the same five rows, not five new ones');
    assert.equal(r.added, 0);
    const after = openDb().prepare(`SELECT name, health_status, consecutive_failures, last_success_at
        FROM channels WHERE source_id = ? ORDER BY name`).all(sourceId);
    assert.deepEqual(after, before);
  });

  test('so a known-bad channel is not resurrected onto Live TV by a sync', async () => {
    assert.deepEqual(await liveNames(), ['GREAT! movies']);
    assert.equal(rowOf('Dead Channel').health_status, STATUS.failed);
  });

  test('and the check a sync starts only looks at what has never been checked', async () => {
    const seen = [];
    await checkImported({ sourceId, checker: async (url) => { seen.push(url); return probe(url); } });
    assert.deepEqual(seen, [], 'all five already have a history');
  });

  test('a channel whose address changes is a new stream, so it is checked', async () => {
    await syncSource(sourceId, { text: PLAYLIST.replace('/dead/index.m3u8', '/dead/v2.m3u8') });
    const fresh = openDb().prepare(`SELECT name, health_status FROM channels
        WHERE source_id = ? AND stream_url LIKE '%/dead/v2%'`).get(sourceId);
    assert.equal(fresh.health_status, STATUS.unchecked);
    const seen = [];
    await checkImported({ sourceId, checker: async (url) => { seen.push(url); return probe(url); } });
    assert.deepEqual(seen, ['http://streams.example/dead/v2.m3u8']);
    /* And the old address is kept too — inactive, with its history intact. */
    const old = openDb().prepare(`SELECT * FROM channels WHERE source_id = ?
        AND stream_url = 'http://streams.example/dead/index.m3u8'`).get(sourceId);
    assert.ok(old, 'nothing is deleted, ever');
    assert.equal(old.active, 0);
    assert.equal(old.health_status, STATUS.failed);
  });
});

describe('what the settings screen is told', () => {
  test('the five figures the brief asks for', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/health-summary', headers: auth(adminToken) });
    assert.equal(res.statusCode, 200);
    const s = res.json().sources.find(x => x.id === sourceId).health;
    assert.equal(s.imported, 6, 'five channels and the retired address');
    assert.equal(s.working, 1);
    assert.equal(s.unavailable, s.temporarily_unavailable + s.failed);
    assert.equal(s.browser_incompatible, 2);
    assert.ok(s.lastHealthAt, 'when it was last checked');
    assert.equal(s.visible + s.hidden, s.imported, 'everything is one or the other');
  });

  test('the hidden channels can be listed, which is only possible because they are kept', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/admin/sources/${sourceId}/channels?state=hidden`, headers: auth(adminToken) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    const names = body.items.map(c => c.name);
    assert.ok(names.includes('Pluto TV Cult Films (Germany)'));
    assert.ok(names.includes('Dead Channel'));
    assert.ok(!names.includes('GREAT! movies'));
    const cult = body.items.find(c => c.name === 'Pluto TV Cult Films (Germany)');
    assert.equal(cult.healthState, 'browser_incompatible');
    assert.match(cult.failureReason, /no browser can decode/);
    /* Everything the playlist said about it, still there to be shown. */
    assert.equal(cult.tvgId, 'cult.de');
    assert.equal(cult.group, 'Movies');
    assert.equal(cult.country, 'DE');
  });

  test('and the incompatible ones on their own, said as what they are', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/admin/sources/${sourceId}/channels?state=incompatible`, headers: auth(adminToken) });
    assert.deepEqual(res.json().items.map(c => c.name).sort(),
      ['Old Protocol', 'Pluto TV Cult Films (Germany)']);
  });

  test('an ordinary account cannot see the hidden list', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/admin/sources/${sourceId}/channels`, headers: auth(token) });
    assert.equal(res.statusCode, 403);
  });

  test('a channel the API hands out never carries its stream address', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/admin/sources/${sourceId}/channels?state=any`, headers: auth(adminToken) });
    for (const c of res.json().items) {
      assert.ok(!('streamUrl' in c) && !('stream_url' in c), c.name);
    }
  });
});

describe('the sweep that brings channels back on its own', () => {
  test('a failed channel is rechecked on a widening interval, never dropped', () => {
    const base = Date.now();
    const at = (ms, fails) => ({ last_checked_at: new Date(base - ms).toISOString(),
                                 health_status: STATUS.failed, consecutive_failures: fails });
    assert.equal(nextCheckDue(at(10 * 60e3, 1), base), false);
    assert.equal(nextCheckDue(at(31 * 60e3, 1), base), true);
    assert.equal(nextCheckDue(at(31 * 60e3, 4), base), false, 'four failures in, it waits longer');
    assert.equal(nextCheckDue(at(25 * 3600e3, 99), base), true, 'but it is always rechecked eventually');
  });

  test('a browser-incompatible channel is left alone like a working one', () => {
    const base = Date.now();
    const row = { last_checked_at: new Date(base - 2 * 3600e3).toISOString(),
                  health_status: 'browser_incompatible', consecutive_failures: 0 };
    assert.equal(nextCheckDue(row, base), false, 'a container does not heal in an hour');
  });

  test('and when the stream comes back, the sweep alone puts it back on the list', async () => {
    const dead = idOf('Dead Channel');
    record(dead, { ok: false, url: 'http://x', reason: 'still nothing' });
    assert.ok(!(await liveNames()).includes('Dead Channel'));

    /* Nobody resyncs anything: the scheduled sweep finds it answering. */
    const counts = await sweep({ sourceId, force: true, checker: async (url) =>
      (url.includes('/dead/') ? { ok: true, kind: 'hls', url, responseTimeMs: 75 } : probe(url)) });
    assert.ok(counts.working >= 2);
    const names = await liveNames();
    assert.ok(names.includes('Dead Channel'), 'back, without anybody asking');
    /* By id, because the retired address is still a row called Dead Channel —
       which is the whole point: it was kept. */
    const live = openDb().prepare('SELECT * FROM channels WHERE id = ?').get(dead);
    assert.equal(live.health_status, STATUS.working);
    assert.equal(live.consecutive_failures, 0);
    assert.ok(live.last_success_at);
  });

  test('the visible and hidden lists between them account for every status', () => {
    const all = [...VISIBLE, ...HIDDEN].sort();
    assert.deepEqual(all, Object.values(STATUS).sort(), 'no status is unaccounted for');
  });
});
