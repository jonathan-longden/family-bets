-- ---------------------------------------------------------------------------
-- 004 — the unified catalogue
--
-- Telly already has three libraries: IPTV channels from playlists, and films,
-- series and recordings read off this server's own disk. Those stay exactly as
-- they are. This migration adds a layer above them.
--
-- The problem it solves: the same film is on several services. Without this,
-- "Inception" appears four times in Movies, once per provider. So a work —
-- a film, a series, an episode — is recorded once, canonically, and the
-- providers that carry it hang off it as *sources*. The screen shows one
-- Inception with three ways to play it.
--
-- Provider identity is deliberately NOT part of a work's identity. A work is
-- a work; a source is one provider's copy of it.
--
--   catalogue_movies ──< catalogue_movie_sources >── providers
--
-- Nothing here replaces the local-disk tables (movies, series, episodes).
-- Those are a provider of this catalogue like any other — see the `local`
-- adapter — so an existing installation keeps everything it had and gains a
-- catalogue on top.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------- providers ---
-- One row per service Telly can import from. The status columns are the point:
-- a provider that does not offer a permitted automated interface is recorded
-- as such, with the reason and the date it was assessed, and never runs.
CREATE TABLE providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT    NOT NULL UNIQUE,         -- 'tubi', 'archive-org', 'local'
  name          TEXT    NOT NULL,
  base_url      TEXT    NOT NULL DEFAULT '',
  terms_url     TEXT    NOT NULL DEFAULT '',     -- so a person can read them
  robots_url    TEXT    NOT NULL DEFAULT '',

  enabled       INTEGER NOT NULL DEFAULT 0,      -- the operator's own switch

  -- How, if at all, a catalogue may be read from it.
  --   official_api      a documented interface meant for this
  --   public_feed       a published feed (MRSS, JSON, M3U) meant to be read
  --   local_filesystem  this server's own disk
  --   none              no permitted automated catalogue interface
  access_method TEXT    NOT NULL DEFAULT 'none',

  --   available                       it can be imported from now
  --   unavailable                     it should work but is not answering
  --   no_official_api                 nothing documented to read
  --   no_permitted_automated_access   its terms forbid automated collection
  status        TEXT    NOT NULL DEFAULT 'no_official_api',
  status_reason TEXT    NOT NULL DEFAULT '',
  status_checked_at TEXT,

  -- What it can supply, when it can be read at all.
  supports_metadata INTEGER NOT NULL DEFAULT 0,
  supports_artwork  INTEGER NOT NULL DEFAULT 0,
  supports_playback INTEGER NOT NULL DEFAULT 0,
  -- The best playback a source from here can offer: direct | hls | dash |
  -- web_only | none. web_only means the provider plays only in its own app or
  -- site; Telly says so rather than pretending it has a stream.
  playback_type TEXT    NOT NULL DEFAULT 'web_only',

  -- Politeness, per provider, because a published rate limit is per service.
  request_delay_ms         INTEGER NOT NULL DEFAULT 500,
  concurrency              INTEGER NOT NULL DEFAULT 2,
  timeout_ms               INTEGER NOT NULL DEFAULT 15000,
  max_retries              INTEGER NOT NULL DEFAULT 3,
  page_limit               INTEGER NOT NULL DEFAULT 0,   -- 0 = no cap
  refresh_interval_seconds INTEGER NOT NULL DEFAULT 86400,

  last_sync_at    TEXT,
  last_attempt_at TEXT,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT    NOT NULL DEFAULT '',
  builtin         INTEGER NOT NULL DEFAULT 1,   -- shipped with Telly
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX idx_providers_enabled ON providers(enabled, status);

-- ---------------------------------------------------------- canonical work --
-- `normalized_title` is the comparison form: lowercased, articles and
-- punctuation stripped, roman numerals and digits folded. `match_key` is that
-- plus the year, which is what a title+year lookup indexes.
CREATE TABLE catalogue_movies (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_title  TEXT    NOT NULL,
  normalized_title TEXT    NOT NULL,
  original_title   TEXT    NOT NULL DEFAULT '',
  match_key        TEXT    NOT NULL DEFAULT '',
  year             INTEGER,
  release_date     TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL DEFAULT '',
  runtime_minutes  INTEGER NOT NULL DEFAULT 0,
  rating           REAL,                          -- a score, where one is given
  age_rating       TEXT    NOT NULL DEFAULT '',   -- 'PG', '15', 'TV-MA'
  poster_url       TEXT    NOT NULL DEFAULT '',
  backdrop_url     TEXT    NOT NULL DEFAULT '',
  thumbnail_url    TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
CREATE INDEX idx_cat_movies_match ON catalogue_movies(match_key);
CREATE INDEX idx_cat_movies_norm  ON catalogue_movies(normalized_title, year);
CREATE INDEX idx_cat_movies_title ON catalogue_movies(canonical_title);
CREATE INDEX idx_cat_movies_year  ON catalogue_movies(year);

CREATE TABLE catalogue_series (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_title  TEXT    NOT NULL,
  normalized_title TEXT    NOT NULL,
  original_title   TEXT    NOT NULL DEFAULT '',
  match_key        TEXT    NOT NULL DEFAULT '',
  year             INTEGER,
  release_date     TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL DEFAULT '',
  rating           REAL,
  age_rating       TEXT    NOT NULL DEFAULT '',
  poster_url       TEXT    NOT NULL DEFAULT '',
  backdrop_url     TEXT    NOT NULL DEFAULT '',
  thumbnail_url    TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
CREATE INDEX idx_cat_series_match ON catalogue_series(match_key);
CREATE INDEX idx_cat_series_norm  ON catalogue_series(normalized_title, year);
CREATE INDEX idx_cat_series_title ON catalogue_series(canonical_title);

CREATE TABLE catalogue_seasons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id     INTEGER NOT NULL REFERENCES catalogue_series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title         TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  poster_url    TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  UNIQUE (series_id, season_number)
);

-- An episode's identity is the series it is in and its numbers, exactly as the
-- brief asks: (series_id, season_number, episode_number). So the same episode
-- on four providers is one row with four sources.
CREATE TABLE catalogue_episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id       INTEGER NOT NULL REFERENCES catalogue_series(id) ON DELETE CASCADE,
  season_id       INTEGER REFERENCES catalogue_seasons(id) ON DELETE CASCADE,
  season_number   INTEGER NOT NULL,
  episode_number  INTEGER NOT NULL,
  title           TEXT    NOT NULL DEFAULT '',
  description     TEXT    NOT NULL DEFAULT '',
  air_date        TEXT    NOT NULL DEFAULT '',
  runtime_minutes INTEGER NOT NULL DEFAULT 0,
  rating          REAL,
  thumbnail_url   TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE (series_id, season_number, episode_number)
);
CREATE INDEX idx_cat_eps_series ON catalogue_episodes(series_id, season_number, episode_number);

-- ----------------------------------------------------------- the sources ---
-- Which provider carries this work, where its page is, and — only where the
-- provider offers one — where its stream is.
--
--   playback_type  direct | hls | dash | web_only | none
--   web_only       the provider plays this in its own app or site only. The
--                  row exists so the catalogue is honest about who has it; no
--                  stream is invented for it.
CREATE TABLE catalogue_movie_sources (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  movie_id            INTEGER NOT NULL REFERENCES catalogue_movies(id) ON DELETE CASCADE,
  provider_id         INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_content_id TEXT    NOT NULL,
  metadata_url        TEXT    NOT NULL DEFAULT '',
  playback_url        TEXT    NOT NULL DEFAULT '',
  playback_type       TEXT    NOT NULL DEFAULT 'web_only',
  availability_status TEXT    NOT NULL DEFAULT 'unchecked',
  -- A local-disk source points at a row in `movies`, not at a URL, so the
  -- existing path guard and ticket system serve it unchanged.
  local_kind          TEXT    NOT NULL DEFAULT '',   -- 'movie' | 'episode' | ''
  local_id            INTEGER,
  quality             TEXT    NOT NULL DEFAULT '',
  last_checked        TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE (provider_id, provider_content_id)
);
CREATE INDEX idx_cat_msrc_movie ON catalogue_movie_sources(movie_id, playback_type);

CREATE TABLE catalogue_series_sources (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id           INTEGER NOT NULL REFERENCES catalogue_series(id) ON DELETE CASCADE,
  provider_id         INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_content_id TEXT    NOT NULL,
  metadata_url        TEXT    NOT NULL DEFAULT '',
  availability_status TEXT    NOT NULL DEFAULT 'unchecked',
  last_checked        TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE (provider_id, provider_content_id)
);
CREATE INDEX idx_cat_ssrc_series ON catalogue_series_sources(series_id);

CREATE TABLE catalogue_episode_sources (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id          INTEGER NOT NULL REFERENCES catalogue_episodes(id) ON DELETE CASCADE,
  provider_id         INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_content_id TEXT    NOT NULL,
  metadata_url        TEXT    NOT NULL DEFAULT '',
  playback_url        TEXT    NOT NULL DEFAULT '',
  playback_type       TEXT    NOT NULL DEFAULT 'web_only',
  availability_status TEXT    NOT NULL DEFAULT 'unchecked',
  local_kind          TEXT    NOT NULL DEFAULT '',
  local_id            INTEGER,
  quality             TEXT    NOT NULL DEFAULT '',
  last_checked        TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  UNIQUE (provider_id, provider_content_id)
);
CREATE INDEX idx_cat_esrc_ep ON catalogue_episode_sources(episode_id, playback_type);

-- ------------------------------------------------------- external ids -------
-- The first and best rung of the deduplication ladder. One (kind, scheme,
-- value) names one work, so two providers quoting the same IMDb id resolve to
-- the same row without a title ever being compared.
CREATE TABLE catalogue_ids (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  work_kind TEXT    NOT NULL,                  -- 'movie' | 'series' | 'episode'
  work_id   INTEGER NOT NULL,
  scheme    TEXT    NOT NULL,                  -- 'imdb' | 'tmdb' | 'tvdb' | 'eidr' | 'wikidata'
  value     TEXT    NOT NULL,
  created_at TEXT   NOT NULL,
  UNIQUE (work_kind, scheme, value)
);
CREATE INDEX idx_cat_ids_work ON catalogue_ids(work_kind, work_id);

-- --------------------------------------------------------------- facets -----
-- Genre, country, language and keyword in one table: four filters, one index,
-- and a provider that invents a fifth kind of tag needs no migration.
CREATE TABLE catalogue_tags (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  work_kind TEXT    NOT NULL,
  work_id   INTEGER NOT NULL,
  kind      TEXT    NOT NULL,                  -- 'genre' | 'country' | 'language' | 'keyword'
  value     TEXT    NOT NULL,
  value_key TEXT    NOT NULL,                  -- lowercased, for grouping
  UNIQUE (work_kind, work_id, kind, value_key)
);
CREATE INDEX idx_cat_tags_lookup ON catalogue_tags(kind, value_key);
CREATE INDEX idx_cat_tags_work   ON catalogue_tags(work_kind, work_id);

-- ---------------------------------------------------------------- people ----
CREATE TABLE catalogue_credits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  work_kind  TEXT    NOT NULL,
  work_id    INTEGER NOT NULL,
  role       TEXT    NOT NULL,                 -- 'cast' | 'director' | 'writer'
  name       TEXT    NOT NULL,
  name_key   TEXT    NOT NULL,
  character  TEXT    NOT NULL DEFAULT '',
  image_url  TEXT    NOT NULL DEFAULT '',
  ordering   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (work_kind, work_id, role, name_key)
);
CREATE INDEX idx_cat_credits_work ON catalogue_credits(work_kind, work_id, role, ordering);

-- ------------------------------------------------------- duplicate review ---
-- Where the ladder got far enough to suspect two rows are the same work but
-- not far enough to act, the pair is parked here instead of being merged.
-- Merging the wrong two films is worse than showing two cards.
CREATE TABLE catalogue_merge_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_kind   TEXT    NOT NULL,
  left_id     INTEGER NOT NULL,
  right_id    INTEGER NOT NULL,
  confidence  REAL    NOT NULL DEFAULT 0,
  reason      TEXT    NOT NULL DEFAULT '',
  evidence    TEXT    NOT NULL DEFAULT '',     -- JSON: what matched, what did not
  status      TEXT    NOT NULL DEFAULT 'open', -- open | merged | rejected
  decided_at  TEXT,
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE (work_kind, left_id, right_id)
);
CREATE INDEX idx_cat_reviews_open ON catalogue_merge_reviews(status, work_kind);

-- ------------------------------------------------------------ import log ----
-- One row per import run, per provider: exactly the figures the brief asks to
-- see on the settings screen.
CREATE TABLE provider_imports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id       INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'running',  -- running | done | failed | skipped
  started_at        TEXT    NOT NULL,
  finished_at       TEXT,
  movies_discovered   INTEGER NOT NULL DEFAULT 0,
  series_discovered   INTEGER NOT NULL DEFAULT 0,
  episodes_discovered INTEGER NOT NULL DEFAULT 0,
  new_items         INTEGER NOT NULL DEFAULT 0,
  updated_items     INTEGER NOT NULL DEFAULT 0,
  duplicates_merged INTEGER NOT NULL DEFAULT 0,
  review_queued     INTEGER NOT NULL DEFAULT 0,
  unmatched_items   INTEGER NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  requests_made     INTEGER NOT NULL DEFAULT 0,
  message           TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_provider_imports_when ON provider_imports(provider_id, started_at DESC);

-- -------------------------------------------------------- artwork cache -----
-- A poster is fetched once. The row remembers the URL, where the copy is, and
-- the validators, so the next import revalidates rather than re-downloading —
-- and a provider whose terms do not permit a local copy is recorded as
-- reference-only and simply linked.
CREATE TABLE artwork_cache (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  url          TEXT    NOT NULL UNIQUE,
  provider_id  INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  rel_path     TEXT    NOT NULL DEFAULT '',     -- within the artwork directory
  content_type TEXT    NOT NULL DEFAULT '',
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  etag         TEXT    NOT NULL DEFAULT '',
  last_modified TEXT   NOT NULL DEFAULT '',
  state        TEXT    NOT NULL DEFAULT 'pending', -- pending | cached | reference_only | failed
  failure_reason TEXT  NOT NULL DEFAULT '',
  fetched_at   TEXT,
  last_used_at TEXT,
  created_at   TEXT    NOT NULL
);
CREATE INDEX idx_artwork_state ON artwork_cache(state, last_used_at);
