# Telly

A single-file IPTV player with a cinematic, remote-friendly interface.
Open `index.html` — there is no build step, no bundler and no framework;
the whole app is one HTML file plus hls.js from a CDN.

## The interface

**Home** is a hub, not a menu. A full-bleed hero shows the channel you are
watching (or the one you left off on) over its own artwork, with the real
playback state — live, connecting, paused, offline — and one obvious action.
Below it, navigation cards of deliberately uneven weight: Live TV is the
large one and carries a rail of real channel logos from your playlist; TV
Guide, Favourites, Movies, Series, Recently watched, Catch Up, Recordings,
Settings and Add playlist fill in around it. Each card says something true
about your playlist rather than a generic label.

**Live TV** is the working screen: categories down the left, the channel
list in the centre, and a preview player with channel details on the right.
On a phone the categories become a chip rail, the player sits above the
list, and the layout stacks rather than shrinking.

**The player never moves between elements.** One video element lives in a
floating layer that measures the slot it should occupy and glides there —
hero, preview, full screen, or a mini window in the corner when you wander
off to Settings. Playback is never interrupted by navigating.

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
  `player_api.php` for the live categories and channels and builds the
  stream URLs itself.
- **Free channels** — a catalogue of public playlists, one tap each.

Both network options need the server to allow cross-origin requests, since
the browser fetches the playlist directly. If a server refuses, save the
playlist and use the File option, which always works.

## Free channels

Telly ships a catalogue of 64 public playlists so it is useful with no
subscription at all: worldwide indexes, 38 countries, 16 genres, and the
free ad-supported services. Filter by name or country and tap one; it loads
exactly like a URL you typed yourself, and the URL is on every row.

Telly hosts none of these. They are maintained by other people, and each
one can change, go quiet, or refuse browser requests at any time — the
error says which. The lists come from:

- [iptv-org/iptv](https://github.com/iptv-org/iptv) — a large index of
  publicly available streams, published as country, category and language
  playlists.
- [Free-TV/IPTV](https://github.com/Free-TV/IPTV) — a smaller, hand-checked
  selection.
- [i.mjh.nz](https://i.mjh.nz) — line-ups for the free ad-supported
  services (Pluto TV, Samsung TV Plus, Plex, Roku, Stirr).

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
- Favourites, the last playlist, the last channel and the recently watched
  list are kept in `localStorage`, so it opens where you left off.
- Plays `.m3u8` with hls.js, falling back to the browser's own HLS support
  on Safari and iOS.
- Says what went wrong instead of hanging: offline, refused (401/403),
  missing (404), a stream that ends, or twenty seconds of silence each get
  a plain message and a Try again button in the page itself.
- Lists of several thousand channels stay smooth — only the visible rows
  exist in the DOM.
- Missing or broken logos fall back to the channel's initials.

## What it does not pretend to do

There is no programme guide. A playlist may name an EPG source, but Telly
does not download guide data, so the TV Guide screen shows the line-up and
says plainly that no guide is loaded rather than inventing programmes.
Catch Up needs a provider that offers archived streams, and recording
happens on a provider's server, not in a browser — both screens explain
that instead of showing empty shelves. Movies and Series are drawn from the
playlist's own group titles; if a playlist has none, they say so.

## Notes

Xtream credentials are stored in the browser in plain text so the app can
reconnect, and the password forms part of every stream URL — that is how
Xtream Codes works. Use it on a private device.

The app plays whatever you point it at; it doesn't come with any channels.
