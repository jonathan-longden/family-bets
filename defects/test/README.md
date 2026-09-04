# Tests for the defect log

43 suites, about a thousand assertions, driving the real app in a real browser
against a real service worker, a real camera and — where it matters — the real
TensorFlow.js.

```
npm install
npx playwright install chromium     # skip if the machine already has one
./run.sh                            # everything
./run.sh survey closer              # just those
```

`run.sh` serves the repository on port 8777 if nothing is already listening
there, runs each suite in its own process, and prints one line per suite.
Detail from anything that failed goes to `report/failures.txt`.

Every suite is a plain ES module that prints `PASS`/`FAIL` lines and exits
non-zero if anything failed, so any one of them can be run on its own:

```
node closer.mjs
```

## Why it is shaped like this

**One suite at a time.** Several drive a camera, a service worker and a 2.4 MB
download at once. Run in parallel they fight over the machine rather than over
the app, and produce failures that pass when re-run alone — which teaches
nobody anything. Two real bugs in this suite's history were found only because
a failure was reproduced rather than re-run.

**No framework.** Each file is a script with a two-line `ok()` at the top. The
assertion message carries the value it saw, not just the claim, because a
failure that says only "expected true" costs a debugging session:

```
ok(now.share > first.share,
   'carrying the closer look: share ' + first.share + ' → ' + now.share);
```

**A stub that lies is worse than no test.** `backend.mjs` and `bench.mjs` stand
in for TensorFlow.js so they can test *which backend gets chosen* without 2.4 MB
and a network. For a long time those stubs implemented an API TensorFlow.js does
not have — chained ops like `x.expandDims(0)`, which the union package registers
and the vendored `tfjs-core` does not — so the app was written against a fiction
that worked only while the Roboflow SDK's bundled copy was on the page. Removing
the SDK broke every backend at once and no test noticed.

`realtf.mjs` exists because of that: it runs the survey's own inference path
against the real library on real WASM and CPU, and refuses any chained tensor op
in `app.js`.

## What each one covers

| | |
|---|---|
| `amend` `note` `classes` `priority` | scoring, priorities, corrections |
| `backend` | which backend the survey picks, and what happens when it can't |
| `bench` | the three-backend benchmark over one picture |
| `closer` | the photograph is the frame the model saw; a closer look replaces the entry |
| `decode` `rawtype` `garbage` `precision` `layout` | reading the model's output, and refusing to guess at it |
| `dupes` `split` `mig` | one entry per defect, observations vs defects, the migration |
| `batch` | several photographs in one pass, the table across them, the sweep |
| `evidence` | one frame from capture to evidence, and the timestamps that prove it |
| `footage` | recording the camera stream, and a scrubbed frame into the miss report |
| `fourways` | the rotation instrument loses nothing, and which way up a frame is |
| `frame` `frametest` `upright` `orient` `shadow` | what the camera hands over and what is rejected |
| `geo` `map` `where` `w3wkey` | position, the map, three-word addresses |
| `zoom` | 2× at the camera track, and what happens on cameras that cannot |
| `local` `meta` `selftest` `diag` `diagnose` `diagscreen` | the model's own diagnostics |
| `miss` | the miss-analysis report, and that it changes nothing it reports on |
| `offline` `sw` `swall` `swupgrade` `vendorcache` | the service worker, caching, and deploys landing |
| `realtf` | the production inference path on the real TensorFlow.js |
| `registry` | which model produced an observation, and that the baseline survives |
| `secrets` | nothing that should not be in a public repository is |
| `survey` `shell` `test` `bounded` `strip` | the survey loop, the shell, exports |

## Things worth knowing before changing them

- `browser.mjs` decides which Chromium to use: `$CHROMIUM`, else the pinned
  build if present, else whatever Playwright downloaded. Nothing else should
  hard-code a browser path.
- `swupgrade.mjs` stages a copy of the site in a temp directory and swaps the
  service worker under the browser's feet, over a six-second-per-file link
  (`slowsrv.py`). It uses `fixtures/sw-v19.js` rather than a git ref, so it does
  not depend on a particular commit still existing.
- Suites that stub the vendored scripts through `ctx.route` must also declare
  `serviceWorkers: 'block'`. A worker's own fetches do not go through
  `ctx.route`, so once one takes charge it pulls the real 2.4 MB and overwrites
  the stub mid-test.
- The weights come from Roboflow. Suites that do not need them abort the request
  and say so; nothing here depends on that account being reachable.
