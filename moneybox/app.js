/* Ten a Win — a moneybox that fills itself.

   Ten pounds a win, and the only hard problems in that sentence are the two
   nobody thinks about: knowing a match is actually over, and never paying for
   the same one twice.

   A results feed will hand you a score at half time as happily as at full
   time, so a match is only counted once it is finished — by its own status
   where the feed gives one, and otherwise by the clock, two and a half hours
   after kick-off. And every match carries an id, which is what the trophy keys
   on: opening the app fifty times on a Sunday night reads the same win fifty
   times and banks it once.

   Money is held in pence as whole numbers throughout. Pounds only exist at
   the edges — what you type and what you read. */

var $ = function (id) { return document.getElementById(id); };

/* Printed in the footer, so the phone can say which copy it is running
   without a round trip to find out. Bump it on release. */
var BUILD = '2026-08-31 · 22';

var STORE_KEY = 'tenAWin.v1';

/* Arsenal's id in the results feed. The team is a setting — the trophy works for
   anyone — but it opens on the one that was asked for. */
var DEFAULT_TEAM = { id: '133604', name: 'Arsenal', badge: '' };

var API = 'https://www.thesportsdb.com/api/v1/json/';
var FREE_KEY = '123';

/* How long after kick-off a match is assumed over when the feed will not say.
   Ninety minutes, a half-time break, injury time and a slow update: two and a
   half hours is late enough that a live score has settled and early enough
   that Saturday's win is in the trophy by Saturday night. */
var FINISHED_AFTER_MS = 150 * 60 * 1000;

/* Poll no more often than this on app open; a trophy does not need the minute. */
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
    sound: { mode: 'cannon', name: '' },
    league: { id: '4328', name: 'English Premier League' },
    tableOpen: true,
    tableChosen: false,
    table: { at: 0, season: '', rows: [] },
    clubs: { league: '', at: 0, list: [] },
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
    /* Anyone who has run this app before has `tableOpen: false` saved from
       when a boxed-up table was the default. That default was wrong — a box
       you have to scroll inside is a box people cannot scroll — so it is
       overridden until they say otherwise by using the toggle themselves. */
    if (!saved.tableChosen) base.tableOpen = true;

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
    /* Worth shouting about: a trophy that silently stops recording is worse
       than none, because you would go on trusting it. */
    saveFailed = true;
    setStatus('The phone refused to save that — export the trophy and free some space.', 'err');
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

/* The current run of wins, counting back through matches the trophy has actually
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
   schedule is the fallback, and it also catches up a trophy that has not been
   opened for a month, which the last five matches would not. */
/* Both feeds, every time, merged on the event id.

   This used to ask for the last five results and only fall back to the season
   when that came back empty — which is a fallback for the wrong failure. The
   one that actually happens is a stale answer rather than no answer: the last
   five arrive, none of them is Saturday's win, every one of them has already
   been banked, and the app says it is up to date because from where it is
   standing it is. Asking both and merging costs one more request and removes
   the whole class of problem. */
function fetchResults(force) {
  var key = apiKey(), team = state.team.id;
  var last = API + key + '/eventslast.php?id=' + encodeURIComponent(team);
  var season = API + key + '/eventsseason.php?id=' + encodeURIComponent(team) + '&s=' + currentSeason();
  var nothing = function () { return null; };

  return Promise.all([
    fetchJson(last).catch(nothing),
    fetchJson(season).catch(nothing),
    leagueSeasonEvents(currentSeason(), force).then(function (rows) {
      return { events: rows.filter(involvesUs) };
    }).catch(nothing)
  ]).then(function (answers) {
    var seenIds = {}, rows = [];
    answers.forEach(function (data) {
      var list = (data && (data.results || data.events)) || [];
      list.forEach(function (ev) {
        var id = ev && (ev.idEvent || (ev.strHomeTeam + '|' + ev.strAwayTeam + '|' + ev.dateEvent));
        if (!id || seenIds[id]) return;
        seenIds[id] = true;
        rows.push(ev);
      });
    });
    if (!rows.length) throw new Error('no matches came back');
    return rows;
  });
}

/* The next fixture had the same fault as the results: it came from the team's
   own feed, which was still offering a match that had already been played as
   the one to come. Every source is asked, ours are picked out, and the next
   fixture is simply the earliest one that has not kicked off yet — so a feed
   that has not caught up cannot put yesterday in front of you as tomorrow. */
function fetchNext() {
  var nothing = function () { return null; };
  var teamNext = API + apiKey() + '/eventsnext.php?id=' + encodeURIComponent(state.team.id);

  return Promise.all([
    fetchJson(teamNext).catch(nothing),
    fetchJson(leagueNextUrl()).catch(nothing),
    leagueSeasonEvents(currentSeason()).then(function (rows) { return { events: rows }; }).catch(nothing)
  ]).then(function (answers) {
    var seenIds = {}, soonest = null;
    answers.forEach(function (data) {
      var list = (data && (data.events || data.results)) || [];
      list.forEach(function (ev) {
        if (!involvesUs(ev)) return;
        var id = ev.idEvent || (ev.strHomeTeam + '|' + ev.strAwayTeam + '|' + ev.dateEvent);
        if (seenIds[id]) return;
        seenIds[id] = true;
        var m = normalise(ev);
        if (m.result || !m.kickoff || m.kickoff <= Date.now()) return;
        if (!soonest || m.kickoff < soonest.kickoff) soonest = m;
      });
    });
    return soonest;
  });
}

/* The table is read once and kept, so it draws instantly on the next open and
   still draws with no signal at all — a league table an hour old is a league
   table, which is not true of a live score. */
var TABLE_STALE_MS = 10 * 60 * 1000;

function tableUrl(season) {
  return API + apiKey() + '/lookuptable.php?l=' + encodeURIComponent(state.league.id) + '&s=' + season;
}

function leagueEventsUrl(season) {
  return API + apiKey() + '/eventsseason.php?id=' + encodeURIComponent(state.league.id) + '&s=' + season;
}

/* Every club in the league, which the results cannot tell you: a club that has
   not kicked a ball is in no result, and no result carries a badge. Read once
   and kept for a week, since a division's membership does not move during a
   season and neither do the badges. */
var CLUBS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/* Does this row belong to the division being shown?

   A team carries the leagues it plays in — its own and its cups, as idLeague
   through idLeague7 — but plenty of rows carry no league at all, which is how
   an entire division of League One clubs walked into a Premier League table:
   naming nothing was treated as naming ours. Nothing is trusted on that basis
   any more (see below); this only throws out what openly says otherwise. */
function inOurLeague(t) {
  var id = String(state.league.id || '');
  var name = (state.league.name || '').toLowerCase();
  var sawLeague = false;
  for (var i = 0; i <= 7; i++) {
    var suffix = i === 0 ? '' : String(i);
    var rowId = t['idLeague' + suffix];
    var rowName = t['strLeague' + suffix];
    if (rowId) { sawLeague = true; if (String(rowId) === id) return true; }
    if (rowName) { sawLeague = true; if (String(rowName).toLowerCase() === name) return true; }
  }
  return !sawLeague;
}

function asClubs(rows) {
  return (rows || []).filter(inOurLeague).map(function (t) {
    return {
      id: String(t.idTeam || t.teamid || ''),
      name: t.strTeam || t.name || '',
      badge: t.strBadge || t.strTeamBadge || ''
    };
  }).filter(function (t) { return t.name; });
}

/* Who is in the division, asked three ways. None of these is believed on its
   own — see pickDivision. */
function divisionSources(season) {
  var key = apiKey(), id = encodeURIComponent(state.league.id);
  var name = encodeURIComponent(state.league.name || 'English Premier League');
  return [
    function () {
      return fetchJson(tableUrl(season)).then(function (d) {
        return asClubs(d && (d.table || d.standings));
      });
    },
    function () {
      return fetchJson(API + key + '/lookup_all_teams.php?id=' + id).then(function (d) {
        return asClubs(d && d.teams);
      });
    },
    function () {
      return fetchJson(API + key + '/search_all_teams.php?l=' + name).then(function (d) {
        return asClubs(d && d.teams);
      });
    }
  ];
}

function clubKeys(list) {
  var ids = {}, names = {};
  list.forEach(function (c) {
    if (c.id) ids[c.id] = c;
    if (c.name) names[c.name.toLowerCase()] = c;
  });
  return { ids: ids, names: names };
}

/* How much of this list is actually the division we are looking at?

   The fixtures are the ground truth: a club with a league fixture is in the
   league, and no amount of "all teams" from an endpoint can outvote that. So a
   candidate list is scored against the clubs the fixtures already named, and
   one that barely overlaps them is somebody else's division and is thrown out
   whole. That is what a Premier League table with Stockport County in it costs:
   one comparison. */
function overlapWith(list, known) {
  var keys = clubKeys(list), hits = 0;
  known.forEach(function (c) {
    if ((c.id && keys.ids[c.id]) || (c.name && keys.names[c.name.toLowerCase()])) hits++;
  });
  return hits;
}

function goodEnough(list, known) {
  if (!list.length || !known.length) return false;
  var hits = overlapWith(list, known);
  return hits >= Math.max(6, Math.ceil(known.length * 0.6));
}

/* The division list, only ever used to fill in the clubs a fixture list has
   not reached yet and to put badges on the rows. */
function pickDivision(season, known) {
  var have = state.clubs;
  if (have.list.length && have.league === String(state.league.id) &&
      (Date.now() - have.at) < CLUBS_STALE_MS && goodEnough(have.list, known)) {
    return Promise.resolve(have.list);
  }

  var tries = divisionSources(season);
  function next(i) {
    if (i >= tries.length) return Promise.resolve([]);
    return tries[i]().then(function (list) {
      return goodEnough(list, known) ? list : next(i + 1);
    }).catch(function () { return next(i + 1); });
  }

  return next(0).then(function (list) {
    if (!list.length) return [];
    state.clubs = { league: String(state.league.id), at: Date.now(), list: list };
    save();
    return list;
  });
}

/* A finished match, without reference to whose match it is. The same rule the
   trophy banks on: a score is not a result until the match is over, by its own
   status where there is one and by the clock otherwise. */
function settled(ev) {
  var hs = num(ev.intHomeScore), as = num(ev.intAwayScore);
  if (hs === null || as === null) return null;
  var statusRaw = String(ev.strStatus || ev.strProgress || '').trim();
  var status = statusRaw.toLowerCase();
  if (status === 'ns' || status === 'not started' || status === 'postponed' ||
      status === 'canceled' || status === 'cancelled') return null;
  var kickoff = kickoffOf(ev);
  var done = FINISHED_WORDS.indexOf(status) !== -1 ||
             (kickoff !== null && (Date.now() - kickoff) > FINISHED_AFTER_MS);
  if (!done) return null;
  return {
    homeId: String(ev.idHomeTeam || ''), awayId: String(ev.idAwayTeam || ''),
    home: ev.strHomeTeam || '', away: ev.strAwayTeam || '',
    hs: hs, as: as
  };
}

/* The league table, worked out from the league's own results.

   Asking the feed for standings looked like the obvious way and is the wrong
   one: that table is maintained separately and lags — a Saturday of football
   can still be missing from it on Sunday, which makes the card wrong exactly
   when someone looks at it. The results are the same feed the trophy already
   trusts to bank a win, and three points for a win is not a calculation worth
   outsourcing. */
function tableFromEvents(events) {
  var by = {};
  function club(id, name, badge) {
    var key = id || (name || '').toLowerCase();
    if (!key) return null;
    if (!by[key]) {
      by[key] = { id: id || '', name: name || '', badge: badge || '', played: 0, won: 0, drawn: 0,
                  lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
    }
    if (!by[key].name && name) by[key].name = name;
    if (!by[key].badge && badge) by[key].badge = badge;
    return by[key];
  }

  /* Everyone with a fixture in this league is in this league — played or not.
     That is the only membership test worth having: it comes from the same
     fixture list the results come from, so it cannot import somebody else's
     division. */
  /* And a cup tie is not a league match. The season feed is asked for one
     league, but an event that names another is not counted into this table. */
  events = (events || []).filter(function (ev) {
    if (!ev.idLeague && !ev.strLeague) return true;
    if (ev.idLeague && String(ev.idLeague) === String(state.league.id)) return true;
    return !!(ev.strLeague && String(ev.strLeague).toLowerCase() === (state.league.name || '').toLowerCase());
  });

  events.forEach(function (ev) {
    if (ev.idHomeTeam || ev.strHomeTeam) club(String(ev.idHomeTeam || ''), ev.strHomeTeam || '', '');
    if (ev.idAwayTeam || ev.strAwayTeam) club(String(ev.idAwayTeam || ''), ev.strAwayTeam || '', '');
  });

  events.forEach(function (ev) {
    var m = settled(ev);
    if (!m || !m.home || !m.away) return;
    var h = club(m.homeId, m.home), a = club(m.awayId, m.away);
    if (!h || !a) return;
    h.played++; a.played++;
    h.goalsFor += m.hs; h.goalsAgainst += m.as;
    a.goalsFor += m.as; a.goalsAgainst += m.hs;
    if (m.hs > m.as) { h.won++; a.lost++; h.points += 3; }
    else if (m.hs < m.as) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points += 1; a.points += 1; }
  });

  return Object.keys(by).map(function (k) {
    var c = by[k];
    c.gd = c.goalsFor - c.goalsAgainst;
    return c;
  });
}

/* A season that has not kicked off yet has no table, and asking for it gets an
   empty answer rather than an error — so the season before is asked for next,
   and the card says which one it is showing rather than leaving you to
   wonder why Arsenal are eighth. */
function previousSeason(season) {
  var start = parseInt(season.split('-')[0], 10);
  return isFinite(start) ? (start - 1) + '-' + start : season;
}

/* The league's own results, read once and handed to everyone who wants them.

   This feed turns out to be ahead of the team's: the table was showing clubs
   on two games played while the trophy still thought the last Arsenal match
   was ten days ago, because the trophy was asking the team endpoints and only
   the table was asking the league. Same competition, same matches, different
   freshness — so the checker and the next fixture read it too, and a minute's
   memo stops one check fetching it three times. */
var leagueMemo = { at: 0, season: '', rows: null };

/* The memo is there so one check does not fetch the same feed three times. It
   is not there to answer a person who has just pressed the button — they are
   pressing it precisely because they think it has changed, so a manual check
   goes past it. */
function leagueSeasonEvents(season, force) {
  if (!force && leagueMemo.rows && leagueMemo.season === season && (Date.now() - leagueMemo.at) < 60000) {
    return Promise.resolve(leagueMemo.rows);
  }
  return fetchJson(leagueEventsUrl(season)).then(function (d) {
    var rows = (d && (d.events || d.results)) || [];
    leagueMemo = { at: Date.now(), season: season, rows: rows };
    return rows;
  }).catch(function () { return leagueMemo.rows || []; });
}

/* Ours by id where the feed gives ids, by name where it does not. */
function involvesUs(ev) {
  var mine = String(state.team.id), name = (state.team.name || '').toLowerCase();
  if (ev.idHomeTeam || ev.idAwayTeam) {
    return String(ev.idHomeTeam) === mine || String(ev.idAwayTeam) === mine;
  }
  return String(ev.strHomeTeam || '').toLowerCase() === name ||
         String(ev.strAwayTeam || '').toLowerCase() === name;
}

function leagueRoundUrl(season, round) {
  return API + apiKey() + '/eventsround.php?id=' + encodeURIComponent(state.league.id) +
    '&r=' + round + '&s=' + season;
}

function leagueNextUrl() {
  return API + apiKey() + '/eventsnextleague.php?id=' + encodeURIComponent(state.league.id);
}

/* The season feed on the free key returns played matches only, so on an
   opening weekend it knows about sixteen clubs. A round and the next fixtures
   fill in the rest — all fixtures, so all of the division — and the same event
   arriving twice is dropped on its id rather than counted twice. */
function dedupeEvents(lists) {
  var seenIds = {}, out = [];
  lists.forEach(function (rows) {
    (rows || []).forEach(function (ev) {
      var key = ev && (ev.idEvent || (ev.strHomeTeam + '|' + ev.strAwayTeam + '|' + ev.dateEvent));
      if (!key || seenIds[key]) return;
      seenIds[key] = true;
      out.push(ev);
    });
  });
  return out;
}

/* The division list adds the clubs no fixture has named yet, and the badges. */
function augment(clubs, division) {
  var keys = clubKeys(clubs);
  (division || []).forEach(function (d) {
    var known = (d.id && keys.ids[d.id]) || (d.name && keys.names[d.name.toLowerCase()]);
    if (known) {
      if (!known.badge && d.badge) known.badge = d.badge;
      return;
    }
    clubs.push({ id: d.id, name: d.name, badge: d.badge, played: 0, won: 0, drawn: 0, lost: 0,
                 goalsFor: 0, goalsAgainst: 0, points: 0, gd: 0 });
  });
  return clubs;
}

function standingsRows(season) {
  return fetchJson(tableUrl(season)).then(function (data) {
    return (data && (data.table || data.standings)) || [];
  }).catch(function () { return []; });
}

/* Results first, standings only if the results are not there to be had — the
   free key does not open every door, and a lagging table beats no table. */
function fetchTable() {
  var season = currentSeason();
  var noneOf = function () { return null; };
  return Promise.all([
    leagueSeasonEvents(season).then(function (rows) { return { events: rows }; }).catch(noneOf),
    fetchJson(leagueRoundUrl(season, 1)).catch(noneOf),
    fetchJson(leagueNextUrl()).catch(noneOf)
  ])
    .then(function (parts) {
      var events = dedupeEvents(parts.map(function (d) {
        return (d && (d.events || d.results)) || [];
      }));
      var built = events.length ? tableFromEvents(events) : [];
      if (built.length) {
        return pickDivision(season, built).then(function (division) {
          return { season: season, clubs: augment(built, division), source: 'results' };
        });
      }
      return standingsRows(season).then(function (rows) {
        if (rows.length) return { season: season, rows: rows, source: 'standings' };
        var older = previousSeason(season);
        return standingsRows(older).then(function (old) {
          return { season: older, rows: old, source: 'standings' };
        });
      });
    }).then(function (got) {
    var season = got.season, rows = got.rows || [];
    if (got.clubs) return finishTable(season, got.clubs, got.source);
    if (!rows.length) throw new Error('the table came back empty');
    var clubs = rows.map(function (r) {
      var forGoals = num(r.intGoalsFor !== undefined ? r.intGoalsFor : r.goalsfor) || 0;
      var againstGoals = num(r.intGoalsAgainst !== undefined ? r.intGoalsAgainst : r.goalsagainst) || 0;
      var gd = r.intGoalDifference !== undefined ? num(r.intGoalDifference)
             : (r.goalsdifference !== undefined ? num(r.goalsdifference) : null);
      return {
        id: String(r.idTeam || r.teamid || ''),
        name: r.strTeam || r.name || '',
        badge: r.strBadge || r.strTeamBadge || '',
        played: num(r.intPlayed) || 0,
        goalsFor: forGoals,
        gd: gd === null ? forGoals - againstGoals : gd,
        points: num(r.intPoints !== undefined ? r.intPoints : r.total) || 0
      };
    });

    return finishTable(season, clubs, got.source);
  });
}

/* The order anything arrives in is not the order clubs stand in, whether it
   came from the standings or was added up here, so the sort and the numbering
   happen in one place for both. */
function finishTable(season, clubs, source) {
  clubs.sort(function (a, b) {
    return (b.points - a.points) || (b.gd - a.gd) || (b.goalsFor - a.goalsFor) ||
           a.name.localeCompare(b.name);
  });
  clubs.forEach(function (c, i) { c.rank = i + 1; });

  /* Badges do not come with results, so the club list's are used, and any the
     last read had are kept for anything the club list did not cover. */
  var badges = {};
  (state.table.rows || []).forEach(function (r) { if (r.badge) badges[r.id || r.name] = r.badge; });
  (state.clubs.list || []).forEach(function (c) { if (c.badge) { badges[c.id] = c.badge; badges[c.name] = c.badge; } });
  clubs.forEach(function (c) { if (!c.badge) c.badge = badges[c.id] || badges[c.name] || ''; });

  state.table = { at: Date.now(), season: season, source: source, rows: clubs };
  save();
  renderTable();
  return state.table;
}

function refreshTable(force) {
  /* Nothing to police here any more: a kept division list is only used if it
     still matches the clubs the fixtures name, so a wrong one cannot survive
     into the next read however long it was cached for. */
  if (!force && state.table.rows.length && (Date.now() - state.table.at) < TABLE_STALE_MS) {
    renderTable();
    return Promise.resolve();
  }
  return fetchTable().catch(function (err) {
    renderTable(err);
  });
}

var tableScrolled = false;

function renderTable(err) {
  var card = $('tableCard'), body = $('leagueBody'), note = $('tableNote');
  var rows = state.table.rows || [];

  if (!rows.length) {
    /* Nothing worth a card until there is a table; an empty one would just be
       an apology taking up a screen. */
    card.hidden = !err;
    if (err) {
      body.innerHTML = '';
      note.hidden = false;
      note.textContent = 'The table would not load — ' + (err.message || err) + '.';
      $('tableWhen').textContent = '';
    }
    return;
  }

  card.hidden = false;
  note.hidden = true;
  $('tableWhen').textContent = state.table.season.replace('-', '/') +
    (state.table.source === 'standings' ? ' · from the published table' : ' · added up from results') +
    (state.table.at ? ' · read ' + ago(state.table.at) : '');

  var scrollBox = $('tableScroll');
  scrollBox.classList.toggle('open', !!state.tableOpen);
  var toggle = $('tableToggle');
  toggle.hidden = rows.length <= 8;
  toggle.textContent = state.tableOpen ? 'Show less' : 'Show all ' + rows.length;

  body.innerHTML = '';
  var mineRow = null;
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    var mine = r.id && String(r.id) === String(state.team.id);
    if (!mine && !r.id) mine = r.name.toLowerCase() === state.team.name.toLowerCase();
    if (mine) { tr.className = 'mine'; mineRow = tr; }

    var pos = document.createElement('td');
    pos.className = 'pos';
    pos.textContent = r.rank;
    tr.appendChild(pos);

    var club = document.createElement('td');
    club.className = 'club';
    if (r.badge) {
      var img = document.createElement('img');
      img.className = 'badge';
      img.src = r.badge;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); });
      club.appendChild(img);
    }
    club.appendChild(document.createTextNode(r.name));
    tr.appendChild(club);

    [r.played, (r.gd > 0 ? '+' : '') + r.gd, r.points].forEach(function (v, i) {
      var td = document.createElement('td');
      if (i === 2) td.className = 'pts';
      td.textContent = v;
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  /* Scroll the followed club into the middle of the card, once. Doing it with
     scrollIntoView would drag the whole page with it, so the scroller is moved
     directly instead. */
  if (mineRow && !tableScrolled) {
    var scroller = $('tableScroll');
    scroller.scrollTop = Math.max(0, mineRow.offsetTop - (scroller.clientHeight / 2) + (mineRow.offsetHeight / 2));
    tableScrolled = true;
  }
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
  var statusRaw = String(ev.strStatus || ev.strProgress || '').trim();
  var status = statusRaw.toLowerCase();
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
    status: statusRaw,
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
    /* The old name goes out alongside the new one: someone's IFTTT recipe may
       already read it, and renaming a wire contract to match a word on a
       screen is how a working automation quietly stops working. */
    trophy_total_pence: totals().total,
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

  return fetchResults(manual).then(function (rows) {
    var matches = rows.map(normalise).filter(function (m) { return m.id; });
    /* Oldest first, so a trophy catching up on a month banks them in order and
       the streak reads the right way round. */
    matches.sort(function (a, b) { return (a.kickoff || 0) - (b.kickoff || 0); });

    var credited = 0, added = 0, read = 0, matched = 0, newest = null, playing = null;
    matches.forEach(function (m) {
      /* A match with a score that is not over yet is the other reason a win
         can look missing, so it is held on to and named rather than passed
         over in silence. */
      if (!m.finished && m.result && m.kickoff && m.kickoff < Date.now()) playing = m;
      if (!m.finished || !m.result) return;
      read++;
      if (!newest || (m.kickoff || 0) > (newest.kickoff || 0)) newest = m;
      if (state.seen[m.id]) return;
      var entry = bank(m, 'auto');
      if (entry) { added++; credited += entry.amount; }
      else matched++;   // it was already in, put there by hand
    });

    state.lastCheck = Date.now();
    save();
    render();

    /* A finished match moves the table, so a check that banked something is
       worth re-reading it for; one that banked nothing is not. */
    refreshTable(manual || added > 0);

    if (added === 0) {
      if (playing) {
        setStatus(scoreline(playing) + ' is still on — it counts at full time.', 'ok');
      } else if (matched) {
        setStatus('The feed has caught up with ' + (matched === 1 ? 'a match' : matched + ' matches') +
          ' you added by hand — no double counting.', 'ok');
      } else if (newest) {
        /* Naming the last match it could see is what makes "up to date"
           checkable: if that is Saturday and today is Monday, the feed is
           behind, not the trophy. */
        setStatus('Up to date. The latest result it can see is ' + describe(newest) + '.', 'ok');
      } else {
        setStatus('No finished matches in the feed yet.', 'ok');
      }
    } else {
      var word = added === 1 ? 'match' : 'matches';
      setStatus(added + ' new ' + word + ', ' + money(credited) + ' in.', 'ok');
      if (credited > 0) celebrate();
    }
  }).catch(function (err) {
    setStatus('Could not read the results — ' + (err.message || err) + '. Add it by hand if you like.', 'err');
    refreshTable();
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
/* Did somebody already put this match in by hand?

   Telling a person to add a win themselves while the feed catches up sets a
   trap: the feed arrives on Tuesday, the app does not recognise the match it
   already has — a hand-written line carries no match id — and the same win is
   paid twice. So before banking anything, a match is checked against the lines
   added by hand: same opponent, within a day and a half of the same date. If
   one is there, the match id is written onto it and nothing new is created. */
function alreadyByHand(m) {
  var when = m.when ? Date.parse(m.when) : 0;
  var opponent = (m.opponent || '').trim().toLowerCase();
  if (!opponent) return null;
  for (var i = 0; i < state.entries.length; i++) {
    var e = state.entries[i];
    if (e.kind !== 'in' || e.source !== 'manual' || e.eventId) continue;
    if ((e.opponent || '').trim().toLowerCase() !== opponent) continue;
    var theirs = Date.parse(e.when || e.at);
    if (!when || !theirs || Math.abs(theirs - when) > 36 * 60 * 60 * 1000) continue;
    return e;
  }
  return null;
}

function bank(m, source) {
  var byHand = source === 'auto' ? alreadyByHand(m) : null;
  if (byHand) {
    byHand.eventId = m.id || '';
    if (m.score && !byHand.score) byHand.score = m.score;
    if (m.competition) byHand.competition = m.competition;
    if (m.id) state.seen[m.id] = byHand.id;
    save();
    return null;
  }

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
    if (m.result === 'W') soundTheWin();
  }
  return entry;
}

function announce(entry) {
  if (!state.notify) return;
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(money(entry.amount) + ' in the trophy', {
      body: state.team.name + ' ' + (entry.result === 'W' ? 'beat ' : 'drew with ') + entry.opponent +
        (entry.score ? ' ' + entry.score : ''),
      icon: 'icon-192.png',
      tag: 'tenawin-' + entry.id
    });
  } catch (e) { /* notifications are a nicety, never a failure */ }
}

function celebrate() {
  var cup = $('trophy');
  if (!cup) return;
  cup.classList.remove('pop');
  void cup.offsetWidth;
  cup.classList.add('pop');
}

// --------------------------------------------------------------- the noise

/* The cannon is made here rather than downloaded, which is the only way a
   sound survives being offline without carrying a file around: a burst of
   noise pushed through a closing filter for the powder, a sine dropping an
   octave and a half underneath it for the weight, and three notes over the
   top so it reads as a celebration rather than an explosion.

   Anything else is the owner's own file, held in IndexedDB — localStorage
   would throw on the second minute of audio — and played straight from the
   phone. It is never uploaded, never sent to the bank link, and never leaves
   the device. */

var audioCtx = null;
var customUrl = null;
var playing = null;

/* Phones will not make a sound until the person has touched the screen, so
   the audio engine is started on the first touch and kept. */
function armAudio() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

/* A win is usually found on the way in, before anyone has touched anything,
   and a phone will not make a sound until they have. Rather than swallowing
   it, the noise waits for the first touch — which is the tap that opens the
   app's own ledger or settings anyway. */
var gestured = false;
var soundOwed = false;

document.addEventListener('pointerdown', function () {
  gestured = true;
  armAudio();
  if (soundOwed) { soundOwed = false; soundTheWin(); }
});

function fireCannon() {
  var ctx = armAudio();
  if (!ctx) return;
  var t = ctx.currentTime + 0.02;

  // powder: white noise through a filter that shuts as it decays
  var frames = Math.floor(ctx.sampleRate * 0.9);
  var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.2);
  var noise = ctx.createBufferSource();
  noise.buffer = buf;
  var lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1800, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.7);
  var noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.9, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
  noise.connect(lp).connect(noiseGain).connect(ctx.destination);
  noise.start(t);

  // weight: the barrel itself
  var boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(110, t);
  boom.frequency.exponentialRampToValueAtTime(38, t + 0.5);
  var boomGain = ctx.createGain();
  boomGain.gain.setValueAtTime(0.0001, t);
  boomGain.gain.exponentialRampToValueAtTime(0.85, t + 0.02);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
  boom.connect(boomGain).connect(ctx.destination);
  boom.start(t);
  boom.stop(t + 0.9);

  // three notes over the smoke
  [[392.00, 0.34], [523.25, 0.50], [659.25, 0.66]].forEach(function (note) {
    var freq = note[0], at = t + note[1];
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.28, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.8);
  });
}

/* The owner's own file. IndexedDB holds one blob under one key — there is
   only ever one sound — and the handle is opened per use rather than kept,
   because a connection held across a phone's sleep is a connection that has
   been closed underneath you. */
function withStore(mode) {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) return reject(new Error('no store on this browser'));
    var req = indexedDB.open('tenAWin', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('sound'); };
    req.onerror = function () { reject(req.error || new Error('store would not open')); };
    req.onsuccess = function () {
      var db = req.result;
      var tx = db.transaction('sound', mode);
      tx.oncomplete = function () { db.close(); };
      resolve(tx.objectStore('sound'));
    };
  });
}

function saveSound(blob) {
  return withStore('readwrite').then(function (store) {
    return new Promise(function (resolve, reject) {
      var put = store.put(blob, 'win');
      put.onsuccess = function () { resolve(); };
      put.onerror = function () { reject(put.error); };
    });
  });
}

function loadSound() {
  return withStore('readonly').then(function (store) {
    return new Promise(function (resolve, reject) {
      var get = store.get('win');
      get.onsuccess = function () { resolve(get.result || null); };
      get.onerror = function () { reject(get.error); };
    });
  });
}

var MAX_PLAY_MS = 45000;

function playOwnSound() {
  return loadSound().then(function (blob) {
    if (!blob) throw new Error('no sound chosen yet');
    if (playing) { try { playing.pause(); } catch (e) {} }
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = URL.createObjectURL(blob);
    var audio = new Audio(customUrl);
    playing = audio;
    /* Nobody wants four minutes of a song every time Arsenal beat Fulham, and
       trimming the file is the owner's job, so the app stops after a chorus's
       worth and fades rather than cutting. */
    var stopper = setTimeout(function () {
      var fade = setInterval(function () {
        audio.volume = Math.max(0, audio.volume - 0.08);
        if (audio.volume <= 0.01) { clearInterval(fade); audio.pause(); }
      }, 60);
    }, MAX_PLAY_MS);
    audio.addEventListener('ended', function () { clearTimeout(stopper); });
    return audio.play();
  });
}

function soundTheWin() {
  var mode = (state.sound && state.sound.mode) || 'cannon';
  if (mode === 'off') return;
  if (!gestured) { soundOwed = true; return; }
  if (mode === 'mine') {
    playOwnSound().catch(function () { fireCannon(); });   // rather than silence
    return;
  }
  fireCannon();
}

// ---------------------------------------------------------- what it can see

/* When the app and the television disagree, this is how you find out which of
   them is wrong without taking anybody's word for it. Each source is asked
   separately and reported separately — how many matches it returned, how many
   of them are ours — and then every match we can see is listed with what the
   feed says about it and what this app would do with it.

   A feed that has not caught up looks exactly like a broken app from the
   outside. This is the difference. */
function peekFeed() {
  var key = apiKey(), team = encodeURIComponent(state.team.id), season = currentSeason();
  var nothing = function () { return null; };
  var sources = [
    { name: 'the team’s last results', get: fetchJson(API + key + '/eventslast.php?id=' + team).catch(nothing) },
    { name: 'the team’s season', get: fetchJson(API + key + '/eventsseason.php?id=' + team + '&s=' + season).catch(nothing) },
    { name: 'the league’s season', get: leagueSeasonEvents(season).then(function (rows) { return { events: rows }; }).catch(nothing) }
  ];

  return Promise.all(sources.map(function (s2) { return s2.get; })).then(function (answers) {
    var summary = [], seenIds = {}, ours = [];
    answers.forEach(function (data, i) {
      var list = (data && (data.results || data.events)) || [];
      var mine = list.filter(involvesUs);
      var count = list.length === 1 ? '1 match' : list.length + ' matches';
      var mineWord = mine.length === 1 ? '1 of them ours' : mine.length + ' of them ours';
      summary.push(sources[i].name + ': ' + (data === null ? 'no answer' : count + ', ' + mineWord));
      mine.forEach(function (ev) {
        var id = ev.idEvent || (ev.strHomeTeam + '|' + ev.strAwayTeam + '|' + ev.dateEvent);
        if (seenIds[id]) return;
        seenIds[id] = true;
        ours.push(normalise(ev));
      });
    });
    ours.sort(function (a, b) { return (b.kickoff || 0) - (a.kickoff || 0); });
    return { summary: summary, matches: ours.slice(0, 8) };
  });
}

function verdictOn(m) {
  if (!m.result) return 'no score in the feed yet';
  if (!m.finished) return 'the feed does not call it finished yet';
  if (state.seen[m.id]) return 'counted';
  return 'would count on the next check';
}

// ------------------------------------------------------------- the drawing

/* The inside of the cup runs from the rim at 34 to the bottom at 95 in the
   drawing's own coordinates, and the money is a rectangle sliding up through
   a clip of that shape — which is why the level takes the cup's taper without
   anything having to know about it. */
var CUP_TOP = 34, CUP_BOTTOM = 95;

function fillTo(pct) {
  var rect = $('cupFill'), top = $('cupFillTop');
  if (!rect) return;
  var y = CUP_BOTTOM - (Math.max(0, Math.min(100, pct)) / 100) * (CUP_BOTTOM - CUP_TOP);
  rect.setAttribute('y', y.toFixed(2));
  if (top) {
    top.setAttribute('cy', y.toFixed(2));
    top.setAttribute('opacity', pct > 0 ? '0.9' : '0');
  }
}

/* A match in progress is a scoreline, not a result: "beat" has not happened
   yet and saying so at 2-0 with twenty minutes left is how you get shouted at. */
function scoreline(m) {
  return m.venue === 'H'
    ? state.team.name + ' ' + m.score + ' ' + m.opponent
    : m.opponent + ' ' + m.score.split('-').reverse().join('-') + ' ' + state.team.name;
}

function describe(m) {
  var when = m.kickoff ? new Date(m.kickoff) : null;
  return state.team.name + ' ' + (m.result === 'W' ? 'beat' : m.result === 'L' ? 'lost to' : 'drew with') +
    ' ' + m.opponent + (m.score ? ' ' + m.score : '') +
    (when ? ', ' + when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
}

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
  $('ruleLine').textContent = money(state.amounts.W) + ' in the trophy every time they win';
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

  /* The trophy fills towards the target where there is one, and through the
     current hundred where there is not, so it always has somewhere to go. */
  var pct;
  if (state.goal.amount > 0) pct = Math.max(0, Math.min(100, (t.total / state.goal.amount) * 100));
  else pct = t.total <= 0 ? 0 : Math.max(6, ((t.total % 10000) / 10000) * 100);
  fillTo(pct);

  $('statWins').textContent = t.wins;
  $('statOwed').textContent = money(t.owed);
  $('statRun').textContent = streak();

  var moveBtn = $('moveBtn');
  moveBtn.hidden = t.owed <= 0;
  moveBtn.textContent = "I've moved " + money(t.owed);

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
      if (!confirm('Take this line out of the trophy?')) return;
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
  if (!confirm('Tick off ' + money(owed) + ' as moved into your savings?')) return;
  var now = new Date().toISOString();
  state.entries.forEach(function (e) { if (e.kind === 'in' && e.amount > 0 && !e.paid) e.paid = now; });
  save(); render();
  setStatus(money(owed) + ' ticked off. The trophy will stop asking.', 'ok');
});

$('aboutBtn').addEventListener('click', function () { $('aboutSheet').showModal(); });

/* Opened out, the card drops its own scrollbox and grows to the full twenty,
   so the whole table is read by scrolling the page — which is the gesture a
   phone is good at. Closed, it keeps to a screenful and scrolls inside. */
$('tableToggle').addEventListener('click', function () {
  state.tableOpen = !state.tableOpen;
  state.tableChosen = true;
  save();
  renderTable();
  if (!state.tableOpen) {
    tableScrolled = false;
    renderTable();
    $('tableCard').scrollIntoView({ block: 'nearest' });
  }
});

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
  if (entry.amount > 0) { celebrate(); if (result === 'W') soundTheWin(); }
  $('addSheet').close();
  setStatus(money(entry.amount) + ' in by hand.', 'ok');
});

// --- break it open

$('withdrawBtn').addEventListener('click', function () {
  var t = totals();
  $('withdrawHint').textContent = 'There is ' + money(t.total) + ' in the trophy' +
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
  setStatus(money(amount) + ' out of the trophy.', 'ok');
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
  $('soundMode').value = (state.sound && state.sound.mode) || 'cannon';
  $('keyTestOut').textContent = '';
  showSoundName();
  $('notifyOn').checked = !!state.notify;
  $('teamCurrent').textContent = 'Currently following ' + state.team.name + '.';
  $('buildHint').textContent = 'This phone is running build ' + BUILD + '.';
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
bindSetting('soundMode', function (el) { state.sound.mode = el.value; });

function showSoundName() {
  var el = $('soundName');
  if (!el) return;
  el.textContent = state.sound && state.sound.name
    ? state.sound.name
    : 'no file chosen';
}

$('soundPick').addEventListener('click', function () { $('soundFile').click(); });

$('soundFile').addEventListener('change', function () {
  var file = $('soundFile').files[0];
  if (!file) return;
  /* Fifteen megabytes is several minutes of audio and well inside what the
     store will hold; the point of the limit is to fail here, with a sentence,
     rather than at the moment of a win. */
  if (file.size > 15 * 1024 * 1024) {
    $('soundName').textContent = 'that file is too big — trim it first';
    $('soundFile').value = '';
    return;
  }
  saveSound(file).then(function () {
    state.sound.name = file.name;
    state.sound.mode = 'mine';
    $('soundMode').value = 'mine';
    save();
    showSoundName();
  }).catch(function (err) {
    $('soundName').textContent = 'could not keep that file — ' + (err.message || err);
  }).finally(function () { $('soundFile').value = ''; });
});

$('soundTest').addEventListener('click', function () {
  armAudio();
  var mode = $('soundMode').value;
  if (mode === 'off') { $('soundName').textContent = 'nothing to hear — set it to the cannon or your own sound'; return; }
  if (mode === 'cannon') { fireCannon(); return; }
  playOwnSound().catch(function (err) {
    $('soundName').textContent = (err.message || String(err));
  });
});

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
        /* A new club is usually a new league, and a table of the old one would
           be worse than none. */
        if (t.idLeague) state.league = { id: String(t.idLeague), name: t.strLeague || '' };
        state.table = { at: 0, season: '', rows: [] };
        tableScrolled = false;
        save(); render(); refreshNext(); refreshTable(true);
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

/* The escape hatch, for when a phone is serving an app older than the one on
   the server. Everything the app knows lives in localStorage and IndexedDB and
   is left alone; what goes is the copy of the app itself — the caches and the
   worker holding them — and then the page is asked for again under a URL the
   browser has never seen, so nothing of its own can answer. */
$('updateBtn').addEventListener('click', function () {
  var out = $('updateOut');
  out.textContent = 'Fetching…';
  var jobs = [];
  if (window.caches && caches.keys) {
    jobs.push(caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }));
  }
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (r) { return r.unregister(); }));
    }));
  }
  Promise.all(jobs).catch(function () {}).then(function () {
    location.replace(location.pathname + '?fresh=' + Date.now());
  });
});

/* Paste a key, press the button, be told what that key can actually see. The
   whole argument of the last few days was whether the app or the feed was
   behind, and a key is worth exactly what its freshest match says it is. */
$('keyTestBtn').addEventListener('click', function () {
  var key = ($('apiKey').value || '').trim() || FREE_KEY;
  var out = $('keyTestOut');
  out.textContent = 'Asking…';
  fetchJson(API + key + '/eventslast.php?id=' + encodeURIComponent(state.team.id))
    .then(function (data) {
      var rows = (data && (data.results || data.events)) || [];
      if (!rows.length) throw new Error('that key answered, but with no matches');
      var matches = rows.map(function (ev) { return normalise(ev); })
        .filter(function (m) { return m.result; })
        .sort(function (a, b) { return (b.kickoff || 0) - (a.kickoff || 0); });
      if (!matches.length) throw new Error('that key answered, but with no results yet');
      var newest = matches[0];
      var days = newest.kickoff ? Math.floor((Date.now() - newest.kickoff) / 86400000) : null;
      out.textContent = 'Works. Latest it can see: ' + describe(newest) +
        (days === null ? '' : days <= 0 ? ' — today.' : days === 1 ? ' — yesterday.' : ' — ' + days + ' days ago.');
    })
    .catch(function (err) {
      out.textContent = String(err.message || err);
    });
});

$('feedPeekBtn').addEventListener('click', function () {
  var ul = $('feedPeek');
  ul.innerHTML = '<li>Asking…</li>';
  peekFeed().then(function (seen) {
    ul.innerHTML = '';
    seen.summary.forEach(function (line) {
      var li = document.createElement('li');
      li.className = 'peek-source';
      li.textContent = line;
      ul.appendChild(li);
    });
    if (!seen.matches.length) {
      var none = document.createElement('li');
      none.textContent = 'No matches for ' + state.team.name + ' in any of them.';
      ul.appendChild(none);
      return;
    }
    seen.matches.forEach(function (m) {
      var li = document.createElement('li');
      var when = m.kickoff ? new Date(m.kickoff).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';
      var top = document.createElement('div');
      top.textContent = when + ' · ' + (m.venue === 'H' ? state.team.name + ' v ' + m.opponent
                                                        : m.opponent + ' v ' + state.team.name) +
        (m.score ? ' · ' + m.score : '');
      var sub = document.createElement('small');
      sub.textContent = (m.status ? 'feed says "' + m.status + '" · ' : '') + verdictOn(m);
      li.appendChild(top);
      li.appendChild(sub);
      ul.appendChild(li);
    });
  }).catch(function (err) {
    ul.innerHTML = '';
    var li = document.createElement('li');
    li.textContent = 'Could not ask — ' + (err.message || err);
    ul.appendChild(li);
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
    if (!incoming || !Array.isArray(incoming.entries)) throw new Error('that file is not a trophy');
    if (!confirm('Replace what is in the trophy now with ' + incoming.entries.length + ' lines from that file?')) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(incoming));
    state = load();
    render(); refreshNext();
    setStatus('Trophy restored.', 'ok');
  }).catch(function (err) {
    setStatus('Could not read that file — ' + (err.message || err), 'err');
  }).finally(function () { $('importFile').value = ''; });
});

$('resetBtn').addEventListener('click', function () {
  if (!confirm('Erase the whole trophy — every result, the total, and the bank link?')) return;
  if (!confirm('Really? There is no undo and no backup.')) return;
  localStorage.removeItem(STORE_KEY);
  state = freshState();
  save(); render(); refreshNext();
  $('settingsSheet').close();
  setStatus('Empty again.', 'ok');
});

// --------------------------------------------------------------- the clock

/* Nothing runs while the app is shut: a page in a browser gets no background
   time it can be relied on, on a phone least of all. So the trophy catches up on
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
refreshTable();
if (state.lastCheck) setStatus('Last read ' + ago(state.lastCheck) + '.');
maybeCheck();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    /* updateViaCache 'none' keeps the browser's HTTP cache away from the
       worker script itself. Without it the check for a new worker can be
       answered out of the same cache that is serving the old app, which is
       the update never arriving. */
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      /* Ask on every open. Without it a worker can sit unchanged for a day
         before the browser thinks to look, which is a day of the old app. */
      reg.update().catch(function () {});
    }).catch(function (e) { console.warn('sw', e); });

    /* A new worker taking over means the files under it have changed, so the
       page reloads itself once to be the new app rather than the old one
       running against new files.

       Except on the very first visit, where a worker takes over a page that
       had none and nothing has changed at all — reloading there throws away
       whatever the app was in the middle of, which on this app's first open
       is the win it has just found and the sound it is holding until you
       touch the screen. The flag is what stops the rest being a loop. */
    var hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadWorker) return;
      if (sessionStorage.getItem('tenAWin.reloaded')) return;
      try { sessionStorage.setItem('tenAWin.reloaded', '1'); } catch (e) { return; }
      location.reload();
    });
  });
}
