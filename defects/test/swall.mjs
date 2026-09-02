// Proves, per app, that a deploy actually reaches a device that already has the
// app cached — against a server sending the same max-age GitHub Pages does.
import { chromium } from 'playwright';
import { CHROME, ROOT } from './browser.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SP_DIR = path.dirname(new URL(import.meta.url).pathname);

const APPS = ['chomp', 'radio', 'singers', 'studio', 'defects'];
const SRC = ROOT;
const fails = [];
// Unindented on purpose: run.sh counts lines beginning PASS/FAIL, so the
// two leading spaces this used to have meant every assertion here was
// invisible in the total. The per-app heading above still groups them.
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const browser = await chromium.launch({
  executablePath: CHROME });

for (const app of APPS) {
  console.log('\n=== ' + app);
  // a throwaway copy, so the real tree is never mutated
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swtest-' + app + '-'));
  fs.cpSync(path.join(SRC, app), dir, { recursive: true });
  const appJs = path.join(dir, 'app.js');
  const marker = 'SHIPPED-' + app.toUpperCase();
  fs.appendFileSync(appJs, '\n/* ' + marker + ' */\n');

  const srv = spawn('python3', [path.join(SP_DIR, 'cacheserver.py'), dir],
                    { stdio: 'ignore', detached: true });
  await new Promise(r => setTimeout(r, 700));

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  try {
    await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    let seen = await page.evaluate(() => fetch('./app.js').then(r => r.text()));
    ok(seen.includes(marker), 'the shipped build is what loads');

    // ship a new one, exactly as a merge to main would
    const next = marker + '-TWO';
    fs.writeFileSync(appJs, fs.readFileSync(appJs, 'utf8').replace(marker, next));
    await page.reload({ waitUntil: 'networkidle' });
    seen = await page.evaluate(() => fetch('./app.js').then(r => r.text()));
    ok(seen.includes(next), 'a reload picks up a deploy despite max-age=600');

    // and again, so it is not a one-off
    const third = marker + '-THREE';
    fs.writeFileSync(appJs, fs.readFileSync(appJs, 'utf8').replace(next, third));
    await page.reload({ waitUntil: 'networkidle' });
    seen = await page.evaluate(() => fetch('./app.js').then(r => r.text()));
    ok(seen.includes(third), 'and the one after that');

    // the cache is still doing its job
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const title = await page.evaluate(() => document.title);
    ok(!!title, 'still loads with no network at all (" ' + title + ' ")');
    await ctx.setOffline(false);
  } catch (e) {
    ok(false, app + ' threw: ' + e.message.split('\n')[0]);
  } finally {
    await ctx.close();
    try { process.kill(-srv.pid); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise(r => setTimeout(r, 300));
  }
}

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
