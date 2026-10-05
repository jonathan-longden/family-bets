# Telly backend

The server the Telly clients talk to. It owns the accounts, the playlists and
the provider credentials; the apps own the picture on the screen.

    Native app --HTTPS--> this server --> SQLite + your IPTV sources

Runs on a PC on your network today and moves to a VPS unchanged: the clients
only ever know an API endpoint, so relocating the server is a setting rather
than a rewrite.

## Getting started

    cd telly/server
    npm install
    node bin/telly-admin.js create-admin youradmin 'a good password'
    node bin/telly-admin.js add-user john 'johns password' 2
    node bin/telly-admin.js add-source "House playlist" m3u_url https://example.com/playlist.m3u
    node bin/telly-admin.js sync 1
    node bin/telly-admin.js assign john 1
    npm start

Then point the app at `http://your-pc-ip:8443`. `npm test` runs the suite.

### The rest of it

    # films, box sets and recordings off this PC's own disk
    node bin/telly-admin.js add-media Films  movies     "C:\\Media\\Movies"
    node bin/telly-admin.js add-media TV     series     "C:\\Media\\TV"
    node bin/telly-admin.js add-media Recs   recordings "C:\\Media\\Recordings"
    node bin/telly-admin.js scan

    # a programme guide
    node bin/telly-admin.js add-epg "UK guide" https://example.org/epg.xml
    node bin/telly-admin.js sync-epg 1

    # the whole catalogue back out as one playlist
    node bin/telly-admin.js export > telly.m3u

    node bin/telly-admin.js list        # everything, with its last error if it has one

After the first run the server refreshes playlists, guides and media folders on
its own — every five minutes it looks for anything due.

## What it is responsible for

| | |
|---|---|
| Accounts | users, roles, enable/disable, expiry dates, password resets |
| Sessions | opaque access + refresh tokens, rotation, revocation |
| Devices | a device limit per account, with named devices an admin can remove |
| Entitlement | which sources and which sections of the app each user may open |
| Playlists | fetching and parsing M3U and Xtream, cached as channel rows |
| Metadata | channels, categories, live/movie/series, search |
| Profile | favourites, recently watched, per-user settings |
| Playback | short-lived signed tickets, so credentials stay here |
| Personal media | folders on this PC scanned in place: films, series, seasons, episodes, recordings |
| Programme guide | XMLTV downloaded, parsed, matched on tvg-id and served as now/next |
| Refreshing | each source on its own interval, with backoff, and never emptying a catalogue on a failure |

## Security

- **Passwords** are stored as scrypt hashes with a per-user salt, and the
  parameters are recorded per row so they can be raised later without locking
  anybody out. A missing username costs the same time as a wrong password, so
  the two cannot be told apart by watching the clock.
- **Tokens** are random and opaque, stored only as SHA-256 hashes. Refreshing
  rotates both tokens, so a stolen refresh token is good once at most, and
  revoking a session is a single row update.
- **Provider credentials never leave this process.** The apps get a channel id;
  playback goes through a signed ticket bound to one user, one device and one
  channel, valid for five minutes.
- **Authentication is opt-in per route**, so a route that forgets to ask is a
  route that does not exist rather than one that is open by accident.
- **Input is validated** by JSON schema at the edge, before any work happens.
- **Rate limiting** on sign-in and on the API generally.
- **A client-provided path is never trusted, because there is no way to send
  one.** Nothing in the API takes a filesystem path: a client holds a movie id
  or an episode id, the server looks the row up in SQLite, and before anything
  is opened the path on that row is resolved and checked to be inside a
  configured media folder. The check is on a boundary, not a prefix, so
  `/srv/media-private` does not pass because `/srv/media` was approved, and a
  row pointing at `/etc/passwd` — through a bad import, a renamed folder or a
  symlink inside a media folder — is refused with a 403 rather than served.
  Artwork goes through the same check.
- **Errors say one thing to a person and nothing to an attacker**: a fixed
  shape, a message fit for a television, and never a stack trace.

## The API

    GET    /api/v1/health                     is anyone there, and is it set up
    POST   /api/v1/auth/login                 username + password + device
    POST   /api/v1/auth/refresh               rotate both tokens
    POST   /api/v1/auth/logout
    GET    /api/v1/me                         profile, sections, playlists, devices
    GET    /api/v1/me/devices                 DELETE /api/v1/me/devices/:id
    GET    /api/v1/me/favourites              PUT|DELETE .../favourites/:channelId
    GET    /api/v1/me/recent                  POST .../recent/:channelId
    GET    /api/v1/me/settings                PUT /api/v1/me/settings
    GET    /api/v1/playlists                  POST /api/v1/playlists/:id/refresh
    GET    /api/v1/categories?kind=live
    GET    /api/v1/channels?kind=&group=&search=&country=&language=
                              &health=&sort=&page=&limit=&offset=
    GET    /api/v1/channels/:id               one channel
    PUT    /api/v1/channels/:id/hidden        hide it for this account only
    DELETE /api/v1/channels/:id/hidden        and show it again
    GET    /api/v1/channels-hidden            what this account has hidden
    GET    /api/v1/countries                  what the line-up declares
    GET    /api/v1/languages

    GET    /api/v1/movies?search=&year=&genre=&limit=&offset=
    GET    /api/v1/movies/:id
    GET    /api/v1/series?search=             with season and episode counts
    GET    /api/v1/series/:id                 and its seasons
    GET    /api/v1/series/:id/seasons         seasons on their own, as records
    GET    /api/v1/series/:id/episodes?season=
    GET    /api/v1/episodes/:id               one episode, for a deep link
    GET    /api/v1/recordings?search=
    GET    /api/v1/search?q=                  channels and the personal library at once
    GET    /api/v1/favourites                 the same list as /me/favourites
    GET    /api/v1/epg                        now and next across the line-up
    GET    /api/v1/epg?tvgId=&from=&to=       one channel, one window
    GET    /api/v1/art/:kind/:id              a poster, by id — never by path

    POST   /api/v1/stream/:id/ticket                  a live channel
    POST   /api/v1/stream/media/:kind/:id/ticket      a file on this PC
    GET    /api/v1/stream/media/:kind/:id?ticket=     with byte ranges

  Administrator:

    GET    /api/v1/admin/sources              POST, PATCH, DELETE
    POST   /api/v1/admin/sources/:id/sync
    GET    /api/v1/admin/sources/builtin      the country lists Telly can set up
    POST   /api/v1/admin/sources/builtin      {enable:[keys]} — the exact set
    POST   /api/v1/admin/sources/:id/health   check that source's channels
    POST   /api/v1/admin/sources/:id/refresh-and-check
    GET    /api/v1/admin/health-summary       working / unavailable, per source
    POST   /api/v1/admin/check-stream         {url} — one address, on its own
    GET    /api/v1/admin/sources/export.m3u   the catalogue as a playlist
    GET    /api/v1/admin/media-roots          POST, PATCH, DELETE
    POST   /api/v1/admin/media-roots/:id/scan and /media-roots/scan for all
    POST   /api/v1/admin/library/scan/:kind   movies | tv | recordings | all
    GET    /api/v1/admin/library/scan?id=     how a scan is going, or the last
    GET    /api/v1/admin/library/unmatched    files it would not guess at
    GET    /api/v1/admin/epg-sources          POST, PATCH, DELETE
    POST   /api/v1/admin/epg-sources/:id/sync
    POST   /api/v1/admin/refresh              one pass now, rather than waiting
    POST   /api/v1/stream/:id/ticket          a signed, short-lived playback URL
    GET    /api/v1/stream/:id?ticket=...      redirects (or proxies) to the stream
    /api/v1/admin/*                           users, devices, sources, audit

## Moving to a VPS

Nothing in the code assumes a location. Copy the directory, bring `data/` if
you want the accounts, set `TELLY_SECRET`, and put TLS in front of it
(`TELLY_TRUST_PROXY=true` behind a reverse proxy). Change the endpoint in the
app. The SQL is deliberately portable: swapping SQLite for Postgres is a driver
change, not a redesign.

## What is not built yet

- **A metadata provider.** Titles, years, seasons and episodes come from the
  filenames and the folders above them, and the technical details from
  ffprobe. The columns a provider would fill — description, genre, poster —
  exist and are optional, so adding TMDB later is a service, not a migration.
  Nothing requires an external service to work.
- **Most of the admin web panel.** Media folders, scanning and the IPTV
  sources are in the app's Settings screen; users, devices and the audit log
  are still `bin/telly-admin.js` from a terminal.

## Personal media

A media folder is a path on this PC and a kind:

    node bin/telly-admin.js add-media Films movies "C:\Media\Movies"

A scan walks it and records what it finds. **The files are never copied and
never moved**, and nothing is written into the folder. `C:\Media\Movies` stays
exactly as it was; SQLite learns where each file is, what the name says about
it, and how big it is.

What the names are read for:

| | |
|---|---|
| Films | `Arrival (2016)/Arrival.2016.1080p.BluRay.x264-GROUP.mkv` → **Arrival**, 2016 |
| Series | `The Bear/Season 1/The.Bear.S01E02.Hands.mkv` → **The Bear**, series 1, episode 2, "Hands" |
| | `S01E02`, `1x02` and `Season 1 Episode 2` are all read |
| Recordings | `BBC One - 2024.03.01 - Doctor Who.ts` → **Doctor Who**, BBC One, 1 March |
| Artwork | `poster.jpg`, `folder.jpg`, `cover.jpg` or a `.jpg` beside the file |

Samples, trailers, `Extras/` and `Featurettes/` folders and anything that is
not a video file are skipped. Scanning twice changes nothing: a row is matched
on its folder and its path within it, so a rescan updates what is there rather
than adding a second copy of it.

**A file it cannot read confidently is listed, not guessed at.** A video in a
TV folder with nothing in its name or its path saying which episode it is goes
to `unmatched_media` and appears under *Unmatched files* in Settings, because
an episode filed in the wrong series is worse than a visible gap. A film with
no year keeps its filename as its title rather than having one invented.

**A file that disappears is waited for, not deleted.** A share that blinks, a
drive not yet mounted or a file halfway through being copied would otherwise
take the catalogue with them. A row that a scan cannot see is stamped
`missing_since` and kept — favourites and history with it — and dropped only
once it has been missing for the grace period (`TELLY_MISSING_GRACE`, seven
days). While it is missing it is not offered to a client, because it cannot be
played; the moment a scan sees the file again the stamp clears and it is back,
the same row. A folder that is wholly absent marks nothing at all: a scan that
can see no files is not evidence that the files are gone.

### Scanning as a job

    POST /api/v1/admin/library/scan/movies     and tv, recordings, or all
    GET  /api/v1/admin/library/scan            how far along, or the last one

A scan runs a few files at a time, handing the event loop back in between, so
the server keeps answering while it goes and `GET .../library/scan` reports
`processed` of `total` as it climbs — rather than sitting mute and producing
the figure only once it is already finished. One scan runs at a time; a second
request joins the one already going. When it ends the job holds what the
library now contains: films, series, episodes, recordings, and how many files
could not be read.

**No path ever reaches a client.** The API answers with an id and a playback
address — `/api/v1/stream/media/movie/12` — and a poster is
`/api/v1/art/movie/12`. A phone can play a film on this PC without being able
to name a single folder on it.

## Playing a file

Two steps, the same as a channel: the app holds the token and asks for a
ticket, the player holds the ticket and cannot carry a header.

The ticket says what will happen, so a player can prepare rather than guess:

    direct      the client can open this container. The file is served with
                byte ranges, so seeking works and the server only reads disk.
    remux       the streams are fine, the container is not — an .mkv in a
                browser. FFmpeg copies both into fragmented MP4 without
                re-encoding: a few percent of one core.
    unsupported no FFmpeg configured and the container will not play. Said
                plainly rather than appearing as a player that never starts.

`?capability=native` says the client is a real media player rather than a
browser, and the answer widens accordingly: an Android app gets `.mkv`, `.avi`
and `.ts` **direct**, so nothing is remuxed for it at all.

Transcoding — actually re-encoding the video — happens only when a request
asks for it. The default is always the cheapest thing that works, because this
PC is also serving the house's television.

FFmpeg is optional. Without it everything a client can open still plays
directly from disk; set `TELLY_FFMPEG_ENABLED=false` to say so explicitly, or
`TELLY_FFMPEG=/path/to/ffmpeg` if it is not on the PATH.

## The programme guide

    node bin/telly-admin.js add-epg "UK guide" https://example.org/epg.xml
    node bin/telly-admin.js sync-epg 1

The server downloads the XMLTV (plain or `.gz`), parses it, and stores the
programmes against the `tvg-id` they name. A channel is matched to a programme
by that id and nothing else, which is why the guide screen shows **how many of
your channels it actually matched** rather than claiming to be loaded.

A guide that will not download leaves the last one in place and records the
error. Nothing invents a programme it does not have.

## Refreshing, and what happens when a source is down

Each playlist and each guide has its own refresh interval. Every five minutes
the server looks for anything due and fetches it.

**A failure never empties a catalogue.** Channels are reconciled only after a
successful download, so a playlist whose server is having a bad afternoon keeps
the channels it had; the error is recorded against the source and shown in
`list`. Failures back off — fifteen minutes, then half an hour, and so on to a
ceiling — so a dead address is not fetched three hundred times a day.

Turning a source off hides it from every client at once and keeps its channels,
so turning it back on is instant rather than another download.

    TELLY_REFRESH_INTERVAL=0     refresh by hand only
    TELLY_SCAN_INTERVAL=0        scan media folders by hand only
    POST /api/v1/admin/refresh   one pass right now

## The channels Telly sets up for you

Two playlists come with it, fetched from [iptv-org](https://iptv-org.github.io/)
rather than copied into this repository, so a channel added or dropped upstream
arrives on the next refresh:

    GET  /api/v1/admin/sources/builtin                        what is available
    POST /api/v1/admin/sources/builtin  {"enable":["iptv-org:uk"]}

| key | |
|---|---|
| `iptv-org:uk` | `https://iptv-org.github.io/iptv/countries/uk.m3u` |
| `iptv-org:us` | `https://iptv-org.github.io/iptv/countries/us.m3u` |

These are the country lists, not the global one, and they carry public
free-to-air and free ad-supported streams only. There is no subscription to put
here, and nothing in Telly accepts one for these.

`enable` is the exact set that should be on, so the Settings screen can send
what it is showing. Each is keyed on `builtin` rather than on its URL: setting
one up twice adopts the row already there, and a file iptv-org moves corrects
that row instead of adding a second source beside it — so favourites and health
history stay with the channels. Override an address with `TELLY_IPTV_ORG_UK` or
`TELLY_IPTV_ORG_US`.

## Does the channel actually play?

A public list of a thousand streams is mostly a list of a thousand addresses
that used to work. So every channel is tested, and **an HTTP 200 is not
treated as an answer** — a dead CDN returning an HTML error page is a 200.

    unchecked                 not looked at yet. Still offered: a library
                              nobody has swept is shown in full, not hidden.
    working                   media came back. Re-checked once a day.
    temporarily_unavailable   it did not answer. Kept, shown, and retried on a
                              widening interval — half an hour, then an hour…
    failed                    three checks in a row failed. Kept and marked,
                              not deleted; the retry interval keeps widening
                              to a ceiling of a day.

What a check actually does, with a short timeout (`TELLY_HEALTH_TIMEOUT`,
8 seconds) and never more than about a megabyte read:

- **ffprobe**, where it is installed: the first video stream only, with
  `-probesize` and `-analyzeduration` capped. A codec and a stream back means
  playable media.
- **otherwise, the bytes themselves.** An HLS manifest must begin `#EXTM3U`
  *and* name segments or variants — an empty playlist is not a channel. MPEG-TS
  must have the 0x47 sync byte at 188-byte intervals. MP4 must carry `ftyp`,
  `styp`, `moov` or `moof`. An HTML page, an empty body or a manifest listing
  nothing all fail.

Each channel records `health_status`, `last_checked_at`, `last_success_at`,
`last_failure_at`, `failure_reason` and `consecutive_failures`. Clients ask for
what they want:

    /api/v1/channels                   playable: working + unchecked + temporarily off
    /api/v1/channels?health=working    only what was proved to play
    /api/v1/channels?health=failed     for an operator working out why
    /api/v1/channels?health=any        everything

Sweeps run a few at a time rather than opening a thousand sockets
(`TELLY_HEALTH_CONCURRENCY`, 6; `TELLY_HEALTH_BATCH`, 120 per background pass),
and only channels whose next check is due are touched.

    POST /api/v1/admin/sources/:id/health            check that source now
    POST /api/v1/admin/sources/:id/refresh-and-check fetch it, then test it
    POST /api/v1/admin/check-stream  {"url":"…"}     one address, on its own
    GET  /api/v1/admin/health-summary                the figures, per source

    TELLY_HEALTH_ENABLED=false   stop checking altogether
    TELLY_FFPROBE=/path/to/ffprobe

## Importing a playlist twice

A refresh does not replace a source's channels; it reconciles them. Identity is
the **stream URL** within the source, because a group title is the publisher's
filing and changes between refreshes without the channel changing. So:

- a channel already there is updated in place, keeping its id — and with it
  every favourite, every hidden flag and its whole health history;
- a channel that is new is added;
- a channel that has gone from the playlist is marked `active = 0`, **not
  deleted**, so it stops appearing but comes straight back, with its history,
  if the publisher puts it back next week.

The source records what the last import did: `lastImport.added`,
`.updated`, `.removed`.

## M3U, in and out

M3U is the interchange format; SQLite is the catalogue. A playlist comes in
through a source and goes back out through the export, which builds one file
from whatever is in the database — several sources, de-duplicated, with the
`tvg-id`, `tvg-logo`, `tvg-country` and `tvg-language` each channel carries.

    node bin/telly-admin.js export     > everything.m3u
    node bin/telly-admin.js export 1   > just-that-source.m3u

It carries real stream addresses, which is why it is an administrator action
and not something a client may fetch.
