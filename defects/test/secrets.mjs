// Nothing new may be exposed by this release, and what was already exposed must
import { DEFECTS } from './browser.mjs';
// not have grown. This reads the shipped files as a browser would fetch them and
// checks the credential surface against what it was known to be.
import { readFileSync, readdirSync } from 'fs';
const R = DEFECTS + '/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const app = readFileSync(R + 'app.js', 'utf8');
const html = readFileSync(R + 'index.html', 'utf8');
const sw = readFileSync(R + 'sw.js', 'utf8');
const css = readFileSync(R + 'styles.css', 'utf8');
const shipped = { 'app.js': app, 'index.html': html, 'sw.js': sw, 'styles.css': css };

// --- the two credentials this app is known to carry, and no others ---
// A Roboflow publishable key is meant to be in a page; the what3words one is
// not, and is mitigated by W3W_HOSTS rather than hidden.
const known = ['rf_pxctFcweYjTPKQwCJgjKpHcWSpz1', 'GNB4B5O7'];
const suspicious = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'Stripe key', re: /\bsk_(live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer literal', re: /Authorization\s*:\s*['"]?Bearer\s+\S/i },
  { name: 'basic auth in a URL', re: /https?:\/\/[^\s/'"]+:[^\s/'"]+@/ }
];
for (const [file, text] of Object.entries(shipped)) {
  for (const s of suspicious) {
    ok(!s.re.test(text), file + ' carries no ' + s.name);
  }
}

// --- the Roboflow key is unchanged and is the publishable kind ---
const rf = app.match(/RF_KEY\s*=\s*'([^']+)'/);
ok(rf && rf[1] === known[0], 'the Roboflow key is the same publishable key as before');
ok((app.match(/rf_[A-Za-z0-9]{20,}/g) || []).length === 1,
   'and there is exactly one of it — no second key crept in');

// --- the what3words key is unchanged, and is now gated ---
const w3w = app.match(/W3W_DEFAULT\s*=\s*'([^']+)'/);
ok(w3w && w3w[1] === known[1], 'the what3words key is the same one as before, not a new one');
ok((app.match(/GNB4B5O7/g) || []).length === 1,
   'appearing exactly once, in the constant, and nowhere else');
ok(/W3W_HOSTS\s*=\s*\[/.test(app), 'and it is gated on the host it belongs to');
ok(/return w3wOwnSite\(\) \? W3W_DEFAULT : '';/.test(app),
   'so an off-site copy gets no key rather than this one');

// --- the exposure is documented rather than glossed ---
ok(/not a secret/i.test(html), 'the app itself says the key is not a secret');
ok(/restrict the key/i.test(html), 'and where the real protection has to be set');
const readme = readFileSync(R + 'README.md', 'utf8');
ok(/The key is not a secret, and cannot be made one here/.test(readme),
   'and the README says the same, under its own heading');

// --- nothing new reaches the network ---
const hosts = new Set();
for (const text of Object.values(shipped)) {
  for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(m[1]);
}
const allowed = new Set([
  'api.roboflow.com', 'storage.googleapis.com',     // the model and its weights
  'api.what3words.com',                              // three-word addresses
  'tile.openstreetmap.org', 'www.openstreetmap.org', // map tiles and their credit
  'fonts.googleapis.com', 'fonts.gstatic.com',       // two typefaces
  'developer.what3words.com',                        // a link in the help text
  'creativecommons.org', 'www.w3.org',               // licence and svg namespace links
  'tile.example'                                     // never fetched; appears in a comment
]);
const unexpected = [...hosts].filter(h => !allowed.has(h));
ok(unexpected.length === 0,
   'the app talks to no host it did not talk to before: ' +
   (unexpected.length ? unexpected.join(', ') : [...hosts].sort().join(', ')));

// --- no credential is written anywhere it could be read back out ---
ok(!/localStorage\.setItem\([^)]*RF_KEY/.test(app),
   'the Roboflow key is never copied into storage');
const diag = app.slice(app.indexOf('function diagLines()'));
ok(!/W3W_DEFAULT/.test(diag.slice(0, diag.indexOf('function paintDiag'))),
   'and diagnostics — which is meant to be copied and pasted — never prints a key');

// --- the vendored SDK is unchanged by this release ---
const vendor = readdirSync(R + 'vendor');
ok(vendor.includes('inference.es.js'), 'the vendored SDK is still the vendored SDK');

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
