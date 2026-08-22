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
- **Two decks.** A pair of turntables: the record that's playing spins on
  the live deck with its tonearm tracking in towards the spindle as the
  track goes on, and the next one sits cued on the other. A mixer between
  them carries the crossfader — which slides across as the music hands
  over — and a level meter per deck reading the real signal.
- **Scratching.** Put a finger on the record that's playing and it stops
  running on its own: the platter follows you and drags the sound with it.
  Let go and it spins back up to speed.
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
- **Turns with the phone.** Sideways it becomes the deck view: two large
  turntables with a mixer between them — a level fader and meter per deck
  over the crossfader — and nothing else on screen. The queue, library and
  everything else are a portrait job.
- **Lock screen controls.** Play, pause and skip from the lock screen or
  headphones, with artwork.
- **Sleep timer.** 15 minutes to 2 hours, or just to the end of this track.
- **Picks up where you left off.** Close it mid-track and it comes back on
  the same track at the same second, paused and waiting for you.
- **Search.** Filter your library by title or artist once there's more than
  a couple of tracks in it.
- **Radio.** A section of its own for live stations: search an open station
  directory, save the ones you like, or add a stream link by hand. Needs a
  connection, unlike everything else here.
- **Podcasts.** Search for a show, subscribe, and pick an episode. Episodes
  can be seeked, skip in 30-second jumps, and remember where you got to.
- **YouTube.** One button that opens YouTube in the app you already use for
  it, where your account and background playback come along.
- **Backup.** Save everything that isn't the music itself — playlists,
  saved stations, subscriptions, loudness readings — to a small file you
  keep, and restore it later or on another device.
- **Voice.** Tap the microphone and say what you want — *play Capital FM*,
  *play my Night Shift playlist*, *next*. With one shortcut set up on your
  phone, *"Hey Siri, Tunage"* works from the lock screen.

## Getting music in

Open the app and use **Add music**:

- **Choose files** — pick one or many audio files. On a phone this is the
  one that matters: open the picker, use its **Select all**, and a whole
  folder goes in at once.
- **Choose a folder** — a computer only; `webkitdirectory` isn't something
  phone browsers do, so the button isn't shown there.
- **Drag and drop** — files or whole folders, on a computer.
- **From a link** — paste a direct link to an audio file you're allowed to
  download. It's fetched once and saved on the device, so it plays offline
  from then on.

**Tunage can't go looking for your music by itself.** No browser lets a page
read a device's storage — it only ever sees files you hand it. That's the
same rule that makes a web app safe to point at a music library, and there's
no permission that turns it off. Picking the files is the way in, and it's
a one-time job: they're copied into the app and stay there.

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

## Scratching

Hold the record on the live deck — mouse or finger — and the platter comes
under your hand. Push it forward and the audio speeds up or slows down with
the pitch bending like a real record, because pitch correction is switched
off while you have hold of it. Drag it backwards and the sound follows you
back; no browser will play audio in reverse, so it's seeked back instead,
which gives roughly the stutter you'd expect. Let go and the platter spins
back up to speed over a fifth of a second.

One revolution is worth 1.8 seconds of audio, the same as a record at
33⅓ rpm, so the movement feels the size it should. Nothing advances while
you're holding a record, even if you drag past the end of the track. The
cued deck can't be scratched — there's nothing loaded on it to scratch.

## Radio

The **Radio** chip, next to Everything and your playlists, is a separate
section for live stations. Search by name, tap a genre, or add a station by
its stream link. Save the ones you keep coming back to and they sit under
**Your stations**.

Stations come from [Radio Browser](https://www.radio-browser.info/), an open
community-run directory — no account, no key, and nothing scraped from
anyone's app.

Two things behave differently here, both unavoidable:

- **Radio needs a connection.** It's a live stream, so this is the one part
  of Tunage that doesn't work offline. Your own music is unaffected.
- **Stations that only stream over plain `http` can't be played at all.**
  Tunage is served over `https`, and browsers refuse to load insecure audio
  into a secure page. Those stations are filtered out of results, with a
  note saying how many were skipped, rather than being offered and failing.

A station plays on its own, away from the decks: there is no scratching or
crossfading a live stream, and starting a record takes the station off air.
The technical reason is that a cross-origin stream routed through the Web
Audio graph comes out silent unless the station sends CORS headers, and
most don't — so stations bypass that graph entirely.

## Podcasts

The **Podcasts** chip opens a section for shows. Search by name, subscribe
to the ones you follow, and tap a show to see its episodes. Shows are found
through the iTunes Search directory, which is open and needs no key, and
the episode list is read straight from the show's own feed.

An episode isn't a live stream, so it behaves like one: the seek bar works,
the skip buttons jump back 15 seconds and forward 30, and where you got to
is remembered — come back later and it picks up from there.

**Some feeds can't be read.** A podcast's feed has to allow other sites to
fetch it, and plenty don't. Without a server of our own there's no way
round that, so those shows say so plainly instead of failing quietly. The
episode audio itself almost always plays — it's reading the list of
episodes that can be refused. If a show you follow won't load, its feed
address can still be added by hand under **Add a show by its feed
address**, though the same restriction applies.

## Voice

There's a microphone button in the top bar, next to the sleep timer. Tap it, say what you want, and
Tunage does it. There's also a text box in the **Voice** panel that takes
the same phrases, which is handy for trying one out.

**It listens as soon as it opens.** Open Tunage and just say *"play Capital
FM"* — no tapping. **Listen when it opens** in the Voice panel turns that
off if you'd rather press the button.

The first time, the browser asks to use the microphone — allow it and every
open after that listens on its own. If it's ever refused, the line under the
play button says so rather than the microphone just quietly not opening.

It stays quiet in the cases where listening would be wrong: when a link
already said what to play, and when music is already going — a microphone
opened over your own music only hears your own music.

### What it understands

| Say | What happens |
| --- | --- |
| *play Honky Tonk Highway* | plays that track |
| *play Toots* | plays something by that artist |
| *play my Night Shift playlist* | switches to that playlist and starts it |
| *play everything* | back to the whole library |
| *play Capital FM* | finds and plays that station |
| *play Kiss FM on the radio* | forces a station, even if you own a track by that name |
| *play the podcast Desert Island Discs* | latest episode of a show you follow |
| *next* · *back* · *pause* · *resume* | the transport buttons |
| *shuffle on* · *shuffle off* | shuffle |
| *sleep for 30 minutes* | sets the sleep timer |

Say "Tunage" at the front if you like — *"Tunage, play Capital FM"* — it's
stripped off either way.

When you don't say which kind of thing you mean, **your own music comes
first**: a track, then a playlist, then a station you saved, then a show you
follow, and only then the station directory. So if you own a track called
*Honky Tonk Highway*, that's what plays — add *on the radio* to mean the
station instead.

### Saying it without opening the app first

Here is the honest limit: **Tunage cannot listen for its own name in the
background.** No web app can — browsers give no website the microphone
while it isn't open, and neither Android nor iOS will register a wake word
for one. That needs a native app.

What it can do is **open already listening**, so you speak once it's up
rather than before.

#### Android

Install Tunage first — Chrome menu → **Install app**. It becomes a real
app on the phone, which is what makes the rest work.

- **Long-press the icon → Listen.** It opens with the microphone running;
  say *"play Capital FM"*. Drag that entry onto the home screen and it's a
  one-tap button. This needs no setup beyond installing.
- **Hands-free:** in the Google Home app, make a routine with the starter
  phrase **Tunage** and an action that opens
  `https://<your-pages-site>/radio/?listen=1`. Then *"Hey Google, Tunage"*
  opens it listening. Google moves this UI around and not every version
  will take a plain link as an action — where yours won't, *"Hey Google,
  open Tunage"* still launches the installed app and you tap the mic.

Android's assistant can't dictate text *into* a link mid-routine, which is
why the flow is open-then-speak rather than one sentence.

#### iPhone

Shortcuts can dictate, so iOS gets it in one go: Shortcuts app → new
shortcut → **Dictate Text**, then **Open URLs** with
`https://<your-pages-site>/radio/?say=` and the dictated text joined on the
end. Name it **Tunage**. Then *"Hey Siri, Tunage"* → it asks what to play →
*"Capital FM"* → the app opens straight onto it.

#### The links themselves

| Link | What it does |
| --- | --- |
| `?listen=1` | opens with the microphone running |
| `?say=play Capital FM` | runs that phrase on load |
| `?open=radio` | jumps to a section, plays nothing |

Any of them works anywhere a link does — a bookmark, an NFC tag by the
front door, a home-screen button. The parameter is cleared from the address
bar once it has run, so a reload doesn't fire it twice.

### Two caveats

- **Speech recognition needs a connection.** Both Chrome's and Safari's send
  the audio away to be transcribed, so this is the second part of Tunage
  (with radio) that doesn't work in flight mode. Everything about playing
  your own music still does.
- **Firefox has no speech recognition at all**, so the microphone button
  hides itself there and says why. Typing a command still works, and so does
  a shortcut on your phone.

One more thing worth knowing: a browser won't always let a page opened by a
shortcut start playing without you touching it. When that happens Tunage
loads with the track or station ready and says *tap play* rather than
pretending it worked.

## YouTube

The **YouTube** chip holds one button: **Open YouTube app**. It hands YouTube
to whatever app your phone uses for it, and gets out of the way.

That's deliberate. An embedded player inside a web page stops the moment you
leave the page, carries none of your account, and can't play with the screen
off — so an in-app YouTube was always going to be the worse version of the
app already on your phone. Handing it over is the honest answer.

On Android the button uses an `intent://` address, which is what makes the
phone offer its **Open with** list rather than going straight to a default.
If your phone asks which app to use, pick the one you want and tick
**Always** to stop it asking. To change it later:
**Settings → Apps → Default apps → Opening links**.

Everywhere else it's an ordinary link to youtube.com, which goes wherever
that platform sends YouTube links.

## Backup

Everything you've built up in Tunage — your playlists, the stations you
saved, the shows you subscribed to, how far into each episode you got —
lives in this browser and nowhere else. There's no account and no server,
which is the point, but it also means clearing site data takes the lot.
**Backup**, near the bottom of the page, is the insurance.

**Save a backup file** writes a small `.json` file to your downloads,
named for the day. **Restore from a file** reads one back in.

The backup deliberately does *not* contain your audio — that would be
hundreds of megabytes, and you already have the originals. It's a list of
what you'd otherwise have to rebuild by hand, usually a few kilobytes.

Because it holds no audio, restoring works in two steps: add your music
back first (**Add music**, same as ever), then restore the backup. Playlist
entries are stored by filename and size rather than by internal id, so
they re-attach to the files themselves — which is what makes a backup
survive a wipe, or move to a different phone, at all. If some files aren't
there yet, the rest is restored and Tunage tells you how many entries it
couldn't place; add those files and restore the same file again to pick
them up.

Restoring merges rather than overwrites. Playlists with the same name are
combined instead of duplicated, stations and shows you already have are
left alone, and episode positions keep whichever is further along. So
restoring the same file twice does nothing the second time, and a backup
from an old phone can be folded into a device already in use.

Loudness readings ride along too, so a restored library doesn't have to
re-measure everything it already knew.

## Nothing deletes your music but you

Updating the app never touches what you've stored. The files, playlists,
stations and subscriptions live in the browser's own storage, and deploying
a new version replaces the app's code beside them — it can't reach them.

The app itself only deletes on the button you press. A track whose audio
won't load is **skipped and kept**, marked *audio wouldn't load* in the
list, and put back in the rotation the moment it reads again. That's
deliberate: a failed read can mean the file has gone, or it can mean the
database was busy for a second, and the two are indistinguishable from
inside. Guessing "gone" and deleting is the guess that loses music you own,
so it isn't made.

If several tracks in a row fail to load, Tunage stops rather than working
through the library, and says so.

**An unreadable store is not an empty one.** If the database won't open at
all, the app says exactly that instead of showing an empty library — because
an empty library invites you to add everything again, and if the music is
still down there you'd end up with two of everything.

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
  and your playlists. The tracks are copies — your originals are untouched,
  and a backup file brings the playlists back once you've re-added them.

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
