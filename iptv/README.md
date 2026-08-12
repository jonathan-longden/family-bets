# Tuner

A private IPTV player for the playlist you already have. Load your own M3U,
browse your channels, watch — on a phone, a tablet or a computer, with the
app installed to the home screen if you want it there.

Tuner is a **player, not a service**. It comes with no channels, no
directory and nothing to sign up to. It carries whatever your provider (or
your own server) gives you, and everything it knows stays on the device.

## The home screen

Tuner opens on a home screen rather than a wall of channels: the clock and
date, **Live TV** across the top, then TV Guide, Favourites, Recents,
Search, Playlists and Settings, with what's loaded along the bottom. The
backdrop is drawn in the app's own colours — no photograph to download.

Every tile goes somewhere real. There's no Movies, Series, Catch Up or
Recording here, because Tuner doesn't do those and a tile that opens
nothing is worse than no tile. With no playlist loaded yet, the only one
that does anything leads and the rest are greyed out.

**TV Guide** is Live TV with the guide brought forward: what's on now, what
follows it, and how far through it is on every row. It needs an XMLTV link
(see below) and says so if there isn't one.

Leave a channel playing, go home, and a pill at the bottom shows what's
still on — tap it to go back to the picture. Turn the app off on a channel
and it comes back on that channel, like a television.

## Something to watch straight away

The playlist sheet has a **Free to watch** row: UK, Ireland, USA, Canada,
Australia and New Zealand. These are channels their broadcasters publish
openly — no subscription and nothing to sign in to — catalogued by the
[iptv-org](https://github.com/iptv-org/iptv) project and fetched from there
when you tap one. Handy for trying the app out before pointing it at your
own playlist, and they sit alongside it afterwards.

They're a mixed bag by nature: some are geo-blocked, some are part-time,
and a public stream can go off air without warning. The list is refreshable
like any other, so **Refresh** picks up whatever has changed.

## Getting your playlist in

Tap the playlist button in the top bar. There are four ways in:

- **Link** — paste the M3U link your provider gave you. Tuner fetches it
  and keeps a copy on the device.
- **File** — load an `.m3u` or `.m3u8` file you've saved.
- **Paste** — paste the playlist text straight in.
- **Login** — Xtream Codes details (server, username, password). Tuner
  builds the playlist and guide links from them.

Add as many playlists as you like and switch between them; **Refresh**
re-reads one that came from a link, for when channels move around.

The parser is deliberately forgiving. `tvg-id`, `tvg-name`, `tvg-logo` and
`group-title` are read in any order, `#EXTGRP` works as an alternative to
`group-title`, player directives like `#EXTVLCOPT` and `#KODIPROP` are
skipped, and a bare list of URLs with no `#EXTINF` lines at all still
produces channels named after their addresses.

## The TV guide

If your provider publishes an XMLTV guide, Tuner shows what's on now and
next under the picture, with a progress bar, and puts the current programme
on each channel row.

Most playlists name their guide in the `#EXTM3U` header (`url-tvg`), and
Tuner picks that up by itself. Otherwise paste the link into **Settings →
TV guide**. Guides served gzipped (`.xml.gz`) are unpacked in the browser.
Channels are matched on `tvg-id`, falling back to the channel name for the
many playlists that leave `tvg-id` off. Only the day either side of now is
kept, and the guide is re-fetched every six hours.

## Watching

- **Favourites** — the star on any row, or on the now-playing bar. The
  ★ group collects them.
- **Recent** — the last thirty channels you watched, newest first.
- **Search** — matches channel names and group names.
- **Previous / next** move through the list you're looking at, so in a
  group they step through that group.
- **Picture in picture** and **fullscreen**, where the browser supports
  them, plus lock-screen controls on a phone.
- Tuner reopens on the last channel you watched. Turn either that or
  autoplay off in Settings.

Keyboard: `Space` play/pause · `↑` `↓` channel · `f` fullscreen · `m` mute
· `/` search · `Esc` close a panel.

## What a browser can and can't play

This is the honest part, and it's worth reading before blaming the app.

- **HLS (`.m3u8`) works.** Safari plays it natively; everywhere else Tuner
  loads [hls.js](https://github.com/video-dev/hls.js) the first time you
  open a channel, trying jsDelivr, then unpkg, then cdnjs — three separate
  companies, so a blocked or broken one doesn't take every HLS channel with
  it. After that the browser caches it. If all three are unreachable, the
  app says so plainly rather than blaming the channel; a content blocker,
  a work or school filter, or a VPN is the usual reason.
- **Raw MPEG-TS usually doesn't.** No browser can play a bare `.ts`
  stream. Xtream links ending in a number (`…/user/pass/12345`) are TS by
  default, so Tuner tries the same address with `.m3u8` on the end first —
  which most Xtream servers answer with an HLS version of the same
  channel. If yours doesn't, ask for HLS output; the playlist link usually
  takes `&output=hls` or `&type=m3u8`.
- **The provider has to allow it.** A web page can only read a playlist,
  guide or stream from a server that sends CORS headers permitting it.
  Plenty of providers don't, and there is nothing an app on your device can
  do about that — it's their server's decision. When a playlist link is
  refused, download the `.m3u` and add it from the **File** tab instead;
  when a stream is refused, that channel won't play in any browser.
- **DRM-protected channels won't play.** Tuner has no licence handling.

If a channel doesn't come through, Tuner says so and offers **Try again**
rather than sitting on a black screen.

## Where your details are kept

Everything is local. Playlists and channel lists go into the browser's own
IndexedDB, favourites and settings into local storage. There's no account,
no server of ours, and nothing is uploaded anywhere — the only machines
involved are yours and your provider's.

Worth knowing: an Xtream username and password entered on the **Login** tab
are stored as part of the playlist link, in the clear, the same way any
player stores them. Anyone with the unlocked device can read them. On a
shared computer, prefer the File tab. **Settings → Clear everything**
removes the lot.

## Keeping it on your phone

- **iPhone:** Share in Safari → **Add to Home Screen**.
- **Android:** browser menu → **Install app**.

It then opens full screen like any other app. The app itself is cached by a
service worker, so it opens with a weak connection — but channels are live
streams and always need one.

## Running it

A static site: `index.html`, `styles.css`, `app.js`, `sw.js`,
`manifest.json` and two icons. No build step, no dependencies bundled in.
Serve the folder over HTTPS (or `localhost`) — a service worker won't
install on plain `http://` — for example with GitHub Pages, where it lives
at `/iptv/`.

Locally:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/iptv/
```

## Using it fairly

Tuner is for playing a service you're entitled to watch — your own
subscription, your own server, or freely published streams. It doesn't
search for, index or supply any channels, and what you point it at is your
responsibility.
