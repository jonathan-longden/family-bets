-- ---------------------------------------------------------------------------
-- 007 — remembering how a poster was found, so it is not looked for twice
--
-- A provider's poster is preferred and always will be. When there is none,
-- Telly can ask The Movie Database — by the id the provider gave, which is
-- exact and cheap, or by title and year, which is neither.
--
-- Which is the whole reason for this migration. A catalogue can hold
-- twenty-four thousand films. Searching TMDB for every one of them on every
-- pass would be twenty-four thousand requests a day for an answer that does
-- not change, and most of those searches would be for the same handful of
-- titles that nobody has a poster for. So each work records what was tried
-- and when:
--
--   art_state  ''          nobody has looked yet
--              'provider'  the provider's own poster is cached and good
--              'tmdb'      TMDB supplied one, and it is cached
--              'none'      looked, found nothing — left alone for a while
--
--   art_checked_at  when that was decided, so 'none' can be retried
--                   occasionally rather than constantly
--
-- No new table: this is the catalogue's own rows able to say one more thing
-- about themselves, in the same style as the channel health columns.
-- ---------------------------------------------------------------------------

ALTER TABLE catalogue_movies ADD COLUMN art_state      TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movies ADD COLUMN art_checked_at TEXT;

ALTER TABLE catalogue_series ADD COLUMN art_state      TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_series ADD COLUMN art_checked_at TEXT;

-- The pass picks up what has never been looked at first, then the oldest
-- decision, so a run is always working on the least recently considered.
CREATE INDEX idx_cat_movies_art ON catalogue_movies(art_state, art_checked_at);
CREATE INDEX idx_cat_series_art ON catalogue_series(art_state, art_checked_at);

-- A work that already has a cached provider poster is in its final state, and
-- saying so now means the first pass after an upgrade does not reconsider the
-- entire catalogue. Anything else is left blank, which is "not looked at yet".
UPDATE catalogue_movies SET art_state = 'provider', art_checked_at = created_at
 WHERE poster_url <> '' AND poster_url IN
   (SELECT url FROM artwork_cache WHERE state = 'cached');

UPDATE catalogue_series SET art_state = 'provider', art_checked_at = created_at
 WHERE poster_url <> '' AND poster_url IN
   (SELECT url FROM artwork_cache WHERE state = 'cached');
