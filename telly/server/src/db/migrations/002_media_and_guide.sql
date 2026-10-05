-- Telly backend: personal media, a real programme guide, and source management.
--
-- Everything here is additive except epg_programmes, which is recreated: the
-- original shape keyed programmes to an IPTV source, and nothing ever wrote a
-- row to it, so there is no data to preserve and a guide that can be shared
-- between playlists is worth more than the empty table.

-- ---------------------------------------------------------------- sources --
-- A source is configurable rather than fixed: it can be turned off without
-- losing its channels, refreshed on its own interval, and — the point of
-- fail_count — left alone when the upstream is merely having a bad day.
ALTER TABLE sources ADD COLUMN refresh_interval_seconds INTEGER NOT NULL DEFAULT 21600;
ALTER TABLE sources ADD COLUMN last_attempt_at TEXT;
ALTER TABLE sources ADD COLUMN fail_count      INTEGER NOT NULL DEFAULT 0;

-- Channels gain the two facts an M3U usually carries and this schema dropped.
ALTER TABLE channels ADD COLUMN country  TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN language TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_channels_country  ON channels(country);
CREATE INDEX idx_channels_language ON channels(language);
CREATE INDEX idx_channels_tvg      ON channels(tvg_id);

-- ------------------------------------------------------------ media roots --
-- A folder on the server's own disk. The files stay exactly where they are:
-- this table records where to look, never what to move.
CREATE TABLE media_roots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT    NOT NULL,
  path         TEXT    NOT NULL UNIQUE,
  kind         TEXT    NOT NULL,                    -- 'movies' | 'series' | 'recordings'
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_scan_at TEXT,
  last_error   TEXT,
  item_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

-- ----------------------------------------------------------------- movies --
-- rel_path is the identity within a root, so a renamed root does not orphan a
-- library. The absolute path is here and goes nowhere near a client.
CREATE TABLE movies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id     INTEGER NOT NULL REFERENCES media_roots(id) ON DELETE CASCADE,
  rel_path    TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  title_key   TEXT    NOT NULL,                     -- lowercased, for search
  year        INTEGER,
  genre       TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  poster      TEXT    NOT NULL DEFAULT '',          -- a path on the server, served as an image
  container   TEXT    NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT    NOT NULL DEFAULT '',
  added_at    TEXT    NOT NULL,
  seen_at     TEXT    NOT NULL,                     -- last scan that saw this file
  UNIQUE (root_id, rel_path)
);
CREATE INDEX idx_movies_title ON movies(title_key);
CREATE INDEX idx_movies_year  ON movies(year);

-- ----------------------------------------------------------------- series --
CREATE TABLE series (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id     INTEGER NOT NULL REFERENCES media_roots(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  title_key   TEXT    NOT NULL,
  year        INTEGER,
  genre       TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  poster      TEXT    NOT NULL DEFAULT '',
  added_at    TEXT    NOT NULL,
  seen_at     TEXT    NOT NULL,
  UNIQUE (root_id, title_key)
);
CREATE INDEX idx_series_title ON series(title_key);

CREATE TABLE episodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id   INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season      INTEGER NOT NULL DEFAULT 1,
  episode     INTEGER NOT NULL DEFAULT 0,
  title       TEXT    NOT NULL DEFAULT '',
  rel_path    TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  container   TEXT    NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT    NOT NULL DEFAULT '',
  added_at    TEXT    NOT NULL,
  seen_at     TEXT    NOT NULL,
  UNIQUE (series_id, rel_path)
);
CREATE INDEX idx_episodes_series ON episodes(series_id, season, episode);

-- ------------------------------------------------------------- recordings --
CREATE TABLE recordings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id      INTEGER NOT NULL REFERENCES media_roots(id) ON DELETE CASCADE,
  rel_path     TEXT    NOT NULL,
  path         TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  title_key    TEXT    NOT NULL,
  channel_name TEXT    NOT NULL DEFAULT '',
  recorded_at  TEXT    NOT NULL DEFAULT '',
  container    TEXT    NOT NULL DEFAULT '',
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  modified_at  TEXT    NOT NULL DEFAULT '',
  added_at     TEXT    NOT NULL,
  seen_at      TEXT    NOT NULL,
  UNIQUE (root_id, rel_path)
);
CREATE INDEX idx_recordings_title ON recordings(title_key);
CREATE INDEX idx_recordings_when  ON recordings(recorded_at DESC);

-- -------------------------------------------------------------------- EPG --
-- An XMLTV feed is its own thing: one guide commonly covers several playlists,
-- and a playlist often names a guide it does not own.
CREATE TABLE epg_sources (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT    NOT NULL,
  url                      TEXT    NOT NULL,
  enabled                  INTEGER NOT NULL DEFAULT 1,
  refresh_interval_seconds INTEGER NOT NULL DEFAULT 43200,
  last_synced_at           TEXT,
  last_attempt_at          TEXT,
  last_error               TEXT,
  fail_count               INTEGER NOT NULL DEFAULT 0,
  channel_count            INTEGER NOT NULL DEFAULT 0,
  programme_count          INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT    NOT NULL,
  updated_at               TEXT    NOT NULL
);

CREATE TABLE epg_channels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  epg_source_id INTEGER NOT NULL REFERENCES epg_sources(id) ON DELETE CASCADE,
  tvg_id        TEXT    NOT NULL,
  display_name  TEXT    NOT NULL DEFAULT '',
  icon          TEXT    NOT NULL DEFAULT '',
  UNIQUE (epg_source_id, tvg_id)
);
CREATE INDEX idx_epg_channels_tvg ON epg_channels(tvg_id);

-- Recreated: see the note at the top of this file.
DROP TABLE IF EXISTS epg_programmes;
CREATE TABLE epg_programmes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  epg_source_id INTEGER NOT NULL REFERENCES epg_sources(id) ON DELETE CASCADE,
  tvg_id        TEXT    NOT NULL,
  starts_at     TEXT    NOT NULL,                   -- ISO-8601 UTC
  ends_at       TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  subtitle      TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  category      TEXT    NOT NULL DEFAULT '',
  icon          TEXT    NOT NULL DEFAULT '',
  UNIQUE (epg_source_id, tvg_id, starts_at)
);
-- The guide is always read as "this channel, around now", so that is the index.
CREATE INDEX idx_epg_prog_window ON epg_programmes(tvg_id, starts_at, ends_at);
CREATE INDEX idx_epg_prog_source ON epg_programmes(epg_source_id);
