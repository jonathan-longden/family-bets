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

## Loading channels

- **M3U URL** — a link to an `.m3u` / `.m3u8` playlist.
- **File** — a `.m3u` from the device. It never leaves the device.
- **Xtream** — server URL, username and password. Telly calls
  `player_api.php` for the live categories and channels and builds the
  stream URLs itself.

Both network options need the server to allow cross-origin requests, since
the browser fetches the playlist directly. If a server refuses, save the
playlist and use the File option, which always works.

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
