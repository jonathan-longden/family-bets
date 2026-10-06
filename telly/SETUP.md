# Setting Telly up, and checking it works

> Just want your own films on screen? [RUNNING.md](RUNNING.md) is the short
> path: start the server, open the app from it, add a folder, scan. This page
> is the fuller reference.

Everything below is done from the app's **Settings** screen, signed in to your
Telly server as an administrator. Nothing here asks you to download an M3U
file, copy a video, or type a path into the app that the app then opens — the
app only ever names things for the server to do on its own disk.

---

## 1. Start the server

    cd telly/server
    npm install
    node bin/telly-admin.js create-admin you 'a long password you choose'
    npm start

Migrations run on start, in order, each once, inside a transaction. **An
existing installation keeps its data**: the new tables and columns are added
beside what is already there.

Then open the app, go to **Add playlist → Telly account**, and sign in with the
username and password you just created. Settings will now show two extra
panels that only an administrator sees.

---

## 2. Configure the Movies folder

**Settings → Media library.**

1. Type the folder as the *server* sees it — `C:\Media\Movies`, or
   `/srv/media/films`.
2. Choose **Movies**.
3. Press **Add folder**.

Repeat for as many folders as you like: `C:\Media\Movies` and `D:\Movies` can
both be Movies folders. They are listed with their path, what is in them, how
many items they hold and when each was last scanned.

**The files are never copied and never moved.** Nothing is written into the
folder. Scanning reads it in place.

From a terminal instead:

    node bin/telly-admin.js add-media Films movies "C:\Media\Movies"

## 3. Configure the TV folder

The same panel, choosing **TV Series** — `C:\Media\TV`. All three layouts are
read:

    Breaking Bad/Season 01/Breaking Bad S01E01.mkv
    Breaking Bad/Season 1/S01E01 - Pilot.mkv
    Breaking Bad S01E01.mkv                     (no season folder at all)

`S01E01`, `S1E1`, `1x01`, `Season 01` and `Season 1` are all understood.
**Recordings** is the third kind, for what the server recorded.

---

## 4. Import an M3U

**Settings → IPTV sources.** Two ways:

**The country lists.** Press **United Kingdom** or **United States**. Telly
fetches the current iptv-org playlist for that country itself — there is no
file to download, and no static copy inside the app, so a channel added or
dropped upstream arrives on the next refresh. Press again to turn it off.
These are public free-to-air and free ad-supported streams only.

**Your own playlist.** Add it once from a terminal, then manage it from the
panel:

    node bin/telly-admin.js add-source "My playlist" m3u_url "https://example.com/list.m3u"
    node bin/telly-admin.js assign yourname 1

Each source in the panel shows **channels imported**, **working**,
**temporarily unavailable**, **browser incompatible**, **unchecked**, when the
playlist last updated and when the **last health check** ran, with four
buttons: **Refresh playlist**, **Check channels**, **Refresh + check** and
**Show hidden channels** — which lists what Live TV is leaving out and why,
with when each one last worked. That list is only answerable because nothing
is deleted.

Re-importing does not duplicate anything. Identity is the stream URL within
the source, so a channel already there is updated in place — keeping its id,
and with it your favourites and its health history. A channel that has gone
from the playlist is marked inactive rather than deleted, so it comes straight
back if the publisher restores it.

### An Xtream subscription

    node bin/telly-admin.js add-source "My panel" xtream "http://panel:8080" username password
    node bin/telly-admin.js assign yourname 2

A panel publishes **three** catalogues through one API, and they go to three
different places in Telly:

| the panel's | Telly reads it with | and it appears in |
|---|---|---|
| live channels | `sync <id>` | **Live TV** |
| films | `import-vod <id>` | **Movies** |
| series, seasons, episodes | `import-vod <id>` | **Series** |

`sync` is the live line-up only — which is why a panel full of films used to
report nothing but "Synced 15 channels". Before importing, you can ask the
panel what it actually has:

    node bin/telly-admin.js probe 2

    My panel — http://panel:8080
      account        username · Active · expires 2027-01-31 · 2 connection(s)
      output formats m3u8, ts

      live channels  15 in 3 categories   → Live TV
      films          812 in 14 categories → Movies
      series         96 in 7 categories    → Series

      a film:   "Arrival (2016) 1080p" (.mp4)
                carries plot, poster, backdrop, genre, cast, director, year, rating, runtime
                no tmdbId
      a series: "The Bear" — 2 season(s), 18 episode(s)

      to import the films and series:  import-vod 2

Then:

    node bin/telly-admin.js import-vod 2

which reads every film's details and every series in full, and files them in
the same Movies and Series library as your own disk. It is **not** a download:
each row holds the panel's own address and the video is fetched when you press
Play. Running it again updates rather than duplicates — a title is filed under
the panel's own id for it, so a renamed film stays one film.

From the app, the same thing happens on the catalogue's own schedule
(**Settings → Catalogue providers → Xtream panels → Refresh**, every six hours
by default).

**A film from two places becomes one card with two ways to play.** If you own
*Arrival* on disk and your panel carries it too, Movies shows one *Arrival*
and Play prefers the copy that needs no internet. Where the match is not
certain — the same title with no year to confirm it — both stay visible and
the pair is queued under **Possible duplicates** for you to decide, rather
than merged on a guess.

**Your subscription stays on the server.** A panel's stream address has the
username and password in the path, so Telly never gives one to a client: the
app receives a short-lived ticket for an address on your own server, and the
server fetches from the panel. That costs bandwidth on the machine running
Telly; `TELLY_VOD_MODE=redirect` trades it back for speed, at the price of
every television in the house learning the subscription.

---

## 5. Scan the libraries

**Settings → Media library →** *Scan Movies*, *Scan TV* or *Scan All*.

While it runs the line reads `scanning… 1,250 of 2,300 files`. When it
finishes it reads what the library now holds — films, series, episodes,
recordings — and below it, how many files Telly would not guess at.

One scan runs at a time. One unreadable file does not end a scan. A file that
cannot be placed confidently is **listed as unmatched, not filed in the wrong
series**; a film with no year keeps its filename as its title rather than
having one invented.

A file that disappears is **not deleted straight away**: the row is stamped and
kept for seven days (`TELLY_MISSING_GRACE`), so a share that blinks or a drive
not yet mounted does not empty your library. While it is missing it is not
offered for playback, because it cannot be played; the moment a scan sees the
file again it is back, the same row. A folder that is wholly absent marks
nothing at all.

By hand:

    POST /api/v1/admin/library/scan/all      # or movies, tv, recordings
    GET  /api/v1/admin/library/scan          # how far along
    GET  /api/v1/admin/library/unmatched     # what it would not guess at
    node bin/telly-admin.js scan

---

## 5b. Build the Movies and Series catalogue

**Settings → Catalogue providers.**

Every provider Telly knows is listed, whether or not it can be used. The ones
that can be are switched on with *Turn on* and then *Refresh*; the ones that
cannot show the reason instead of a switch.

| Provider | |
|---|---|
| **This server's media folders** | On by default. Puts your own films and box sets in the catalogue. |
| **Internet Archive** | Public-domain features, with real metadata and direct playback. Off until you want a few thousand films. |
| Tubi · The Roku Channel · Fawesome · Xumo Play · Movy | **No importer.** See the reason on each row, and [PROVIDERS.md](PROVIDERS.md). |

*Refresh all providers* imports every enabled one. The ones that cannot be
imported from are skipped **with their reason**, which is what the import log
then shows — so an empty Tubi row says why rather than looking broken.

Each row carries the figures the brief asks for: films, series and episodes
discovered; new, updated, duplicates merged, unmatched; errors; and when it
last ran. Below the list: how many titles the catalogue holds, and **how many
are carried by more than one provider** — which is how many extra cards the
deduplication is saving you.

### What one film looks like afterwards

Open **Movies**. A film your disk has *and* a provider has is **one card**.
Opening it shows the metadata and a row of providers; pressing one plays from
that one, and pressing **Play** uses the preferred source — your own disk
first, because it needs no internet.

A provider that keeps a title in its own app is greyed and labelled **web
only**. That is the honest answer, not a failure.

### Search

A box above Movies and Series, searching the whole catalogue in SQLite rather
than the page that happens to be on screen. On a subscription with twenty
thousand films that distinction is the feature: *Zodiac* is nowhere near the
first page, and typing `zodiac` finds it.

The title is matched three ways — as written, as the comparison form (so
"zone of interest" finds *The Zone of Interest*) and as the original title (so
`Rencontre` finds *Arrival*). Typing is debounced, so a word is one request
rather than one per letter, and results page in like the rest of the
catalogue. Clearing the box puts the list back as it was without fetching it
again.

Search and the filters compose: a genre chosen while searching narrows the
search rather than replacing it. Live TV has its own box over its own channel
list and is not involved.

### Posters

A provider's own poster is preferred and always will be. Where it has none, or
where the address it gave does not load, Telly can ask The Movie Database —
by the id the provider supplied, which is exact, or by title and year, which
is only trusted when the year agrees and the name is close.

That is off until you set a key, and a catalogue works perfectly well without
one: a title with no poster gets the app's own generated artwork rather than a
hole. To switch it on, get a key from
[themoviedb.org](https://www.themoviedb.org/settings/api) and set it before
starting the server:

    set TELLY_TMDB_KEY=your-key-here         (Windows)
    export TELLY_TMDB_KEY=your-key-here      (macOS, Linux)

Posters are then filled in a batch at a time by the same background pass that
refreshes providers, so a big catalogue fills over a few runs rather than
in one stampede. To run one now and see where you are:

    node bin/telly-admin.js artwork

Pictures are fetched once, cached on the server and handed to the app on the
server's own address — the app never asks a provider or TMDB for an image, and
nothing about your library is sent to them beyond the title and year of a film
with no id. Posters are fetched at a card's size, so twenty-four thousand
films cost about a gigabyte rather than tens of them; the cache stops at
`TELLY_ART_MAX_MB` (2048 by default) until you prune it.

This product uses the TMDB API but is not endorsed or certified by TMDB.

### Filters

Above Movies and Series: provider, genre, year, rating, country, language.
`Movies → Provider → Internet Archive` narrows the list; *Inception* is still
one card. A series card carries its season and episode counts, which come with
the row rather than needing the series to be opened first.

### Possible duplicates

**Settings → Possible duplicates** holds pairs Telly suspected were the same
title but would not merge on its own — the same name a year apart with nothing
else to compare, or a remake with no year. Both stay visible until you press
*Same title* or *Different*. It will not guess, because merging the wrong two
quietly hides a film.

### Removing a provider's titles

Turning a provider off stops it importing and leaves what it contributed in
place, so turning it back on is instant. To forget its titles as well:

    DELETE /api/v1/admin/providers/:id/catalogue

A film that provider was the only source for goes with it; a film others also
carry just loses one way to play.

### Refresh intervals

Each provider has its own, configurable, and the background pass only touches
the ones that are due:

    PATCH /api/v1/admin/providers/:id
      { "refreshIntervalSeconds": 604800, "requestDelayMs": 1200,
        "concurrency": 2, "timeoutMs": 20000, "maxRetries": 3, "pageLimit": 10 }

Telly will not hammer a provider: a delay between requests, a cap on how many
at once, timeouts that abort, `Retry-After` obeyed as given, a 403 taken as an
answer rather than retried another way, and failures that back off to a
ceiling of a day.

---

## 6. How to test

### A channel

**Settings → IPTV sources →** *Check channels* on a source, or *Refresh +
check* to fetch the playlist first. One address on its own:

    POST /api/v1/admin/check-stream  {"url":"https://…/master.m3u8"}

An HTTP 200 is **not** treated as an answer, because a dead CDN serving an
HTML error page is a 200. With ffprobe installed, the first video stream is
probed with `-probesize` and `-analyzeduration` capped. Without it, the bytes
are read: an HLS manifest must begin `#EXTM3U` *and* name segments or
variants; MPEG-TS must have the 0x47 sync byte at 188-byte intervals; MP4 must
carry `ftyp`, `styp`, `moov` or `moof`. Short timeout, about a megabyte at
most.

A channel is only `working` if that succeeds.

**What happens to one that fails.** Nothing is deleted, ever. A channel that
was working is given the benefit of the doubt: the first failure leaves it on
the list and puts it on the short retry clock, because somebody else's server
having a bad minute should not make the channel list flicker. The second
failure in a row takes it off Live TV — `temporarily_unavailable`, kept,
retried in half an hour, then an hour, widening to a day. Three in a row makes
it `failed`, which is still kept and still rechecked. **One good check puts it
straight back**, with no resync and nothing for you to press: the scheduled
sweep finds it answering and it reappears.

**Reachable but unplayable here is a different answer.** A raw MPEG-TS stream
or an `rtmp://` address answers perfectly well and no browser can decode it.
Those are `browser_incompatible`: hidden from Live TV in a browser, counted
separately, and told the truth about — the reason says a native player opens
it rather than claiming the channel is off.

**The server decides, not the app.** `/api/v1/channels` returns working and
not-yet-checked channels and nothing else, in SQL, and an ordinary account
asking for anything else is ignored. The other views are for administrators:

    GET /api/v1/channels                                  working + unchecked
    POST /api/v1/admin/providers/<xtream id>/refresh      import a panel's films and series
    GET /api/v1/admin/health-summary                      the figures, per source
    GET /api/v1/admin/sources/1/channels?state=hidden     what is being left out
    GET /api/v1/admin/sources/1/channels?state=incompatible
    GET /api/v1/admin/sources/1/channels?state=any        everything ever imported

A sync checks what it brought in, behind the response — several hundred
channels take minutes and no browser should hold a request open for that, so
the sync answers at once with `"checking": true` and the channels appear as
they are found. A sync never reopens a channel already known to be bad: its
row carries its history, so only the never-checked ones are looked at and a
refresh cannot put a dead channel back on the list.

### A film

Go to **Movies**, open one, press Play. Or:

    GET  /api/v1/movies?search=matrix
    POST /api/v1/stream/media/movie/12/ticket    # says direct, remux or unsupported
    GET  /api/v1/stream/media/movie/12?ticket=…  # with byte ranges, so seeking works

The reply says what will happen before you press anything: **direct** when the
client can open the container, **remux** when FFmpeg will repackage it without
re-encoding, **unsupported** when neither is possible — said plainly rather
than appearing as a player that never starts.

### A catalogue title

**Movies**, open one, press a provider in the row under the facts — or press
**Play** to use the preferred source. By hand:

    GET  /api/v1/catalogue/movies?search=arrival     one row, with its sources
    POST /api/v1/stream/catalogue/movie/7/ticket     → mode: local | direct
    POST /api/v1/stream/catalogue/movie/7/ticket?provider=archive-org

A title every provider keeps behind its own app answers **409 WEB_ONLY**, with
the link and a list of any provider that does offer a stream. That is the
answer, not an error to route around.

### A series

**Series**, open one, pick a season, pick an episode.

    GET /api/v1/series?search=breaking
    GET /api/v1/series/3                 # with its seasons
    GET /api/v1/series/3/seasons         # seasons as records of their own
    GET /api/v1/series/3/episodes?season=1

### An episode

    GET  /api/v1/episodes/41
    POST /api/v1/stream/media/episode/41/ticket
    GET  /api/v1/stream/media/episode/41?ticket=…

---

## 7. What the client can and cannot send

**No filesystem path reaches a client, and none can be sent to the server.**
There is no path parameter anywhere — `/stream?path=C:\Windows\…` does not
exist. A client holds a **movie id** or an **episode id**; the server looks the
row up in SQLite and, before anything is opened, resolves the path on that row
and checks it is inside a configured media folder. The check is on a boundary,
not a prefix, so `C:\Movies-private` does not pass because `C:\Movies` was
approved. A row pointing outside them — through a bad import, a renamed folder
or a symlink inside a media folder — is refused with a 403 rather than served.
Artwork goes through the same check: `/api/v1/art/movie/12`, never a path.

The admin panels in Settings are drawn from the role the server reports, but
that only decides what is *drawn*: every call behind them is an admin route,
checked again at the server, so a browser claiming to be an administrator gets
a 403 rather than a media folder.

---

## 8. Remaining limitations

- **Four of the five requested catalogue providers have no importer.** Tubi,
  The Roku Channel, Fawesome and Xumo publish nothing a third party may read;
  movy.sx could not be established as a licensed distributor at all. They are
  listed with their reasons and cannot be switched on. This is the finding the
  brief asked for, not a gap to be closed later —
  [PROVIDERS.md](PROVIDERS.md) says what would have to change for each.
- **No metadata provider for local files.** Titles, years, seasons and
  episodes of files on your own disk come from the filenames and the folders
  above them; codecs and resolution from ffprobe. Descriptions, genres and
  real posters are only there if a file or folder carries them (`poster.jpg`,
  `folder.jpg`, `cover.jpg`) — or if a catalogue provider supplies them for
  the same title. The columns a provider would fill exist and are optional, so
  adding TMDB later is a service, not a migration.
- **Deduplication is cautious on purpose.** Two films with the same name a
  year apart and nothing else in common are left as two cards and queued for
  review rather than merged. That is the intended trade: a visible duplicate
  gets fixed, a bad merge hides a film.
- **Without ffprobe, technical details are blank.** Duration, codecs and
  resolution come from ffprobe; channel health falls back to byte inspection,
  which is genuinely stronger than an HTTP 200 but weaker than a real decode.
- **A missing file is still listed for seven days** in the admin figures,
  though not offered to a client. That is the grace period doing its job, not
  a stale row.
- **Posters are local only.** A film with no artwork beside it gets Telly's own
  generated artwork, never a black box with initials in it.
- **Users, devices and the audit log are still the terminal tool.** Media
  folders, scanning and IPTV sources are in Settings; the rest is
  `bin/telly-admin.js`.
- **The scan is single-threaded** — one folder, then the next. It yields often
  enough that the server keeps answering, but a library of tens of thousands of
  files takes minutes rather than seconds.
- **Recordings are read, not made.** Telly catalogues and plays what is in a
  Recordings folder; it does not schedule or capture anything.
