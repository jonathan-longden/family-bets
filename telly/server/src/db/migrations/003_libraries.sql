-- Telly backend: the three libraries proper.
--
-- Channels stop being thrown away and re-inserted on every refresh; they get
-- an identity, a lifetime and a health record. Series gain real seasons. A
-- scan becomes a job you can watch, and the files it could not read become a
-- list somebody can look at rather than silence.

-- ------------------------------------------------------------- channels --
-- source_key is the channel's identity within its source, so a refresh
-- updates the row that is already there instead of making another one. The
-- stream address is what actually identifies a stream; a group title is the
-- publisher's filing and changes between refreshes without the channel
-- changing at all.
ALTER TABLE channels ADD COLUMN source_key TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN tvg_name   TEXT NOT NULL DEFAULT '';

-- A channel that vanishes from a playlist is not deleted. Playlists drop
-- channels for an afternoon and bring them back; deleting one loses its
-- favourites, its health history and its place in the numbering.
ALTER TABLE channels ADD COLUMN active        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE channels ADD COLUMN first_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN last_seen_at  TEXT NOT NULL DEFAULT '';

-- 'unchecked' | 'working' | 'temporarily_unavailable' | 'failed'
ALTER TABLE channels ADD COLUMN health_status        TEXT NOT NULL DEFAULT 'unchecked';
ALTER TABLE channels ADD COLUMN last_checked_at      TEXT;
ALTER TABLE channels ADD COLUMN last_success_at      TEXT;
ALTER TABLE channels ADD COLUMN last_failure_at      TEXT;
ALTER TABLE channels ADD COLUMN failure_reason       TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;

UPDATE channels SET source_key = stream_url WHERE source_key = '';
UPDATE channels SET first_seen_at = created_at, last_seen_at = created_at WHERE first_seen_at = '';

CREATE UNIQUE INDEX idx_channels_identity ON channels(source_id, source_key);
CREATE INDEX idx_channels_health ON channels(health_status, last_checked_at);
CREATE INDEX idx_channels_active ON channels(source_id, active, kind);

-- Hiding is a person's choice, not a property of the channel: one household
-- member clearing shopping channels out of the way should not clear them for
-- everybody.
CREATE TABLE hidden_channels (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

-- --------------------------------------------------------------- sources --
-- What the last import and the last health sweep actually found, so the
-- settings screen can say so rather than implying everything worked.
ALTER TABLE sources ADD COLUMN builtin            TEXT NOT NULL DEFAULT '';  -- 'iptv-org:uk' etc
ALTER TABLE sources ADD COLUMN last_import_added   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN last_import_updated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN last_import_removed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN last_health_at      TEXT;

-- --------------------------------------------------------- media folders --
-- Named as the thing it is. The table was media_roots; renaming it keeps the
-- rows, which is the point of doing it as a migration.
ALTER TABLE media_roots RENAME TO media_folders;

-- ---------------------------------------------------------------- series --
ALTER TABLE series ADD COLUMN folder_path TEXT NOT NULL DEFAULT '';
ALTER TABLE series ADD COLUMN updated_at  TEXT NOT NULL DEFAULT '';
UPDATE series SET updated_at = added_at WHERE updated_at = '';

-- A season is a real record with a real key, so an episode belongs to one
-- rather than merely carrying a number that happens to match.
CREATE TABLE seasons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title         TEXT    NOT NULL DEFAULT '',
  poster        TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  UNIQUE (series_id, season_number)
);
CREATE INDEX idx_seasons_series ON seasons(series_id, season_number);

ALTER TABLE episodes ADD COLUMN season_id   INTEGER REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE episodes ADD COLUMN updated_at  TEXT NOT NULL DEFAULT '';
UPDATE episodes SET updated_at = added_at WHERE updated_at = '';
CREATE INDEX idx_episodes_season ON episodes(season_id, episode);

-- ----------------------------------------------- technical metadata ------
-- Read locally with ffprobe where it is installed. The columns exist either
-- way, so a metadata provider can fill the rest in later without a migration.
ALTER TABLE movies ADD COLUMN video_codec TEXT    NOT NULL DEFAULT '';
ALTER TABLE movies ADD COLUMN audio_codec TEXT    NOT NULL DEFAULT '';
ALTER TABLE movies ADD COLUMN width       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE movies ADD COLUMN height      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE movies ADD COLUMN probed_at   TEXT;
ALTER TABLE movies ADD COLUMN updated_at  TEXT NOT NULL DEFAULT '';
UPDATE movies SET updated_at = added_at WHERE updated_at = '';

ALTER TABLE episodes ADD COLUMN video_codec TEXT    NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN audio_codec TEXT    NOT NULL DEFAULT '';
ALTER TABLE episodes ADD COLUMN width       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE episodes ADD COLUMN height      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE episodes ADD COLUMN probed_at   TEXT;

ALTER TABLE recordings ADD COLUMN video_codec TEXT    NOT NULL DEFAULT '';
ALTER TABLE recordings ADD COLUMN audio_codec TEXT    NOT NULL DEFAULT '';
ALTER TABLE recordings ADD COLUMN width       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN height      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recordings ADD COLUMN probed_at   TEXT;
ALTER TABLE recordings ADD COLUMN updated_at  TEXT NOT NULL DEFAULT '';
UPDATE recordings SET updated_at = added_at WHERE updated_at = '';

-- ------------------------------------------------- a file that vanished --
-- A scan that cannot see a file no longer deletes its row on the spot: a
-- network share that blinks, a drive not yet mounted or a file halfway
-- through being copied would all take the catalogue with them. The row is
-- stamped instead, kept for the grace period, and only then dropped. A file
-- that comes back clears the stamp.
ALTER TABLE movies     ADD COLUMN missing_since TEXT;
ALTER TABLE episodes   ADD COLUMN missing_since TEXT;
ALTER TABLE recordings ADD COLUMN missing_since TEXT;
CREATE INDEX idx_movies_missing     ON movies(missing_since);
CREATE INDEX idx_episodes_missing   ON episodes(missing_since);
CREATE INDEX idx_recordings_missing ON recordings(missing_since);

-- ------------------------------------------------------- unmatched media --
-- A file the scanner could not confidently read. It is listed rather than
-- guessed at, because a wrongly-filed episode is worse than a visible gap.
CREATE TABLE unmatched_media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id  INTEGER NOT NULL REFERENCES media_folders(id) ON DELETE CASCADE,
  rel_path   TEXT    NOT NULL,
  path       TEXT    NOT NULL,
  file_name  TEXT    NOT NULL,
  kind       TEXT    NOT NULL,            -- what the folder said it should be
  reason     TEXT    NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  seen_at    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  UNIQUE (folder_id, rel_path)
);
CREATE INDEX idx_unmatched_folder ON unmatched_media(folder_id);

-- ------------------------------------------------------------ scan jobs --
-- A scan is a job with a progress figure, because "scanning…" with no number
-- against a library of three thousand files tells nobody anything.
CREATE TABLE scan_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,           -- 'movies' | 'tv' | 'recordings' | 'all'
  status      TEXT    NOT NULL,           -- 'running' | 'done' | 'failed'
  started_at  TEXT    NOT NULL,
  finished_at TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  processed   INTEGER NOT NULL DEFAULT 0,
  movies      INTEGER NOT NULL DEFAULT 0,
  series      INTEGER NOT NULL DEFAULT 0,
  episodes    INTEGER NOT NULL DEFAULT 0,
  recordings  INTEGER NOT NULL DEFAULT 0,
  unmatched   INTEGER NOT NULL DEFAULT 0,
  missing     INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  message     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_scan_jobs_when ON scan_jobs(started_at DESC);
