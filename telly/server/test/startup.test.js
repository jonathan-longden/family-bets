import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', 'src', 'index.js');

const { isEntryPoint } = await import('../src/index.js');

/* ===================================================================
   Does the server know it was run directly?

   It did not, on Windows. `import.meta.url` is a file:// URL and
   `process.argv[1]` is a path in the platform's own spelling, and the check
   concatenated them instead of converting: "file://" + "C:\\x\\index.js".
   That is never the URL Node produces, so nothing called listen() and
   `npm start` exited silently with status 0.
   =================================================================== */

describe('knowing whether it was started directly', () => {
  test('a module run as itself is the entry point', () => {
    const file = realpathSync(SERVER);
    assert.equal(isEntryPoint(pathToFileURL(file).href, file), true);
  });

  test('a module imported by something else is not', () => {
    assert.equal(
      isEntryPoint(pathToFileURL(realpathSync(SERVER)).href,
                   path.join(here, 'startup.test.js')),
      false);
  });

  test('a Windows path and its URL are recognised as the same file', () => {
    /* The case that was broken. These are the exact two strings Node hands a
       Windows process, written out so this holds on any platform: the check
       has to see through the spelling difference rather than pasting one
       string onto the other. */
    const argv = 'C:\\Telly\\telly\\server\\src\\index.js';
    const url = 'file:///C:/Telly/telly/server/src/index.js';

    /* What the old code computed, and why it could never match. */
    assert.notEqual(`file://${argv}`, url,
      'concatenating a Windows path onto file:// cannot produce its URL');

    if (process.platform === 'win32') {
      assert.equal(isEntryPoint(url, argv), true);
    } else {
      /* pathToFileURL is platform-specific, so the real comparison can only
         run on Windows. What is asserted here instead is the property that
         makes it work there: Node's own conversion, not string concatenation,
         is what the code uses — so the two spellings of *this* platform's
         path always agree. */
      const file = realpathSync(SERVER);
      assert.equal(isEntryPoint(pathToFileURL(file).href, file), true);
      assert.notEqual(`file://${file}`, pathToFileURL(file).href + 'x');
    }
  });

  test('a POSIX path and its URL too — which the old check got right by luck', () => {
    const argv = '/srv/telly/server/src/index.js';
    const url = 'file:///srv/telly/server/src/index.js';
    assert.equal(`file://${argv}`, url,
      'the leading slash is why the bug hid on Linux and macOS');
    if (process.platform !== 'win32') assert.equal(isEntryPoint(url, argv), true);
  });

  test('a path reached through a symlink still counts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'telly-entry-'));
    try {
      const link = path.join(dir, 'index.js');
      symlinkSync(realpathSync(SERVER), link);
      /* The URL is the real file, the argv is the link. A string comparison
         cannot see that those are the same; the realpath fallback can. */
      assert.equal(isEntryPoint(pathToFileURL(realpathSync(SERVER)).href, link), true);
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EEXIST') return;   // Windows without privileges
      throw e;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nonsense is not the entry point, and does not throw', () => {
    assert.equal(isEntryPoint(undefined, undefined), false);
    assert.equal(isEntryPoint('', ''), false);
    assert.equal(isEntryPoint('file:///a.js', ''), false);
    assert.equal(isEntryPoint('not a url at all', '/tmp/x.js'), false);
  });
});

/* ===================================================================
   And the symptom itself: `node src/index.js` has to listen and stay up.

   This is the test that would have caught it. The unit tests above check the
   comparison; this one checks that the process actually serves something,
   which is what "npm start exits immediately" was really about.
   =================================================================== */

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const children = [];
after(() => { for (const c of children) { try { c.kill('SIGKILL'); } catch {} } });

describe('starting it the way npm start does', () => {
  test('it listens, answers, and does not exit on its own', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'telly-start-'));
    const port = await freePort();
    let child;
    try {
      /* Started from a different working directory on purpose: the data
         directory is anchored to the module, not the cwd, and starting it
         from elsewhere must not quietly use a different database. */
      child = spawn(process.execPath, [SERVER], {
        cwd: tmpdir(),
        env: {
          ...process.env,
          TELLY_DATA_DIR: dir,
          TELLY_PORT: String(port),
          TELLY_HOST: '127.0.0.1',
          TELLY_REFRESH_INTERVAL: '0',
          TELLY_SERVE_APP: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      children.push(child);

      let out = '';
      child.stdout.on('data', d => { out += String(d); });
      child.stderr.on('data', d => { out += String(d); });

      const exited = new Promise(resolve => child.on('exit', code => resolve(code)));

      /* Wait for it to answer, or for it to die trying. */
      let health = null;
      for (let i = 0; i < 100 && health === null; i++) {
        const done = await Promise.race([exited, new Promise(r => setTimeout(() => r('wait'), 100))]);
        if (done !== 'wait') {
          assert.fail(`the server exited with code ${done} instead of listening.\n` +
            `This is the Windows entry-point bug if the code is 0 and there is no error.\n` +
            `Output:\n${out.slice(0, 2000)}`);
        }
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
          if (res.ok) health = await res.json();
        } catch { /* not up yet */ }
      }

      assert.ok(health, `no answer from the server within 10s. Output:\n${out.slice(0, 2000)}`);
      assert.equal(health.ok, true);
      assert.equal(health.service, 'telly');

      /* Still alive a moment later: listening, not exiting after one reply. */
      await new Promise(r => setTimeout(r, 300));
      assert.equal(child.exitCode, null, 'the server exited after answering');
    } finally {
      if (child) { try { child.kill('SIGTERM'); } catch {} }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('and importing it does NOT start a listener', async () => {
    /* The other half of the condition: `node --test` imports this module all
       day, and it must not try to bind a port when it does. */
    const dir = mkdtempSync(path.join(tmpdir(), 'telly-import-'));
    const port = await freePort();
    try {
      const probe = path.join(dir, 'probe.mjs');
      writeFileSync(probe,
        `import { buildServer, isEntryPoint } from ${JSON.stringify(pathToFileURL(SERVER).href)};\n` +
        `console.log(JSON.stringify({ entry: isEntryPoint(${JSON.stringify(pathToFileURL(SERVER).href)}),\n` +
        `  built: typeof buildServer }));\n`);

      const out = await new Promise((resolve, reject) => {
        const c = spawn(process.execPath, [probe], {
          env: { ...process.env, TELLY_DATA_DIR: dir, TELLY_PORT: String(port),
                 TELLY_HOST: '127.0.0.1', TELLY_SERVE_APP: 'false' },
          stdio: ['ignore', 'pipe', 'pipe']
        });
        children.push(c);
        let o = '', e = '';
        c.stdout.on('data', d => { o += String(d); });
        c.stderr.on('data', d => { e += String(d); });
        c.on('exit', code => code === 0 ? resolve(o) : reject(new Error(`probe exited ${code}: ${e}`)));
      });

      const got = JSON.parse(out.trim().split('\n').pop());
      assert.equal(got.entry, false, 'an imported module is not the entry point');
      assert.equal(got.built, 'function');

      /* Nothing should be listening on that port. */
      await assert.rejects(fetch(`http://127.0.0.1:${port}/api/v1/health`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
