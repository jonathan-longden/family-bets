/* Click every control in the app and fail on anything the page throws. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/moneybox/index.html';
const now = Date.now(), day = 86400000, iso = t => new Date(t).toISOString();
const ev = (id, home, away, hs, as, when) => ({
  idEvent: id, strHomeTeam: home, strAwayTeam: away, idHomeTeam: home === 'Arsenal' ? '133604' : '9' + id,
  idAwayTeam: away === 'Arsenal' ? '133604' : '8' + id,
  intHomeScore: hs === null ? null : String(hs), intAwayScore: as === null ? null : String(as),
  idLeague: '4328', strLeague: 'English Premier League', dateEvent: iso(when).slice(0, 10),
  strTime: iso(when).slice(11, 19), strTimestamp: iso(when).replace('.000Z', ''),
  strStatus: hs === null ? 'NS' : 'Match Finished'
});
const played = [ev('1', 'Arsenal', 'Coventry City', 3, 0, now - 7 * day),
                ev('2', 'Arsenal', 'Everton', 2, 1, now - day)];
const clubs = ['Arsenal','Everton','Coventry City','Liverpool','Chelsea','Brentford','Fulham',
  'Leeds United','Burnley','Brighton','Newcastle United','Aston Villa'];
const teams = { teams: clubs.map((n, i) => ({
  idTeam: n === 'Arsenal' ? '133604' : String(1000 + i), strTeam: n, strBadge: '',
  idLeague: '4328', strLeague: 'English Premier League' })) };

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'],
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push('console: ' + m.text().slice(0, 100)); });
  p.on('dialog', d => d.accept());
  await p.route(/thesportsdb\.com/, r => {
    const u = r.request().url();
    let body = { results: [] };
    if (u.includes('eventslast')) body = { results: played };
    else if (u.includes('eventsseason')) body = { events: played };
    else if (u.includes('eventsnext')) body = { events: [ev('3', 'Aston Villa', 'Arsenal', null, null, now + 3 * day)] };
    else if (u.includes('searchteams') || u.includes('all_teams')) body = teams;
    else if (u.includes('lookuptable')) body = { table: teams.teams.map((t, i) => ({ ...t, intPlayed: '1',
      intPoints: String(3 - i % 4), intGoalDifference: '0', intGoalsFor: '1' })) };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.route(/hook\.example|api\.sportsapi\.app/, r => r.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ data: [] }) }));

  await p.goto(BASE);
  await p.waitForTimeout(1800);
  let failures = 0;
  const step = async (label, fn) => {
    const before = errs.length;
    try { await fn(); } catch (e) { errs.push('THREW at ' + label + ': ' + e.message.split('\n')[0]); }
    await p.waitForTimeout(350);
    const ok = errs.length === before;
    if (!ok) failures++;
    console.log((ok ? '  ok  ' : '  FAIL') + '  ' + label);
  };

  await step('check for wins', () => p.click('#checkBtn'));
  await step('about sheet', async () => { await p.click('#aboutBtn'); await p.click('#aboutSheet .icon-btn'); });
  await step('add by hand', async () => {
    await p.click('#addBtn'); await p.fill('#addOpponent', 'Test FC'); await p.fill('#addScore', '1-0');
    await p.click('#addForm button[type=submit]');
  });
  await step("I've moved it", () => p.click('#moveBtn'));
  await step('take some out', async () => {
    await p.click('#withdrawBtn'); await p.fill('#wdAmount', '5'); await p.click('#withdrawForm button[type=submit]');
  });
  await step('delete a ledger line', () => p.click('#ledger li:last-child .rowbtns button:last-child'));
  await step('open settings', async () => {
    await p.click('#settingsBtn');
    if (!(await p.evaluate(() => document.getElementById('settingsSheet').open))) throw new Error('sheet did not open');
  });
  await step('team search', async () => { await p.fill('#teamQuery', 'Arsenal'); await p.click('#teamSearchBtn'); });
  await step('follow a team', () => p.click('#teamResults li button'));
  await step('amounts', async () => {
    for (const [id, v] of [['#amtWin', '12'], ['#amtDraw', '1'], ['#amtLoss', '0']]) {
      await p.fill(id, v); await p.dispatchEvent(id, 'change');
    }
  });
  await step('goal', async () => {
    await p.fill('#goalLabel', 'Away days'); await p.dispatchEvent('#goalLabel', 'change');
    await p.fill('#goalAmount', '250'); await p.dispatchEvent('#goalAmount', 'change');
  });
  await step('bank link + test fire', async () => {
    await p.fill('#hookUrl', 'https://hook.example/x'); await p.dispatchEvent('#hookUrl', 'change');
    await p.click('#hookTestBtn');
  });
  await step('sportsapi key + test', async () => {
    await p.fill('#saKey', 'sk_live_test'); await p.dispatchEvent('#saKey', 'change');
    await p.click('#saTestBtn');
  });
  await step('sound: cannon', async () => { await p.selectOption('#soundMode', 'cannon'); await p.click('#soundTest'); });
  await step('api key + test', async () => {
    await p.fill('#apiKey', '123'); await p.dispatchEvent('#apiKey', 'change'); await p.click('#keyTestBtn');
  });
  await step('ask the feeds', () => p.click('#feedPeekBtn'));
  await step('notifications toggle', () => p.click('#notifyOn'));
  await step('export', () => p.click('#exportBtn'));
  await step('close and reopen settings', async () => {
    await p.click('#settingsSheet .sheet-head .icon-btn'); await p.click('#settingsBtn');
  });

  console.log(failures ? '\nFAILED\n' + errs.join('\n') : '\nall clear, no page errors');
  await b.close();
  process.exit(failures ? 1 : 0);
})();
