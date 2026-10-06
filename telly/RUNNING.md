# Getting your own library on screen

The short version: **the catalogue lives on your PC, so the app has to be
opened from your PC.** Telly's server now serves the app itself, which is the
arrangement that needs no certificate, no CORS and no configuration.

    your PC ──> Telly server ──> SQLite ──> /api/movies ──> the app
                     │                                        ▲
                     └────────── serves the app ──────────────┘
                              http://192.168.1.50:8080/telly/

## 1. Start the server

Node 20 or newer. In a terminal:

    cd telly/server
    npm install
    node bin/telly-admin.js create-admin jonathan "a password you choose"
    npm start

It prints the address it is listening on. By default that is port **8443**;
for a home network over plain HTTP, use 8080:

    # Windows (PowerShell)
    $env:TELLY_PORT=8080; $env:TELLY_HOST="0.0.0.0"; npm start

    # macOS / Linux
    TELLY_PORT=8080 TELLY_HOST=0.0.0.0 npm start

`TELLY_HOST=0.0.0.0` is what lets the phone and the television reach it.
Without it the server only answers on the PC itself.

Find your PC's address on the network — `ipconfig` on Windows, `ifconfig` or
`ip addr` elsewhere — and use that: `http://192.168.1.50:8080`.

## 2. Open the app from the server

    http://192.168.1.50:8080/telly/

**Not** the GitHub Pages copy. That one is served over https and your server is
on http, so the browser refuses the request before it is sent — it is not a
setting you can change from this side. Opened from the server, the app and the
API share an origin and there is nothing to configure.

Settings now says which it is:

    Telly server
    ● Connected      http://192.168.1.50:8080 — 128 films · 14 series · 302 episodes

    ● Blocked by the browser   …this page is on https and the server is on http…
    ● Offline                  …did not answer…

## 3. Sign in

**Add playlist → Telly account**, the server's address, the username and
password from step 1.

A brand-new server has nothing in it, and that is fine — it connects anyway and
takes you to the Library settings. (It used to refuse, which is what made this
look broken.)

## 4. Add your folders and scan

**Settings → Media library.**

1. Type the folder **as the server sees it** — `C:\Media\Movies` on the PC
   running the server, not as it looks from another machine.
2. Choose **Movies**.
3. **Add folder**. Repeat with `C:\Media\TV` and **TV Series**.
4. Press **Scan Everything**.

The panel then reads:

    Movies found      2
    Series found      1
    Episodes found    2
    Scan status       finished
    Last scan         just now
    Errors            none
    Unmatched files   none

**Movies** and **Series** now hold your library.

## Test it with two known files

Exactly the procedure, with the results to expect.

### A film

1. Make the folder and put one video in it:

       C:\TellyTest\Movies\Inception (2010).mkv

2. **Settings → Media library** → path `C:\TellyTest\Movies`, kind **Movies**,
   **Add folder**.
3. **Scan Movies**. The panel should say `Movies found: 1`.
4. Check the database, if you want to see it for yourself:

       cd telly/server
       node bin/telly-admin.js list

5. Check the API in a browser tab — you will need the token the app holds, so
   the easier check is the open one:

       http://192.168.1.50:8080/api/health

   which reports `"catalogue":{"movies":1,...}`.

6. **Movies** → the card says **Inception**, 2010. Not "Inception (2010)" — the
   year comes out of the title because it has its own column.
7. Click it → the film screen, with **This server's media folders** listed as
   the source.
8. **Play** → the existing Telly player opens.

> **An `.mkv` needs FFmpeg.** Browsers play mp4, m4v and webm; for anything
> else the server repackages the container on the way out, which needs FFmpeg
> on the PATH. Without it the film still appears in the library and Play says
> exactly that rather than hanging. Install FFmpeg, or test with an `.mp4`
> first.

### A series

1. Make:

       C:\TellyTest\TV\Breaking Bad\Season 1\Breaking Bad S01E01.mp4
       C:\TellyTest\TV\Breaking Bad\Season 1\Breaking Bad S01E02.mp4

2. Add `C:\TellyTest\TV` as **TV Series**, then **Scan TV**.
3. `Series found: 1`, `Episodes found: 2`.
4. **Series** → **Breaking Bad** → **Season 1** → Episode 1, Episode 2.
5. Press an episode → the player opens.

The filenames carry no episode titles, so they show as "Episode 1" and
"Episode 2" — which is honest. `S01E01 - Pilot.mp4` would show as "Pilot".

## The API, if you want to check it yourself

Unversioned paths, all reading the catalogue:

    GET /api/health                      open — no account needed
    GET /api/movies                      ?search= &genre= &year= &page= &limit=
    GET /api/movies/:id
    GET /api/movies/:id/stream
    GET /api/series
    GET /api/series/:id
    GET /api/series/:id/seasons
    GET /api/series/:id/episodes
    GET /api/episodes/:id
    GET /api/episodes/:id/stream
    GET /api/search?q=
    GET /api/counts

Everything but `/api/health` and the two `/stream` paths needs a bearer token.
`/api/v1/...` is unchanged and still works.

From a terminal:

    TOKEN=$(curl -s -X POST http://192.168.1.50:8080/api/v1/auth/login \
      -H 'content-type: application/json' \
      -d '{"username":"jonathan","password":"your password",
           "device":{"key":"curl-0000000001","name":"curl","platform":"web","appVersion":"1"}}' \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

    curl -s -H "authorization: Bearer $TOKEN" http://192.168.1.50:8080/api/movies

## Why the client never sends a path

It cannot. There is no path parameter anywhere in the API. The app holds a
**movie id** or an **episode id**; the server looks the row up in SQLite,
resolves the path on it, and checks it is inside a folder you configured before
opening anything — on a boundary, so `C:\Movies-private` does not pass because
`C:\Movies` was approved. A row pointing anywhere else is refused with a 403.

Playback goes through a short-lived signed ticket, because a `<video>` element
cannot send an Authorization header. `/api/movies/:id/stream` accepts either
that ticket or a bearer token, so a real media player can use it directly.

## GitHub Pages

Still published, still useful as a shop window:
<https://jonathan-longden.github.io/family-bets/telly/>

What works there: the interface, the Free channels catalogue, any https M3U you
paste, favourites in that browser.

What does not, and cannot: anything in the library. The catalogue is SQLite on
your PC; a static host has no database and no access to your folders. From
https it cannot even reach your server over http. Use
`http://your-pc:8080/telly/` for the real thing.

## When it still looks empty

| What you see | What it means |
|---|---|
| Settings says **Offline** | The server is not running, or this device cannot reach that address. Check `TELLY_HOST=0.0.0.0`. |
| Settings says **Blocked by the browser** | You are on the Pages copy over https. Open `http://your-pc:8080/telly/` instead. |
| **Connected**, but Movies is empty | No folders added, or no scan yet. Settings → Media library. |
| `Movies found: 0` after a scan | The path is wrong, or wrong as the *server* sees it. The folder row shows an error if it does not exist. |
| Films appear, Play fails on `.mkv` | FFmpeg is not installed. Films in mp4/m4v/webm play without it. |
| Channels showing in Movies | Fixed. A channel is never a film; film channels live in Live TV under "Film channels". |
| Live TV showing fewer channels than the playlist imported | Working as intended. A channel whose stream does not answer is hidden, kept in the database, rechecked on its own and put back the moment it works. **Settings → IPTV sources → Show hidden channels** says which and why. |
| An Xtream panel's films and series are missing from Movies and Series | `sync` reads the live channels only. Run `node bin/telly-admin.js probe <id>` to see what the panel has, then `import-vod <id>` to bring the films and series in. |
| A channel you know works is not listed | It may be `browser_incompatible` — a raw MPEG-TS or `rtmp://` stream, which answers but which no browser can decode. The hidden list says so. Press **Check channels** to look again now. |

A scan that finds files now publishes them to the catalogue in the same
operation, so there is no second button to find. If you ever want to force it:

    POST /api/v1/admin/providers/1/refresh     # 1 = the local folders
