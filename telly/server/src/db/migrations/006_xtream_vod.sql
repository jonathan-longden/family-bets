-- ---------------------------------------------------------------------------
-- 006 — an Xtream panel's films and series, in the catalogue
--
-- Two things a catalogue source could not say, both of which an Xtream
-- subscription needs it to.
--
-- 1. WHICH SUBSCRIPTION IT CAME FROM.
--
--    `provider_id` says "an Xtream panel". It does not say which, and an
--    operator with two subscriptions needs to know: the same film from two
--    panels is one card with two ways to play it, and when a panel is removed
--    its sources should go with it and nobody else's should move. The
--    provider content id already encodes the source row ("s2:movie:1234"),
--    but a column that can be joined and shown is not the same as a string
--    that has to be parsed, so the row now carries the source id and the name
--    the operator gave that panel.
--
-- 2. THAT THE ADDRESS IS NOT FIT TO HAND OUT.
--
--    An Xtream VOD address has the subscription's username and password in
--    the path:
--
--        http://panel:8080/movie/USERNAME/PASSWORD/1234.mkv
--
--    Every other catalogue source so far has been either a file on this
--    server's own disk or a public address — so a source's URL could be given
--    to a player and was. That cannot happen with these: handing the address
--    to every television and phone in the house hands each of them the
--    subscription, and the standing rule is that a client receives what it
--    needs and nothing else.
--
--    So a source can now be marked `credentialed`, and the rule for one is
--    that its address stays on the server: the client is given a short-lived
--    ticketed path on this server instead, which resolves the address and
--    redirects. The same arrangement live channels have always used. Nothing
--    is downloaded and nothing is stored — the video still comes from the
--    panel, straight to the player.
--
-- No new tables: these are the existing source rows, able to say two more
-- things about themselves.
-- ---------------------------------------------------------------------------

ALTER TABLE catalogue_movie_sources   ADD COLUMN credentialed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalogue_movie_sources   ADD COLUMN source_id    INTEGER REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE catalogue_movie_sources   ADD COLUMN source_label TEXT    NOT NULL DEFAULT '';

ALTER TABLE catalogue_episode_sources ADD COLUMN credentialed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalogue_episode_sources ADD COLUMN source_id    INTEGER REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE catalogue_episode_sources ADD COLUMN source_label TEXT    NOT NULL DEFAULT '';

ALTER TABLE catalogue_series_sources  ADD COLUMN source_id    INTEGER REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE catalogue_series_sources  ADD COLUMN source_label TEXT    NOT NULL DEFAULT '';

-- Removing a subscription, and finding everything that came from it.
CREATE INDEX idx_cat_msrc_source ON catalogue_movie_sources(source_id);
CREATE INDEX idx_cat_esrc_source ON catalogue_episode_sources(source_id);
CREATE INDEX idx_cat_ssrc_source ON catalogue_series_sources(source_id);
