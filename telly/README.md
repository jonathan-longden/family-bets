# Telly

A single-file IPTV player for a phone. Open `index.html` — there is no
build step, no bundler and no framework; the whole app is one HTML file
plus hls.js from a CDN.

## Loading channels

Three ways, from the **Playlist** button:

- **M3U URL** — paste a link to an `.m3u` / `.m3u8` playlist.
- **File** — pick a `.m3u` file off the device. It never leaves the phone.
- **Xtream** — server URL, username and password. The app calls
  `player_api.php` for the live categories and channels and builds the
  stream URLs itself.

Both network options need the server to allow cross-origin requests, since
the browser fetches the playlist directly. If a server refuses, save the
playlist and use the File tab, which always works.

## What it does

- Reads `#EXTINF` properly: `tvg-id`, `tvg-logo`, `group-title` and the
  channel name, including names and attribute values containing commas.
  `#EXTGRP` and `#EXTVLCOPT` lines are handled too.
- Groups channels into collapsible categories, with favourites pinned to
  the top as their own group.
- Search filters by channel name as you type.
- Favourites, the last playlist and the last channel watched are kept in
  `localStorage`, so it opens where you left off.
- Plays `.m3u8` with hls.js, and falls back to the browser's own HLS
  support on Safari and iOS.
- Says what went wrong instead of hanging: a stream that is offline,
  refused (401/403), missing (404) or simply silent for 20 seconds gets a
  message and a Try again button.
- Lists of several thousand channels stay smooth — only the visible rows
  exist in the DOM.
- Missing or broken logos fall back to the channel's initials.

## Notes

Xtream credentials are stored in the browser in plain text so the app can
reconnect, and the password forms part of every stream URL — that is how
Xtream Codes works. Use it on a private device.

The app plays whatever you point it at; it doesn't come with any channels.
