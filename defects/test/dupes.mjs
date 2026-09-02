// Telling one defect from the one before it, and the three things that used to
// go wrong: a one-slot memory, a fixed radius regardless of how good the fix
// was, and a fixed cadence that stared at a red light as hard as it watched a
// carriageway. Plus the wake lock, which must never be able to break a survey.
import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openLog, rec, settled } from './shellhelp.mjs';
const B = 'http://127.0.0.1:8777/defects/';
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };

const launch = (extra = {}) => chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], ...extra });

const browser = await launch();
const ctx = await browser.newContext({
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 53.0, longitude: -1.1, accuracy: 8 },
  viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
  null, { timeout: 15000 });
await settled(page);

// ---------------------------------------------------------- compass arithmetic
const hg = await page.evaluate(() => ({
  wrap: headingGap(350, 10), same: headingGap(90, 90),
  quarter: headingGap(0, 90), opposite: headingGap(0, 180)
}));
ok(hg.wrap === 20, '350° and 10° are twenty degrees apart, not three hundred and forty');
ok(hg.same === 0 && hg.quarter === 90 && hg.opposite === 180,
   'and the rest of the compass behaves: ' + JSON.stringify(hg));

// ------------------------------------------------------- the matching radius
const rad = await page.evaluate(() => ({
  tight: dupRadius(3, 4),        // two good fixes
  mid: dupRadius(12, 10),        // ordinary fixes
  hopeless: dupRadius(80, 5),    // one useless fix
  none: dupRadius(null, null)
}));
ok(rad.tight === 15, 'two good fixes still get a floor, so a hole cannot separate from itself: '
   + rad.tight);
ok(rad.mid === 24, 'ordinary fixes scale the radius to what they are worth: ' + rad.mid);
ok(rad.hopeless === null,
   'and a hopeless fix reports that position cannot decide anything, rather than swallowing the street');
ok(rad.none === 15, 'with no accuracy at all, the floor stands: ' + rad.none);

// --------------------------------------------------- the ring, case by case
const ring = await page.evaluate(() => {
  const at = 1000000;
  const put = (list) => { survey.recent = list; };
  const c = (over) => Object.assign(
    { at: at + 1000, lat: 53, lon: -1.1, confM: 5, heading: 90, vlat: 53, vlon: -1.1 }, over || {});
  const r = (over) => Object.assign(
    { at, lat: 53, lon: -1.1, confM: 5, heading: 90, vlat: 53, vlon: -1.1 }, over || {});

  const out = {};

  // the same hole, moments later
  put([r()]);
  out.same = !!alreadyLogged(c());

  // not the most recent one — the bug the one-slot memory had
  put([r({ lat: 53.0 }), r({ at: at + 500, lat: 53.02, vlat: 53.02 })]);
  out.notMostRecent = !!alreadyLogged(c({ at: at + 1000 }));

  // a genuine neighbour, well outside the radius
  put([r()]);
  out.neighbour = !!alreadyLogged(c({ lat: 53.0005 }));       // ~55 m

  // the other carriageway: same place, opposite heading
  put([r({ heading: 90 })]);
  out.otherWay = !!alreadyLogged(c({ heading: 270 }));

  // heading unknown on one side: it abstains rather than separating them
  put([r({ heading: null })]);
  out.headingUnknown = !!alreadyLogged(c({ heading: 90 }));

  // long ago and far away
  put([r({ at: at - 300000, vlat: 52.9 })]);
  out.longGone = !!alreadyLogged(c({ vlat: 53.0 }));

  // long ago but the vehicle has not moved: still the same view
  put([r({ at: at - 300000 })]);
  out.parked = !!alreadyLogged(c());

  // no position anywhere: time alone, as the app has always done
  put([r({ lat: null, lon: null, vlat: null, vlon: null })]);
  out.noFixRecent = !!alreadyLogged(c({ lat: null, lon: null, vlat: null, vlon: null }));
  out.noFixOld = !!alreadyLogged(
    c({ at: at + 90000, lat: null, lon: null, vlat: null, vlon: null }));

  // useless fixes: falls back to time rather than suppressing everything nearby
  put([r({ confM: 90 })]);
  out.vagueRecent = !!alreadyLogged(c({ confM: 90, lat: 53.0004 }));
  out.vagueOld = !!alreadyLogged(c({ confM: 90, lat: 53.0004, at: at + 90000 }));

  survey.recent = [];
  return out;
});
ok(ring.same, 'the same hole moments later is recognised');
ok(ring.notMostRecent,
   'and one from earlier in the ring, not just the most recent — the old one-slot bug');
ok(!ring.neighbour, 'a genuine neighbour fifty metres on is logged as its own defect');
ok(!ring.otherWay, 'the same place seen travelling the other way is the other carriageway');
ok(ring.headingUnknown,
   'an unknown heading abstains rather than voting the two apart');
ok(!ring.longGone, 'long ago and a hundred kilometres away is not the same defect');
ok(ring.parked, 'long ago but the vehicle has not moved is still the same view');
ok(ring.noFixRecent && !ring.noFixOld,
   'with no position at all it falls back to time, as before: ' + JSON.stringify(ring));
ok(ring.vagueRecent && !ring.vagueOld,
   'and fixes too vague to decide fall back to time rather than swallowing the street');

// ---------------------------------------------- the ring does not grow forever
const capped = await page.evaluate(() => {
  survey.recent = [];
  for (let i = 0; i < 100; i++) rememberFind({ at: i, lat: null, lon: null, confM: null,
    heading: null, vlat: null, vlon: null });
  const n = survey.recent.length, oldest = survey.recent[0].at;
  survey.recent = [];
  return { n, oldest };
});
ok(capped.n === 30 && capped.oldest === 70,
   'the ring holds the last thirty and drops the oldest: ' + JSON.stringify(capped));

// ------------------------------------------------------- distance-aware cadence
const cad = await page.evaluate(() => {
  const was = S.gps;
  const at = (speed) => { S.gps = { lat: 53, lon: -1.1, acc: 5, at: Date.now(), heading: 90, speed }; return lookDelay(); };
  const out = {
    noSpeed: (S.gps = { lat: 53, lon: -1.1, acc: 5, at: Date.now(), heading: null, speed: null },
              lookDelay()),
    stopped: at(0.2), crawl: at(2), thirty: at(13.4), fast: at(30)
  };
  S.gps = was;
  return out;
});
ok(cad.noSpeed === 1200, 'with no speed reported the old fixed interval stands: ' + cad.noSpeed);
ok(cad.thirty >= 700 && cad.thirty <= 800,
   'at 30 mph a look every ten metres is about three quarters of a second: ' + cad.thirty);
ok(cad.crawl > cad.thirty, 'a crawl looks less often, not more: ' + cad.crawl);
ok(cad.fast === 700, 'and it will not ask for looks faster than inference can answer: ' + cad.fast);
ok(cad.stopped === 4000, 'stopped, it idles rather than staring: ' + cad.stopped);

// ------------------------------------------------ stationary suppression, live
await page.evaluate(() => {
  window.__hits = [];
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1;
  window.loadModel = () => Promise.resolve({});
  window.__looks = 0;
  const realLook = window.look;
  window.look = function () { window.__looks++; return realLook.apply(this, arguments); };
});
await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
const hit = [{ class: 'pothole', confidence: 0.9, bbox: { x: 300, y: 300, width: 180, height: 180 } }];

await page.evaluate(() => {
  S.gps = { lat: 53, lon: -1.1, acc: 5, at: Date.now(), heading: 90, speed: 0.2 };
  setInterval(() => { if (S.gps) S.gps.at = Date.now(); }, 200);
});
await rec(page);
await page.evaluate(h => { window.__hits = h; }, hit);
// stopped, the cadence idles at LOOK_MAX_MS — so give it long enough to have
// idled round twice and still done nothing
await page.waitForTimeout(9000);
ok(await page.textContent('#hudCount') === '0 logged',
   'stopped at a junction with a pothole in shot, nothing is logged');
ok(/Stopped/.test(await page.textContent('#hudState')),
   'and the screen says why: ' + await page.textContent('#hudState'));
ok(await page.evaluate(() => window.__looks) >= 2,
   'it did keep waking up to check — it is idling, not switched off: ' +
   await page.evaluate(() => window.__looks) + ' looks');

// moving again: it logs
await page.evaluate(() => { S.gps.speed = 13.4; });
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
  null, { timeout: 20000 });
ok(true, 'moving off, the same defect is logged once');

// the same hole stays suppressed while it is in shot
await page.waitForTimeout(4000);
ok(await page.textContent('#hudCount') === '1 logged',
   'and stays suppressed while it is still in shot: ' + await page.textContent('#hudCount'));

// a defect a hundred metres on is a different defect
await page.evaluate(() => { S.gps.lat = 53.001; });
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '2 logged',
  null, { timeout: 20000 });
ok(true, 'a defect a hundred metres down the road is logged as its own');

// coming back to the first one is still the first one — the one-slot bug
await page.evaluate(() => { S.gps.lat = 53.0; });
await page.waitForTimeout(4000);
ok(await page.textContent('#hudCount') === '2 logged',
   'and coming back to the first is not a third row: ' + await page.textContent('#hudCount'));

// turning round is the other carriageway, and is its own defect
await page.evaluate(() => { S.gps.heading = 270; });
await page.waitForFunction(() => document.getElementById('hudCount').textContent === '3 logged',
  null, { timeout: 20000 });
ok(true, 'the same place travelling the other way is a defect on the other carriageway');

await page.click('#bRec');

// ------------------------------------------------------------------ wake lock
const wl = await page.evaluate(() => wakeState);
ok(typeof wl === 'string' && wl.length > 0, 'the wake lock records what happened: ' + wl);
const diag = await page.evaluate(() => diagLines());
ok(/wake lock/.test(diag), 'and diagnostics reports it');
ok(/cadence/.test(diag), 'along with the cadence it is actually running at');

// a browser with no wake lock at all must survey exactly as well
{
  const ctx2 = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53.0, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });
  await ctx2.addInitScript(() => {
    try { Object.defineProperty(navigator, 'wakeLock', { get: () => undefined }); } catch (e) {}
  });
  const p2 = await ctx2.newPage();
  p2.on('dialog', d => d.accept());
  await p2.goto(B, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(p2);
  ok(await p2.evaluate(() => !navigator.wakeLock), 'a browser with no wake lock API at all');
  await p2.evaluate(() => {
    window.__hits = [];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
    S.gps = { lat: 53, lon: -1.1, acc: 5, at: Date.now(), heading: 90, speed: 13.4 };
    setInterval(() => { if (S.gps) S.gps.at = Date.now(); }, 200);
  });
  await p2.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await rec(p2);
  await p2.evaluate(h => { window.__hits = h; }, hit);
  await p2.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
    null, { timeout: 20000 });
  ok(true, 'surveys and logs exactly as it would with one');
  ok(/not supported/.test(await p2.evaluate(() => wakeState)),
     'and says so rather than pretending: ' + await p2.evaluate(() => wakeState));
  await p2.click('#bRec');
  ok(await p2.getAttribute('#bRec', 'aria-pressed') === 'false', 'and stops cleanly');
  await ctx2.close();
}

// a wake lock that refuses must not break anything either
{
  const ctx3 = await browser.newContext({
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: 53.0, longitude: -1.1, accuracy: 8 },
    viewport: { width: 844, height: 390 } });
  await ctx3.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'wakeLock', {
        get: () => ({ request: () => Promise.reject(new DOMException('no', 'NotAllowedError')) })
      });
    } catch (e) {}
  });
  const p3 = await ctx3.newPage();
  p3.on('dialog', d => d.accept());
  await p3.goto(B, { waitUntil: 'domcontentloaded' });
  await p3.waitForFunction(() => document.getElementById('badge').textContent === 'Live',
    null, { timeout: 15000 });
  await settled(p3);
  await p3.evaluate(() => {
    window.__hits = [];
    window.engine = { infer: () => Promise.resolve(window.__hits) };
    window.worker = 1;
    window.loadModel = () => Promise.resolve({});
    S.gps = { lat: 53, lon: -1.1, acc: 5, at: Date.now(), heading: 90, speed: 13.4 };
    setInterval(() => { if (S.gps) S.gps.at = Date.now(); }, 200);
  });
  await p3.waitForFunction(() => document.getElementById('vid').videoWidth > 0);
  await rec(p3);
  await p3.evaluate(h => { window.__hits = h; }, hit);
  await p3.waitForFunction(() => document.getElementById('hudCount').textContent === '1 logged',
    null, { timeout: 20000 });
  ok(/refused/.test(await p3.evaluate(() => wakeState)),
     'a refused wake lock is recorded: ' + await p3.evaluate(() => wakeState));
  ok(true, 'and the survey runs regardless');
  await ctx3.close();
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
await browser.close();
process.exit(fails.length ? 1 : 0);
