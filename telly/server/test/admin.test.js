import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth, SAMPLE_M3U } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser, findByUsername } = await import('../src/services/users.js');
const { createSource, syncSource } = await import('../src/services/sources.js');
const { closeDb } = await import('../src/db/index.js');

let app, adminToken, sourceId;

before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'boss', password: 'bosspassword', role: 'admin' });
  await createUser({ username: 'john', password: 'johnspassword' });
  const src = createSource({ name: 'House playlist', kind: 'm3u_text' });
  sourceId = src.id;
  await syncSource(sourceId, { text: SAMPLE_M3U });
  adminToken = (await login(app, 'boss', 'bosspassword', { key: 'admin-device-001' })).json().accessToken;
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('who may administer', () => {
  test('an ordinary user is refused every admin endpoint', async () => {
    const t = (await login(app, 'john', 'johnspassword', { key: 'john-device-001' })).json().accessToken;
    for (const [method, url] of [['GET', '/api/v1/admin/users'], ['GET', '/api/v1/admin/sources'], ['GET', '/api/v1/admin/audit']]) {
      const res = await app.inject({ method, url, headers: auth(t) });
      assert.equal(res.statusCode, 403, `${url} should be closed to a normal user`);
      assert.equal(res.json().error.code, 'forbidden');
    }
  });

  test('an unauthenticated caller gets nothing', async () => {
    const res = await app.inject({ url: '/api/v1/admin/users' });
    assert.equal(res.statusCode, 401);
  });
});

describe('managing accounts', () => {
  test('an admin creates a user, who can then sign in', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/users', headers: auth(adminToken),
      payload: { username: 'newcomer', password: 'newcomerpass', maxDevices: 3, sections: ['live', 'favourites'] }
    });
    assert.equal(res.statusCode, 201);
    const login1 = await login(app, 'newcomer', 'newcomerpass', { key: 'newcomer-device-1' });
    assert.equal(login1.statusCode, 200);
    const env = login1.json();
    assert.equal(env.user.maxDevices, 3);
    assert.equal(env.sections.live, true);
    assert.equal(env.sections.movies, false, 'only the granted sections are on');
  });

  test('disabling an account cuts its live sessions there and then', async () => {
    const before = (await login(app, 'newcomer', 'newcomerpass', { key: 'newcomer-device-1' })).json();
    const still = await app.inject({ url: '/api/v1/me', headers: auth(before.accessToken) });
    assert.equal(still.statusCode, 200);

    const { findByUsername: find } = await import('../src/services/users.js');
    const id = find('newcomer').id;
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${id}`, headers: auth(adminToken), payload: { enabled: false } });

    const after = await app.inject({ url: '/api/v1/me', headers: auth(before.accessToken) });
    assert.equal(after.statusCode, 403);
    assert.equal(after.json().error.code, 'account_disabled');
  });

  test('resetting a password invalidates the old sessions and the old password', async () => {
    const id = findByUsername('john').id;
    const old = (await login(app, 'john', 'johnspassword', { key: 'john-device-001' })).json();
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${id}`, headers: auth(adminToken), payload: { password: 'brandnewpassword' } });

    const sessionAfter = await app.inject({ url: '/api/v1/me', headers: auth(old.accessToken) });
    assert.equal(sessionAfter.statusCode, 401, 'the old session is gone');
    assert.equal((await login(app, 'john', 'johnspassword', { key: 'john-device-001' })).statusCode, 401);
    assert.equal((await login(app, 'john', 'brandnewpassword', { key: 'john-device-001' })).statusCode, 200);
  });

  test('an account expiry date can be set and is enforced', async () => {
    const id = findByUsername('john').id;
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${id}`, headers: auth(adminToken), payload: { expiresAt: '2001-01-01T00:00:00.000Z' } });
    const res = await login(app, 'john', 'brandnewpassword', { key: 'john-device-001' });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'account_expired');
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${id}`, headers: auth(adminToken), payload: { expiresAt: null } });
  });

  test('an admin cannot delete the account they are using', async () => {
    const id = findByUsername('boss').id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${id}`, headers: auth(adminToken) });
    assert.equal(res.statusCode, 400);
  });
});

describe('managing sources and access', () => {
  test('assigning a source is what makes its channels visible', async () => {
    const id = findByUsername('john').id;
    const t = (await login(app, 'john', 'brandnewpassword', { key: 'john-device-001' })).json().accessToken;

    const before = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json();
    assert.equal(before.total, 0);

    await app.inject({ method: 'PUT', url: `/api/v1/admin/users/${id}/sources/${sourceId}`, headers: auth(adminToken) });
    const after = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json();
    assert.equal(after.total, 2);

    await app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${id}/sources/${sourceId}`, headers: auth(adminToken) });
    const removed = (await app.inject({ url: '/api/v1/channels', headers: auth(t) })).json();
    assert.equal(removed.total, 0, 'taking access away takes the channels away');
  });

  test('the source list shows an admin everything except the upstream password', async () => {
    const src = createSource({ name: 'Xtream box', kind: 'xtream', url: 'http://panel.example:8080', username: 'operator', password: 'operatorsecret' });
    const res = (await app.inject({ url: '/api/v1/admin/sources', headers: auth(adminToken) })).json();
    const listed = res.sources.find(s => s.id === src.id);
    assert.equal(listed.username, 'operator');
    assert.equal(listed.hasPassword, true);
    assert.ok(!JSON.stringify(res).includes('operatorsecret'), 'the password itself is never sent, even to an admin');
  });

  test('signing in and out is written to the audit log', async () => {
    const res = (await app.inject({ url: '/api/v1/admin/audit', headers: auth(adminToken) })).json();
    assert.ok(res.entries.some(e => e.action === 'login'));
  });
});
