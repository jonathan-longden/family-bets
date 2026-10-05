# Telly

A single-file IPTV player with a cinematic, remote-friendly interface.
Open `index.html` — there is no build step, no bundler and no framework;
the whole app is one HTML file plus hls.js from a CDN.

## The interface

**Home** opens on a banner — one title, shown large over artwork that fills
the width — then a row of five landscape category cards (Live TV, Movies,
Series, Sport, News), each carrying its own artwork and counting what is
really loaded, and then rails of thumbnails: Popular Now, films, series,
channels.

**Live TV** is the working screen: categories down the left, the channel
list in the centre, and a preview player with channel details on the right.
It is the same three columns on every screen; only the scale changes.

**The player never moves between elements.** One video element lives in a
floating layer that measures the slot it should occupy and glides there —
the preview panel on Live TV, full screen, or a mini window in the corner
when you wander off. Home has no slot, so a channel playing follows you
there as that mini window. Playback is never interrupted by navigating.

**Add playlist** is a screen, not a modal: three large source cards with
descriptions, then a spacious form.

## The shape of it

Telly is three things that fit together, and each works without the others:

    telly/index.html   the web player — open it, add a playlist, watch
    telly/android/     the native app — the same, without a browser's limits
    telly/server/      an optional backend — accounts, entitlements, devices

The server is what turns a player into a household system: one place holding
the playlists and the provider's credentials, users who each see what they are
entitled to, a device limit per account, and favourites that follow a person
from the living room to the bedroom. It runs on a PC and moves to a VPS
without the apps being rebuilt — they only ever know an API endpoint.

None of it is required. The web app and the native app still take an M3U link,
a file or Xtream details directly, exactly as they did before the server
existed.

## Loading channels

- **M3U URL** — a link to an `.m3u` / `.m3u8` playlist.
- **File** — a `.m3u` from the device. It never leaves the device.
- **Xtream** — server URL, username and password. Telly calls
  `player_api.php` for the live categories and channels, for the film
  library and for the series library, and builds the stream URLs itself.
- **Telly account** — sign in to the server in `telly/server`. The playlist
  lives there, not here.
- **Free channels** — a catalogue of public playlists, one tap each.

The three network options need the server to allow cross-origin requests,
since the browser fetches the playlist directly. If a server refuses, save
the playlist and use the File option, which always works.

## One playlist, every device

The first three options put the playlist in this browser, and that is where
it stays. `localStorage` is per device and per origin: **a playlist added on
a PC is not on the phone**, and a favourite starred on the phone is not on
the TV. That is what local storage is, rather than a fault in it — there is
no way for one browser to read another's.

The playlist that follows you is the fourth option. The Telly server in
`telly/server` owns the accounts, the sources and the provider's
credentials; the app signs in and is told what it may watch. Sign in on the
PC and on the phone and both show the same line-up, the same categories and
the same favourites, because neither of them is the thing that remembers.

Signed in, the account also brings everything else the server holds: the
films, box sets and recordings in the media folders on that PC, and the
programme guide. Those are the server's own — one household, one shelf — so
they appear beside the channels on every device signed in to it:

    Live TV        the playlists, with what is on now where the guide knows
    Movies         the on-demand library, and the films on the PC's disk
    Series         box sets, with their seasons and episodes
    Recordings     what the PC recorded, under the channel it came from
    TV Guide       now and next, from XMLTV, and how much of the line-up matched
    Search         all of it at once

A film on the PC plays on the phone without the phone ever learning a path:
it holds an id, asks for a ticket, and the server reads the disk.

    PC browser  ─┐
    Phone       ─┼─ HTTPS ─> telly/server ──> SQLite + your IPTV sources
    Android app ─┘

What is kept in the browser is a pair of session tokens the server can
revoke, and nothing else:

- **The password is sent once and never stored.** Signing in exchanges it
  for tokens; the field is cleared the moment it succeeds.
- **The provider's own credentials never reach the browser.** Channels
  arrive as ids. Playing one asks the server for a signed ticket, good for
  five minutes, for one user, one device and one channel — so the upstream
  address is never in a page, a URL bar or `localStorage`.
- **Favourites are the account's.** Starring on one device writes it
  through; the others have it next time they load.
- **Devices are named and countable.** The account has a device limit, and
  whoever runs the server can remove one.

Settings says which account is signed in, on which server, which playlists
it carries, and offers the way out. Signing out drops the tokens and the
line-up with them.

The server classifies its rows by group title, which is the publisher's
label rather than a fact about the stream — the same guess this app stopped
making. They are live streams either way, so they all arrive as channels,
and the section tests that sort Film, Series, Sport and News out of a plain
M3U sort these out too. The Movies and Series *libraries* stay empty for a
server source, because its API carries no episode structure to fill them
with.

## What runs where

    Windows PC  ──┐
    Android     ──┼── HTTPS ──> Telly server on the PC ──> SQLite
    iPhone/iPad ──┘                      │                 (the catalogue)
                                         ├──> IPTV playlists (M3U / Xtream)
                                         ├──> XMLTV guides
                                         └──> C:\Media\... read in place

The PC is the server. The clients are told an address — `http://192.168.1.50:8080`
or whatever yours is — and ask it for everything. There is no cloud account
and nothing to sign up for: this is a house on its own network.

The web app runs on all three. On Android there is also a native app in
`telly/android`, which plays containers a browser cannot.

If the server is not there, the app says so and keeps what it had: the three
local options (an M3U address, a file, Xtream) do not involve a server at all.

## Landscape only

Telly is a television, so there is one layout and it is landscape. The
interface is laid out once, in logical pixels, on a canvas 1080 rows tall and
between 1440 and 2560 columns wide — the width follows the viewport's own
aspect ratio, so a 16:9 panel fills edge to edge and a wider one does too.
That canvas is then scaled to whatever viewport it finds itself in.

This is what makes 1280×720, 1366×768, 1920×1080 and 3840×2160 the same
picture at four sizes rather than four layouts. The rail is the same share of
the screen on all of them, the banner is the same height relative to it, the
cards are the same size relative to it. A 4K panel gets the composition drawn
twice as large, not twice as much of it.

**There is no portrait layout.** Held upright, a phone gets the television,
scaled down and letterboxed above and below. Nothing stacks, nothing becomes
a narrow column, nothing is squeezed, and nothing asks for the device to be
turned. The composition is the one on the television, because that is the
only composition there is.

Landscape is still asked for at every level the platform actually allows:

- The **manifest** declares `"display": "fullscreen"` and
  `"orientation": "landscape"`. Installed to a home screen, the platform
  honours that and none of the code below runs.
- In a browser tab, the **first tap** requests fullscreen and then an
  orientation lock. Neither can happen on load — both need a user gesture,
  and a page that tried would simply be refused.
- **Settings** reports what the browser is really doing: installed, full
  screen or a tab; landscape or portrait; and whether orientation locking
  exists here at all. With a button to toggle it.

Where the browser refuses, nothing is blocked and **there is no "rotate your
device" screen**. A browser cannot physically turn a handset, and refusing to
render until someone does it by hand is not a design. The canvas handles it
instead.

## The home screen

A side rail down the left carries the wordmark, then Home, Live TV, Movies,
Series, Sport, News and Settings, with Favourites, TV Guide and Add playlist
below a divider. It takes a fixed slice of the canvas, around an eighth; the
content keeps the rest, and the top bar starts where the rail ends.

**The banner** is the top of the panel rather than a card sitting on it: it
runs from the rail to the right edge and up under the top bar, which stands
down on home so it is not a second horizon across the picture. One title at a
time, set large over artwork that fills the frame, with a gradient across from
the left, another up from the bottom and a vignette around it, so the words
hold over any picture.

It is a carousel of up to six: favourites first, then films, then series, then
channels. A dot under the buttons for each, the current one lit, and pressing
a dot moves to that title. It advances on its own every nine seconds — but
never under someone's hands: it stops while the banner holds focus, and for
twenty seconds after a dot is pressed. Each slide turns its scene a little in
hue, so moving through the carousel is not one picture shown six times.

What the banner shows is honest about what is loaded, and with nothing loaded
it says how to load something rather than showing an empty frame. The line
under the title is what the source actually knows: a plot where Xtream sends
one, otherwise the year, the kind, the category and where it came from. Where
a title has a small logo rather than a landscape picture, the logo is shown as
a mark above the title — where a logo belongs — and the category scene carries
the frame.

With nothing loaded there is nothing to put in any of the rows, and a screen
of tiles over an acre of black is not a home screen — so the catalogue Telly
already carries becomes the first two rows, **Start Here — Free Channels**
and **Free Films — Public Domain**. Pressing one loads it, which is the only
thing there is to do on an empty home anyway.

**Five category tiles** follow, in one row: Live TV, Movies, Series, Sport,
News. Each is a wide 16:9 tile — the category's own artwork, its colour washed
in from the left so the picture still shows on the right, a large icon, the
title and a count of what is really loaded. Focus lifts a tile and rings it in
the accent colour.

**Then the rows**, each a carousel that reaches the edge of the panel and
carries on past it, each with a heading and a way through to the whole of it,
and each hidden when the source has nothing for it:

    Popular Now        favourites, then films, then series, then channels
    Films / Series     the on-demand libraries, as posters
    Film Channels      channels that carry films, when a library is loaded too
    Series Channels    the same for box sets
    Live Sports        the sport section
    News               the news section
    Recently Added     the newest entries in the playlist
    Favourites         the channels somebody chose
    All Channels       favourites first, then the rest

Recently Added is a fact about the playlist, not about anything that has been
watched. **Telly keeps no history**: no last channel, nothing recently played.

Every card is a picture with a caption under it and a badge in the corner
saying what it is — TV, LIVE, FILM or SERIES. Focus grows a card and rings it
in gold.

## Thumbnails: the artwork is the card

The picture is the largest part of every card, with the caption underneath —
a 16:9 frame for anything that comes off a channel, a poster for anything out
of a library.

Where the source gives a picture, that is what you see. Both formats carry
exactly one image field and Telly uses it: `tvg-logo` in an M3U, and
`stream_icon` / `movie_image` / `cover` from Xtream. `tvg-name` and
`group-title` are text, not artwork, and are already spent on the name and
the category; there is nothing else in either format that is an image.

A poster or a still is meant to be cropped, so it fills the frame. A station
logo is not — it would be cut in half — so it is shown whole over a blurred
copy of itself, which fills the frame instead.

Where the source gives nothing, or the address fails to load, the artwork is
**generated**: the scene that belongs to that item's category — scaled,
shifted, sometimes mirrored and turned in hue by an amount taken from the
title — washed in a matching hue, with the category mark over it. The same
hash every time, so a card looks the same whenever you come back to it, and no
two neighbours look alike. No card is ever a black box with two letters in it,
which is what this replaced.

## Backdrops

Six scenes, drawn rather than downloaded — a ridge line at dusk, a signal
going out over a horizon, a projector beam opening across a dark room, lit
windows after dark, floodlight pools over a pitch, and a wireframe globe. All
of it is gradients and paths in Telly's own palette: original work, no
photograph, no third party's artwork, nothing fetched over the network. The
whole set costs a few kilobytes and stays sharp on a 4K panel.

Each one belongs to a section, and the scene cross-fades as you move between
them — the ridge on Home, the signal on Live TV and the guide, the projector
on Movies and Series, the floodlights on Sport, the globe on News. Anything
without a scene of its own keeps the ridge rather than flicking to blank.

They are drawn once as symbols and used behind every screen, faint enough
to read over. A picture playing wins — the backdrop drops back to a twelfth,
so it never competes with what you are watching.

Older Smart TV browsers have no `aspect-ratio`. Without a fallback the
thumbnails collapse to nothing and a full library looks like an empty one, so
there is one.

## Channels, films and series are three different things

A channel showing a film is not a film. FilmRise Movies plays whatever it is
playing and you cannot choose; a film library is a list of titles you pick
from. Telly keeps them apart, and it does not decide by reading group titles —
a group called "VOD Movies (EN)" is full of channels, and calling them films
is what filled the Movies tab with television. It decides by what the address
is:

| Address | Treated as |
|---|---|
| `.m3u8`, `.ts`, anything streamed | a **channel** → Live TV |
| `/movie/…` (the Xtream convention) | a **film** → Movies |
| `/series/…`, or a file whose name carries `S01E02`, `1x02` or `Season 1 Episode 2` | an **episode** → Series |
| any other video file (`.mp4`, `.mkv`, …) | a **film**, unless its name says episode |
| `/download/{item}/format=…` — the Internet Archive asks for a format rather than naming a file | a **film** |
| an image (`.jpg`, `.png`, `format=Thumbnail`) | **nothing** — skipped, not listed |

That last row is not hypothetical: a handful of entries in the Archive film
lists point at a thumbnail instead of a film, and a poster masquerading as a
film is worse than a missing row.

So:

- **Live TV** holds every channel, and four headings Telly works out rather
  than reads sit pinned above the rest and in the sidebar: **Film channels**,
  **Series channels**, **Sport** and **News**. Channels still appear under
  their own group titles further down, exactly as a favourite does, and one
  channel can be in two of these — Sky Sports News is both.

  Film and series are read from the group title. Sport and news are read from
  the group title *and* the channel name, because a provider that files Sky
  Sports under "UK | ENTERTAINMENT" has still named it, and a section that
  misses it is worse than no section.

  Sport and News are not screens of their own: pressing either opens Live TV
  already filtered.
- **Movies** holds films you choose and play, with a year where the source
  gives one or the title carries one.
- **Series** holds shows. Opening one lists its seasons and episodes; Xtream
  episodes are fetched when the series is opened, not all up front.

Both are shown as a poster wall: 2:3 artwork that fills its tile, the title
on a scrim over the bottom of it, a badge with the year or the episode count,
and a play icon that appears on the one you are pointing at or have focused.
Channels keep rectangular tiles, because a channel logo does not survive
being cropped to a poster shape.

Opening a film or a series goes to one screen either way — artwork, the facts
as chips, a synopsis where the source sends one — and then a Play button for a
film or the seasons for a series. A film whose container a browser cannot open
says so on that screen before you press anything.

A film library comes from an Xtream account, from a provider M3U that carries
one, or from the **Films on demand** rows in the catalogue: 9,322 public-domain
feature films held by the Internet Archive, indexed as M3U by
[streamfeeds](https://streamfeeds.github.io/web/) and split by language.
Those are films, so they fill the Movies tab and leave Live TV empty.

With a channel list loaded, the Movies and Series tabs show that source's
film and box-set channels instead, under one line saying what they are and a
way through to Live TV. They are counted as channels and drawn as logo tiles,
and pressing one plays it — they are not titles and are not pretended to be.
A tab that explains why it is empty, on a source holding 178 film channels, is
a worse answer than showing the 178.

Only when a source has neither a library nor any channel that looks like one
does the tab say there is nothing.

On-demand titles play from the start and seek, so they are never labelled
"Live". A container a browser will not open — `.mkv`, `.avi` and the rest —
is refused straight away with the container named, rather than after a
twenty-second wait.

## Free channels

Telly ships a catalogue of 187 public playlists so it is useful with no
subscription at all: worldwide indexes, countries, genres, the free
ad-supported services, and Free-TV's own splits. Filter by name or country
and tap one; it loads exactly like a URL you typed yourself, and the URL is
on every row.

Telly hosts none of these. They are maintained by other people, and each
one can change, go quiet, or refuse browser requests at any time — the
error says which. The lists come from:

- [iptv-org/iptv](https://github.com/iptv-org/iptv) — a large index of
  publicly available streams, published as country, category and language
  playlists. 38 countries and 16 genres are listed, plus the four
  worldwide indexes.
- [Free-TV/IPTV](https://github.com/Free-TV/IPTV) — a smaller, hand-checked
  selection. The combined list is there, and so is every split the project
  publishes under `playlists/`: 87 countries and 8 topical lists (film
  channels, Italian film and box sets, news in English, Arabic and Spanish,
  documentaries in English and Arabic, and music).
- [i.mjh.nz](https://i.mjh.nz) — line-ups for the free ad-supported
  services (Pluto TV, Samsung TV Plus, Plex, Roku, Stirr).
- [streamfeeds](https://streamfeeds.github.io/web/) — public-domain feature
  films held by [the Internet Archive](https://archive.org/), indexed as M3U
  and split by language: 4,971 English, 1,393 German, 1,376 Spanish, 905
  Turkish, 281 Japanese, 266 French, 128 Italian. All seven were fetched and
  counted before being added, and every address in them is `https`.

  The same project indexes the public broadcasters' libraries, and their
  **films** are here too: ARD (945 German, 738 international), 3sat (996 and
  413), ZDF (323 and 167), ARTE (186 German, 145 French) and SRF (77) —
  3,990 films, each list fetched and counted. These are licence-fee
  television, free to watch and **mostly geo-restricted to the country that
  paid for it**, so outside Germany, Austria, Switzerland or France a good
  share will refuse. Every row says so.

  Their **television** is not here, and that is deliberate. Those lists hold
  281,000 individual programmes with no episode structure at all — not one
  entry in a sample of 1,231 carried a season or episode marker — so they are
  neither films nor series as Telly understands them, and adding them would
  put a quarter of a million one-off programmes in the Movies tab. They need
  a home of their own first.
- [BuddyChewChew/app-m3u-generator](https://github.com/BuddyChewChew/app-m3u-generator)
  — the same services split by country, which the global lists are not: 12
  line-ups covering the UK, the US, Canada, Australia and New Zealand,
  regenerated daily from i.mjh.nz. Every one of the twelve was fetched and
  parsed before being added, and every stream address in them is `https`.

That repository reports Stirr as discontinued. Telly still lists the Stirr
row, because it could not be checked from here — if it is dead, it will say
so when you tap it.

Nine of those rows carry a warning, because most of their streams are
plain `http://` and this page is served over `https://`: the browser will
refuse them before it asks for anything. Film channels is the worst of
them — 24 of its 26 channels. They all play in the Android app, which has
the same catalogue and none of the browser's rules. The count shown after
a playlist loads is the live one, measured on what actually arrived.

These index free-to-air and free ad-supported channels. Telly will play any
playlist you point it at, but nothing that requires somebody else's paid
subscription is bundled with it.

Real playlists are untidy, and Telly is built for that: entries whose
address is a placeholder rather than a URL are skipped, and a channel
carrying an `rtmp://` or `rtsp://` address — which no browser can play —
says so at once instead of timing out.

## Why a channel will not play

A browser is a fussier IPTV client than VLC, and three of its rules stop
streams that are perfectly fine elsewhere. Telly names which one it hit
rather than guessing:

- **Insecure content.** Hosted on `https://` (GitHub Pages, for instance),
  the browser refuses to load an `http://` stream at all — the request is
  never made. Most IPTV providers hand out `http://` URLs. Telly counts
  these when a playlist loads and says so on each one; Settings shows how
  many of your channels are affected. Opening Telly over `http://` avoids it.
- **CORS.** For `.m3u8` playback hls.js fetches the playlist and segments
  with JavaScript, so the stream's server must send
  `Access-Control-Allow-Origin`. Most IPTV servers do not, which is exactly
  why a channel plays in VLC and not in a web page. Safari and iOS use the
  browser's own HLS support and are not bound by this.
- **Raw MPEG-TS.** A bare `.ts` address is a continuous transport stream and
  no browser can decode it. The same channel offered as `.m3u8` will play.

None of these are things a web page can work around, so if a provider's
line-up is `http://` or `.ts` only, a native player is the right tool for
it — that is a property of the provider, not of Telly.

## Remote and keyboard

Arrow keys move focus by geometry, so it behaves on a TV remote as well as
a keyboard. Enter activates, Escape/Backspace goes back (including the
Tizen and webOS back keys), `f` toggles full screen and space plays or
pauses. In the channel list the arrows walk the list by row, scrolling and
keeping focus even though only the visible rows exist in the DOM.

## What it does

- Reads `#EXTINF` properly: `tvg-id`, `tvg-logo`, `group-title` and the
  channel name, including names and attribute values containing commas.
  `#EXTGRP` and `#EXTVLCOPT` are handled, and `url-tvg` is noted.
- Collapsible categories, favourites pinned to the top, search by name.
- Favourites, the playlist you loaded, which categories you collapsed and
  your display settings are kept in `localStorage`, so it opens with your
  playlist already there. **Nothing about what you have watched is kept** —
  no history, and not the last channel either.
- Plays `.m3u8` with hls.js, falling back to the browser's own HLS support
  on Safari and iOS.
- Says what went wrong instead of hanging: offline, refused (401/403),
  missing (404), a stream that ends, or twenty seconds of silence each get
  a plain message and a Try again button in the page itself.
- Lists of several thousand channels stay smooth — only the visible rows
  exist in the DOM.
- Missing or broken artwork falls back to a generated category scene, not
  to initials in an empty box.

## What it does not pretend to do

There is no programme guide. A playlist may name an EPG source, but Telly
does not download guide data, so the TV Guide screen shows the line-up and
says plainly that no guide is loaded rather than inventing programmes.
Catch Up needs a provider that offers archived streams, and recording
happens on a provider's server, not in a browser — both screens explain
that instead of showing empty shelves. Movies and Series are drawn from the
playlist's own group titles; if a playlist has none, they say so.

Neither M3U nor Xtream carries artwork beyond the one image field per entry,
so Telly does not go looking for posters elsewhere — no third-party metadata
service is called, and nothing about your playlist leaves the device. Where a
title has no picture, the generated scene is what you get.

## Notes

Xtream credentials are stored in the browser in plain text so the app can
reconnect, and the password forms part of every stream URL — that is how
Xtream Codes works. Use it on a private device, or sign in to a Telly
account instead, where the credentials stay on the server and the browser
only ever holds a revocable token.

The app plays whatever you point it at; it doesn't come with any channels.
