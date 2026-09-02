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
    GET    /api/v1/channels?kind=&group=&search=&limit=&offset=
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
