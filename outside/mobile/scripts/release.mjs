/* Cut a release.

   The version number lives in app.config.json, but a release is not only that
   number: the web app carries a `?v=` on every asset and a cache name in its
   service worker, and if those do not move together a phone ends up running
   this version's HTML against last version's JavaScript. That has to be done
   in eight places at once, by hand, every time — which is a thing that gets
   forgotten at eleven at night.

   So the build number is the asset version. Bump one and every `?v=`, the
   cache name and both stores' build numbers follow.

     node scripts/release.mjs            bump the build number
     node scripts/release.mjs 1.2.0      set the version, and bump the build

   It does not commit, tag, push or upload anything. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..');
const configFile = join(web, 'app.config.json');

const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
const version = process.argv[2];

if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`\nrelease: "${version}" is not a version. Try 1.2.0.\n`);
  process.exit(1);
}

const was = { version: cfg.version, build: cfg.build };
if (version) cfg.version = version;
cfg.build = cfg.build + 1;

writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n');

/* The web app's cache-busting, keyed to the same number. Both files are
   rewritten wholesale rather than by anchor: a `?v=` that failed to move is
   the exact bug this script exists to prevent, so it is not allowed to be a
   thing that can silently not happen. */
const v = cfg.build;
let stamped = 0;

for (const file of ['index.html', 'sw.js']) {
  const path = join(web, file);
  const before = readFileSync(path, 'utf8');
  const after = before
    .replace(/\?v=\d+/g, `?v=${v}`)
    .replace(/weather-v\d+/g, `weather-v${v}`);
  if (after !== before) { writeFileSync(path, after); stamped++; }
}

console.log(`\n  ${was.version} (${was.build})  →  ${cfg.version} (${cfg.build})`);
console.log(`  assets stamped ?v=${v}, cache weather-v${v}, ${stamped} file(s) changed\n`);
console.log('  next:');
console.log('    npm run build');
console.log('    npm test');
console.log('    commit and push  → the website deploys itself from main');
console.log('    Xcode: Archive → upload');
console.log('    Android Studio: Generate Signed App Bundle → Play Console\n');
