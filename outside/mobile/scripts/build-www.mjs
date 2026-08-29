/* Copy the web app into mobile/www, which is what Capacitor bundles.

   There is no build. No bundler, no transpiler, no framework — the files that
   the phone runs are the same files the website runs, copied. That is the
   whole point of the arrangement: one app, three places to open it.

   Two deliberate differences in the copy:

     sw.js is left behind. A service worker exists to keep a website on a
     phone; inside a native app the files are already on the phone, and a
     worker caching them is only a way to ship a version that can never update
     itself. app.js checks the platform and does not register one.

     Every file is listed by name below. A copy that globs would sweep up
     node_modules, the two native projects and its own output the moment this
     directory moves, and nobody would notice until the app store did. */

import { readdirSync, mkdirSync, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const web = join(mobile, '..');
const www = join(mobile, 'www');

const FILES = [
  'index.html',
  'privacy.html',
  'styles.css',
  'brand.js',
  'weather.js',
  'voice.js',
  'native.js',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

const NOT_SHIPPED = ['sw.js'];

/* A stale file left in www outlives the release that removed it, so the
   directory is emptied rather than written over. */
if (existsSync(www)) rmSync(www, { recursive: true });
mkdirSync(www, { recursive: true });

let bytes = 0;
for (const file of FILES) {
  const from = join(web, file);
  if (!existsSync(from)) {
    console.error(`\nbuild-www: ${file} is in the list but not on disk.\n`);
    process.exit(1);
  }
  copyFileSync(from, join(www, file));
  bytes += statSync(from).size;
}

/* Anything in the web app that nobody has decided about is a file the phone
   will silently not have. Better to be told. */
const known = new Set([...FILES, ...NOT_SHIPPED, 'app.config.json', 'README.md']);
const strays = readdirSync(web, { withFileTypes: true })
  .filter(e => e.isFile() && !known.has(e.name));

console.log(`\nwww: ${FILES.length} files, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`     not shipped to the phone: ${NOT_SHIPPED.join(', ')}`);
if (strays.length) {
  console.log('\n     in the web app but not in the list above — add or ignore them:');
  for (const s of strays) console.log('       ' + s.name);
}
console.log('');
