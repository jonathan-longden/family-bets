import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth, SAMPLE_M3U } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createSource, syncSource, assign } = await import('../src/services/sources.js');
const { closeDb, openDb } = await import('../src/db/index.js');

let app, john, jane, sourceId;

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'john', password: 'johnspassword' });
  await createUser({ username: 'jane', password: 'janespassword' });
  john = findByUsername('john');
  jane = findByUsername('jane');

  // A source whose upstream URLs carry a provider's credentials, as real ones do.
  const src = createSource({ name: 'House playlist', kind: 'm3u_text' });
  sourceId = src.id;
  await syncSource(sourceId, { text: SAMPLE_M3U });
  assign(john.id, sourceId);          // jane is deliberately left without it
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

async function tokenFor(username, password, key = 'device-key-0000001') {
  return (await login(app, username, password, { key, name: 'TV' })).json().accessToken;
}

describe('the catalogue', () => {
  test('a synced source becomes channels, split into live and movies', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const live = (await app.inject({ url: '/api/v1/channels?kind=live', headers: auth(t) })).json();
    const movies = (await app.inject({ url: '/api/v1/channels?kind=movie', headers: auth(t) })).json();
    assert.equal(live.total, 2);
    assert.equal(movies.total, 1);
    assert.equal(movies.items[0].name, 'Casablanca');
  });

  test('the placeholder entry never became a channel', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const all = (await app.inject({ url: '/api/v1/channels?limit=100', headers: auth(t) })).json();
    assert.ok(!all.items.some(c => c.name === 'NHK BSP4K'));
  });

  test('THE PROVIDER CREDENTIALS NEVER REACH A CLIENT', async () => {
    const t = await tokenFor('john', 'johnspassword');
    for (const url of ['/api/v1/channels?limit=100', '/api/v1/categories', '/api/v1/playlists', '/api/v1/me']) {
      const body = (await app.inject({ url, headers: auth(t) })).body;
      assert.ok(!body.includes('secretuser'), `${url} leaked the provider username`);
      assert.ok(!body.includes('secretpass'), `${url} leaked the provider password`);
      assert.ok(!body.includes('provider.example'), `${url} leaked the upstream address`);
    }
  });

  test('categories come back with counts', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const cats = (await app.inject({ url: '/api/v1/categories?kind=live', headers: auth(t) })).json();
    assert.deepEqual(cats.categories.map(c => c.name).sort(), ['UK | Entertainment', 'UK | Sport']);
    assert.equal(cats.categories[0].count, 1);
  });

  test('search filters by name', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const res = (await app.inject({ url: '/api/v1/channels?search=sky', headers: auth(t) })).json();
    assert.equal(res.total, 1);
    assert.match(res.items[0].name, /Sky Sports/);
  });

  test('a user with no source assigned sees an empty catalogue, not somebody else\'s', async () => {
    const t = await tokenFor('jane', 'janespassword', 'device-key-0000002');
    const res = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json();
    assert.equal(res.total, 0);
    assert.deepEqual(res.items, []);
  });
});

describe('playback tickets', () => {
  test('an entitled user gets a ticket, and it is not the stream address', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const ch = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items[0];
    const res = await app.inject({ method: 'POST', url: `/api/v1/stream/${ch.id}/ticket`, headers: auth(t) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.match(body.url, /^\/api\/v1\/stream\/\d+\?ticket=/);
    assert.ok(!body.url.includes('provider.example'));
    assert.ok(!body.url.includes('secretpass'));
  });

  test('the ticket redirects to the real stream, so the player never held the credentials', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const ch = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items[0];
    const { url } = (await app.inject({ method: 'POST', url: `/api/v1/stream/${ch.id}/ticket`, headers: auth(t) })).json();
    const play = await app.inject({ url });               // no Authorization header: a player cannot send one
    assert.equal(play.statusCode, 302);
    assert.match(play.headers.location, /^http:\/\/provider\.example\/live\/secretuser\/secretpass\/1\.m3u8$/);
  });

  test('an edited ticket is refused', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const ch = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items[0];
    const { url } = (await app.inject({ method: 'POST', url: `/api/v1/stream/${ch.id}/ticket`, headers: auth(t) })).json();
    const tampered = url.replace(/ticket=([^.]+)\./, 'ticket=999.');
    const res = await app.inject({ url: tampered });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'forbidden');
  });

  test('a ticket for one channel will not open another', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const items = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items;
    const { url } = (await app.inject({ method: 'POST', url: `/api/v1/stream/${items[0].id}/ticket`, headers: auth(t) })).json();
    const swapped = url.replace(`/stream/${items[0].id}?`, `/stream/${items[1].id}?`);
    const res = await app.inject({ url: swapped });
    assert.equal(res.statusCode, 403);
  });

  test('a user cannot get a ticket for a channel they are not entitled to', async () => {
    const jt = await tokenFor('jane', 'janespassword', 'device-key-0000002');
    const anyChannel = openDb().prepare('SELECT id FROM channels LIMIT 1').get().id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/stream/${anyChannel}/ticket`, headers: auth(jt) });
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /not part of your subscription/);
  });

  test('a revoked device cannot use a ticket it already holds', async () => {
    const t = await tokenFor('john', 'johnspassword');
    const ch = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items[0];
    const { url } = (await app.inject({ method: 'POST', url: `/api/v1/stream/${ch.id}/ticket`, headers: auth(t) })).json();
    const devices = (await app.inject({ url: '/api/v1/me/devices', headers: auth(t) })).json().devices;
    await app.inject({ method: 'DELETE', url: `/api/v1/me/devices/${devices[0].id}`, headers: auth(t) });
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error.message, /removed from the account/);
  });
});

describe('favourites, recent and settings', () => {
  test('favourites survive a new session and belong to one user only', async () => {
    const t = await tokenFor('john', 'johnspassword', 'device-key-0000003');
    const ch = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items[0];
    await app.inject({ method: 'PUT', url: `/api/v1/me/favourites/${ch.id}`, headers: auth(t) });

    const t2 = await tokenFor('john', 'johnspassword', 'device-key-0000003');
    const mine = (await app.inject({ url: '/api/v1/me/favourites', headers: auth(t2) })).json();
    assert.equal(mine.channels.length, 1);

    const jt = await tokenFor('jane', 'janespassword', 'device-key-0000002');
    const hers = (await app.inject({ url: '/api/v1/me/favourites', headers: auth(jt) })).json();
    assert.equal(hers.channels.length, 0);
  });

  test('playing a channel records it as recently watched', async () => {
    const t = await tokenFor('john', 'johnspassword', 'device-key-0000003');
    const ch = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json().items[1];
    await app.inject({ method: 'POST', url: `/api/v1/stream/${ch.id}/ticket`, headers: auth(t) });
    const recent = (await app.inject({ url: '/api/v1/me/recent', headers: auth(t) })).json();
    assert.ok(recent.channels.some(c => c.id === ch.id));
  });

  test('settings are per user and come back as they went in', async () => {
    const t = await tokenFor('john', 'johnspassword', 'device-key-0000003');
    await app.inject({ method: 'PUT', url: '/api/v1/me/settings', headers: auth(t), payload: { uiScale: 'large', motion: 'reduced' } });
    const got = (await app.inject({ url: '/api/v1/me/settings', headers: auth(t) })).json();
    assert.deepEqual(got.settings, { uiScale: 'large', motion: 'reduced' });
  });
});
