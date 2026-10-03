/* The one thing a moneybox must never get wrong: paying for a win twice.

   Two ways it can happen, both covered here. A win typed in by hand carries no
   match id, so a feed catching up later looks like a brand new match. And the
   same fixture arrives from two feeds under two different ids, neither feed
   knowing the other exists. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/moneybox/index.html';
const now = Date.now(), day = 86400000, hour = 3600e3, iso = t => new Date(t).toISOString();
const id = n => n === 'Arsenal' ? '133604' : String(1000 + n.length);

const tsdb = (eid, home, away, hs, as, when, status) => ({
  idEvent: eid, idHomeTeam: id(home), idAwayTeam: id(away), strHomeTeam: home, strAwayTeam: away,
  intHomeScore: hs === null ? null : String(hs), intAwayScore: as === null ? null : String(as),
  idLeague: '4328', strLeague: 'English Premier League', dateEvent: iso(when).slice(0, 10),
  strTime: iso(when).slice(11, 19), strTimestamp: iso(when).replace('.000Z', ''),
  strStatus: status === undefined ? 'Match Finished' : status
});
const sa = (mid, home, away, hs, as, type, agoMs) => ({
  id: mid, status: { type: type }, home: { name: home }, away: { name: away },
  homeScore: { current: hs }, awayScore: { current: as },
  startTimestamp: Math.floor((now - agoMs) / 1000), tournament: { name: 'Premier League' }
});

const coventry = tsdb('1', 'Arsenal', 'Coventry City', 3, 0, now - 10 * day);
const villaNoScore = tsdb('2', 'Aston Villa', 'Arsenal', null, null, now - 14 * hour, 'NS');
const villaResult = tsdb('2', 'Aston Villa', 'Arsenal', 0, 1, now - 14 * hour);

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log((ok ? '  ok  ' : '  FAIL') + '  ' + label + ': ' + got + (ok ? '' : ' (wanted ' + want + ')'));
}

async function open(saRows) {
  const b = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('dialog', d => d.accept());
  const state = { caughtUp: false };
  await p.route(/thesportsdb\.com/, r => {
    const u = r.request().url();
    const villa = state.caughtUp ? villaResult : villaNoScore;
    let body = { results: [] };
    if (u.includes('eventslast')) body = { results: [coventry] };
    else if (u.includes('eventsseason') && u.includes('id=133604')) body = { events: [coventry] };
    else if (u.includes('eventsseason') && u.includes('id=4328')) body = { events: [coventry, villa] };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.route(/api\.sportsapi\.app/, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: saRows || [] }) }));
  await p.goto(BASE);
  await p.waitForTimeout(1600);
  return { b, p, state };
}

const recheck = async p => {
  await p.evaluate(() => { state.lastCheck = 0; save(); });
  await p.click('#checkBtn');
  await p.waitForTimeout(1600);
};
const total = p => p.textContent('#totalFigure');

(async () => {
  // 1. added by hand, then the feed catches up
  {
    const { b, p, state } = await open();
    check('feed behind, nothing banked for it', await total(p), '£10');
    await p.click('#addBtn');
    await p.fill('#addOpponent', 'Aston Villa');
    await p.fill('#addScore', '1-0');
    await p.fill('#addDate', new Date(now - 14 * hour).toISOString().slice(0, 10));
    await p.click('#addForm button[type=submit]');
    await p.waitForTimeout(500);
    check('after adding by hand', await total(p), '£20');
    state.caughtUp = true;
    await recheck(p);
    check('feed catches up — still', await total(p), '£20');
    check('the hand-written line adopted the match id',
      await p.evaluate(() => String(state.entries.filter(e => (e.opponent || '').includes('Villa'))[0].eventId)), '2');
    await recheck(p);
    check('and once more', await total(p), '£20');
    await b.close();
  }

  // 2. the same fixture from both feeds, under different ids
  {
    const { b, p, state } = await open([sa(8817, 'Aston Villa', 'Arsenal', 0, 1, 'finished', 14 * hour)]);
    await p.evaluate(() => { state.sportsapi.key = 'sk_live_test'; state.sportsapi.on = true; save(); });
    await recheck(p);
    check('banked once from the live feed', await total(p), '£20');
    state.caughtUp = true;
    await recheck(p);
    check('the other feed reports the same match — still', await total(p), '£20');
    check('one line for it, not two',
      await p.evaluate(() => String(state.entries.filter(e => (e.opponent || '').includes('Villa')).length)), '1');
    await b.close();
  }

  console.log(failures ? '\nFAILED' : '\nall clear, a win is paid exactly once');
  process.exit(failures ? 1 : 0);
})();
