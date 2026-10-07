import { openDb, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { fetchArtwork, cachedIdFor, cacheFull, reviveEvicted } from './artwork.js';
import * as tmdb from './tmdb.js';

/**
 * Getting a poster onto every card, in order of preference.
 *
 *   1. THE PROVIDER'S OWN. If a provider published a poster and it is a real
 *      picture, that is the answer — it is the artwork for the copy the
 *      household can actually play, and no outside service is asked.
 *
 *   2. TMDB BY ID. A provider that supplies a TMDB id has told us exactly
 *      which film this is. One request, no judgement, nothing to get wrong.
 *      Xtream panels supply these, so on a real subscription this is the
 *      common case.
 *
 *   3. TMDB BY TITLE AND YEAR, rationed. Inexact, so it is only trusted when
 *      the year agrees and the name is close, and only attempted within the
 *      pass's budget. A catalogue of twenty-four thousand films must not
 *      become twenty-four thousand searches, which is why every outcome is
 *      written to `art_state` and a work that came back empty is left alone
 *      for a month rather than asked again tomorrow.
 *
 *   4. NOTHING. Which is a perfectly good answer: the clients draw their own
 *      artwork from the title, and /catalogue/art/placeholder serves a plain
 *      one for anything that would rather have an image.
 *
 * Whatever is found is fetched through the existing artwork cache, so a client
 * is handed an id on this server rather than somebody else's URL, the picture
 * is fetched once for the whole house, and the size ceiling applies.
 *
 * This is a pass over rows that already exist. It imports nothing, it never
 * touches a source or a stream, and running it does not re-import anything.
 */

const TABLE = { movie: 'catalogue_movies', series: 'catalogue_series' };

/** How long a work that nobody has a poster for is left alone. */
const retryAfter = () => new Date(Date.now() - 30 * 86400e3).toISOString();

/**
 * The works worth looking at.
 *
 * Three kinds: never considered; considered and found nothing, long enough ago
 * to be worth another try; and settled on a poster that has since fallen out
 * of the cache, which is a poster that needs fetching again.
 */
export function needingArtwork(kind, limit = config.artwork.batch) {
  const table = TABLE[kind];
  if (!table) return [];
  return openDb().prepare(`SELECT id, canonical_title, year, poster_url, backdrop_url,
        description, rating, art_state, art_checked_at
      FROM ${table} w
      WHERE w.art_state = ''
         /* Looked at while there was no TMDB key: the answer changes the
            moment one is set, so it is due now rather than in a month. */
         OR w.art_state = 'nokey'
         OR (w.art_state = 'none' AND (w.art_checked_at IS NULL OR w.art_checked_at < ?))
         /* A poster that has fallen out of the cache needs fetching again —
            unless it was evicted to make room, in which case fetching it
            would evict another to pay for it. Those rows come back on their
            own once the cache is under its ceiling again; see reviveEvicted. */
         OR (w.art_state IN ('provider', 'tmdb') AND NOT EXISTS (
               SELECT 1 FROM artwork_cache a WHERE a.url = w.poster_url
                 AND a.state IN ('cached', 'evicted')))
      ORDER BY w.art_state <> '', w.art_checked_at IS NOT NULL, w.art_checked_at, w.id
      LIMIT ?`)
    .all(retryAfter(), Math.max(Number(limit) || 1, 1));
}

/** True when the cache already holds this exact picture. */
const alreadyCached = (url) => Boolean(url && cachedIdFor(url));

function mark(kind, id, state, at = nowIso()) {
  openDb().prepare(`UPDATE ${TABLE[kind]} SET art_state = ?, art_checked_at = ? WHERE id = ?`)
    .run(state, at, id);
  return state;
}

/** The TMDB id a provider already gave for this work, if any. */
export function storedTmdbId(kind, id) {
  const row = openDb().prepare(`SELECT value FROM catalogue_ids
      WHERE work_kind = ? AND work_id = ? AND scheme = 'tmdb' LIMIT 1`).get(kind, Number(id));
  return row ? String(row.value) : '';
}

function rememberIds(kind, id, found) {
  const db = openDb();
  const at = nowIso();
  for (const [scheme, value] of [['tmdb', found.tmdbId], ['imdb', found.imdbId]]) {
    if (!value) continue;
    /* The catalogue's own table, the same one a provider's ids go in — so a
       title resolved here deduplicates against a provider that quotes the
       same id later. */
    db.prepare(`INSERT INTO catalogue_ids (work_kind, work_id, scheme, value, created_at)
        VALUES (?,?,?,?,?) ON CONFLICT(work_kind, scheme, value) DO NOTHING`)
      .run(kind, Number(id), scheme, String(value), at);
  }
}

/**
 * Fill in only what is empty.
 *
 * A provider that gave a plot keeps its plot. TMDB is a fallback, not an
 * authority: it is here for the gaps.
 */
function fillGaps(kind, row, found) {
  const sets = [], args = [];
  const add = (col, val) => { sets.push(`${col} = ?`); args.push(val); };
  if (found.poster) add('poster_url', found.poster);
  if (found.backdrop && !row.backdrop_url) add('backdrop_url', found.backdrop);
  if (found.description && !row.description) add('description', found.description);
  if (found.rating != null && row.rating == null) add('rating', found.rating);
  if (!sets.length) return;
  openDb().prepare(`UPDATE ${TABLE[kind]} SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...args, nowIso(), row.id);
}

/**
 * One work, through the ladder. Returns what it settled on.
 *
 * Never throws: a poster is a nicety, and a pass over two hundred of them
 * must not end because one picture server was rude.
 */
export async function resolveArtwork(kind, row, { budget = null, fetchImpl = fetch,
                                                  provider = null } = {}) {
  const at = nowIso();
  try {
    /* 1. The provider's own, if it is real. Already cached means already
          answered — no request at all, which is what makes a second pass over
          a settled catalogue nearly free. */
    const own = String(row.poster_url || '').trim();
    if (own && /^https?:\/\//i.test(own)) {
      if (alreadyCached(own)) return mark(kind, row.id, 'provider', at);
      const got = await fetchArtwork(own, { provider, fetchImpl });
      if (got && got.state === 'cached') return mark(kind, row.id, 'provider', at);
      if (got && got.state === 'reference_only') return mark(kind, row.id, 'provider', at);
      /* A poster that will not load is not a poster. Fall through. */
    }

    /* 2 and 3. TMDB, by the id if there is one and by name if there is not.
       A full cache is no longer a reason to skip this: the picture that
       comes back makes room for itself by evicting the least recently used
       ones, so the ceiling holds without the catalogue stopping. */
    if (tmdb.configured()) {
      const found = await tmdb.resolve(kind, {
        tmdbId: storedTmdbId(kind, row.id),
        title: row.canonical_title,
        year: row.year
      }, { budget, fetchImpl });

      if (found) {
        rememberIds(kind, row.id, found);
        if (found.poster) {
          const got = await fetchArtwork(found.poster, { fetchImpl });
          if (got && got.state === 'cached') {
            fillGaps(kind, row, found);
            return mark(kind, row.id, 'tmdb', at);
          }
        }
        /* Found the title but not a picture: the ids and any filled gaps are
           still worth keeping. */
        fillGaps(kind, row, { ...found, poster: '' });
      }
    }

    /* 4. Nothing, said plainly and remembered — and remembered differently
          when the reason was that there was nowhere to look. A catalogue
          imported before a TMDB key was set must not have to wait a month to
          be reconsidered. */
    return mark(kind, row.id, tmdb.configured() ? 'none' : 'nokey', at);
  } catch (e) {
    /* An error is not a verdict: leave the state alone so the next pass tries
       again, but stamp the time so it is not retried in a tight loop. */
    openDb().prepare(`UPDATE ${TABLE[kind]} SET art_checked_at = ? WHERE id = ?`).run(at, row.id);
    return `error: ${String(e.message || e).slice(0, 120)}`;
  }
}

/**
 * A pass over both kinds.
 *
 * The budget is shared: two hundred and fifty searches for the whole run, not
 * per kind, so a catalogue that is mostly films cannot spend the ration twice.
 */
export async function artworkPass({ limit = config.artwork.batch, kinds = ['movie', 'series'],
                                    budget = tmdb.makeBudget(), fetchImpl = fetch,
                                    log = null } = {}) {
  /* Room may have been made since the last pass — a bigger limit, or a
     housekeeping prune — and if so the pictures evicted for space are worth
     collecting again. */
  const revived = reviveEvicted();

  const out = {
    looked: 0, provider: 0, tmdb: 0, none: 0, nokey: 0, errors: 0,
    tmdbConfigured: tmdb.configured(),
    searches: 0, byId: 0, budgetLeft: budget.left,
    cacheFull: cacheFull(), revived
  };

  for (const kind of kinds) {
    const rows = needingArtwork(kind, limit);
    for (const row of rows) {
      const got = await resolveArtwork(kind, row, { budget, fetchImpl });
      out.looked += 1;
      if (got === 'provider') out.provider += 1;
      else if (got === 'tmdb') out.tmdb += 1;
      else if (got === 'none') out.none += 1;
      else if (got === 'nokey') out.nokey += 1;
      else {
        out.errors += 1;
        if (log) log.warn(`Artwork for ${kind} ${row.id} (${row.canonical_title}): ${got}`);
      }
    }
  }

  out.searches = budget.searches;
  out.byId = budget.byId;
  out.budgetLeft = budget.left;
  out.cacheFull = cacheFull();
  return out;
}

/** What is still without a poster, for the figures a settings screen shows. */
export function artworkSummary() {
  const db = openDb();
  const per = (kind) => {
    const rows = db.prepare(`SELECT art_state, COUNT(*) n FROM ${TABLE[kind]} GROUP BY art_state`).all();
    const out = { total: 0, provider: 0, tmdb: 0, none: 0, nokey: 0, unchecked: 0 };
    for (const r of rows) {
      out[r.art_state === '' ? 'unchecked' : r.art_state] = r.n;
      out.total += r.n;
    }
    out.withPoster = out.provider + out.tmdb;
    return out;
  };
  return { movies: per('movie'), series: per('series'), tmdb: tmdb.tmdbStatus() };
}
