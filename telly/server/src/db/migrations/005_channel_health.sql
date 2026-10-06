-- ---------------------------------------------------------------------------
-- 005 — hiding the channels that do not work, without losing them
--
-- 003 gave every channel a health status, a last-checked time, a failure
-- reason and a failure count. Two things were missing for Live TV to show
-- only what plays:
--
--   · a count of consecutive successes, so a recovery is a decision rather
--     than a single lucky connection;
--   · how long the stream took to answer, which is the difference between a
--     channel that works and one that technically works.
--
-- There is no new table and no new status column: `health_status` already
-- exists and simply gains one more value, `browser_incompatible`, for a
-- stream that answers perfectly well in a format no browser can decode.
-- Calling that "offline" would be a lie, and it is a different problem with a
-- different answer.
--
-- `last_success_at` is already "when it last worked", so nothing is added for
-- that; the API exposes it as `lastWorkingAt` as well, under both names.
-- ---------------------------------------------------------------------------

ALTER TABLE channels ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN response_time_ms      INTEGER NOT NULL DEFAULT 0;

-- A channel already known to work is treated as having one success behind it,
-- so an existing installation does not read as "never confirmed".
UPDATE channels SET consecutive_successes = 1 WHERE health_status = 'working';

-- The Live TV query filters on (source, kind, active, health) on every call,
-- and after this change the health column is in the hot path rather than an
-- extra detail. 003's index covers (health_status, last_checked_at), which
-- serves the sweep; this one serves the listing.
CREATE INDEX idx_channels_visible ON channels(source_id, kind, active, health_status);
