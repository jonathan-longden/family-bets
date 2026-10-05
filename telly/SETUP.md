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
**unavailable**, **unchecked**, when the playlist last updated and when the
channels were last checked, with three buttons: **Refresh playlist**, **Check
channels**, **Refresh + check**.

Re-importing does not duplicate anything. Identity is the stream URL within
the source, so a channel already there is updated in place — keeping its id,
and with it your favourites and its health history. A channel that has gone
from the playlist is marked inactive rather than deleted, so it comes straight
back if the publisher restores it.

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

### Filters

Above Movies and Series: provider, genre, year, rating, country, language.
`Movies → Provider → Internet Archive` narrows the list; *Inception* is still
one card.

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

A channel is only `working` if that succeeds. One failure makes it
`temporarily_unavailable` — kept, still offered, retried in half an hour, then
an hour, widening to a day. Three in a row makes it `failed` — still kept and
still visible to you, never deleted. Viewers see `working` and `unchecked`
channels; `?health=failed` is there for working out why.

    GET /api/v1/channels?health=working
    GET /api/v1/admin/health-summary

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
