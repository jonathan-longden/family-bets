/* Ten a Win — a moneybox that fills itself.

   Ten pounds a win, and the only hard problems in that sentence are the two
   nobody thinks about: knowing a match is actually over, and never paying for
   the same one twice.

   A results feed will hand you a score at half time as happily as at full
   time, so a match is only counted once it is finished — by its own status
   where the feed gives one, and otherwise by the clock, two and a half hours
   after kick-off. And every match carries an id, which is what the jar keys
   on: opening the app fifty times on a Sunday night reads the same win fifty
   times and banks it once.

   Money is held in pence as whole numbers throughout. Pounds only exist at
   the edges — what you type and what you read. */

var $ = function (id) { return document.getElementById(id); };

/* Printed in the footer, so the phone can say which copy it is running
   without a round trip to find out. Bump it on release. */
var BUILD = '2026-08-23 · 1';

var STORE_KEY = 'tenAWin.v1';

/* Arsenal's id in the results feed. The team is a setting — the jar works for
   anyone — but it opens on the one that was asked for. */
var DEFAULT_TEAM = { id: '133604', name: 'Arsenal', badge: '' };

var API = 'https://www.thesportsdb.com/api/v1/json/';
var FREE_KEY = '123';

/* How long after kick-off a match is assumed over when the feed will not say.
   Ninety minutes, a half-time break, injury time and a slow update: two and a
   half hours is late enough that a live score has settled and early enough
   that Saturday's win is in the jar by Saturday night. */
var FINISHED_AFTER_MS = 150 * 60 * 1000;

/* Poll no more often than this on app open; a jar does not need the minute. */
var CHECK_EVERY_MS = 15 * 60 * 1000;

// --------------------------------------------------------------- the state

function freshState() {
  return {
    version: 1,
    team: { id: DEFAULT_TEAM.id, name: DEFAULT_TEAM.name, badge: DEFAULT_TEAM.badge },
    amounts: { W: 1000, D: 0, L: 0 },      // pence
    goal: { label: '', amount: 0 },        // pence
    entries: [],                           // newest first
    seen: {},                              // eventId -> entry id, or 'skip'
    hook: { url: '', headerName: '', headerValue: '', auto: true },
    apiKey: '',
    notify: false,
    lastCheck: 0
  };
}

var state = load();

function load() {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshState();
    var saved = JSON.parse(raw);
    var base = freshState();
    // Shallow merge, so a state written by an older build still opens.
    Object.keys(base).forEach(function (k) {
      if (saved[k] === undefined || saved[k] === null) return;
      if (typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = Object.assign(base[k], saved[k]);
      } else {
        base[k] = saved[k];
      }
    });
    return base;
  } catch (e) {
    console.warn('state unreadable, starting fresh', e);
    return freshState();
  }
}

var saveFailed = false;

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    saveFailed = false;
  } catch (e) {
    /* Worth shouting about: a jar that silently stops recording is worse than
       no jar, because you would go on trusting it. */
    saveFailed = true;
    setStatus('The phone refused to save that — export the jar and free some space.', 'err');
  }
}

// ------------------------------------------------------------------- money

function money(pence) {
  var neg = pence < 0;
  var p = Math.abs(Math.round(pence));
  var s = (p % 100 === 0) ? '£' + (p / 100) : '£' + (p / 100).toFixed(2);
  return (neg ? '−' : '') + s;
}

function toPence(pounds) {
  var n = parseFloat(pounds);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function toPounds(pence) { return (pence / 100).toString(); }

// -------------------------------------------------------------- the ledger

function totals() {
  var inSum = 0, outSum = 0, wins = 0, owed = 0;
  state.entries.forEach(function (e) {
    if (e.kind === 'out') { outSum += e.amount; return; }
    inSum += e.amount;
    if (e.result === 'W') wins++;
    if (!e.paid) owed += e.amount;
  });
  return { total: inSum - outSum, wins: wins, owed: owed, taken: outSum, banked: inSum };
}

/* The current run of wins, counting back through matches the jar has actually
   read. Draws and losses are recorded as £0 entries when nothing is staked on
   them, which is exactly why they are recorded: without them a streak would
   count wins either side of a thrashing as consecutive. */
function streak() {
  var n = 0;
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.kind === 'out') continue;
    if (e.result !== 'W') break;
    n++;
  }
  return n;
}

function addEntry(entry) {
  state.entries.unshift(entry);
  state.entries.sort(function (a, b) { return (b.when || b.at) < (a.when || a.at) ? -1 : 1; });
  save();
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

// ------------------------------------------------------------- the results

function apiKey() { return (state.apiKey || '').trim() || FREE_KEY; }

function fetchJson(url, ms) {
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 12000);
  return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
    .then(function (res) {
      if (!res.ok) throw new Error('the results feed answered ' + res.status);
      return res.json();
    })
    .finally(function () { clearTimeout(timer); });
}

/* The season string the feed wants, e.g. "2026-2027". A football season is
   named by the calendar year it starts in, and it starts in July. */
function currentSeason(now) {
  var d = now || new Date();
  var y = d.getFullYear();
  var start = d.getMonth() >= 6 ? y : y - 1;
  return start + '-' + (start + 1);
}

/* Two ways of asking, because the free feed has moved which endpoints it
   gives away before. The last-results call is the cheap one; the season
   schedule is the fallback, and it also catches up a jar that has not been
   opened for a month, which the last five matches would not. */
function fetchResults() {
  var key = apiKey(), team = state.team.id;
  var last = API + key + '/eventslast.php?id=' + encodeURIComponent(team);
  var season = API + key + '/eventsseason.php?id=' + encodeURIComponent(team) + '&s=' + currentSeason();

  return fetchJson(last).then(function (data) {
    var rows = data && (data.results || data.events);
    if (rows && rows.length) return rows;
    throw new Error('no recent matches came back');
  }).catch(function (err) {
    return fetchJson(season).then(function (data) {
      var rows = data && (data.events || data.results);
      if (rows && rows.length) return rows;
      throw err;
    });
  });
}

function fetchNext() {
  var url = API + apiKey() + '/eventsnext.php?id=' + encodeURIComponent(state.team.id);
  return fetchJson(url).then(function (data) {
    var rows = (data && (data.events || data.results)) || [];
    return rows.length ? normalise(rows[0]) : null;
  });
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function kickoffOf(ev) {
  var stamp = ev.strTimestamp || ev.strTimeStamp;
  if (stamp) {
    var t = Date.parse(stamp.indexOf('Z') === -1 && stamp.indexOf('+') === -1 ? stamp.replace(' ', 'T') + 'Z' : stamp);
    if (isFinite(t)) return t;
  }
  var d = ev.dateEvent || ev.dateEventLocal;
  if (!d) return null;
  var time = (ev.strTime && ev.strTime !== '00:00:00') ? ev.strTime : '15:00:00';
  var parsed = Date.parse(d + 'T' + time + 'Z');
  return isFinite(parsed) ? parsed : null;
}

var FINISHED_WORDS = ['match finished', 'ft', 'finished', 'aet', 'after extra time', 'pen', 'penalties', 'awarded'];

function normalise(ev) {
  var homeId = ev.idHomeTeam ? String(ev.idHomeTeam) : '';
  var awayId = ev.idAwayTeam ? String(ev.idAwayTeam) : '';
  var mine = String(state.team.id);
  var weAreHome;
  if (homeId && awayId) {
    weAreHome = homeId === mine;
  } else {
    weAreHome = String(ev.strHomeTeam || '').toLowerCase() === state.team.name.toLowerCase();
  }

  var hs = num(ev.intHomeScore), as = num(ev.intAwayScore);
  var ours = weAreHome ? hs : as;
  var theirs = weAreHome ? as : hs;
  var status = String(ev.strStatus || ev.strProgress || '').trim().toLowerCase();
  var kickoff = kickoffOf(ev);

  var saidFinished = FINISHED_WORDS.indexOf(status) !== -1;
  var saidNotStarted = status === 'ns' || status === 'not started' || status === 'postponed' || status === 'canceled' || status === 'cancelled';
  var lateEnough = kickoff !== null && (Date.now() - kickoff) > FINISHED_AFTER_MS;

  return {
    id: String(ev.idEvent || ''),
    when: kickoff ? new Date(kickoff).toISOString() : null,
    kickoff: kickoff,
    competition: ev.strLeague || ev.strEvent || '',
    round: ev.intRound || '',
    opponent: (weAreHome ? ev.strAwayTeam : ev.strHomeTeam) || 'someone',
    venue: weAreHome ? 'H' : 'A',
    ours: ours,
    theirs: theirs,
    score: (ours === null || theirs === null) ? '' : ours + '-' + theirs,
    result: (ours === null || theirs === null) ? null : (ours > theirs ? 'W' : (ours < theirs ? 'L' : 'D')),
    /* A score alone is not full time — the feed carries live ones too. */
    finished: ours !== null && theirs !== null && !saidNotStarted && (saidFinished || lateEnough)
  };
}

// ------------------------------------------------------------- the banking

/* What a win is worth to the automation on the other end of the webhook.
   IFTTT and its kin read value1/value2/value3 out of a form post, and
   everything else reads JSON, so both shapes carry the same three things:
   the amount, what it was for, and the match id that makes a repeat safe. */
function hookPayload(entry) {
  var pounds = (entry.amount / 100).toFixed(2);
  var note = state.team.name + ' ' + (entry.result === 'W' ? 'beat' : 'played') + ' ' + entry.opponent +
    (entry.score ? ' ' + entry.score : '');
  return {
    event: entry.result === 'W' ? 'win' : 'result',
    amount: Number(pounds),
    amount_pence: entry.amount,
    currency: 'GBP',
    team: state.team.name,
    opponent: entry.opponent,
    competition: entry.competition || '',
    score: entry.score || '',
    played_at: entry.when || entry.at,
    match_id: entry.eventId || entry.id,
    idempotency_key: 'tenawin-' + (entry.eventId || entry.id),
    jar_total_pence: totals().total,
    value1: pounds,
    value2: note,
    value3: 'tenawin-' + (entry.eventId || entry.id)
  };
}

/* Firing the webhook is done twice over, and the second way matters.

   Most webhook endpoints answer a browser with no CORS headers at all, which
   the browser reports to the page as an indistinguishable network error even
   though the request was delivered and the money moved. So the JSON post is
   tried first, and when it throws, the same thing is sent again as a plain
   form post with mode 'no-cors' — a request the browser will make without
   asking permission first, whose answer it will not let us read. That second
   one is recorded honestly as "sent, no answer" rather than as success.

   A custom header rules the fallback out: it forces a preflight, which is the
   very thing an endpoint without CORS will refuse. */
function fireHook(entry) {
  var cfg = state.hook;
  if (!cfg.url) return Promise.resolve(false);

  var payload = hookPayload(entry);
  var headers = { 'Content-Type': 'application/json' };
  if (cfg.headerName && cfg.headerName.trim()) headers[cfg.headerName.trim()] = cfg.headerValue || '';

  entry.hook = { state: 'sending', at: new Date().toISOString() };
  render();

  if (!navigator.onLine) {
    entry.hook = { state: 'failed', at: new Date().toISOString(), detail: 'no signal' };
    save(); render();
    return Promise.resolve(false);
  }

  return fetch(cfg.url, { method: 'POST', headers: headers, body: JSON.stringify(payload) })
    .then(function (res) {
      entry.hook = {
        state: res.ok ? 'sent' : 'failed',
        at: new Date().toISOString(),
        detail: 'answered ' + res.status
      };
      save(); render();
      return res.ok;
    })
    .catch(function (err) {
      if (cfg.headerName && cfg.headerName.trim()) {
        entry.hook = { state: 'failed', at: new Date().toISOString(), detail: String(err.message || err) };
        save(); render();
        return false;
      }
      var form = new URLSearchParams();
      form.set('value1', payload.value1);
      form.set('value2', payload.value2);
      form.set('value3', payload.value3);
      return fetch(cfg.url, { method: 'POST', mode: 'no-cors', body: form })
        .then(function () {
          entry.hook = { state: 'blind', at: new Date().toISOString(), detail: 'sent, no answer readable' };
          save(); render();
          return true;
        })
        .catch(function (err2) {
          entry.hook = { state: 'failed', at: new Date().toISOString(), detail: String(err2.message || err2) };
          save(); render();
          return false;
        });
    });
}

// -------------------------------------------------------------- the checks

var checking = false;

function checkNow(manual) {
  if (checking) return Promise.resolve();
  checking = true;
  $('checkBtn').disabled = true;
  setStatus('Reading the results…');

  return fetchResults().then(function (rows) {
    var matches = rows.map(normalise).filter(function (m) { return m.id; });
    /* Oldest first, so a jar catching up on a month banks them in order and
       the streak reads the right way round. */
    matches.sort(function (a, b) { return (a.kickoff || 0) - (b.kickoff || 0); });

    var credited = 0, added = 0, read = 0;
    matches.forEach(function (m) {
      if (!m.finished || !m.result) return;
      read++;
      if (state.seen[m.id]) return;
      var entry = bank(m, 'auto');
      if (entry) { added++; credited += entry.amount; }
    });

    state.lastCheck = Date.now();
    save();
    render();

    if (added === 0) {
      setStatus(read ? 'Nothing new — the jar is up to date.' : 'No finished matches in the feed yet.', 'ok');
    } else {
      var word = added === 1 ? 'match' : 'matches';
      setStatus(added + ' new ' + word + ', ' + money(credited) + ' in.', 'ok');
      if (credited > 0) celebrate();
    }
  }).catch(function (err) {
    setStatus('Could not read the results — ' + (err.message || err) + '. Add it by hand if you like.', 'err');
    if (manual) console.warn(err);
  }).finally(function () {
    checking = false;
    $('checkBtn').disabled = false;
    refreshNext();
  });
}

/* One match in, one entry out — or none, when the result is worth nothing and
   there is nothing to record but the fact that it was read. Either way the id
   is marked seen, which is what stops the next check paying it again. */
function bank(m, source) {
  var amount = state.amounts[m.result] || 0;
  var entry = {
    id: newId(),
    kind: 'in',
    result: m.result,
    opponent: m.opponent,
    competition: m.competition,
    score: m.score,
    venue: m.venue,
    amount: amount,
    when: m.when || new Date().toISOString(),
    at: new Date().toISOString(),
    eventId: m.id || '',
    source: source,
    paid: null,
    hook: null
  };
  addEntry(entry);
  if (m.id) { state.seen[m.id] = entry.id; save(); }

  if (amount > 0) {
    if (state.hook.url && state.hook.auto) fireHook(entry);
    announce(entry);
  }
  return entry;
}

function announce(entry) {
  if (!state.notify) return;
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(money(entry.amount) + ' in the jar', {
      body: state.team.name + ' ' + (entry.result === 'W' ? 'beat ' : 'drew with ') + entry.opponent +
        (entry.score ? ' ' + entry.score : ''),
      icon: 'icon-192.png',
      tag: 'tenawin-' + entry.id
    });
  } catch (e) { /* notifications are a nicety, never a failure */ }
}

function celebrate() {
  var glass = document.querySelector('.jar-glass');
  if (!glass) return;
  glass.classList.remove('pop');
  void glass.offsetWidth;
  glass.classList.add('pop');
}

// ------------------------------------------------------------- the drawing

function setStatus(text, kind) {
  var el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function ago(ms) {
  var d = Date.now() - ms;
  if (d < 60000) return 'just now';
  var mins = Math.round(d / 60000);
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  var hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  var days = Math.round(hrs / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

function dayLabel(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function render() {
  var t = totals();

  $('teamName').textContent = state.team.name;
  $('ruleLine').textContent = money(state.amounts.W) + ' in the jar every time they win';
  var crest = $('crest');
  if (state.team.badge) { crest.src = state.team.badge; crest.hidden = false; }
  else { crest.hidden = true; }

  $('totalFigure').textContent = money(t.total);
  $('totalCaption').textContent = t.banked === 0
    ? 'nothing in it yet'
    : money(t.banked) + ' in' + (t.taken ? ', ' + money(t.taken) + ' back out' : '');

  var goalLine = $('goalLine');
  if (state.goal.amount > 0) {
    var left = state.goal.amount - t.total;
    goalLine.hidden = false;
    goalLine.textContent = left > 0
      ? money(left) + ' to go' + (state.goal.label ? ' for ' + state.goal.label : '')
      : (state.goal.label ? state.goal.label + ' — paid for' : 'target reached');
  } else {
    goalLine.hidden = true;
  }

  /* The jar fills towards the target where there is one, and through the
     current hundred where there is not, so it always has somewhere to go. */
  var pct;
  if (state.goal.amount > 0) pct = Math.max(0, Math.min(100, (t.total / state.goal.amount) * 100));
  else pct = t.total <= 0 ? 0 : Math.max(6, ((t.total % 10000) / 10000) * 100);
  $('jarFill').style.height = pct + '%';

  $('statWins').textContent = t.wins;
  $('statOwed').textContent = money(t.owed);
  $('statRun').textContent = streak();

  var moveBtn = $('moveBtn');
  moveBtn.hidden = t.owed <= 0;
  moveBtn.textContent = 'Mark ' + money(t.owed) + ' moved';

  renderLedger();
  $('buildLine').textContent = 'Build ' + BUILD + (state.lastCheck ? ' · checked ' + ago(state.lastCheck) : '');
}

function renderLedger() {
  var ul = $('ledger');
  ul.innerHTML = '';
  $('ledgerEmpty').hidden = state.entries.length > 0;

  state.entries.slice(0, 60).forEach(function (e) {
    var li = document.createElement('li');

    var pill = document.createElement('span');
    pill.className = 'pill ' + (e.kind === 'out' ? 'out' : e.result);
    pill.textContent = e.kind === 'out' ? '↑' : e.result;
    li.appendChild(pill);

    var body = document.createElement('div');
    body.className = 'entry';

    var top = document.createElement('div');
    top.className = 'entry-top';
    if (e.kind === 'out') {
      top.textContent = e.note || 'Taken out';
    } else {
      top.textContent = (e.result === 'W' ? 'Beat ' : e.result === 'D' ? 'Drew with ' : 'Lost to ') + e.opponent +
        (e.score ? ' ' + e.score : '');
    }
    body.appendChild(top);

    var sub = document.createElement('div');
    sub.className = 'entry-sub';
    var bits = [];
    bits.push(dayLabel(e.when || e.at));
    if (e.kind === 'in') {
      if (e.competition) bits.push(e.competition);
      bits.push(e.venue === 'H' ? 'home' : 'away');
      if (e.source === 'manual') bits.push('added by hand');
    }
    sub.textContent = bits.filter(Boolean).join(' · ');

    if (e.kind === 'in' && e.amount > 0) {
      var flag = document.createElement('span');
      flag.className = 'flag';
      if (e.hook && e.hook.state === 'sent') flag.textContent = ' · sent to the bank link';
      else if (e.hook && e.hook.state === 'blind') flag.textContent = ' · fired at the bank link';
      else if (e.hook && e.hook.state === 'sending') flag.textContent = ' · sending…';
      else if (e.hook && e.hook.state === 'failed') { flag.className = 'flag bad'; flag.textContent = ' · bank link failed'; }
      else if (e.paid) flag.textContent = ' · moved';
      if (flag.textContent) sub.appendChild(flag);
    }
    body.appendChild(sub);
    li.appendChild(body);

    var amt = document.createElement('span');
    amt.className = 'amount' + (e.kind === 'out' ? ' out' : (e.amount === 0 ? ' zero' : ''));
    amt.textContent = (e.kind === 'out' ? '−' : '') + money(e.amount);
    li.appendChild(amt);

    var btns = document.createElement('div');
    btns.className = 'rowbtns';
    if (e.kind === 'in' && e.amount > 0 && !e.paid) {
      btns.appendChild(button('Moved', 'ghost', function () {
        e.paid = new Date().toISOString(); save(); render();
      }));
    }
    if (e.kind === 'in' && e.amount > 0 && state.hook.url && (!e.hook || e.hook.state === 'failed')) {
      btns.appendChild(button('Send', 'ghost', function () { fireHook(e); }));
    }
    btns.appendChild(button('✕', 'ghost', function () {
      if (!confirm('Take this line out of the jar?')) return;
      remove(e);
    }));
    li.appendChild(btns);

    ul.appendChild(li);
  });
}

function button(label, cls, onClick) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/* Removing an entry has to forget the match too, or the next check reads it,
   finds it seen, and the line can never come back. */
function remove(entry) {
  state.entries = state.entries.filter(function (x) { return x.id !== entry.id; });
  Object.keys(state.seen).forEach(function (k) {
    if (state.seen[k] === entry.id) delete state.seen[k];
  });
  save();
  render();
}

function refreshNext() {
  fetchNext().then(function (m) {
    var card = $('nextCard');
    if (!m) { card.hidden = true; return; }
    card.hidden = false;
    $('nextFixture').textContent = m.venue === 'H'
      ? state.team.name + ' v ' + m.opponent
      : m.opponent + ' v ' + state.team.name;
    var when = m.kickoff ? new Date(m.kickoff) : null;
    $('nextWhen').textContent = when
      ? when.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' +
        when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
        (m.competition ? ' · ' + m.competition : '')
      : (m.competition || '');
    $('nextStake').textContent = money(state.amounts.W) + ' riding on it.';
  }).catch(function () {
    $('nextCard').hidden = true;
  });
}

// -------------------------------------------------------------- the wiring

$('checkBtn').addEventListener('click', function () { checkNow(true); });

$('moveBtn').addEventListener('click', function () {
  var owed = totals().owed;
  if (owed <= 0) return;
  if (!confirm('Mark ' + money(owed) + ' as moved into your savings?')) return;
  var now = new Date().toISOString();
  state.entries.forEach(function (e) { if (e.kind === 'in' && e.amount > 0 && !e.paid) e.paid = now; });
  save(); render();
  setStatus(money(owed) + ' marked moved.', 'ok');
});

$('aboutBtn').addEventListener('click', function () { $('aboutSheet').showModal(); });

// --- add by hand

$('addBtn').addEventListener('click', function () {
  $('addDate').value = new Date().toISOString().slice(0, 10);
  $('addResult').value = 'W';
  $('addAmount').value = toPounds(state.amounts.W);
  $('addOpponent').value = '';
  $('addScore').value = '';
  $('addSheet').showModal();
});

$('addResult').addEventListener('change', function () {
  $('addAmount').value = toPounds(state.amounts[$('addResult').value] || 0);
});

$('addForm').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var result = $('addResult').value;
  var when = $('addDate').value ? new Date($('addDate').value + 'T15:00:00').toISOString() : new Date().toISOString();
  var entry = {
    id: newId(),
    kind: 'in',
    result: result,
    opponent: $('addOpponent').value.trim() || 'someone',
    competition: '',
    score: $('addScore').value.trim(),
    venue: 'H',
    amount: toPence($('addAmount').value),
    when: when,
    at: new Date().toISOString(),
    eventId: '',
    source: 'manual',
    paid: null,
    hook: null
  };
  addEntry(entry);
  if (entry.amount > 0 && state.hook.url && state.hook.auto) fireHook(entry);
  render();
  if (entry.amount > 0) celebrate();
  $('addSheet').close();
  setStatus(money(entry.amount) + ' in by hand.', 'ok');
});

// --- break it open

$('withdrawBtn').addEventListener('click', function () {
  var t = totals();
  $('withdrawHint').textContent = 'There is ' + money(t.total) + ' in the jar' +
    (t.owed > 0 ? ', of which ' + money(t.owed) + ' you have not actually moved into savings yet.' : '.');
  $('wdAmount').value = toPounds(Math.max(0, t.total));
  $('wdNote').value = '';
  $('withdrawSheet').showModal();
});

$('withdrawForm').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var amount = toPence($('wdAmount').value);
  if (amount <= 0) { $('withdrawSheet').close(); return; }
  addEntry({
    id: newId(),
    kind: 'out',
    amount: amount,
    note: $('wdNote').value.trim(),
    when: new Date().toISOString(),
    at: new Date().toISOString()
  });
  render();
  $('withdrawSheet').close();
  setStatus(money(amount) + ' out of the jar.', 'ok');
});

document.querySelectorAll('[data-close]').forEach(function (b) {
  b.addEventListener('click', function () { b.closest('dialog').close(); });
});

// --- settings

$('settingsBtn').addEventListener('click', function () {
  $('amtWin').value = toPounds(state.amounts.W);
  $('amtDraw').value = toPounds(state.amounts.D);
  $('amtLoss').value = toPounds(state.amounts.L);
  $('goalLabel').value = state.goal.label;
  $('goalAmount').value = state.goal.amount ? toPounds(state.goal.amount) : '';
  $('hookUrl').value = state.hook.url;
  $('hookHeaderName').value = state.hook.headerName;
  $('hookHeaderValue').value = state.hook.headerValue;
  $('hookAuto').checked = !!state.hook.auto;
  $('apiKey').value = state.apiKey;
  $('notifyOn').checked = !!state.notify;
  $('teamCurrent').textContent = 'Currently following ' + state.team.name + '.';
  $('teamResults').innerHTML = '';
  $('hookTestOut').textContent = '';
  $('settingsSheet').showModal();
});

/* Settings are saved as they are changed rather than behind an OK button:
   there is no half-applied state worth protecting here, and a sheet that is
   swiped away should not lose what you just typed. */
function bindSetting(id, apply) {
  var el = $(id);
  el.addEventListener('change', function () { apply(el); save(); render(); });
}

bindSetting('amtWin', function (el) { state.amounts.W = toPence(el.value); });
bindSetting('amtDraw', function (el) { state.amounts.D = toPence(el.value); });
bindSetting('amtLoss', function (el) { state.amounts.L = toPence(el.value); });
bindSetting('goalLabel', function (el) { state.goal.label = el.value.trim(); });
bindSetting('goalAmount', function (el) { state.goal.amount = toPence(el.value); });
bindSetting('hookUrl', function (el) { state.hook.url = el.value.trim(); });
bindSetting('hookHeaderName', function (el) { state.hook.headerName = el.value.trim(); });
bindSetting('hookHeaderValue', function (el) { state.hook.headerValue = el.value; });
bindSetting('hookAuto', function (el) { state.hook.auto = el.checked; });
bindSetting('apiKey', function (el) { state.apiKey = el.value.trim(); });

$('notifyOn').addEventListener('change', function () {
  var want = $('notifyOn').checked;
  if (!want) { state.notify = false; save(); return; }
  if (typeof Notification === 'undefined') {
    $('notifyOn').checked = false;
    setStatus('This browser will not do notifications.', 'err');
    return;
  }
  Notification.requestPermission().then(function (p) {
    state.notify = p === 'granted';
    $('notifyOn').checked = state.notify;
    save();
  });
});

$('teamSearchBtn').addEventListener('click', function () {
  var q = $('teamQuery').value.trim();
  if (!q) return;
  var ul = $('teamResults');
  ul.innerHTML = '<li><span>Looking…</span></li>';
  fetchJson(API + apiKey() + '/searchteams.php?t=' + encodeURIComponent(q)).then(function (data) {
    var teams = (data && data.teams) || [];
    ul.innerHTML = '';
    if (!teams.length) { ul.innerHTML = '<li><span>Nothing by that name.</span></li>'; return; }
    teams.slice(0, 8).forEach(function (t) {
      var li = document.createElement('li');
      var badge = t.strBadge || t.strTeamBadge || '';
      if (badge) {
        var img = document.createElement('img');
        img.src = badge; img.alt = '';
        li.appendChild(img);
      }
      var name = document.createElement('span');
      name.textContent = t.strTeam;
      var small = document.createElement('small');
      small.textContent = [t.strLeague, t.strCountry].filter(Boolean).join(' · ');
      name.appendChild(small);
      li.appendChild(name);
      li.appendChild(button('Follow', 'secondary small', function () {
        state.team = { id: String(t.idTeam), name: t.strTeam, badge: badge };
        save(); render(); refreshNext();
        $('teamCurrent').textContent = 'Currently following ' + state.team.name + '.';
        ul.innerHTML = '';
      }));
      ul.appendChild(li);
    });
  }).catch(function (err) {
    ul.innerHTML = '';
    var li = document.createElement('li');
    li.textContent = 'Could not search — ' + (err.message || err);
    ul.appendChild(li);
  });
});

$('hookTestBtn').addEventListener('click', function () {
  if (!state.hook.url) { $('hookTestOut').textContent = 'No address yet.'; return; }
  $('hookTestOut').textContent = 'Sending…';
  var probe = {
    id: 'test', kind: 'in', result: 'W', opponent: 'a test',
    competition: 'Ten a Win test', score: '', venue: 'H',
    amount: 1, when: new Date().toISOString(), at: new Date().toISOString(),
    eventId: 'test-' + Date.now(), source: 'test', paid: null, hook: null
  };
  fireHook(probe).then(function () {
    var s = probe.hook || {};
    $('hookTestOut').textContent =
      s.state === 'sent' ? 'Answered — the link works.' :
      s.state === 'blind' ? 'Fired. The browser cannot read the answer, so check the other end.' :
      'Failed: ' + (s.detail || 'no answer');
  });
});

$('exportBtn').addEventListener('click', function () {
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ten-a-win-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
});

$('importBtn').addEventListener('click', function () { $('importFile').click(); });

$('importFile').addEventListener('change', function () {
  var file = $('importFile').files[0];
  if (!file) return;
  file.text().then(function (text) {
    var incoming = JSON.parse(text);
    if (!incoming || !Array.isArray(incoming.entries)) throw new Error('that file is not a jar');
    if (!confirm('Replace what is in the jar now with ' + incoming.entries.length + ' lines from that file?')) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(incoming));
    state = load();
    render(); refreshNext();
    setStatus('Jar restored.', 'ok');
  }).catch(function (err) {
    setStatus('Could not read that file — ' + (err.message || err), 'err');
  }).finally(function () { $('importFile').value = ''; });
});

$('resetBtn').addEventListener('click', function () {
  if (!confirm('Erase the whole jar — every result, the total, and the bank link?')) return;
  if (!confirm('Really? There is no undo and no backup.')) return;
  localStorage.removeItem(STORE_KEY);
  state = freshState();
  save(); render(); refreshNext();
  $('settingsSheet').close();
  setStatus('Empty again.', 'ok');
});

// --------------------------------------------------------------- the clock

/* Nothing runs while the app is shut: a page in a browser gets no background
   time it can be relied on, on a phone least of all. So the jar catches up on
   the way in — every open, and every return to the app — and quietly on a
   timer while it is in front of you, which covers a Sunday afternoon spent
   watching the score. */
function maybeCheck() {
  if (!navigator.onLine) return;
  if (Date.now() - (state.lastCheck || 0) < CHECK_EVERY_MS) return;
  checkNow(false);
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') { render(); maybeCheck(); }
});

window.addEventListener('online', maybeCheck);
setInterval(maybeCheck, 5 * 60 * 1000);

render();
refreshNext();
if (state.lastCheck) setStatus('Last read ' + ago(state.lastCheck) + '.');
maybeCheck();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('sw', e); });
  });
}
