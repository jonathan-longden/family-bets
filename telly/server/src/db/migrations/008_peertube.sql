-- ---------------------------------------------------------------------------
-- 008 — PeerTube: openly licensed video, and the provenance that makes it so
--
-- PeerTube is a federation of independent instances, each run by somebody
-- different, each setting its own rules. That shapes all three of the changes
-- here.
--
-- 1. A SOURCE NEEDS SETTINGS OF ITS OWN.
--
--    An Xtream panel is a subscription: a URL and a username, and the panel
--    decides what is in it. A PeerTube instance is a library, and what Telly
--    takes from it is the operator's choice — which search terms, how long a
--    film has to be, which licences are acceptable on that instance, whether
--    HLS is required. Those are per-instance, not per-provider, so they live
--    on the source row as JSON rather than becoming eleven columns that only
--    one kind of source would ever use.
--
-- 2. A COPY NEEDS TO SAY WHAT IT IS AND WHERE IT CAME FROM.
--
--    Everything in the catalogue so far has been either the household's own
--    file or something a subscription carries, and in both cases the right to
--    play it is not in question. An openly licensed video is different: the
--    licence IS the permission, so it has to be recorded with the copy, shown
--    to the viewer, and kept where an operator can audit it. Attribution is
--    not decoration either — under CC BY it is a condition of use.
--
--    These are properties of the COPY, not of the work: the same film could
--    come from one instance under CC BY and from another under a licence
--    Telly will not take. So they sit on the source row.
--
-- 3. AN IMPORT NEEDS TO SAY WHAT IT REFUSED, AND WHY.
--
--    An import that discovers four thousand videos and takes nine is working
--    exactly as intended, and without these counters it looks broken. The
--    licence figure is the one that matters most: it is the evidence that the
--    filter is doing its job.
--
-- No new tables, and nothing existing changes meaning. An Xtream or M3U
-- source has no settings and reads as it always did; a source row with no
-- licence is a source whose rights were never in question.
-- ---------------------------------------------------------------------------

-- 1. Per-source configuration, as JSON. Empty for every existing source.
ALTER TABLE sources ADD COLUMN settings TEXT NOT NULL DEFAULT '';

-- 2. Provenance, on the copy.
--
--    licence         the declared licence, in Telly's own words ('CC BY-SA')
--    licence_id      the provider's own code for it, kept verbatim
--    licence_url     where the licence text is, when one is published
--    attribution     the credit line a licence may require
--    author          who uploaded or made it
--    source_instance the host it came from, which on PeerTube is the publisher
--    source_url      the canonical page, for a viewer who wants the original
--    external_uuid   the provider's own identifier for the video
--    last_seen_at    when a sync last saw it still there, which is not the
--                    same as when it last changed
ALTER TABLE catalogue_movie_sources ADD COLUMN licence         TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN licence_id      TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN licence_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN attribution     TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN author          TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN source_instance TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN source_url      TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN external_uuid   TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_movie_sources ADD COLUMN last_seen_at    TEXT;

ALTER TABLE catalogue_episode_sources ADD COLUMN licence         TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN licence_id      TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN licence_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN attribution     TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN author          TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN source_instance TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN source_url      TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN external_uuid   TEXT NOT NULL DEFAULT '';
ALTER TABLE catalogue_episode_sources ADD COLUMN last_seen_at    TEXT;

-- Finding every copy that came from one instance, and auditing by licence.
CREATE INDEX idx_cat_msrc_instance ON catalogue_movie_sources(source_instance);
CREATE INDEX idx_cat_msrc_licence  ON catalogue_movie_sources(licence);
CREATE INDEX idx_cat_msrc_uuid     ON catalogue_movie_sources(external_uuid);

-- 3. What a run refused. Every one of these is a video that was discovered
--    and deliberately not imported, which is the importer working rather
--    than failing — `errors` stays what it has always been, a fault.
ALTER TABLE provider_imports ADD COLUMN skipped_licence   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_short     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_nsfw      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_live      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_unplayable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_duplicate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_instance  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN skipped_other     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN instances_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN queries_run       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_imports ADD COLUMN videos_discovered INTEGER NOT NULL DEFAULT 0;
