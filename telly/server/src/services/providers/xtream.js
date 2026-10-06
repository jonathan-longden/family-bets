import { openDb } from '../../db/index.js';
import { ACCESS, STATUS, PLAYBACK } from './contract.js';
import {
  signIn, vodCategories, vodStreams, seriesCategories, seriesList,
  vodInfoUrl, seriesInfoUrl, categoryNames, movieWork, seriesWork, asInt
} from '../xtream.js';

/**
 * The Xtream panels the operator subscribes to, as a provider of the
 * catalogue.
 *
 * Telly has read Xtream panels since the beginning — but only
 * `get_live_streams`, which is why adding a panel full of films reported
 * "Synced 15 channels" and left the Movies and Series library empty. A panel
 * publishes three catalogues through one API, and the other two are films and
 * box sets with posters, plots, cast and ratings. This adapter reads those two
 * and nothing else: the live line-up is still the business of the playlist
 * sync, unchanged, so a channel stays a channel and a film stops being
 * mistaken for one.
 *
 * ── one adapter, every panel ──────────────────────────────────────────────
 *
 * There is one provider row, not one per subscription, because a provider is a
 * kind of place to read from and the panels are rows in `sources` that the
 * operator adds and removes. Identity is kept where it matters: every source
 * this yields is filed under `s<sourceId>:movie:<streamId>`, so
 *
 *   · re-importing a panel updates the rows it made last time rather than
 *     making more (the matcher's first rung is a provider id it has already
 *     filed);
 *   · two panels carrying the same film give that film two playback sources
 *     on one card, which is the point of the catalogue;
 *   · removing a panel's source row can take its catalogue sources with it
 *     without touching anybody else's.
 *
 * ── what it does not do ───────────────────────────────────────────────────
 *
 * Nothing is downloaded. A film is a row with the panel's own address in it,
 * and that address is used when somebody presses Play. Nothing is bypassed
 * either: this is the panel's own client API, read with the credentials the
 * operator typed in, and a panel that refuses them is reported as refusing
 * them rather than tried another way.
 */
export default {
  key: 'xtream',
  name: 'Xtream panels (your own subscriptions)',
  baseUrl: '',
  termsUrl: '',
  robotsUrl: '',
  /* On by default, because a provider that reads the operator's own
     subscriptions has nobody else to ask. With no Xtream source configured it
     does nothing at all, which is the common case. */
  enabledByDefault: true,

  access: {
    method: ACCESS.officialApi,
    status: STATUS.available,
    reason: 'The panel\'s own player API, read with the username and password you entered ' +
      'for that subscription. Films and series only — the live channels come in through the ' +
      'playlist sync, as before.',
    assessedAt: '2026-10-06'
  },

  capabilities: {
    metadata: true,
    artwork: true,
    /* A panel's VOD is a file it serves: mp4, mkv, or a manifest. Playable,
       and resolved through this server so the subscription's username and
       password never reach a client. */
    playback: true,
    playbackType: PLAYBACK.direct
  },

  /* A panel is one household's own server, not a public service, so this is
     paced for a small box on somebody's rack rather than for a CDN: a short
     delay, a few at a time, and `pageLimit` as a ceiling on detail calls for
     an operator whose panel is slow or whose catalogue is enormous. */
  limits: { requestDelayMs: 120, concurrency: 4, timeoutMs: 20000, maxRetries: 2,
            pageLimit: 0, refreshIntervalSeconds: 21600 },

  settings: {
    /* Reading every film's `get_vod_info` is one request per film. It is where
       the plot, the poster, the cast and the year come from, so it is on; an
       operator with a very large panel can turn it off and keep the titles. */
    movieDetail: true,
    /* A series has to be read in full — `get_series` alone has no episodes in
       it at all — so this is not optional, only limitable. */
    maxMovies: 0,
    maxSeries: 0
  },

  /**
   * Every enabled Xtream source, in turn.
   *
   * A panel that will not answer does not stop the others: its failure is
   * logged against the run and the next subscription is read. That matters
   * for an operator with two panels, one of which has expired.
   */
  async * discover(ctx) {
    const sources = xtreamSources();
    if (!sources.length) {
      ctx.log('No Xtream subscriptions are configured, so there is nothing to import.');
      return;
    }

    for (const src of sources) {
      const cred = { host: src.url, username: src.username, password: src.password,
                     label: src.name };
      try {
        await signIn(cred, (url, opts) => ctx.get(url, opts));
      } catch (e) {
        /* The one failure worth saying out loud: the operator's own
           subscription is not letting us in, and no amount of retrying is
           going to change that. */
        ctx.log(`${src.name}: ${e.message}`);
        continue;
      }
      ctx.log(`${src.name}: signed in`);

      try { yield* films(ctx, src, cred); }
      catch (e) { ctx.log(`${src.name} films: ${e.message}`); }

      try { yield* shows(ctx, src, cred); }
      catch (e) { ctx.log(`${src.name} series: ${e.message}`); }
    }
  }
};

/** The panels to read: enabled, and with something to sign in with. */
export function xtreamSources() {
  return openDb().prepare(`SELECT * FROM sources
      WHERE kind = 'xtream' AND enabled = 1 AND url <> '' AND username <> ''
      ORDER BY id`).all();
}

/* A ceiling the operator set, in the provider row or the adapter's settings.
   Zero means no ceiling, which is the default. */
function ceiling(ctx, key) {
  const n = asInt(ctx.setting(key, 0)) || 0;
  const page = Number(ctx.pageLimit) || 0;
  if (n > 0 && page > 0) return Math.min(n, page);
  return n > 0 ? n : page;
}

async function * films(ctx, src, cred) {
  /* Every request the panel sees goes through ctx.get, which is what keeps the
     delay, the timeout, the retries and the 429 handling in one place. */
  const via = (u, o) => ctx.get(u, o);
  let cats = new Map();
  try { cats = categoryNames(await vodCategories(cred, via)); }
  catch { /* a category name is a nicety; a film without one still imports */ }

  const rows = await vodStreams(cred, via);
  const max = ceiling(ctx, 'maxMovies');
  const list = max > 0 ? rows.slice(0, max) : rows;
  ctx.log(`${src.name}: ${rows.length} films${list.length !== rows.length ? ` (reading ${list.length})` : ''}`);

  const detail = ctx.setting('movieDetail', true) !== false;

  for (const row of list) {
    if (ctx.cancelled) return;
    let body = null;
    if (detail) {
      /* One film's metadata failing is one film with less metadata, not a
         failed import: the list row already has its name, its poster and its
         id, which is enough to play it. */
      try { body = await ctx.getJson(vodInfoUrl(cred, row.stream_id)); }
      catch (e) { ctx.log(`${row.name || row.stream_id}: ${e.message}`); }
    }
    const work = movieWork(cred, src.id, row, body);
    /* The panel's own category, where it has not supplied genres. It is the
       only grouping a thin panel gives, and losing it would leave the filters
       empty. */
    const group = cats.get(String(row.category_id));
    if (group && !work.genres.length) work.genres = [group];
    yield work;
  }
}

async function * shows(ctx, src, cred) {
  const via = (u, o) => ctx.get(u, o);
  let cats = new Map();
  try { cats = categoryNames(await seriesCategories(cred, via)); }
  catch { /* as above */ }

  const rows = await seriesList(cred, via);
  const max = ceiling(ctx, 'maxSeries');
  const list = max > 0 ? rows.slice(0, max) : rows;
  ctx.log(`${src.name}: ${rows.length} series${list.length !== rows.length ? ` (reading ${list.length})` : ''}`);

  for (const row of list) {
    if (ctx.cancelled) return;
    /* Unlike a film, a series has to be read in full or it has no episodes,
       so a series whose detail call fails is skipped rather than filed as an
       empty show. */
    let body;
    try { body = await ctx.getJson(seriesInfoUrl(cred, row.series_id)); }
    catch (e) { ctx.log(`${row.name || row.series_id}: ${e.message}`); continue; }

    const work = seriesWork(cred, src.id, row, body);
    if (!work.seasons.length) {
      ctx.log(`${work.title}: the panel listed no episodes for it`);
      continue;
    }
    const group = cats.get(String(row.category_id));
    if (group && !work.genres.length) work.genres = [group];
    yield work;
  }
}
