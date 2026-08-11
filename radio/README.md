# Nonstop

Two stations that never stop — **Reggae** and **Country** — playing from
your own phone with no signal, no data and no account.

Nonstop is a player, not a streaming service: it doesn't come with any
music. You load it with tracks you already own (or ones you're allowed to
download), it works out which station each one belongs to, and then it
keeps them rolling.

## What it does

- **Three stations.** Reggae, Country, or Both for one long road trip.
- **Never stops.** When a track ends the next one is already lined up. The
  queue refills itself forever, and shuffle plays through the whole station
  before it starts repeating.
- **Crossfades.** Tracks blend into each other (up to six seconds) instead
  of stopping dead. Turn it off for straight cuts. Short tracks always cut.
- **Fully offline.** Music is copied into the browser's own storage
  (IndexedDB) and the app itself is cached by a service worker. After the
  first visit it works in flight mode, in a tunnel, on a plane.
- **Sorts itself out.** It reads the tags inside your files — ID3 in MP3s,
  MP4 tags in the M4A/AAC files an iTunes library is made of — and falls
  back to the filename and folder name. Anything it can't place shows up
  under "Which station?" for a one-tap decision.
- **Keeps a folder in sync.** On a computer, point it at your music folder
  once and it re-reads that folder every time you open it, importing
  anything new. See the limits below.
- **Lock screen controls.** Play, pause and skip from the lock screen or
  headphones, with artwork.
- **Sleep timer.** 15 minutes to 2 hours, or just to the end of this track.

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

### Keeping a folder in sync

**Keep a folder in sync** goes further than a one-off import: pick your
music folder once and Nonstop re-reads it on every launch, importing
anything you've added since and sorting it by genre. It only opens files it
hasn't seen, so a large library doesn't get re-read from disk each time.

This needs the File System Access API, which means **Chrome or Edge on a
computer**. Safari and Firefox don't have it, and neither does any browser
on iOS or Android — the button explains itself and the ordinary "Choose a
folder" import is there instead. Chrome remembers the permission for an
installed app; otherwise it asks once per visit, and Nonstop shows an
"Allow access" button rather than nagging.

Tracks are still copied into the app's own storage, so the stations keep
playing when the folder isn't reachable — an unplugged external drive, or
a phone with no connection.

### What a web app can't reach

No browser can read your **Apple Music or Spotify library**, and neither
can this one. Streaming apps store their music encrypted, and their
catalogues are licensed for playback inside those apps only. The same goes
for the iOS Music library: Safari has no access to it. Nonstop plays files
you can see in a file browser — purchased downloads, CD rips, Bandcamp
files, anything DRM-free.

Nonstop plays music you already have the right to play. It doesn't search
for, stream or download anything on its own.

## Which station a track lands on

In order, it looks at:

1. the **genre tag** inside the file (`Reggae`, `Bluegrass`, `Country`…),
2. the artist, album and title tags,
3. the filename and the folder it came from.

Words like _dub, roots, dancehall, riddim, ska_ send it to Reggae;
_bluegrass, honky-tonk, outlaw, americana, nashville_ send it to Country.
When there's no clue either way — or clues for both — the track waits in
the "Which station?" panel until you tap **Reggae** or **Country**. You can
move any track between stations later from **Your music**.

## Keeping it on your phone

Open the app in the browser, then:

- **iPhone:** Share → **Add to Home Screen**.
- **Android:** menu → **Install app**.

It then opens like a normal app, full screen, and keeps playing when the
screen is off.

Two things worth knowing about browser storage:

- The app asks the browser to make its storage **persistent** the first
  time you add music, so it isn't cleared automatically.
- Clearing site data (or deleting the app on iOS) removes the saved music.
  The tracks are copies — your originals are untouched.

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
