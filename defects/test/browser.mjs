// Where Chromium is, and where the app is served from.
//
// Both were hard-coded in all 43 suites, which was fine while they lived in a
// scratch directory on one machine and is not fine in a repository. The paths
// are still the same by default; they are just no longer the only answer.
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFECTS = dirname(HERE);          // .../defects
export const ROOT = dirname(DEFECTS);          // the repository

/* The browser, in order of preference:
     CHROMIUM in the environment, for whoever knows better;
     the build this suite was written against, when it is present;
     nothing — which is not a failure, it is Playwright using the browser it
     downloaded, and the right answer on a normal machine. */
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const CHROME = process.env.CHROMIUM ||
  (existsSync(PINNED) ? PINNED : undefined);

/* The port run.sh serves the repository on. Overridable for anyone running a
   suite by hand against a server they started themselves. */
export const PORT = process.env.PORT || '8777';
export const BASE = 'http://127.0.0.1:' + PORT + '/defects/';
export const FIXTURES = join(HERE, 'fixtures');
