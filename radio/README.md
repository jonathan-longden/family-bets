# Tunage

Your own music, playing without stopping and without a signal. Everything
you add lands in one pool, and you can carve playlists out of it.

Tunage is a player, not a streaming service: it doesn't come with any
music. You load it with tracks you already own (or ones you're allowed to
download), and it keeps them rolling.

## What it does

- **Everything.** One pool holding all the music you've added. Press play
  and it runs.
- **Playlists.** Make as many as you like, add any track to any number of
  them, and tap a playlist to make it the thing that's playing. Playlists
  hold references, so removing a track from one — or deleting the playlist
  outright — never touches the music itself.
- **Never stops.** When a track ends the next one is already lined up. The
  queue refills itself forever, and shuffle plays through everything once
  before it starts repeating.
- **Two decks.** The record that's playing spins on the live deck and the
  next one sits cued on the other, with a crossfader that slides across as
  the music hands over. Each new track drops onto whichever deck is free.
- **Crossfades.** Tracks blend into each other (up to six seconds) instead
  of stopping dead. Turn it off for straight cuts. Short tracks always cut.
- **One steady volume.** Every track is measured once and played at a
  matched level, so a loud remaster and a quiet old rip sit together
  without you reaching for the volume.
- **Fully offline.** Music is copied into the browser's own storage
  (IndexedDB) and the app itself is cached by a service worker. After the
  first visit it works in flight mode, in a tunnel, on a plane.
- **Names things properly.** It reads the tags inside your files — ID3 in
  MP3s, MP4 tags in the M4A/AAC files an iTunes library is made of — and
  falls back to the filename when there aren't any.
- **Keeps a folder in sync.** On a computer, point it at your music folder
  once and it re-reads that folder every time you open it, importing
  anything new. See the limits below.
- **Turns with the phone.** Sideways, the player takes a pane on the left
  and the lists scroll beside it.
- **Lock screen controls.** Play, pause and skip from the lock screen or
  headphones, with artwork.
- **Sleep timer.** 15 minutes to 2 hours, or just to the end of this track.
- **Picks up where you left off.** Close it mid-track and it comes back on
  the same track at the same second, paused and waiting for you.
- **Search.** Filter your library by title or artist once there's more than
  a couple of tracks in it.

## Getting music in

Open the app and use **Add music**:

- **Choose files** — pick one or many audio files.
- **Choose a folder** — grab an entire music folder in one go.
- **Drag and drop** — files or whole folders, on a computer.
- **From a link** — paste a direct link to an audio file you're allowed to
  download. It's fetched once and saved on the device, so it plays offline
  from then on.

MP3, M4A, AAC, OGG, Opus, WAV and FLAC all work, as far as the browser
supports them. Files never leave the device — there's no server involved.

Tunage plays music you already have the right to play. It doesn't search
for, stream or download anything on its own.

## Playlists

Every track in **Your music** has a **+ Playlist** button. Tap it and
either pick an existing playlist or type a name to make a new one. Tapping
a playlist in that list again takes the track back out.

Playlists appear as chips along the top, next to Everything. Tap one and it
becomes what's playing — the queue draws from it and nothing else, in the
order you added things unless shuffle is on. While a playlist is playing
you get a panel for it, where you can rename it, remove tracks, or delete
the whole thing.

Deleting a playlist, or removing a track from one, leaves your music
alone: the tracks stay in your library. Deleting a track from **Your music** is
the only thing that removes the file, and that also takes it out of every
playlist it was in.

## Levelling the volume

Music collected from different places is mastered at wildly different
volumes — a modern remaster can be six times louder than an old rip of the
same song. **Level** (next to Shuffle and Crossfade) evens that out.

Each track is measured once, in the background, shortly after it's added;
until its turn comes it plays at its own volume. The measurement follows
ITU-R BS.1770, the broadcast loudness standard: K-weighting filters in
front of the meter, then gated 400 ms blocks so quiet passages don't drag
a track's reading down. The result is stored with the track, so it's only
ever done once.

Playback then applies a per-track gain aiming at -16 LUFS. Boost is capped
at +6 dB, and never enough to push a track's peaks into clipping — so a
very quiet recording is brought up as far as is safe and no further. Turn
**Level** off to hear tracks exactly as they were mastered.

One caveat: lifting a quiet track above its recorded volume needs the Web
Audio path, which is what the app normally uses. On a browser that won't
allow it, tracks can still be brought *down* to match, just not up.

## Files a browser can't play

Browsers don't all support the same formats — Safari won't decode FLAC, for
instance. When Tunage meets a file this browser can't play, it marks the
track **can't play in this browser** and skips it, rather than deleting
something you own. It stays in your library and your playlists, and the
audio stays on the device, so the same file plays normally somewhere that
does support it. Only a file whose audio has genuinely gone is removed.

### Keeping a folder in sync

**Keep a folder in sync** goes further than a one-off import: pick your
music folder once and Tunage re-reads it on every launch, importing
anything you've added since. It only opens files it hasn't seen, so a
large library doesn't get re-read from disk each time.

This needs the File System Access API, which means **Chrome or Edge on a
computer**. Safari and Firefox don't have it, and neither does any browser
on iOS or Android — the button explains itself and the ordinary "Choose a
folder" import is there instead. Chrome remembers the permission for an
installed app; otherwise it asks once per visit, and Tunage shows an
"Allow access" button rather than nagging.

Tracks are still copied into the app's own storage, so playback keeps
working when the folder isn't reachable — an unplugged external drive, or
a phone with no connection.

### What a web app can't reach

No browser can read your **Apple Music or Spotify library**, and neither
can this one. Streaming apps store their music encrypted, and their
catalogues are licensed for playback inside those apps only. The same goes
for the iOS Music library: Safari has no access to it. Tunage plays files
you can see in a file browser — purchased downloads, CD rips, Bandcamp
files, anything DRM-free.

## Keeping it on your phone

Open the app in the browser, then:

- **iPhone:** Share → **Add to Home Screen**.
- **Android:** menu → **Install app**.

It then opens like a normal app, full screen, and keeps playing when the
screen is off.

Two things worth knowing about browser storage:

- The app asks the browser to make its storage **persistent** the first
  time you add music, so it isn't cleared automatically.
- Clearing site data (or deleting the app on iOS) removes the saved music
  and your playlists. The tracks are copies — your originals are untouched.

## Running it

It's a static site: `index.html`, `styles.css`, `app.js`, `sw.js`,
`manifest.json` and two icons. No build step, no dependencies. Serve the
folder over HTTPS (or `localhost`) — a service worker won't install on
plain `http://` — for example with GitHub Pages, where it lives at
`/radio/`.

Locally:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/radio/
```

## Keyboard shortcuts

`Space` play/pause · `→` next · `←` previous (or restart) · `Esc` close a
panel.
