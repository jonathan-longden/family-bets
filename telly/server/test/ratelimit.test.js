import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isolate, login } from './helpers.js';

// Deliberately tiny limits: this suite is about the limiter, not about volume.
process.env.TELLY_RL_LOGIN = '5';
process.env.TELLY_RL_API = '20';
const box = isolate();

const { buildServer } = await import('../src/index.js');
const { createUser } = await import('../src/services/users.js');
const { closeDb } = await import('../src/db/index.js');

let app;
before(async () => {
  app = await buildServer({ logger: false });
  await createUser({ username: 'john', password: 'johnspassword' });
});
after(async () => { await app.close(); closeDb(); box.cleanup(); });

describe('rate limiting', () => {
  test('repeated wrong passwords are throttled rather than answered forever', async () => {
    const codes = [];
    for (let i = 0; i < 9; i++) codes.push((await login(app, 'john', 'wrongpassword')).statusCode);
    assert.ok(codes.includes(401), 'the first few are answered normally');
    assert.ok(codes.includes(429), 'then the door closes');
  });

  test('being throttled still speaks plainly, and never leaks internals', async () => {
    let res;
    for (let i = 0; i < 12; i++) res = await login(app, 'john', 'wrongpassword');
    assert.equal(res.statusCode, 429);
    const body = res.json();
    assert.equal(body.error.code, 'rate_limited');
    assert.match(body.error.message, /Too many attempts/);
    assert.ok(!/stack|Error:|at Object/.test(res.body));
  });
});
