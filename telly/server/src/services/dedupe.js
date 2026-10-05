import { openDb, nowIso } from '../db/index.js';

/**
 * Deciding whether two records are the same work.
 *
 * This is the part that decides whether Movies shows one Inception or four, so
 * it is deliberately cautious. Merging two different films is a worse mistake
 * than showing two cards: the two cards are visibly wrong and somebody fixes
 * them, whereas a bad merge quietly hides a film and attaches the wrong
 * provider to it.
 *
 * So there are three outcomes, not two:
 *
 *   MERGE    confident. The incoming record is attached to the existing work.
 *   REVIEW   suspicious but not confident. The pair is parked for a person to
 *            decide, and meanwhile both stay visible.
 *   DISTINCT no reason to think they are the same.
 *
 * The ladder, in the brief's own order of preference:
 *
 *   0. this provider's own id, already filed      — decisive, and the reason
 *                                                   a re-import is idempotent
 *   1. a reliable external id (IMDb and friends)  — decisive on its own
 *   2. normalized title + year                    — strong
 *   3. original title + year                      — strong
 *   4. normalized title, year within one          — needs corroboration
 *   5. normalized title, neither side has a year  — review at best
 *
 * Rung 0 matters more than it looks. Without it, a work the provider gives no
 * year for can never match itself: rung 2 needs a year, and rungs 4 and 5 only
 * ever queue for review, so every refresh would file another copy of it and
 * the catalogue would grow a duplicate a week. Remembering which work this
 * provider's item was filed as last time costs one lookup and makes a
 * re-import a no-op however thin the metadata is.
 */

export const MERGE_AT = 0.85;
export const REVIEW_AT = 0.45;

/** External id schemes trusted enough to decide a match on their own. */
export const STRONG_SCHEMES = new Set(['imdb', 'tmdb', 'tvdb', 'eidr', 'wikidata']);

/* ------------------------------------------------------------ normalizing -- */

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/**
 * The comparison form of a title.
 *
 * "The Lord of the Rings: The Two Towers" and "Lord of the Rings - the Two
 * Towers" have to land on the same string, and "Rocky II" has to land where
 * "Rocky 2" does.
 *
 * `year` matters for one specific case. A provider that writes the year into
 * the title as well as into the year field is restating it, not naming the
 * film — a filename like `Arrival.2016.1080p.mkv` reads as "Arrival 2016" —
 * so a trailing year that equals the record's own year comes off. A trailing
 * number that does NOT match the year stays, because then it is part of the
 * name: "Blade Runner 2049" released in 2017 is not "Blade Runner".
 */
export function normalizeTitle(title, year = null) {
  let s = String(title || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // drop diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/\b(?:part|pt|vol|volume|chapter)\b\.?\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  /* A leading article is noise: "The Matrix" is "Matrix". Only leading, so
     "Saving Private Ryan" keeps its words. */
  s = s.replace(/^(?:the|a|an|le|la|les|el|los|das|der|die|il|lo)\s+/, '');

  /* Fold roman numerals to digits so sequels line up either way round. */
  s = s.split(' ').map(w => (w in ROMAN ? String(ROMAN[w]) : w)).join(' ');
  s = s.replace(/\s+/g, ' ').trim();

  if (year != null && year !== '') {
    const stripped = s.replace(new RegExp(`\\s*\\b${Number(year)}\\b\\s*$`), '').trim();
    /* Only when something is left: a film genuinely called "1917" keeps its
       name rather than becoming the empty string. */
    if (stripped) s = stripped;
  }

  return s;
}

/**
 * Which of two titles to show, where both name the same work.
 *
 * The shorter is preferred when the longer only adds a restatement of the
 * year — so a film scanned off disk as "Arrival 2016" is displayed as
 * "Arrival" once a provider supplies the cleaner name. Otherwise the existing
 * one is kept, because churning the title on every import is worse than a
 * slightly scruffy one.
 */
export function betterTitle(existing, incoming, year) {
  const a = String(existing || '').trim();
  const b = String(incoming || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (year == null) return a;
  const tail = new RegExp(`[\\s.\\-_(\\[]*${Number(year)}[)\\]]*$`);
  const aRestates = tail.test(a), bRestates = tail.test(b);
  if (aRestates && !bRestates) return b;
  return a;
}

export const matchKey = (title, year) =>
  `${normalizeTitle(title, year)}|${year == null || year === '' ? '' : Number(year)}`;

export const nameKey = (name) => String(name || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* --------------------------------------------------------------- the rungs -- */

const TABLE = { movie: 'catalogue_movies', series: 'catalogue_series' };

const SOURCE_TABLE = {
  movie: ['catalogue_movie_sources', 'movie_id'],
  series: ['catalogue_series_sources', 'series_id'],
  episode: ['catalogue_episode_sources', 'episode_id']
};

/**
 * Rung 0: we have filed this exact item from this exact provider before.
 *
 * The source row is the record of that decision, so it is also the answer.
 * Nothing about the work's metadata is consulted, which is the point: a
 * provider that renames a film, or supplies no year at all, still lands on
 * the row it landed on last time.
 */
export function bySourceId(kind, providerId, contentId) {
  if (!providerId || !contentId) return null;
  const spec = SOURCE_TABLE[kind];
  const table = TABLE[kind];
  if (!spec || !table) return null;
  const [srcTable, col] = spec;
  const db = openDb();
  const hit = db.prepare(
    `SELECT ${col} AS work_id FROM ${srcTable} WHERE provider_id = ? AND provider_content_id = ?`)
    .get(providerId, String(contentId));
  if (!hit) return null;
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(hit.work_id);
  return row ? { work: row, confidence: 1, reason: 'already imported from this provider' } : null;
}

/** Rung 1: an external id names exactly one work, so this is decisive. */
export function byExternalId(kind, externalIds = {}) {
  const db = openDb();
  for (const [scheme, value] of Object.entries(externalIds)) {
    if (!value || !STRONG_SCHEMES.has(scheme)) continue;
    const hit = db.prepare('SELECT work_id FROM catalogue_ids WHERE work_kind = ? AND scheme = ? AND value = ?')
      .get(kind, scheme, String(value));
    if (hit) {
      const row = db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`).get(hit.work_id);
      if (row) return { work: row, confidence: 1, reason: `${scheme} id ${value}` };
    }
  }
  return null;
}

/**
 * The whole ladder. Returns { decision, work, confidence, reason, evidence }.
 *
 * `incoming` is a normalized work from an adapter. `runtimeMinutes`,
 * `directors` and `originalTitle` are used as corroboration when the title and
 * year alone are not enough — which is the difference between merging Rocky
 * and merging a 1998 remake onto its 1962 original.
 */
export function resolve(kind, incoming, { providerId = null } = {}) {
  const db = openDb();
  const table = TABLE[kind];
  if (!table) throw new Error(`Not a kind of work: ${kind}`);

  const seen = bySourceId(kind, providerId, incoming.source && incoming.source.contentId);
  if (seen) return { decision: 'merge', ...seen, evidence: { rung: 0 } };

  const byId = byExternalId(kind, incoming.externalIds || {});
  if (byId) return { decision: 'merge', ...byId, evidence: { rung: 1, id: byId.reason } };

  const year = incoming.year == null ? null : Number(incoming.year);
  const norm = normalizeTitle(incoming.title, year);
  if (!norm) return { decision: 'distinct', work: null, confidence: 0, reason: 'no usable title' };
  const origNorm = incoming.originalTitle ? normalizeTitle(incoming.originalTitle, year) : '';

  /* Rung 2 and 3: an exact title+year hit, on either the title or the original
     title. Two different films sharing both is rare enough, and a provider
     disagreeing about the year by a year is common enough, that this is the
     line where merging is safe. */
  if (year != null) {
    const exact = db.prepare(`SELECT * FROM ${table} WHERE normalized_title = ? AND year = ?`)
      .all(norm, year);
    if (exact.length === 1) {
      return { decision: 'merge', work: exact[0], confidence: 0.95,
               reason: 'title and year', evidence: { rung: 2, norm, year } };
    }
    if (exact.length > 1) {
      /* The catalogue itself already holds two rows that look identical. Do not
         guess which one this belongs to. */
      return { decision: 'review', work: exact[0], confidence: 0.6,
               reason: 'several existing rows share this title and year',
               evidence: { rung: 2, norm, year, candidates: exact.map(r => r.id) } };
    }

    if (origNorm && origNorm !== norm) {
      const byOrig = db.prepare(
        `SELECT * FROM ${table} WHERE (normalized_title = ? OR original_title = ?) AND year = ?`)
        .all(origNorm, incoming.originalTitle, year);
      if (byOrig.length === 1) {
        return { decision: 'merge', work: byOrig[0], confidence: 0.9,
                 reason: 'original title and year', evidence: { rung: 3, origNorm, year } };
      }
    }
  }

  /* Rung 4: the same title a year out. Providers disagree about release years
     all the time — a festival year against a general release — so this is a
     candidate, not a match, and it needs something else to agree. */
  const near = year == null ? [] : db.prepare(
    `SELECT * FROM ${table} WHERE normalized_title = ? AND year IS NOT NULL
       AND ABS(year - ?) <= 1 AND year <> ?`).all(norm, year, year);

  if (near.length === 1) {
    const corroborated = corroborate(kind, near[0], incoming);
    if (corroborated.score > 0) {
      return { decision: 'merge', work: near[0], confidence: 0.88,
               reason: `title, year within one, and ${corroborated.why}`,
               evidence: { rung: 4, norm, year, otherYear: near[0].year, ...corroborated } };
    }
    return { decision: 'review', work: near[0], confidence: 0.65,
             reason: 'same title, year differs by one, nothing else to compare',
             evidence: { rung: 4, norm, year, otherYear: near[0].year } };
  }

  /* Rung 5: a title match with no year to lean on, on one side or the other.
     Never merged. A remake and its original would land here, and so would two
     unrelated films called "Alone". */
  const titleOnly = db.prepare(
    `SELECT * FROM ${table} WHERE normalized_title = ? AND (year IS NULL OR ? IS NULL)`)
    .all(norm, year);
  if (titleOnly.length) {
    return { decision: 'review', work: titleOnly[0], confidence: 0.5,
             reason: year == null ? 'same title, this record has no year'
                                  : 'same title, the existing record has no year',
             evidence: { rung: 5, norm, year, candidates: titleOnly.map(r => r.id) } };
  }

  if (near.length > 1) {
    return { decision: 'review', work: near[0], confidence: 0.5,
             reason: 'several existing rows have this title within a year',
             evidence: { rung: 4, norm, year, candidates: near.map(r => r.id) } };
  }

  return { decision: 'distinct', work: null, confidence: 0, reason: 'no candidate' };
}

/**
 * Something other than the title agreeing. A runtime within three minutes, or
 * a director in common, is enough to turn a near-miss on the year into a
 * match; nothing in common leaves it for review.
 */
function corroborate(kind, existing, incoming) {
  if (kind === 'movie' && incoming.runtimeMinutes && existing.runtime_minutes) {
    const gap = Math.abs(Number(incoming.runtimeMinutes) - Number(existing.runtime_minutes));
    if (gap <= 3) return { score: 1, why: `a runtime within ${gap} minute${gap === 1 ? '' : 's'}` };
    /* A runtime that disagrees by half an hour is evidence *against*. */
    if (gap >= 20) return { score: -1, why: `a runtime ${gap} minutes apart` };
  }

  const theirs = new Set((incoming.directors || []).map(nameKey).filter(Boolean));
  if (theirs.size) {
    const ours = openDb().prepare(
      `SELECT name_key FROM catalogue_credits WHERE work_kind = ? AND work_id = ? AND role = 'director'`)
      .all(kind, existing.id).map(r => r.name_key);
    const shared = ours.filter(n => theirs.has(n));
    if (shared.length) return { score: 1, why: 'the same director' };
  }

  return { score: 0, why: 'nothing else to compare' };
}

/* ----------------------------------------------------------- review queue -- */

/**
 * Park an uncertain pair. Ordered so the same pair found from either direction
 * is one row, and ignored if that pair has already been decided.
 */
export function queueReview(kind, aId, bId, { confidence, reason, evidence } = {}) {
  if (!aId || !bId || aId === bId) return null;
  const left = Math.min(aId, bId), right = Math.max(aId, bId);
  const db = openDb();
  const existing = db.prepare(
    'SELECT * FROM catalogue_merge_reviews WHERE work_kind = ? AND left_id = ? AND right_id = ?')
    .get(kind, left, right);
  if (existing) return existing;

  db.prepare(`INSERT INTO catalogue_merge_reviews
      (work_kind, left_id, right_id, confidence, reason, evidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
    .run(kind, left, right, Number(confidence) || 0, String(reason || ''),
         JSON.stringify(evidence || {}), nowIso());
  return db.prepare(
    'SELECT * FROM catalogue_merge_reviews WHERE work_kind = ? AND left_id = ? AND right_id = ?')
    .get(kind, left, right);
}

export function openReviews({ kind = null, limit = 100, offset = 0 } = {}) {
  const db = openDb();
  const where = ["status = 'open'"], args = [];
  if (kind) { where.push('work_kind = ?'); args.push(kind); }
  const total = db.prepare(`SELECT COUNT(*) n FROM catalogue_merge_reviews WHERE ${where.join(' AND ')}`)
    .get(...args).n;
  const rows = db.prepare(`SELECT * FROM catalogue_merge_reviews WHERE ${where.join(' AND ')}
      ORDER BY confidence DESC, id LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Number(limit) || 100, 500), Number(offset) || 0);

  return {
    total,
    items: rows.map(r => {
      const table = TABLE[r.work_kind];
      const side = (id) => table
        ? db.prepare(`SELECT id, canonical_title, year, runtime_minutes FROM ${table} WHERE id = ?`)
            .get(id) || null
        : null;
      return {
        id: r.id, workKind: r.work_kind, confidence: r.confidence, reason: r.reason,
        evidence: safeJson(r.evidence), createdAt: r.created_at,
        left: side(r.left_id), right: side(r.right_id)
      };
    })
  };
}

const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
