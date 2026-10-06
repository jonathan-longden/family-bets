import { config } from '../config.js';
import { normalizeTitle } from './dedupe.js';

/**
 * The Movie Database, used for one thing: a poster when the provider has none.
 *
 * It is their documented public API, read with a key the operator obtained
 * themselves, and it is the only external metadata source Telly has. Nothing
 * here scrapes a web page, and nothing here looks at IMDb — a title's IMDb id
 * is stored if a provider supplies one, but it is never followed, because
 * IMDb publishes no interface for this and its terms do not permit taking one.
 *
 * Two ways in, and the difference matters:
 *
 *   by id      `/movie/{id}` when a provider already told us the TMDB id.
 *              Exact, one request, and no judgement required.
 *
 *   by search  `/search/movie?query=&year=` when it did not. Inexact, so the
 *              answer is only accepted when the year agrees and the name is
 *              close; and rationed, because a catalogue of twenty-four
 *              thousand films would otherwise be twenty-four thousand
 *              searches. See `budget`.
 *
 * Switched off entirely with no key, in which case every function here says
 * so and the artwork pass falls through to the placeholder.
 */

export const configured = () => Boolean(String(config.tmdb.key || '').trim());

/** TMDB calls a series a "tv". Telly does not, so the mapping lives here. */
const pathFor = (kind) => (kind === 'series' ? 'tv' : 'movie');

/**
 * How many inexact searches one pass may spend.
 *
 * A budget is an object rather than a number so the pass, the adapter and the
 * client all decrement the same one: the ceiling is per pass, not per call
 * site. Lookups by id are not charged to it — they are exact and cheap.
 */
export function makeBudget(n = config.tmdb.lookupsPerRun) {
  return { left: Math.max(Number(n) || 0, 0), spent: 0, searches: 0, byId: 0 };
}

/* ------------------------------------------------------------- requests -- */

let lastAt = 0;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * One request, no faster than the configured delay, with the key attached.
 *
 * A 429 is an instruction: it is honoured once, with the Retry-After they
 * give, and then given up on rather than hammered. A 404 is an answer — that
 * title is not in their database — so it comes back as null, not an error.
 */
async function get(pathname, params = {}, { fetchImpl = fetch } = {}) {
  if (!configured()) return null;
  const url = new URL(config.tmdb.apiBase.replace(/\/+$/, '') + pathname);
  url.searchParams.set('api_key', String(config.tmdb.key).trim());
  if (config.tmdb.language) url.searchParams.set('language', config.tmdb.language);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const delay = Math.max(Number(config.tmdb.requestDelayMs) || 0, 0);
  const since = Date.now() - lastAt;
  if (delay && since < delay) await wait(delay - since);

  for (let attempt = 0; ; attempt++) {
    lastAt = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.max(Number(config.tmdb.timeoutMs) || 12000, 1000));
    let res;
    try {
      res = await fetchImpl(url, {
        signal: ac.signal,
        headers: { accept: 'application/json', 'user-agent': 'Telly/1.0 (personal media catalogue)' }
      });
    } finally { clearTimeout(timer); }

    if (res.status === 404) return null;                 // not in their database
    if (res.status === 429 && attempt === 0) {
      const after = Number(res.headers.get('retry-after'));
      await wait(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : 2000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('TMDB refused the key. Check TELLY_TMDB_KEY.');
    }
    if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
    return res.json();
  }
}

/* The address of a picture, at the size the configuration asks for. Posters
   are fetched at a card's size, not at print resolution: the difference is
   forty kilobytes against two megabytes, times every title in the catalogue. */
export function imageUrl(filePath, size = config.tmdb.posterSize) {
  const p = String(filePath || '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  const base = config.tmdb.imageBase.replace(/\/+$/, '');
  return `${base}/${size}/${p.replace(/^\/+/, '')}`;
}

/* ---------------------------------------------------------------- shapes -- */

const yearOf = (v) => {
  const m = String(v || '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};

/** What Telly wants out of a TMDB record, and nothing else. */
function workFrom(kind, body) {
  if (!body || !body.id) return null;
  const title = String((kind === 'series' ? body.name : body.title) || '').trim();
  return {
    tmdbId: String(body.id),
    imdbId: String((body.external_ids && body.external_ids.imdb_id) || body.imdb_id || '').trim(),
    title,
    originalTitle: String((kind === 'series' ? body.original_name : body.original_title) || '').trim(),
    year: yearOf(kind === 'series' ? body.first_air_date : body.release_date),
    poster: imageUrl(body.poster_path, config.tmdb.posterSize),
    backdrop: imageUrl(body.backdrop_path, config.tmdb.backdropSize),
    description: String(body.overview || '').trim(),
    rating: Number.isFinite(body.vote_average) && body.vote_average > 0
      ? Math.round(body.vote_average * 10) / 10 : null,
    genres: Array.isArray(body.genres) ? body.genres.map(g => String(g.name || '').trim()).filter(Boolean) : [],
    runtimeMinutes: Number(body.runtime) > 0 ? Math.round(body.runtime)
      : (Array.isArray(body.episode_run_time) && body.episode_run_time[0] > 0
          ? Math.round(body.episode_run_time[0]) : 0)
  };
}

/* --------------------------------------------------------------- lookups -- */

/**
 * By the id a provider gave. One request, exact, not charged to the budget.
 * `null` means TMDB does not have that id, which is an answer worth recording.
 */
export async function byId(kind, tmdbId, { budget = null, fetchImpl = fetch } = {}) {
  const id = String(tmdbId || '').trim();
  if (!configured() || !/^\d+$/.test(id)) return null;
  const body = await get(`/${pathFor(kind)}/${id}`, {}, { fetchImpl });
  if (budget) { budget.byId += 1; budget.spent += 1; }
  return workFrom(kind, body);
}

/**
 * How alike two titles are, 0 to 1, on the comparison form the catalogue
 * already uses — so "The Matrix" and "Matrix" are the same thing, and
 * "Arrival" and "Arrival 2" are not.
 */
export function titleScore(a, b) {
  const x = normalizeTitle(a || ''), y = normalizeTitle(b || '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  /* A containment that is nearly the whole string counts; one word inside a
     long title does not. */
  const long = x.length >= y.length ? x : y;
  const short = x.length >= y.length ? y : x;
  if (long.includes(short)) return short.length / long.length;

  /* Otherwise: how many of the shorter title's words appear in the longer. */
  const words = new Set(long.split(' ').filter(Boolean));
  const hits = short.split(' ').filter(w => w && words.has(w)).length;
  const total = short.split(' ').filter(Boolean).length;
  return total ? (hits / total) * 0.9 : 0;
}

/**
 * By title and year — the inexact way, and the rationed one.
 *
 * Three guards, because a wrong poster is worse than no poster:
 *
 *   · a year is required. Searching "Taken" with no year returns a dozen
 *     films and picking one would be a guess.
 *   · the candidate's year must match, or be one out — release dates differ
 *     by territory.
 *   · the name must score at least `minTitleScore`.
 *
 * Returns null when the budget is spent, which is not a failure: the pass
 * records the work as unresolved and the next pass picks it up.
 */
export async function search(kind, title, year, { budget = null, fetchImpl = fetch } = {}) {
  if (!configured()) return null;
  const name = String(title || '').trim();
  if (!name || !year) return null;
  if (budget && budget.left <= 0) return null;

  if (budget) { budget.left -= 1; budget.searches += 1; budget.spent += 1; }
  const params = kind === 'series'
    ? { query: name, first_air_date_year: year }
    : { query: name, year };
  const body = await get(`/search/${pathFor(kind)}`, params, { fetchImpl });
  const results = (body && Array.isArray(body.results)) ? body.results : [];

  let best = null, bestScore = 0;
  for (const r of results.slice(0, 8)) {
    const cand = workFrom(kind, r);
    if (!cand) continue;
    if (cand.year && Math.abs(cand.year - Number(year)) > 1) continue;
    const score = Math.max(titleScore(name, cand.title), titleScore(name, cand.originalTitle));
    if (score > bestScore) { best = cand; bestScore = score; }
  }
  if (!best || bestScore < Number(config.tmdb.minTitleScore)) return null;
  return { ...best, matchScore: Math.round(bestScore * 100) / 100 };
}

/**
 * The whole ladder for one work: the id if there is one, a search if there is
 * not and the budget allows. Says which way it got there, because the pass
 * records that.
 */
export async function resolve(kind, { tmdbId = '', title = '', year = null } = {},
                              { budget = null, fetchImpl = fetch } = {}) {
  if (!configured()) return null;
  if (tmdbId) {
    const exact = await byId(kind, tmdbId, { budget, fetchImpl });
    if (exact) return { ...exact, how: 'id' };
    /* An id that TMDB does not recognise is worth falling through on — the
       provider may have invented it — but only on the usual rations. */
  }
  const found = await search(kind, title, year, { budget, fetchImpl });
  return found ? { ...found, how: 'search' } : null;
}

/** What Settings shows about this source, without ever showing the key. */
export function tmdbStatus() {
  return {
    configured: configured(),
    posterSize: config.tmdb.posterSize,
    backdropSize: config.tmdb.backdropSize,
    language: config.tmdb.language,
    lookupsPerRun: config.tmdb.lookupsPerRun,
    minTitleScore: config.tmdb.minTitleScore,
    /* Their terms ask for this wherever the data is used. */
    attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.'
  };
}
