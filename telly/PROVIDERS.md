# Catalogue providers: what each one permits

Telly builds one Movies and Series catalogue out of several providers. Before
an importer exists for a provider, the question is not "can this be scraped?"
but "does this provider publish something meant to be read, and do its terms
permit reading it automatically?"

For the five services asked for, the answer is no — for four of them because
nothing is published, and for one for a different reason. This page says which
is which, and why, so the answer is checkable rather than taken on trust.

## The short version

| Provider | Access | Status | Importer |
|---|---|---|---|
| **Movy** (movy.sx) | none | `no_permitted_automated_access` | **No** — licensing, see below |
| **Tubi** | none | `no_permitted_automated_access` | **No** — terms prohibit automated access |
| **The Roku Channel** | none | `no_official_api` | **No** — no read API exists |
| **Fawesome** | none | `no_official_api` | **No** — nothing published |
| **Xumo Play** (on demand) | none | `no_official_api` | **No** — nothing published |
| **Xtream panels** (your own subscriptions) | `official_api` | `available` | **Yes** |
| Internet Archive | `official_api` | `available` | **Yes** |
| This server's media folders | `local_filesystem` | `available` | **Yes** |
| **PeerTube** (instances on Telly's allowlist) | `official_api` | `available` | **Yes** — openly licensed video only |
| The Movie Database | `official_api` | off unless a key is set | **Artwork and metadata only** — never a playback source |

Every one of the five is registered, visible in Settings with its reason, and
cannot be switched on. Telly reports:

> No permitted automated catalogue interface available.

## Why each one

### Movy (movy.sx) — declined on licensing

This is the one that is not an API question, and it is worth separating from
the other four.

Tubi, The Roku Channel, Fawesome and Xumo are licensed services that simply do
not publish a catalogue interface. movy.sx could not be established as a
licensed distributor of the films and series it indexes at all — there is no
identifiable operator, no terms of service, and no indication of rights to
carry the content it lists.

An importer here would not be reading a catalogue a service is entitled to
offer. It would be indexing other people's films on behalf of a site that does
not appear to have the right to carry them. **So a feed appearing would not
change this answer**, which is why its `recheck` list asks about licensing
rather than about an API.

### Tubi — terms prohibit automated access

Tubi is a real, licensed, ad-supported service (Fox). It publishes no public or
partner catalogue API for third parties; its own apps read an internal API, its
terms of use prohibit automated access and scraping, and its video is delivered
under DRM.

Using that internal API would mean going against the terms — so Telly does not.
Playback is `web_only`: a Tubi page is a page, not a stream.

### The Roku Channel — the feed spec points the other way

Roku has a substantial developer platform, but it faces outward: the published
content-feed specification is for a content owner to describe *their own*
catalogue **to** Roku. There is no documented interface for reading what The
Roku Channel carries, and playback runs through Roku's own apps and site with
its own authentication and DRM.

### Fawesome — nothing published

A licensed AVOD service from Future Today. No public or documented catalogue
API or content feed for third parties could be identified. Without something
published and meant to be read, there is nothing for an adapter to use.

### Xumo Play — half of it already works, and it is not this half

Worth being precise about, because it would be easy to overclaim.

- **Live channels.** Xumo's free channel line-up is carried by the public IPTV
  playlist projects Telly already imports from, and plays in Telly today
  through **Live TV**. That path is untouched and needs nothing from this
  system.
- **On demand.** The films-and-series catalogue is a different thing, served to
  Xumo's own apps through an internal API. Nothing public or documented
  describes it for third parties.

So the `xumo` adapter covers the on-demand catalogue only, and reports that it
has no permitted way in. It does not interfere with the live channels.

## What was and was not verified

**These assessments were made from published documentation and terms, not from
live checks against the five sites.** The environment this was built in cannot
reach any of them — every one of `movy.sx`, `tubitv.com`,
`therokuchannel.roku.com`, `fawesome.tv` and `play.xumo.com` is refused by its
egress policy — so their `robots.txt` and current terms could not be fetched at
the time of writing.

That is why the assessment is **stored as data, with a date, and surfaced in
Settings** rather than buried in code:

```
providers.access_method      none
providers.status             no_official_api | no_permitted_automated_access
providers.status_reason      the sentence shown in Settings
providers.status_checked_at  when somebody last looked
```

and why each adapter carries a `recheck` list naming what would have to change:

```js
access: {
  method: ACCESS.none,
  status: STATUS.noPermittedAccess,
  reason: 'No permitted automated catalogue interface available. …',
  assessedAt: '2026-10-05',
  recheck: [
    'A documented Tubi partner or developer catalogue API',
    'An official MRSS or JSON content feed offered to third parties',
    'A change to the terms of use permitting automated catalogue collection'
  ]
}
```

If one of these opens a feed, the change is a `discover` function and a new
`access` block in that one file. Nothing else in Telly changes, because the
catalogue, the deduplication, the player and the UI do not know one provider
from another.

## The three that do work

### Xtream panels — your own subscription, read with your own credentials

The provider that was hiding in plain sight. Telly has read Xtream panels
since the beginning, but only `get_live_streams` — so a subscription carrying
eight hundred films and a hundred box sets reported "Synced 15 channels" and
left Movies and Series empty.

A panel publishes three catalogues through one documented client API:

```
player_api.php?username=…&password=…                     the account
  &action=get_live_categories / get_live_streams          → Live TV, as before
  &action=get_vod_categories  / get_vod_streams           → Movies
  &action=get_vod_info&vod_id=…                             plot, poster, backdrop,
                                                            genre, cast, director,
                                                            year, rating, runtime,
                                                            tmdb id, age rating
  &action=get_series_categories / get_series              → Series
  &action=get_series_info&series_id=…                       seasons, episodes, their
                                                            titles, plots, air dates,
                                                            thumbnails and runtimes
```

and three stream address forms, which the API does not hand out and a client
builds:

```
/live/<user>/<pass>/<stream_id>.<ext>
/movie/<user>/<pass>/<stream_id>.<container_extension>
/series/<user>/<pass>/<episode_id>.<container_extension>
```

**Why this one qualifies on every count.** It is the panel's own client API,
documented and meant to be read; the credentials are the operator's, entered
by them for their own subscription; nothing is bypassed, because there is
nothing to bypass — the panel either accepts those credentials or does not,
and when it does not, Telly reports that and stops. There is no second way in.

**Two things it is careful about.**

*Panels disagree with their own documentation.* A number arrives as a string.
`rating` is out of ten on one panel and out of five on the next. A backdrop is
an array of addresses, or one address. A release date is `releasedate` on a
film and `releaseDate` on a series. `episodes` is keyed by season number, or
is a flat array. `info` is an object — or, when the panel has nothing to say,
an empty array, which is what makes the obvious implementation throw. All of
that is read through one set of coercions, because a reader that only copes
with the tidy version imports a third of a real catalogue and reports success.

*The address is not fit to hand out.* It has the subscription's username and
password in it. So a panel's source is marked `credentialed`, and a
credentialed source's address never leaves the server: a client is given a
short-lived ticket for a path on its own Telly server, and the server fetches
from the panel. `TELLY_VOD_MODE=redirect` turns that into a 302 for an
operator who would rather spend the address than the bandwidth.

**One adapter, every panel.** There is one provider row, not one per
subscription, because the subscriptions are rows in `sources` that an operator
adds and removes. Identity is kept where it matters: every source is filed
under `s<sourceId>:movie:<streamId>`, so re-importing updates rather than
duplicates, two panels carrying the same film give that film two ways to play,
and removing a panel takes its own entries with it and nobody else's.

## The two that need nobody's permission

### The Internet Archive

The one requested-style provider that qualifies on every count, and the reason
the rest of the machinery is testable rather than theoretical:

- **A documented public API meant to be read** — `advancedsearch.php` for
  listing, `/metadata/{id}` for one item.
- **Public-domain and openly-licensed material**, so there is nothing to bypass
  and no DRM to break.
- **Real direct playback** — the MP4 behind `/download/{id}/{file}` is a file
  the Telly player opens, so Play plays rather than opening a website.
- **Artwork at a documented address** — `/services/img/{id}`.

Telly already offered Archive film lists on the **Free channels** screen. This
turns them into real catalogue entries with metadata, which is what the brief
wants and what no commercial provider here permits.

Deliberately unhurried: a 1.2-second delay between requests, two at a time, ten
pages a run by default. It is a charity running a library.

### This server's media folders

The household's own films and box sets, which Telly already scans, offered to
the catalogue as one provider's sources. It needs nobody's permission, which is
why it is the only one on by default.

This is what makes deduplication worth having from day one: **a film you own
and a film a service carries become one card with two ways to play it**, and
the local copy is preferred because it is the one that does not need the
internet.

A local source is an id into the existing `movies` and `episodes` tables, not a
URL — so the path guard, the ticket and the remux decision are all unchanged.

## Adding a provider

One file and one line.

```js
// src/services/providers/example.js
import { ACCESS, STATUS, PLAYBACK } from './contract.js';

export default {
  key: 'example',
  name: 'Example',
  baseUrl: 'https://example.com/',
  termsUrl: 'https://example.com/terms',
  access: {
    method: ACCESS.officialApi,
    status: STATUS.available,
    reason: 'Documented public catalogue API.',
    assessedAt: '2026-10-05'
  },
  capabilities: { metadata: true, artwork: true, playback: true,
                  playbackType: PLAYBACK.hls },
  limits: { requestDelayMs: 500, concurrency: 2, timeoutMs: 15000,
            maxRetries: 3, refreshIntervalSeconds: 86400 },

  async * discover(ctx) {
    const body = await ctx.getJson('https://example.com/api/titles');
    for (const t of body.titles) {
      yield {
        kind: 'movie',
        title: t.name, year: t.year, description: t.synopsis,
        runtimeMinutes: t.minutes, genres: t.genres,
        externalIds: { imdb: t.imdb_id },      // this is what dedup prefers
        poster: t.artwork.poster,
        source: {
          contentId: String(t.id),
          metadataUrl: `https://example.com/title/${t.id}`,
          playbackUrl: t.stream_url,            // only if officially offered
          playbackType: PLAYBACK.hls,
          availability: 'available'
        }
      };
    }
  }
};
```

Then add it to `ADAPTERS` in `src/services/providers/index.js`. That is all:
the schema, the matcher, the import log, the politeness, the filters, the UI
and the player are already provider-agnostic.

Three things the framework will not let an adapter do:

1. **Make an impolite request.** Every outbound call goes through `ctx.get`,
   which enforces that provider's delay, timeout, retries and request count.
   An adapter cannot reach `fetch` directly.
2. **Run without a permitted interface.** `importable()` requires a `discover`
   function *and* `status: available` *and* a method other than `none`. An
   adapter with no permitted way in has no `discover` at all, so there is
   nothing to call.
3. **Claim identity.** A work an adapter yields carries no provider field. The
   provider belongs to the source, which is what makes one film one card.

### PeerTube — a federation, asked one instance at a time

PeerTube is not a service. It is software anybody may run, so "importing from
PeerTube" is meaningless until you say *whose* PeerTube. That shapes every
decision here.

| | |
|---|---|
| Access | `official_api` — the documented REST API, `/api/v1/search/videos` and `/api/v1/videos/{uuid}` |
| Who is asked | Named instances on Telly's own allowlist, and nobody else |
| What is taken | Only videos licensed **CC0**, **CC BY** or **CC BY-SA** |
| Playback | Public HLS, or a public progressive file — played by the client, from the instance |
| Default | Off, with no instances configured |

**The global search index is never used.** PeerTube's `searchTarget=search-index`
aggregates whoever asks to be aggregated, which means videos from servers
nobody has assessed under rules nobody has read. Telly asks instances it has
an allowlist for, and `searchTarget` is deliberately absent from every request
it sends.

**The allowlist is checked twice** — when a source is added, and again on every
import. A list enforced only at creation time is not enforced: an operator may
tighten it, and a source added under the old list has to stop being read the
moment they do. `TELLY_PEERTUBE_HOSTS` replaces the shipped list rather than
adding to it.

**The licence is the permission.** The three permitted licences are the ones
that unambiguously allow redistribution. The rest are refused, and two of the
refusals are worth stating plainly:

- **ND (no derivatives)** forbids derivative works, and transcoding and
  re-presentation can amount to one.
- **NC (non-commercial)** turns on whether a particular use is commercial —
  a question about the household running the server, not about the video, and
  one Telly is in no position to answer. Where the answer is unclear the video
  is not taken.

A video whose licence is missing, unrecognised, or anything other than the
three is not imported — not greyed out, not queued for review, not imported.
There is no setting that widens the list to "anything", and `All rights
reserved` can never be added to it.

**Attribution is kept and shown.** Under CC BY and CC BY-SA it is a condition
of use rather than a courtesy, so the credit line, the author, the licence,
the licence URL and a link to the original are stored with the copy and
displayed on the title's own screen.

**Nothing is downloaded.** The address Telly stores is a public HLS manifest or
a public file on the instance that published it, and the client opens it
directly — the same arrangement the Internet Archive uses. An address that
looks signed or time-limited is treated as having no playable media at all,
because storing one would give the catalogue an entry that stops working in an
hour.

## Metadata and artwork: TMDB, and only TMDB

The providers above are catalogues — they say what a title is and how to play
it. One source is neither: **The Movie Database** is read only to fill in a
poster, and a few fields beside it, that a provider left empty.

| | |
|---|---|
| Access | `official_api` — [documented](https://developer.themoviedb.org/docs), read with a key the operator obtains themselves |
| Default | **Off.** No key, no requests. |
| Read by id | `/3/movie/{id}`, `/3/tv/{id}` — where a provider supplied a TMDB id |
| Read by name | `/3/search/movie`, `/3/search/tv` — rationed, and only with a year |
| Written | A poster and backdrop, cached locally at card size; description, rating and the TMDB and IMDb ids, into empty columns only |
| Attribution | *This product uses the TMDB API but is not endorsed or certified by TMDB.* |

Three things it deliberately is not:

- **Not a scraper.** It is their JSON API. No web page is parsed, here or
  anywhere else in Telly.
- **Not IMDb.** An IMDb id is stored when a provider or TMDB hands one over,
  because it is useful for matching two records of the same film. It is never
  followed: IMDb publishes no interface for this and its terms do not permit
  taking one.
- **Not an authority.** A provider's own poster wins. TMDB fills gaps; it
  never overwrites a field a provider filled.

And it is rationed, because twenty-four thousand films must not become
twenty-four thousand searches: a lookup by id is exact and cheap, a search by
title and year is neither, so a pass spends at most `TELLY_TMDB_LOOKUPS` of
them and every outcome is recorded so the next pass does not repeat it. A
search with no year, or whose best candidate's name or year does not agree, is
thrown away rather than guessed at — a wrong poster is worse than none.

## The boundaries, restated

Telly stores metadata and authorised playback sources. It does not:

- bypass DRM, authentication, paywalls, CAPTCHAs, bot protection or rate limits
- extract protected streams
- treat a provider's web page as if it were a video stream
- download films from third-party services
- redistribute third-party content
- scrape a provider whose terms prohibit it
- read any metadata service other than TMDB, and that only with a key the
  operator set and only through its documented API
- import a PeerTube video whose licence is missing, unknown, or anything other
  than CC0, CC BY or CC BY-SA — and a TMDB match never changes that answer
- read a PeerTube instance that is not on Telly's own allowlist, or the
  federation-wide search index

Where a provider offers playback only through its own app or site, the source
is marked `web_only`: the catalogue stays honest about who carries the title,
Play says so plainly, and the link out is offered instead of a player that will
never start.
