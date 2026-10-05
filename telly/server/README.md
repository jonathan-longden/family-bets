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
    GET    /api/v1/channels?kind=&group=&search=&country=&language=&limit=&offset=
    GET    /api/v1/countries                  what the line-up declares
    GET    /api/v1/languages

    GET    /api/v1/movies?search=&year=&genre=&limit=&offset=
    GET    /api/v1/movies/:id
    GET    /api/v1/series?search=             with season and episode counts
    GET    /api/v1/series/:id                 and its seasons
    GET    /api/v1/series/:id/episodes?season=
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
    GET    /api/v1/admin/sources/export.m3u   the catalogue as a playlist
    GET    /api/v1/admin/media-roots          POST, PATCH, DELETE
    POST   /api/v1/admin/media-roots/:id/scan and /media-roots/scan for all
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

- **The admin web panel.** Its API is here and tested; the pages are not
  written. `bin/telly-admin.js` does the same jobs from a terminal.
- **EPG ingestion.** The `epg_programmes` table and a source's `epgUrl` exist,
  and nothing populates them yet, so the guide still says plainly that it has
  no data rather than inventing any.

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
not a video file are skipped. A file deleted from disk leaves the catalogue on
the next scan; one that moved within the folder arrives again under its new
name. Scanning twice changes nothing.

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

**A failure never empties a catalogue.** The channels are replaced only after a
successful download, so a playlist whose server is having a bad afternoon keeps
the channels it had; the error is recorded against the source and shown in
`list`. Failures back off — fifteen minutes, then half an hour, and so on to a
ceiling — so a dead address is not fetched three hundred times a day.

Turning a source off hides it from every client at once and keeps its channels,
so turning it back on is instant rather than another download.

    TELLY_REFRESH_INTERVAL=0     refresh by hand only
    TELLY_SCAN_INTERVAL=0        scan media folders by hand only
    POST /api/v1/admin/refresh   one pass right now

## M3U, in and out

M3U is the interchange format; SQLite is the catalogue. A playlist comes in
through a source and goes back out through the export, which builds one file
from whatever is in the database — several sources, de-duplicated, with the
`tvg-id`, `tvg-logo`, `tvg-country` and `tvg-language` each channel carries.

    node bin/telly-admin.js export     > everything.m3u
    node bin/telly-admin.js export 1   > just-that-source.m3u

It carries real stream addresses, which is why it is an administrator action
and not something a client may fetch.
