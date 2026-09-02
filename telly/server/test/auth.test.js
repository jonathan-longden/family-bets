import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login, auth, DEVICE } from './helpers.js';

const box = isolate();
const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { openDb, closeDb } = await import('../src/db/index.js');

let app;
before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'john', password: 'johnspassword', maxDevices: 2 });
  await createUser({ username: 'admin', password: 'adminpassword', role: 'admin' });
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('signing in', () => {
  test('a correct password returns tokens and the user environment', async () => {
    const res = await login(app, 'john', 'johnspassword');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.accessToken && body.refreshToken);
    assert.equal(body.user.username, 'john');
    assert.equal(body.user.role, 'user');
    assert.equal(typeof body.expiresIn, 'number');
    assert.equal(body.sections.live, true);
    assert.equal(body.sections.recordings, false, 'sections the operator did not grant stay off');
    assert.deepEqual(body.playlists, [], 'no playlist assigned yet');
  });

  test('the reply never contains password material', async () => {
    const body = (await login(app, 'john', 'johnspassword')).body;
    assert.ok(!body.includes('johnspassword'));
    assert.ok(!/password_hash|password_salt/.test(body));
  });

  test('a wrong password is refused with a message meant for a television', async () => {
    const res = await login(app, 'john', 'wrongpassword');
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'invalid_credentials');
    assert.match(res.json().error.message, /do not match/);
  });

  test('an unknown username fails the same way as a wrong password', async () => {
    const a = await login(app, 'nobody', 'whatever12345');
    const b = await login(app, 'john', 'wrongpassword');
    assert.equal(a.statusCode, b.statusCode);
    assert.deepEqual(a.json().error.code, b.json().error.code);
  });

  test('a malformed request is rejected before any password work', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'john' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'bad_request');
  });

  test('a disabled account cannot sign in, and says why', async () => {
    const { setEnabled, findByUsername } = await import('../src/services/users.js');
    const u = findByUsername('john');
    setEnabled(u.id, false);
    const res = await login(app, 'john', 'johnspassword');
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'account_disabled');
    setEnabled(u.id, true);
  });

  test('an expired account cannot sign in', async () => {
    const { findByUsername } = await import('../src/services/users.js');
    const u = findByUsername('john');
    openDb().prepare('UPDATE users SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', u.id);
    const res = await login(app, 'john', 'johnspassword');
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'account_expired');
    openDb().prepare('UPDATE users SET expires_at = NULL WHERE id = ?').run(u.id);
  });
});

describe('sessions', () => {
  test('a bearer token opens the API and a missing one does not', async () => {
    const { accessToken } = (await login(app, 'john', 'johnspassword')).json();
    const ok = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(accessToken) });
    assert.equal(ok.statusCode, 200);
    const bare = await app.inject({ method: 'GET', url: '/api/v1/me' });
    assert.equal(bare.statusCode, 401);
    assert.equal(bare.json().error.code, 'session_expired');
  });

  test('an invented token is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth('not-a-real-token') });
    assert.equal(res.statusCode, 401);
  });

  test('refresh rotates both tokens and the old refresh stops working', async () => {
    const first = (await login(app, 'john', 'johnspassword')).json();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    assert.equal(res.statusCode, 200);
    const second = res.json();
    assert.notEqual(second.accessToken, first.accessToken);
    assert.notEqual(second.refreshToken, first.refreshToken);
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    assert.equal(replay.statusCode, 401, 'a refresh token is good once');
  });

  test('logging out kills the token immediately', async () => {
    const { accessToken } = (await login(app, 'john', 'johnspassword')).json();
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: auth(accessToken) });
    const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(accessToken) });
    assert.equal(after.statusCode, 401);
  });

  test('an expired access token reports session_expired, which the app can act on', async () => {
    const { accessToken } = (await login(app, 'john', 'johnspassword')).json();
    openDb().prepare('UPDATE sessions SET access_expires_at = ? WHERE access_hash IS NOT NULL')
      .run('2000-01-01T00:00:00.000Z');
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(accessToken) });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'session_expired');
  });
});

describe('devices', () => {
  test('a third device is refused while two are signed in', async () => {
    const fresh = await import('../src/services/users.js');
    await fresh.createUser({ username: 'twodev', password: 'twodevpassword', maxDevices: 2 });
    const a = await login(app, 'twodev', 'twodevpassword', { key: 'dev-aaaaaaaa', name: 'Living Room' });
    const b = await login(app, 'twodev', 'twodevpassword', { key: 'dev-bbbbbbbb', name: 'Bedroom' });
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    const c = await login(app, 'twodev', 'twodevpassword', { key: 'dev-cccccccc', name: 'Kitchen' });
    assert.equal(c.statusCode, 409);
    assert.equal(c.json().error.code, 'device_limit');
    assert.match(c.json().error.message, /2 devices/);
  });

  test('the same device signing in again does not consume another slot', async () => {
    const again = await login(app, 'twodev', 'twodevpassword', { key: 'dev-aaaaaaaa', name: 'Living Room' });
    assert.equal(again.statusCode, 200);
  });

  test('removing a device frees the slot', async () => {
    const { accessToken } = (await login(app, 'twodev', 'twodevpassword', { key: 'dev-aaaaaaaa' })).json();
    const list = (await app.inject({ method: 'GET', url: '/api/v1/me/devices', headers: auth(accessToken) })).json();
    const bedroom = list.devices.find(d => d.name === 'Bedroom');
    await app.inject({ method: 'DELETE', url: `/api/v1/me/devices/${bedroom.id}`, headers: auth(accessToken) });
    const kitchen = await login(app, 'twodev', 'twodevpassword', { key: 'dev-cccccccc', name: 'Kitchen' });
    assert.equal(kitchen.statusCode, 200);
  });
});
