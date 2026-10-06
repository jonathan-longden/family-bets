import { openDb, nowIso } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { resolve, queueReview, normalizeTitle, betterTitle, matchKey, nameKey, MERGE_AT }
  from './dedupe.js';
import { PLAYBACK } from './providers/index.js';
import { cachedIdFor } from './artwork.js';

/**
 * The unified catalogue.
 *
 * One row per work, however many providers carry it. A provider's copy is a
 * *source* hanging off that row, which is why provider identity is nowhere in
 * the work's own columns: the screen shows one Inception, and the Play button
 * shows who has it.
 *
 * Writing is `ingest*`, which runs an incoming record through the matcher and
 * either attaches it to a work that exists or creates one. Reading is the
 * rest, and never mentions a provider unless asked for one.
 */

/* ------------------------------------------------------------- the writes -- */

/** A field is filled in only where the incoming record is better than silence. */
function better(existing, incoming) {
  if (incoming == null || incoming === '' ) return existing;
  if (existing == null || existing === '') return incoming;
  /* For prose, the longer one is almost always the fuller one. */
  if (typeof existing === 'string' && typeof incoming === 'string') {
    return incoming.length > existing.length ? incoming : existing;
  }
  return existing;
}

/**
 * Which title to keep when an incoming record lands on an existing work.
 *
 * It depends on who is speaking. Rung 0 means this is the *same provider's
 * own item* coming round again, so its title is that provider's current name
 * for it and a correction should take effect. Any other rung means a second
 * provider's copy, where the safer thing is to keep the name already shown
 * rather than let every refresh churn it — except where the one on file is
 * only restating the year.
 */
function nameFrom(existing, incoming, year, verdict) {
  const sameSource = verdict && verdict.evidence && verdict.evidence.rung === 0;
  /* Same provider's own item: its title wins, because a correction should
     take effect — but not if the "correction" is only the year written into
     the name again. A film scanned off disk as "Arrival 2016" must not
     overwrite the "Arrival" a provider supplied, whichever imports last, so
     the year test applies in both directions. */
  if (sameSource) return betterTitle(incoming, existing, year);
  return betterTitle(existing, incoming, year);
}

export function ingestMovie(providerId, work, stats = {}) {
  const db = openDb();
  const at = nowIso();
  const bump = (k) => { stats[k] = (stats[k] || 0) + 1; };

  const verdict = resolve('movie', work, { providerId });
  let movieId;

  if (verdict.decision === 'merge' && verdict.work) {
    movieId = verdict.work.id;
    const row = verdict.work;
    /* The comparison form is recomputed, not left as it was: a row created
       without a year whose year arrives later has to stop comparing as
       "arrival 2016" and start comparing as "arrival". */
    const year = row.year ?? work.year ?? null;
    const title = nameFrom(row.canonical_title, work.title, year, verdict);
    db.prepare(`UPDATE catalogue_movies SET
          canonical_title = ?, normalized_title = ?, original_title = ?, release_date = ?,
          description = ?, runtime_minutes = ?, rating = ?, age_rating = ?,
          poster_url = ?, backdrop_url = ?, thumbnail_url = ?,
          year = COALESCE(year, ?), match_key = ?, updated_at = ?
        WHERE id = ?`)
      .run(title, normalizeTitle(title, year),
           better(row.original_title, work.originalTitle),
           better(row.release_date, work.releaseDate),
           better(row.description, work.description),
           row.runtime_minutes || Number(work.runtimeMinutes) || 0,
           row.rating ?? (work.rating ?? null),
           better(row.age_rating, work.ageRating),
           better(row.poster_url, work.poster),
           better(row.backdrop_url, work.backdrop),
           better(row.thumbnail_url, work.thumbnail),
           work.year ?? null, matchKey(title, year), at, movieId);
    /* A second provider's copy folded into this one is a duplicate merged;
       this provider's own item arriving again is just an update. */
    if (verdict.evidence && verdict.evidence.rung !== 0 && verdict.confidence >= MERGE_AT) {
      bump('duplicates_merged');
    }
    bump('updated_items');
  } else {
    const title = String(work.title || '').trim();
    const info = db.prepare(`INSERT INTO catalogue_movies
        (canonical_title, normalized_title, original_title, match_key, year, release_date,
         description, runtime_minutes, rating, age_rating, poster_url, backdrop_url,
         thumbnail_url, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(title, normalizeTitle(title, work.year ?? null), work.originalTitle || '',
           matchKey(title, work.year ?? null), work.year ?? null, work.releaseDate || '',
           work.description || '', Number(work.runtimeMinutes) || 0,
           work.rating ?? null, work.ageRating || '',
           work.poster || '', work.backdrop || '', work.thumbnail || '', at, at);
    movieId = Number(info.lastInsertRowid);
    bump('new_items');

    /* Suspicious but not conclusive: both rows stay visible and a person
       decides. Queued after the insert so there are two rows to compare. */
    if (verdict.decision === 'review' && verdict.work) {
      queueReview('movie', movieId, verdict.work.id, verdict);
      bump('review_queued');
    }
  }

  writeIds('movie', movieId, work.externalIds);
  writeTags('movie', movieId, work);
  writeCredits('movie', movieId, work);
  attachMovieSource(movieId, providerId, work.source, at);
  return { movieId, decision: verdict.decision, confidence: verdict.confidence };
}

export function ingestSeries(providerId, work, stats = {}) {
  const db = openDb();
  const at = nowIso();
  const bump = (k) => { stats[k] = (stats[k] || 0) + 1; };

  const verdict = resolve('series', work, { providerId });
  let seriesId;

  if (verdict.decision === 'merge' && verdict.work) {
    seriesId = verdict.work.id;
    const row = verdict.work;
    const year = row.year ?? work.year ?? null;
    const title = nameFrom(row.canonical_title, work.title, year, verdict);
    db.prepare(`UPDATE catalogue_series SET
          canonical_title = ?, normalized_title = ?, original_title = ?, description = ?,
          rating = ?, age_rating = ?,
          poster_url = ?, backdrop_url = ?, thumbnail_url = ?, release_date = ?,
          year = COALESCE(year, ?), match_key = ?, updated_at = ?
        WHERE id = ?`)
      .run(title, normalizeTitle(title, year),
           better(row.original_title, work.originalTitle),
           better(row.description, work.description), row.rating ?? (work.rating ?? null),
           better(row.age_rating, work.ageRating), better(row.poster_url, work.poster),
           better(row.backdrop_url, work.backdrop), better(row.thumbnail_url, work.thumbnail),
           better(row.release_date, work.releaseDate), work.year ?? null,
           matchKey(title, year), at, seriesId);
    if (verdict.evidence && verdict.evidence.rung !== 0 && verdict.confidence >= MERGE_AT) {
      bump('duplicates_merged');
    }
    bump('updated_items');
  } else {
    const title = String(work.title || '').trim();
    const info = db.prepare(`INSERT INTO catalogue_series
        (canonical_title, normalized_title, original_title, match_key, year, release_date,
         description, rating, age_rating, poster_url, backdrop_url, thumbnail_url,
         created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(title, normalizeTitle(title, work.year ?? null), work.originalTitle || '',
           matchKey(title, work.year ?? null), work.year ?? null, work.releaseDate || '',
           work.description || '', work.rating ?? null, work.ageRating || '',
           work.poster || '', work.backdrop || '', work.thumbnail || '', at, at);
    seriesId = Number(info.lastInsertRowid);
    bump('new_items');
    if (verdict.decision === 'review' && verdict.work) {
      queueReview('series', seriesId, verdict.work.id, verdict);
      bump('review_queued');
    }
  }

  writeIds('series', seriesId, work.externalIds);
  writeTags('series', seriesId, work);
  writeCredits('series', seriesId, work);

  if (work.source && work.source.contentId) {
    db.prepare(`INSERT INTO catalogue_series_sources
        (series_id, provider_id, provider_content_id, metadata_url, availability_status,
         source_id, source_label, last_checked, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(provider_id, provider_content_id) DO UPDATE SET
          series_id = excluded.series_id, metadata_url = excluded.metadata_url,
          availability_status = excluded.availability_status,
          source_id = excluded.source_id, source_label = excluded.source_label,
          last_checked = excluded.last_checked, updated_at = excluded.updated_at`)
      .run(seriesId, providerId, String(work.source.contentId), work.source.metadataUrl || '',
           work.source.availability || 'unchecked', work.source.sourceId ?? null,
           work.source.sourceLabel || '', at, at, at);
  }

  /* Episodes are identified by (series, season, episode) and nothing else, so
     the same episode from a fourth provider is a fourth source on one row. */
  let episodes = 0;
  for (const season of work.seasons || []) {
    const seasonId = upsertSeason(seriesId, season, at);
    for (const ep of season.episodes || []) {
      if (ep.number == null) { bump('unmatched_items'); continue; }
      upsertEpisode(seriesId, seasonId, season.number, ep, providerId, at, stats);
      episodes++;
    }
  }

  return { seriesId, episodes, decision: verdict.decision, confidence: verdict.confidence };
}

function upsertSeason(seriesId, season, at) {
  const db = openDb();
  const n = Number(season.number) || 0;
  db.prepare(`INSERT INTO catalogue_seasons (series_id, season_number, title, description, poster_url, created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(series_id, season_number) DO UPDATE SET
        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE catalogue_seasons.title END,
        description = CASE WHEN excluded.description <> '' THEN excluded.description
                           ELSE catalogue_seasons.description END,
        poster_url = CASE WHEN excluded.poster_url <> '' THEN excluded.poster_url
                          ELSE catalogue_seasons.poster_url END`)
    .run(seriesId, n, season.title || '', season.description || '', season.poster || '', at);
  return db.prepare('SELECT id FROM catalogue_seasons WHERE series_id = ? AND season_number = ?')
    .get(seriesId, n).id;
}

function upsertEpisode(seriesId, seasonId, seasonNumber, ep, providerId, at, stats = {}) {
  const db = openDb();
  const n = Number(ep.number);
  const existing = db.prepare(
    'SELECT * FROM catalogue_episodes WHERE series_id = ? AND season_number = ? AND episode_number = ?')
    .get(seriesId, seasonNumber, n);

  let episodeId;
  if (existing) {
    episodeId = existing.id;
    db.prepare(`UPDATE catalogue_episodes SET
          season_id = COALESCE(season_id, ?), title = ?, description = ?, air_date = ?,
          runtime_minutes = ?, rating = ?, thumbnail_url = ?, updated_at = ?
        WHERE id = ?`)
      .run(seasonId, better(existing.title, ep.title), better(existing.description, ep.description),
           better(existing.air_date, ep.airDate),
           existing.runtime_minutes || Number(ep.runtimeMinutes) || 0,
           existing.rating ?? (ep.rating ?? null),
           better(existing.thumbnail_url, ep.thumbnail), at, episodeId);
    stats.updated_items = (stats.updated_items || 0) + 1;
  } else {
    const info = db.prepare(`INSERT INTO catalogue_episodes
        (series_id, season_id, season_number, episode_number, title, description, air_date,
         runtime_minutes, rating, thumbnail_url, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(seriesId, seasonId, seasonNumber, n, ep.title || '', ep.description || '',
           ep.airDate || '', Number(ep.runtimeMinutes) || 0, ep.rating ?? null,
           ep.thumbnail || '', at, at);
    episodeId = Number(info.lastInsertRowid);
    stats.new_items = (stats.new_items || 0) + 1;
  }

  writeIds('episode', episodeId, ep.externalIds);
  if (ep.source && ep.source.contentId) {
    db.prepare(`INSERT INTO catalogue_episode_sources
        (episode_id, provider_id, provider_content_id, metadata_url, playback_url, playback_type,
         availability_status, local_kind, local_id, quality, credentialed, source_id, source_label,
         last_checked, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(provider_id, provider_content_id) DO UPDATE SET
          episode_id = excluded.episode_id, metadata_url = excluded.metadata_url,
          playback_url = excluded.playback_url, playback_type = excluded.playback_type,
          availability_status = excluded.availability_status,
          local_kind = excluded.local_kind, local_id = excluded.local_id,
          quality = excluded.quality, credentialed = excluded.credentialed,
          source_id = excluded.source_id, source_label = excluded.source_label,
          last_checked = excluded.last_checked, updated_at = excluded.updated_at`)
      .run(episodeId, providerId, String(ep.source.contentId), ep.source.metadataUrl || '',
           ep.source.playbackUrl || '', ep.source.playbackType || PLAYBACK.webOnly,
           ep.source.availability || 'unchecked', ep.source.localKind || '',
           ep.source.localId ?? null, ep.source.quality || '',
           ep.source.credentialed ? 1 : 0, ep.source.sourceId ?? null,
           ep.source.sourceLabel || '', at, at, at);
  }
  return episodeId;
}

function attachMovieSource(movieId, providerId, source, at) {
  if (!source || !source.contentId) return;
  openDb().prepare(`INSERT INTO catalogue_movie_sources
      (movie_id, provider_id, provider_content_id, metadata_url, playback_url, playback_type,
       availability_status, local_kind, local_id, quality, credentialed, source_id, source_label,
       last_checked, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider_id, provider_content_id) DO UPDATE SET
        movie_id = excluded.movie_id, metadata_url = excluded.metadata_url,
        playback_url = excluded.playback_url, playback_type = excluded.playback_type,
        availability_status = excluded.availability_status,
        local_kind = excluded.local_kind, local_id = excluded.local_id,
        quality = excluded.quality, credentialed = excluded.credentialed,
        source_id = excluded.source_id, source_label = excluded.source_label,
        last_checked = excluded.last_checked, updated_at = excluded.updated_at`)
    .run(movieId, providerId, String(source.contentId), source.metadataUrl || '',
         source.playbackUrl || '', source.playbackType || PLAYBACK.webOnly,
         source.availability || 'unchecked', source.localKind || '', source.localId ?? null,
         source.quality || '', source.credentialed ? 1 : 0, source.sourceId ?? null,
         source.sourceLabel || '', at, at, at);
}

function writeIds(kind, workId, ids) {
  if (!ids) return;
  const db = openDb();
  const at = nowIso();
  for (const [scheme, value] of Object.entries(ids)) {
    if (!value) continue;
    db.prepare(`INSERT INTO catalogue_ids (work_kind, work_id, scheme, value, created_at)
        VALUES (?,?,?,?,?) ON CONFLICT(work_kind, scheme, value) DO NOTHING`)
      .run(kind, workId, String(scheme), String(value), at);
  }
}

const TAG_KINDS = [['genres', 'genre'], ['countries', 'country'],
                   ['languages', 'language'], ['keywords', 'keyword']];

function writeTags(kind, workId, work) {
  const db = openDb();
  for (const [field, tagKind] of TAG_KINDS) {
    for (const raw of work[field] || []) {
      const value = String(raw || '').trim();
      if (!value) continue;
      db.prepare(`INSERT INTO catalogue_tags (work_kind, work_id, kind, value, value_key)
          VALUES (?,?,?,?,?) ON CONFLICT(work_kind, work_id, kind, value_key) DO NOTHING`)
        .run(kind, workId, tagKind, value, value.toLowerCase());
    }
  }
}

const CREDIT_KINDS = [['cast', 'cast'], ['directors', 'director'], ['writers', 'writer']];

function writeCredits(kind, workId, work) {
  const db = openDb();
  for (const [field, role] of CREDIT_KINDS) {
    const people = work[field] || [];
    people.forEach((person, i) => {
      const name = String(typeof person === 'string' ? person : person.name || '').trim();
      if (!name) return;
      db.prepare(`INSERT INTO catalogue_credits
          (work_kind, work_id, role, name, name_key, character, image_url, ordering)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(work_kind, work_id, role, name_key) DO UPDATE SET
            character = CASE WHEN excluded.character <> '' THEN excluded.character
                             ELSE catalogue_credits.character END,
            image_url = CASE WHEN excluded.image_url <> '' THEN excluded.image_url
                             ELSE catalogue_credits.image_url END`)
        .run(kind, workId, role, name, nameKey(name),
             (person && person.character) || '', (person && person.image) || '',
             (person && person.ordering) ?? i);
    });
  }
}

/* -------------------------------------------------------------- merging ---- */

/**
 * Fold one work into another, by hand, from the review queue. Everything that
 * hung off the loser moves across; the loser goes.
 */
export function mergeWorks(kind, keepId, dropId) {
  const db = openDb();
  const table = kind === 'movie' ? 'catalogue_movies' : 'catalogue_series';
  const keep = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(keepId);
  const drop = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(dropId);
  if (!keep || !drop) throw notFound('One of those is no longer in the catalogue.');
  if (keepId === dropId) throw notFound('Those are the same record.');

  const at = nowIso();
  const tx = db.transaction(() => {
    if (kind === 'movie') {
      /* A source already on the keeper for the same provider and content id
         would collide, so those are dropped rather than moved. */
      db.prepare(`DELETE FROM catalogue_movie_sources WHERE movie_id = ?
            AND (provider_id, provider_content_id) IN
                (SELECT provider_id, provider_content_id FROM catalogue_movie_sources WHERE movie_id = ?)`)
        .run(dropId, keepId);
      db.prepare('UPDATE catalogue_movie_sources SET movie_id = ? WHERE movie_id = ?').run(keepId, dropId);
    } else {
      db.prepare(`DELETE FROM catalogue_series_sources WHERE series_id = ?
            AND (provider_id, provider_content_id) IN
                (SELECT provider_id, provider_content_id FROM catalogue_series_sources WHERE series_id = ?)`)
        .run(dropId, keepId);
      db.prepare('UPDATE catalogue_series_sources SET series_id = ? WHERE series_id = ?').run(keepId, dropId);
      moveEpisodes(db, keepId, dropId, at);
    }

    for (const t of ['catalogue_ids', 'catalogue_tags', 'catalogue_credits']) {
      /* Move what does not collide; the rest is already on the keeper. */
      const cols = t === 'catalogue_ids' ? 'scheme, value'
                 : t === 'catalogue_tags' ? 'kind, value_key' : 'role, name_key';
      db.prepare(`DELETE FROM ${t} WHERE work_kind = ? AND work_id = ? AND (${cols}) IN
            (SELECT ${cols} FROM ${t} WHERE work_kind = ? AND work_id = ?)`)
        .run(kind, dropId, kind, keepId);
      db.prepare(`UPDATE ${t} SET work_id = ? WHERE work_kind = ? AND work_id = ?`)
        .run(keepId, kind, dropId);
    }

    /* Keep whichever fields the loser filled in and the keeper had not. */
    db.prepare(`UPDATE ${table} SET
          original_title = CASE WHEN original_title = '' THEN ? ELSE original_title END,
          description = CASE WHEN description = '' THEN ? ELSE description END,
          poster_url = CASE WHEN poster_url = '' THEN ? ELSE poster_url END,
          backdrop_url = CASE WHEN backdrop_url = '' THEN ? ELSE backdrop_url END,
          thumbnail_url = CASE WHEN thumbnail_url = '' THEN ? ELSE thumbnail_url END,
          year = COALESCE(year, ?), rating = COALESCE(rating, ?), updated_at = ?
        WHERE id = ?`)
      .run(drop.original_title, drop.description, drop.poster_url, drop.backdrop_url,
           drop.thumbnail_url, drop.year, drop.rating, at, keepId);

    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(dropId);

    /* Any review mentioning the row that has gone is settled by definition. */
    db.prepare(`UPDATE catalogue_merge_reviews SET status = 'merged', decided_at = ?
        WHERE work_kind = ? AND (left_id = ? OR right_id = ?) AND status = 'open'`)
      .run(at, kind, dropId, dropId);
  });
  tx();
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(keepId);
}

function moveEpisodes(db, keepId, dropId, at) {
  const theirs = db.prepare('SELECT * FROM catalogue_episodes WHERE series_id = ?').all(dropId);
  for (const ep of theirs) {
    const mine = db.prepare(`SELECT id FROM catalogue_episodes
        WHERE series_id = ? AND season_number = ? AND episode_number = ?`)
      .get(keepId, ep.season_number, ep.episode_number);
    if (mine) {
      /* The same episode on both: one row keeps both providers' sources. */
      db.prepare(`DELETE FROM catalogue_episode_sources WHERE episode_id = ?
            AND (provider_id, provider_content_id) IN
                (SELECT provider_id, provider_content_id FROM catalogue_episode_sources WHERE episode_id = ?)`)
        .run(ep.id, mine.id);
      db.prepare('UPDATE catalogue_episode_sources SET episode_id = ? WHERE episode_id = ?')
        .run(mine.id, ep.id);
      db.prepare('DELETE FROM catalogue_episodes WHERE id = ?').run(ep.id);
    } else {
      const season = db.prepare(`INSERT INTO catalogue_seasons
            (series_id, season_number, title, description, poster_url, created_at)
            VALUES (?,?,'','','',?)
            ON CONFLICT(series_id, season_number) DO UPDATE SET series_id = excluded.series_id
            RETURNING id`).get(keepId, ep.season_number, at);
      db.prepare('UPDATE catalogue_episodes SET series_id = ?, season_id = ? WHERE id = ?')
        .run(keepId, season.id, ep.id);
    }
  }
  db.prepare('DELETE FROM catalogue_seasons WHERE series_id = ?').run(dropId);
}

/**
 * Forget everything one provider contributed.
 *
 * Its sources go, and a work left with no sources at all goes with them —
 * because a film nobody carries is not in the catalogue, it is a ghost. A
 * work several providers had simply loses one of its ways to play.
 *
 * This is what "remove this provider's titles" means, and it is why turning a
 * provider off does not do it on its own: switching off is reversible in a
 * second, and forgetting is not.
 */
/**
 * Forget one source's catalogue entries — the subscription has been removed.
 *
 * The same rule as forgetProvider, narrowed to one `sources` row: a film this
 * panel was the only carrier of goes, and a film the household also owns on
 * disk simply loses one of its ways to play. Called when an Xtream source is
 * deleted, because leaving behind rows whose only address needs credentials
 * that no longer exist would put unplayable films in the library.
 */
export function forgetSourceCatalogue(sourceId) {
  const db = openDb();
  const id = Number(sourceId);
  const out = { movieSources: 0, seriesSources: 0, episodeSources: 0,
                movies: 0, series: 0, episodes: 0, seasons: 0 };

  const tx = db.transaction(() => {
    out.movieSources = db.prepare('DELETE FROM catalogue_movie_sources WHERE source_id = ?')
      .run(id).changes;
    out.episodeSources = db.prepare('DELETE FROM catalogue_episode_sources WHERE source_id = ?')
      .run(id).changes;
    out.seriesSources = db.prepare('DELETE FROM catalogue_series_sources WHERE source_id = ?')
      .run(id).changes;
    if (!(out.movieSources + out.episodeSources + out.seriesSources)) return;
    out.episodes = db.prepare(`DELETE FROM catalogue_episodes WHERE id NOT IN
        (SELECT episode_id FROM catalogue_episode_sources)`).run().changes;
    out.seasons = db.prepare(`DELETE FROM catalogue_seasons WHERE id NOT IN
        (SELECT season_id FROM catalogue_episodes WHERE season_id IS NOT NULL)`).run().changes;
    out.series = db.prepare(`DELETE FROM catalogue_series WHERE id NOT IN
          (SELECT series_id FROM catalogue_episodes)
        AND id NOT IN (SELECT series_id FROM catalogue_series_sources)`).run().changes;
    out.movies = db.prepare(`DELETE FROM catalogue_movies WHERE id NOT IN
        (SELECT movie_id FROM catalogue_movie_sources)`).run().changes;

    /* And whatever hung off a work that has gone, including a duplicate
       review about one: a question about two rows, one of which no longer
       exists, cannot be answered and would break the list it sits in. */
    for (const [kind, table] of [['movie', 'catalogue_movies'], ['series', 'catalogue_series'],
                                 ['episode', 'catalogue_episodes']]) {
      for (const t of ['catalogue_ids', 'catalogue_tags', 'catalogue_credits']) {
        db.prepare(`DELETE FROM ${t} WHERE work_kind = ?
            AND work_id NOT IN (SELECT id FROM ${table})`).run(kind);
      }
      db.prepare(`DELETE FROM catalogue_merge_reviews WHERE work_kind = ?
          AND (left_id NOT IN (SELECT id FROM ${table})
            OR right_id NOT IN (SELECT id FROM ${table}))`).run(kind);
    }
  });
  tx();
  return out;
}

export function forgetProvider(providerId) {
  const db = openDb();
  const id = Number(providerId);
  const out = { movieSources: 0, seriesSources: 0, episodeSources: 0,
                movies: 0, series: 0, episodes: 0, seasons: 0 };

  const tx = db.transaction(() => {
    out.movieSources = db.prepare('DELETE FROM catalogue_movie_sources WHERE provider_id = ?')
      .run(id).changes;
    out.episodeSources = db.prepare('DELETE FROM catalogue_episode_sources WHERE provider_id = ?')
      .run(id).changes;
    out.seriesSources = db.prepare('DELETE FROM catalogue_series_sources WHERE provider_id = ?')
      .run(id).changes;

    /* An episode nobody carries goes; then a season with no episodes; then a
       series with no episodes at all. In that order, because each depends on
       the one before it. */
    out.episodes = db.prepare(`DELETE FROM catalogue_episodes WHERE id NOT IN
        (SELECT episode_id FROM catalogue_episode_sources)`).run().changes;
    out.seasons = db.prepare(`DELETE FROM catalogue_seasons WHERE id NOT IN
        (SELECT season_id FROM catalogue_episodes WHERE season_id IS NOT NULL)`).run().changes;
    out.series = db.prepare(`DELETE FROM catalogue_series WHERE id NOT IN
          (SELECT series_id FROM catalogue_episodes)
        AND id NOT IN (SELECT series_id FROM catalogue_series_sources)`).run().changes;
    out.movies = db.prepare(`DELETE FROM catalogue_movies WHERE id NOT IN
        (SELECT movie_id FROM catalogue_movie_sources)`).run().changes;

    /* Tags, credits and ids hanging off a work that has gone, and reviews
       about one. */
    for (const [kind, table] of [['movie', 'catalogue_movies'], ['series', 'catalogue_series'],
                                 ['episode', 'catalogue_episodes']]) {
      for (const t of ['catalogue_ids', 'catalogue_tags', 'catalogue_credits']) {
        db.prepare(`DELETE FROM ${t} WHERE work_kind = ?
            AND work_id NOT IN (SELECT id FROM ${table})`).run(kind);
      }
      db.prepare(`DELETE FROM catalogue_merge_reviews WHERE work_kind = ?
          AND (left_id NOT IN (SELECT id FROM ${table})
            OR right_id NOT IN (SELECT id FROM ${table}))`).run(kind);
    }
  });
  tx();
  return out;
}

export function decideReview(reviewId, decision, userId = null) {
  const db = openDb();
  const r = db.prepare('SELECT * FROM catalogue_merge_reviews WHERE id = ?').get(reviewId);
  if (!r) throw notFound('No such review.');
  if (r.status !== 'open') return r;

  if (decision === 'merge') {
    /* The older row wins, so ids already handed out stay valid. */
    mergeWorks(r.work_kind, Math.min(r.left_id, r.right_id), Math.max(r.left_id, r.right_id));
  }
  db.prepare('UPDATE catalogue_merge_reviews SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .run(decision === 'merge' ? 'merged' : 'rejected', nowIso(), userId, reviewId);
  return db.prepare('SELECT * FROM catalogue_merge_reviews WHERE id = ?').get(reviewId);
}

/* ------------------------------------------------------------- the reads --- */

const page = (limit, offset) => ({
  limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
  offset: Math.max(Number(offset) || 0, 0)
});

/**
 * The filters the brief asks for, built once for both movies and series.
 *
 * Provider is a filter over the *sources*, not the work, which is the whole
 * point of the shape: "Movies → Provider → Tubi" narrows the list without the
 * provider ever being part of a film's identity.
 */
function filters(kind, q = {}) {
  const where = [], args = [];
  const table = kind === 'movie' ? 'catalogue_movies' : 'catalogue_series';
  const srcTable = kind === 'movie' ? 'catalogue_movie_sources' : 'catalogue_series_sources';
  const srcCol = kind === 'movie' ? 'movie_id' : 'series_id';

  if (q.search) {
    /* Matched on the normalized form as well as the written one, so "the
       matrix", "Matrix" and "matrix," all find it. */
    where.push('(w.canonical_title LIKE ? OR w.normalized_title LIKE ? OR w.original_title LIKE ?)');
    const like = `%${String(q.search).trim()}%`;
    args.push(like, `%${normalizeTitle(q.search)}%`, like);
  }
  if (q.year) { where.push('w.year = ?'); args.push(Number(q.year)); }
  if (q.yearFrom) { where.push('w.year >= ?'); args.push(Number(q.yearFrom)); }
  if (q.yearTo) { where.push('w.year <= ?'); args.push(Number(q.yearTo)); }
  if (q.minRating) { where.push('w.rating >= ?'); args.push(Number(q.minRating)); }
  if (q.ageRating) { where.push('w.age_rating = ?'); args.push(String(q.ageRating)); }

  for (const [field, tagKind] of [['genre', 'genre'], ['country', 'country'], ['language', 'language'],
                                  ['keyword', 'keyword']]) {
    if (!q[field]) continue;
    where.push(`EXISTS (SELECT 1 FROM catalogue_tags t WHERE t.work_kind = ? AND t.work_id = w.id
        AND t.kind = ? AND t.value_key = ?)`);
    args.push(kind, tagKind, String(q[field]).toLowerCase());
  }

  if (q.provider) {
    where.push(`EXISTS (SELECT 1 FROM ${srcTable} s JOIN providers p ON p.id = s.provider_id
        WHERE s.${srcCol} = w.id AND p.key = ?)`);
    args.push(String(q.provider));
  }

  /* Only works something can actually play, unless asked otherwise. A work
     whose every source is web-only is still listed — it is in the catalogue
     and somebody has it — but `playable=true` narrows to what Play can open. */
  if (q.playable) {
    if (kind === 'movie') {
      where.push(`EXISTS (SELECT 1 FROM catalogue_movie_sources s WHERE s.movie_id = w.id
          AND s.playback_type IN ('direct','hls','dash') AND s.availability_status <> 'unavailable')`);
    } else {
      where.push(`EXISTS (SELECT 1 FROM catalogue_episodes e
          JOIN catalogue_episode_sources s ON s.episode_id = e.id
          WHERE e.series_id = w.id AND s.playback_type IN ('direct','hls','dash'))`);
    }
  }

  return { table, where: where.length ? where.join(' AND ') : '1 = 1', args };
}

const SORTS = {
  title: 'w.canonical_title COLLATE NOCASE',
  year: 'w.year DESC, w.canonical_title COLLATE NOCASE',
  rating: 'w.rating DESC NULLS LAST, w.canonical_title COLLATE NOCASE',
  added: 'w.created_at DESC',
  updated: 'w.updated_at DESC'
};

export function movies(q = {}) {
  const db = openDb();
  const { limit, offset } = page(q.limit, q.offset);
  const f = filters('movie', q);
  const order = SORTS[q.sort] || SORTS.title;

  const total = db.prepare(`SELECT COUNT(*) n FROM catalogue_movies w WHERE ${f.where}`)
    .get(...f.args).n;
  const rows = db.prepare(`SELECT w.* FROM catalogue_movies w WHERE ${f.where}
      ORDER BY ${order} LIMIT ? OFFSET ?`).all(...f.args, limit, offset);

  return { total, items: rows.map(r => publicMovie(r, { sources: movieSources(r.id) })) };
}

export function movie(id) {
  const row = openDb().prepare('SELECT * FROM catalogue_movies WHERE id = ?').get(Number(id));
  if (!row) throw notFound('No such film in the catalogue.');
  return row;
}

export function seriesList(q = {}) {
  const db = openDb();
  const { limit, offset } = page(q.limit, q.offset);
  const f = filters('series', q);
  const order = SORTS[q.sort] || SORTS.title;

  const total = db.prepare(`SELECT COUNT(*) n FROM catalogue_series w WHERE ${f.where}`)
    .get(...f.args).n;
  const rows = db.prepare(`SELECT w.*,
        (SELECT COUNT(*) FROM catalogue_episodes e WHERE e.series_id = w.id) AS episode_count,
        (SELECT COUNT(*) FROM catalogue_seasons s WHERE s.series_id = w.id) AS season_count
      FROM catalogue_series w WHERE ${f.where}
      ORDER BY ${order} LIMIT ? OFFSET ?`).all(...f.args, limit, offset);

  return { total, items: rows.map(r => publicSeries(r, { sources: seriesSources(r.id) })) };
}

export function oneSeries(id) {
  const row = openDb().prepare(`SELECT w.*,
        (SELECT COUNT(*) FROM catalogue_episodes e WHERE e.series_id = w.id) AS episode_count,
        (SELECT COUNT(*) FROM catalogue_seasons s WHERE s.series_id = w.id) AS season_count
      FROM catalogue_series w WHERE w.id = ?`).get(Number(id));
  if (!row) throw notFound('No such series in the catalogue.');
  return row;
}

export function seasonsOf(seriesId) {
  oneSeries(seriesId);
  return openDb().prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM catalogue_episodes e WHERE e.season_id = s.id) AS episode_count
      FROM catalogue_seasons s WHERE s.series_id = ? ORDER BY s.season_number`)
    .all(Number(seriesId))
    .map(s => ({ id: s.id, seriesId: Number(seriesId), season: s.season_number,
                 title: s.title || `Season ${s.season_number}`,
                 description: s.description, poster: artUrl(s.poster_url),
                 episodes: s.episode_count }));
}

export function episodesOf(seriesId, { season = null } = {}) {
  oneSeries(seriesId);
  const where = ['series_id = ?'], args = [Number(seriesId)];
  if (season != null && season !== '') { where.push('season_number = ?'); args.push(Number(season)); }
  return openDb().prepare(`SELECT * FROM catalogue_episodes WHERE ${where.join(' AND ')}
      ORDER BY season_number, episode_number`).all(...args)
    .map(e => publicEpisode(e, { sources: episodeSources(e.id) }));
}

export function episode(id) {
  const row = openDb().prepare(`SELECT e.*, s.canonical_title AS series_title
      FROM catalogue_episodes e JOIN catalogue_series s ON s.id = e.series_id
      WHERE e.id = ?`).get(Number(id));
  if (!row) throw notFound('No such episode in the catalogue.');
  return row;
}

/**
 * One search over the canonical catalogue, not a fan-out to every provider:
 * "Matrix" returns the four films once each, however many services carry them.
 */
export function search(text, { limit = 25 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const films = movies({ search: text, limit: n, sort: 'title' });
  const shows = seriesList({ search: text, limit: n, sort: 'title' });
  const like = `%${String(text).trim()}%`;
  const eps = openDb().prepare(`SELECT e.*, s.canonical_title AS series_title
      FROM catalogue_episodes e JOIN catalogue_series s ON s.id = e.series_id
      WHERE e.title LIKE ? ORDER BY s.canonical_title, e.season_number, e.episode_number
      LIMIT ?`).all(like, n);

  return {
    query: String(text),
    movies: films.items,
    series: shows.items,
    episodes: eps.map(e => publicEpisode(e, { seriesTitle: e.series_title })),
    total: films.total + shows.total + eps.length
  };
}

/** What the filter menus offer, counted from what is actually in the catalogue. */
export function facets(kind = 'movie') {
  const db = openDb();
  const tag = (k) => db.prepare(`SELECT t.value, t.value_key, COUNT(*) n FROM catalogue_tags t
      WHERE t.work_kind = ? AND t.kind = ? GROUP BY t.value_key
      ORDER BY n DESC, t.value LIMIT 200`).all(kind, k)
    .map(r => ({ value: r.value, key: r.value_key, count: r.n }));

  const table = kind === 'movie' ? 'catalogue_movies' : 'catalogue_series';
  const srcTable = kind === 'movie' ? 'catalogue_movie_sources' : 'catalogue_series_sources';
  const srcCol = kind === 'movie' ? 'movie_id' : 'series_id';

  return {
    genres: tag('genre'),
    countries: tag('country'),
    languages: tag('language'),
    years: db.prepare(`SELECT year, COUNT(*) n FROM ${table} WHERE year IS NOT NULL
        GROUP BY year ORDER BY year DESC`).all().map(r => ({ value: r.year, count: r.n })),
    providers: db.prepare(`SELECT p.key, p.name, COUNT(DISTINCT s.${srcCol}) n
        FROM ${srcTable} s JOIN providers p ON p.id = s.provider_id
        GROUP BY p.id ORDER BY n DESC`).all()
      .map(r => ({ value: r.key, name: r.name, count: r.n })),
    ageRatings: db.prepare(`SELECT age_rating value, COUNT(*) n FROM ${table}
        WHERE age_rating <> '' GROUP BY age_rating ORDER BY n DESC`).all()
      .map(r => ({ value: r.value, count: r.n }))
  };
}

/* ------------------------------------------------------------- the sources -- */

const SOURCE_SELECT = `s.*, p.key AS provider_key, p.name AS provider_name,
  p.enabled AS provider_enabled, p.status AS provider_status`;

export function movieSources(movieId) {
  return openDb().prepare(`SELECT ${SOURCE_SELECT} FROM catalogue_movie_sources s
      JOIN providers p ON p.id = s.provider_id WHERE s.movie_id = ?
      ORDER BY ${PREFERENCE}`).all(Number(movieId)).map(publicSource);
}

export function episodeSources(episodeId) {
  return openDb().prepare(`SELECT ${SOURCE_SELECT} FROM catalogue_episode_sources s
      JOIN providers p ON p.id = s.provider_id WHERE s.episode_id = ?
      ORDER BY ${PREFERENCE}`).all(Number(episodeId)).map(publicSource);
}

export function seriesSources(seriesId) {
  return openDb().prepare(`SELECT ${SOURCE_SELECT} FROM catalogue_series_sources s
      JOIN providers p ON p.id = s.provider_id WHERE s.series_id = ?`)
    .all(Number(seriesId))
    .map(s => ({ providerKey: s.provider_key, providerName: s.provider_name,
                 metadataUrl: s.metadata_url, availability: s.availability_status }));
}

/* Preference order, which is also what "automatically select the preferred
   working source" means: something playable before something web-only, the
   server's own disk before anything that needs the internet, and an available
   source before one last seen failing. */
const PREFERENCE = `
  CASE s.playback_type WHEN 'direct' THEN 0 WHEN 'hls' THEN 1 WHEN 'dash' THEN 2
       WHEN 'web_only' THEN 8 ELSE 9 END,
  CASE WHEN s.local_kind <> '' THEN 0 ELSE 1 END,
  CASE s.availability_status WHEN 'available' THEN 0 WHEN 'unchecked' THEN 1 ELSE 2 END,
  p.name COLLATE NOCASE`;

/**
 * A source as a client sees it.
 *
 * Three shapes, and the difference matters:
 *
 *   playback  an id into this server's own media — the client asks for a
 *             ticket exactly as it always has, and the path guard still runs.
 *   url       a stream address the provider publishes for this purpose. The
 *             player opens it.
 *   webUrl    web_only. The provider plays this in its own app or site, so
 *             this is a link out and is labelled as one. No stream is invented.
 */
/* A playback address is only ever http or https. Checked on the way out as
   well as on the way in: a row could carry anything after a bad import or a
   hand-edited database, and handing a client a `javascript:` or `file:` URL
   to open would be this layer's fault rather than the importer's. */
const webAddress = (u) => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';

export function publicSource(s) {
  const playable = ['direct', 'hls', 'dash'].includes(s.playback_type) &&
    (Boolean(s.local_kind) || Boolean(webAddress(s.playback_url)));
  const out = {
    id: s.id,
    providerKey: s.provider_key,
    providerName: s.provider_name,
    providerEnabled: Boolean(s.provider_enabled),
    /* Which subscription or folder this copy is on, where the provider is not
       the whole answer: an operator with two Xtream panels sees which one. */
    sourceLabel: s.source_label || '',
    playbackType: s.playback_type,
    playable,
    availability: s.availability_status,
    quality: s.quality || '',
    metadataUrl: s.metadata_url || '',
    lastChecked: s.last_checked
  };
  if (s.local_kind) {
    out.playback = `/api/v1/stream/media/${s.local_kind}/${s.local_id}`;
    out.local = true;
    out.localKind = s.local_kind;
    out.localId = s.local_id;
  } else if (playable && s.credentialed) {
    /* The address has a subscription's username and password in it, so it
       stays here. The client is given a path on this server, which cuts a
       ticket and redirects — the arrangement live channels have always used.
       Nothing is downloaded: the video still comes from the provider. */
    out.credentialed = true;
    out.remote = true;
    out.playback = `/api/v1/stream/catalogue/${s.movie_id ? 'movie' : 'episode'}/` +
      `${s.movie_id || s.episode_id}`;
  } else if (playable) {
    out.url = webAddress(s.playback_url);
  } else {
    out.webOnly = true;
    out.webUrl = webAddress(s.metadata_url);
  }
  return out;
}

/**
 * The real address behind a source — for this server only.
 *
 * Deliberately separate from publicSource, and deliberately not reachable
 * through it: the only way to the stored URL of a credentialed source is a
 * server-side call that names the kind and the source id. A route that wants
 * to redirect a player to a panel asks here; nothing that answers a client
 * ever sees the result.
 */
export function sourceAddress(kind, sourceId) {
  const table = kind === 'movie' ? 'catalogue_movie_sources' : 'catalogue_episode_sources';
  const row = openDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(sourceId));
  if (!row) return null;
  return {
    url: webAddress(row.playback_url),
    playbackType: row.playback_type,
    credentialed: Boolean(row.credentialed),
    workId: kind === 'movie' ? row.movie_id : row.episode_id,
    sourceLabel: row.source_label || ''
  };
}

/** The one source Play should use, or null when nothing here can be played. */
export function preferredSource(kind, workId) {
  const list = kind === 'movie' ? movieSources(workId) : episodeSources(workId);
  return list.find(s => s.playable && s.availability !== 'unavailable') || null;
}

/* --------------------------------------------------------------- shapes ---- */

const tagsOf = (kind, id, which) => openDb()
  .prepare('SELECT value FROM catalogue_tags WHERE work_kind = ? AND work_id = ? AND kind = ? ORDER BY value')
  .all(kind, id, which).map(r => r.value);

const creditsOf = (kind, id, role, limit = 40) => openDb()
  .prepare(`SELECT name, character, image_url FROM catalogue_credits
      WHERE work_kind = ? AND work_id = ? AND role = ? ORDER BY ordering, name LIMIT ?`)
  .all(kind, id, role, limit)
  .map(r => ({ name: r.name, character: r.character || undefined,
               image: artUrl(r.image_url) || undefined }));

const idsOf = (kind, id) => Object.fromEntries(openDb()
  .prepare('SELECT scheme, value FROM catalogue_ids WHERE work_kind = ? AND work_id = ?')
  .all(kind, id).map(r => [r.scheme, r.value]));

/**
 * The address a client should use for a picture.
 *
 * Where there is a cached copy, that one — served from this server by id.
 * Three reasons, all of them the brief's: the provider is not asked for the
 * same poster by every device in the house; a provider serving over http does
 * not get blocked as mixed content on a page served over https; and a client
 * never has to reach a provider directly at all.
 *
 * Where there is no copy — a local poster already served by id, or a provider
 * whose terms say link rather than copy — the original is passed through
 * unchanged.
 */
function artUrl(url) {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;      // already one of ours
  const id = cachedIdFor(url);
  return id ? `/api/v1/catalogue/art/${id}` : url;
}

export function publicMovie(m, extra = {}) {
  return {
    id: m.id, kind: 'movie',
    title: m.canonical_title,
    originalTitle: m.original_title || undefined,
    year: m.year,
    releaseDate: m.release_date || undefined,
    description: m.description,
    runtimeMinutes: m.runtime_minutes || 0,
    rating: m.rating,
    ageRating: m.age_rating || undefined,
    poster: artUrl(m.poster_url), backdrop: artUrl(m.backdrop_url),
    thumbnail: artUrl(m.thumbnail_url),
    genres: tagsOf('movie', m.id, 'genre'),
    countries: tagsOf('movie', m.id, 'country'),
    languages: tagsOf('movie', m.id, 'language'),
    cast: creditsOf('movie', m.id, 'cast'),
    directors: creditsOf('movie', m.id, 'director').map(p => p.name),
    writers: creditsOf('movie', m.id, 'writer').map(p => p.name),
    externalIds: idsOf('movie', m.id),
    addedAt: m.created_at, updatedAt: m.updated_at,
    ...extra
  };
}

export function publicSeries(s, extra = {}) {
  return {
    id: s.id, kind: 'series',
    title: s.canonical_title,
    originalTitle: s.original_title || undefined,
    year: s.year,
    releaseDate: s.release_date || undefined,
    description: s.description,
    rating: s.rating,
    ageRating: s.age_rating || undefined,
    poster: artUrl(s.poster_url), backdrop: artUrl(s.backdrop_url),
    thumbnail: artUrl(s.thumbnail_url),
    seasonCount: s.season_count ?? undefined,
    episodeCount: s.episode_count ?? undefined,
    genres: tagsOf('series', s.id, 'genre'),
    countries: tagsOf('series', s.id, 'country'),
    languages: tagsOf('series', s.id, 'language'),
    cast: creditsOf('series', s.id, 'cast'),
    directors: creditsOf('series', s.id, 'director').map(p => p.name),
    writers: creditsOf('series', s.id, 'writer').map(p => p.name),
    externalIds: idsOf('series', s.id),
    addedAt: s.created_at, updatedAt: s.updated_at,
    ...extra
  };
}

export function publicEpisode(e, extra = {}) {
  return {
    id: e.id, kind: 'episode',
    seriesId: e.series_id, seasonId: e.season_id || null,
    season: e.season_number, episode: e.episode_number,
    title: e.title || `Episode ${e.episode_number}`,
    description: e.description,
    airDate: e.air_date || undefined,
    runtimeMinutes: e.runtime_minutes || 0,
    rating: e.rating,
    thumbnail: artUrl(e.thumbnail_url),
    seriesTitle: e.series_title || undefined,
    externalIds: idsOf('episode', e.id),
    ...extra
  };
}

/** Totals for the settings screen. */
export function catalogueCounts() {
  const db = openDb();
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    movies: n('SELECT COUNT(*) n FROM catalogue_movies'),
    series: n('SELECT COUNT(*) n FROM catalogue_series'),
    episodes: n('SELECT COUNT(*) n FROM catalogue_episodes'),
    movieSources: n('SELECT COUNT(*) n FROM catalogue_movie_sources'),
    episodeSources: n('SELECT COUNT(*) n FROM catalogue_episode_sources'),
    openReviews: n("SELECT COUNT(*) n FROM catalogue_merge_reviews WHERE status = 'open'"),
    /* How much the deduplication is actually doing: films with more than one
       way to play, which would otherwise be that many extra cards.
       Counted per place rather than per provider, because two Xtream
       subscriptions are one provider and two places — an operator with two
       panels carrying the same film has one card and two sources, and a
       figure that read 0 would be telling them otherwise. */
    multiSourceMovies: n(`SELECT COUNT(*) n FROM (SELECT movie_id FROM catalogue_movie_sources
        GROUP BY movie_id HAVING COUNT(DISTINCT provider_id || ':' || COALESCE(source_id, 0)) > 1)`)
  };
}
