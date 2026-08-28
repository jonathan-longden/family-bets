/* Ten a Win, without the phone.

   The app can only bank a win while it is open, and a browser will not let a
   page call a bank at all — so the part that matters runs here instead. This
   worker wakes on a schedule, reads the results, and puts the stake into a
   Starling space itself. The token lives in this worker's secrets: it is never
   on a phone, never in a page, and never passes through anybody else's server.

   Two things it must never do, and does not:

   - Pay for the same match twice. Every transfer id is hashed from the match
     id, and Starling treats a repeat of an id as the same transfer, so a
     second attempt is refused by the bank rather than trusted not to happen.
     The app uses the identical hash, so even a phone still configured to pay
     cannot produce a second tenner for the same win.
   - Pay for the backlog. On its first run it writes down what has already
     finished without paying a penny for it, because a worker installed on a
     Sunday night should not empty your account for a season played before it
     existed. Set PAY_BACKLOG to "true" if you actually want the history paid. */

const API = 'https://www.thesportsdb.com/api/v1/json/';
const STARLING = 'https://api.starlingbank.com';
const FINISHED_AFTER_MS = 150 * 60 * 1000;
const FINISHED_WORDS = ['match finished', 'ft', 'finished', 'aet', 'after extra time', 'pen', 'penalties', 'awarded'];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!authorised(url, env)) {
      return json({ error: 'add ?key= with the STATUS_KEY this worker was deployed with' }, 401);
    }
    if (url.pathname === '/spaces') return json(await listSpaces(env));
    if (url.pathname === '/run') return json(await run(env));
    return json(await status(env));
  },
};

function authorised(url, env) {
  if (!env.STATUS_KEY) return true;          // no key set: nothing here is secret
  return url.searchParams.get('key') === env.STATUS_KEY;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ------------------------------------------------------------------ the run

async function run(env) {
  const stake = parseInt(env.STAKE_PENCE || '1000', 10);
  const team = env.TEAM_ID || '133604';
  const key = env.SPORTSDB_KEY || '123';

  let matches;
  try {
    matches = await results(key, team, env.TEAM_NAME || 'Arsenal');
  } catch (err) {
    await note(env, { at: now(), what: 'could not read the results', detail: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }

  const finished = matches.filter((m) => m.finished).sort((a, b) => a.kickoff - b.kickoff);
  const firstRun = !(await env.JAR.get('installed'));
  const payBacklog = String(env.PAY_BACKLOG || '').toLowerCase() === 'true';

  if (firstRun && !payBacklog) {
    for (const m of finished) await env.JAR.put('seen:' + m.id, now());
    await env.JAR.put('installed', now());
    await note(env, { at: now(), what: 'installed', detail: `${finished.length} finished matches written off as history` });
    return { ok: true, installed: true, skipped: finished.length };
  }
  if (firstRun) await env.JAR.put('installed', now());

  const done = [];
  for (const m of finished) {
    if (await env.JAR.get('seen:' + m.id)) continue;

    if (m.result !== 'W') {
      await env.JAR.put('seen:' + m.id, now());
      continue;
    }

    try {
      await deposit(env, stake, 'tenawin-' + m.id);
      await env.JAR.put('seen:' + m.id, now());
      await env.JAR.put('paid:' + m.id, JSON.stringify({ at: now(), pence: stake, opponent: m.opponent, score: m.score }));
      await addToTotal(env, stake);
      await note(env, { at: now(), what: 'paid', detail: `${money(stake)} for beating ${m.opponent} ${m.score}` });
      done.push({ match: m.id, opponent: m.opponent, score: m.score, pence: stake });
    } catch (err) {
      /* Left unseen deliberately: the next run tries again, and the transfer
         id is the same one, so the bank — not this code — decides whether that
         second attempt is a repeat. */
      await note(env, { at: now(), what: 'transfer failed', detail: `${m.opponent}: ${String(err.message || err)}` });
      return { ok: false, paid: done, error: String(err.message || err) };
    }
  }

  await env.JAR.put('lastRun', now());
  return { ok: true, paid: done, checked: finished.length };
}

async function status(env) {
  const list = await env.JAR.list({ prefix: 'paid:' });
  const total = parseInt((await env.JAR.get('total')) || '0', 10);
  return {
    installed: await env.JAR.get('installed'),
    lastRun: await env.JAR.get('lastRun'),
    winsPaid: list.keys.length,
    totalMoved: money(total),
    recent: JSON.parse((await env.JAR.get('log')) || '[]'),
  };
}

async function note(env, entry) {
  const log = JSON.parse((await env.JAR.get('log')) || '[]');
  log.unshift(entry);
  await env.JAR.put('log', JSON.stringify(log.slice(0, 20)));
}

async function addToTotal(env, pence) {
  const total = parseInt((await env.JAR.get('total')) || '0', 10);
  await env.JAR.put('total', String(total + pence));
}

const now = () => new Date().toISOString();
const money = (pence) => '£' + (pence / 100).toFixed(2).replace(/\.00$/, '');

// -------------------------------------------------------------- the results

async function results(key, team, teamName) {
  const last = `${API}${key}/eventslast.php?id=${encodeURIComponent(team)}`;
  const season = `${API}${key}/eventsseason.php?id=${encodeURIComponent(team)}&s=${currentSeason()}`;

  let rows = [];
  try {
    const data = await getJson(last);
    rows = (data && (data.results || data.events)) || [];
  } catch (err) {
    rows = [];
  }
  if (!rows.length) {
    const data = await getJson(season);
    rows = (data && (data.events || data.results)) || [];
  }
  if (!rows.length) throw new Error('no matches came back');
  return rows.map((ev) => normalise(ev, team, teamName)).filter((m) => m.id);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('the results feed answered ' + res.status);
  return res.json();
}

function currentSeason(d = new Date()) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 6 ? y : y - 1;
  return `${start}-${start + 1}`;
}

function kickoffOf(ev) {
  const stamp = ev.strTimestamp || ev.strTimeStamp;
  if (stamp) {
    const t = Date.parse(/[Z+]/.test(stamp) ? stamp : stamp.replace(' ', 'T') + 'Z');
    if (Number.isFinite(t)) return t;
  }
  const day = ev.dateEvent || ev.dateEventLocal;
  if (!day) return null;
  const time = ev.strTime && ev.strTime !== '00:00:00' ? ev.strTime : '15:00:00';
  const parsed = Date.parse(`${day}T${time}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/* The same rule the app banks on: a score is not a result until the match is
   over, by its own status where there is one and by the clock otherwise. */
function normalise(ev, team, teamName) {
  const homeId = ev.idHomeTeam ? String(ev.idHomeTeam) : '';
  const awayId = ev.idAwayTeam ? String(ev.idAwayTeam) : '';
  /* Ids where the feed gives them, the name only as a fallback — and if it
     gives neither, the match is treated as away rather than guessed at, since
     the worst case there is a win going unpaid until someone looks, not a
     loss being paid for. */
  const weAreHome = homeId && awayId
    ? homeId === String(team)
    : !!(teamName && String(ev.strHomeTeam || '').toLowerCase() === String(teamName).toLowerCase());

  const hs = numberOrNull(ev.intHomeScore);
  const as = numberOrNull(ev.intAwayScore);
  const ours = weAreHome ? hs : as;
  const theirs = weAreHome ? as : hs;
  const statusWord = String(ev.strStatus || ev.strProgress || '').trim().toLowerCase();
  const kickoff = kickoffOf(ev);
  const notStarted = ['ns', 'not started', 'postponed', 'canceled', 'cancelled'].includes(statusWord);
  const lateEnough = kickoff !== null && Date.now() - kickoff > FINISHED_AFTER_MS;

  return {
    id: String(ev.idEvent || ''),
    kickoff: kickoff || 0,
    opponent: (weAreHome ? ev.strAwayTeam : ev.strHomeTeam) || 'someone',
    score: ours === null || theirs === null ? '' : `${ours}-${theirs}`,
    result: ours === null || theirs === null ? null : ours > theirs ? 'W' : ours < theirs ? 'L' : 'D',
    finished: ours !== null && theirs !== null && !notStarted && (FINISHED_WORDS.includes(statusWord) || lateEnough),
  };
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------- the Starling

async function listSpaces(env) {
  const accounts = await starling(env, '/api/v2/accounts');
  const out = [];
  for (const account of accounts.accounts || []) {
    let spaces = { savingsGoals: [] };
    try {
      spaces = await starling(env, `/api/v2/account/${account.accountUid}/spaces`);
    } catch (err) {
      spaces = await starling(env, `/api/v2/account/${account.accountUid}/savings-goals`);
    }
    out.push({
      ACCOUNT_UID: account.accountUid,
      name: account.name || account.accountType,
      spaces: (spaces.savingsGoals || spaces.savingsGoalList || []).map((g) => ({
        SPACE_UID: g.savingsGoalUid,
        name: g.name,
      })),
    });
  }
  return { put_these_in_wrangler_toml: out };
}

async function deposit(env, pence, seed) {
  const body = await starling(
    env,
    `/api/v2/account/${env.ACCOUNT_UID}/savings-goals/${env.SPACE_UID}/add-money/${uuidFrom(seed)}`,
    { method: 'PUT', body: JSON.stringify({ amount: { currency: 'GBP', minorUnits: pence } }) }
  );
  if (body && body.success === false) {
    const said = body.errors && body.errors[0] && body.errors[0].message;
    throw new Error(said || 'Starling would not make the transfer');
  }
  return body;
}

async function starling(env, path, options = {}) {
  const res = await fetch(STARLING + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + env.STARLING_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: options.body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    const said = data && data.errors && data.errors[0] && data.errors[0].message;
    throw new Error(said || `Starling answered ${res.status}`);
  }
  return data;
}

/* Identical to the app's, deliberately: the same match must hash to the same
   transfer id in both places, so the bank sees a repeat rather than a second
   payment if both are ever set up at once. */
function uuidFrom(seed) {
  let h = 2166136261 >>> 0;
  const mix = (str) => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  const bytes = [];
  for (let round = 0; round < 16; round++) {
    mix(`${seed}|${round}`);
    bytes.push(h & 0xff);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => (b + 0x100).toString(16).slice(1));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
    .slice(8, 10)
    .join('')}-${hex.slice(10).join('')}`;
}

export { run, status, listSpaces, uuidFrom, normalise, currentSeason };
