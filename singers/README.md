# Spotlight — a short-video stage for singers

TikTok-shaped, but singers only: 60-second clips, a swipeable feed, and a
chart that ranks people by how much attention their singing actually gets.
Built as an installable PWA with no build step — plain HTML, CSS and JS,
exactly like the Family Bets app at the repo root.

Live at `<your-pages-url>/singers/` once the branch is on GitHub Pages, or
locally with any static server:

```sh
cd singers
python3 -m http.server 8899
# then open http://localhost:8899 — use localhost, camera access needs a secure origin
```

## What's in it

**The feed** — full-screen vertical clips with snap scrolling. Tap to
pause, double-tap to like, and a sound toggle in the corner (clips start
muted because browsers block autoplay with sound). Three tabs: *For you*
(ranked by the chart score, with a nudge for clips you haven't seen),
*Following*, and *Fresh* (newest first).

**Recording** — camera + mic preview, 3-2-1 countdown, a 60-second ring
timer, front/back flip, retake, or upload an existing video instead. Then
you add a caption, song title, an "original song" flag, a genre and tags
before posting. A poster frame is grabbed automatically for the grids.

**Discover** — search across singers, handles, songs, genres, cities and
#tags, genre filter chips, a *Rising this week* row, and a clip grid.

**The Chart** — the "get noticed" part. Clips and singers ranked by a
score of `plays + likes×5 + comments×8 + shortlists×15`, decayed 18% per
day so the chart reflects the last week rather than all time. Three
views: Clips, Singers, and New talent (accounts and clips from the last
few days).

**Profiles** — avatar, bio, city, genres, follower/like/play counts, chart
position, and a grid of clips. Long-press one of your own tiles to delete
it.

**Scout accounts are verified** — anyone can pick "Scout" at signup, but it
grants nothing on its own. See *Scout verification* below. A shortlist is
also the heaviest signal in the chart score, so scouts moving on someone
pushes them up.

## Scout verification

Scout accounts see singers' contact details and can export them, so they
are gated. Two ways in:

- **Invite code** — a `SPOT-XXXX-XXXX` code you issued. Entered at signup
  (or later via Edit profile → *Apply for scout access*) it unlocks the
  account immediately, and the code is single-use and revocable.
- **Application** — anyone without a code fills in company, role, work
  email and a website or roster link. They get an ordinary listener
  account marked *pending* — they can browse, follow and post, but
  contact details and CSV export stay locked — until the owner approves.

### Owner console

Settings → **Owner tools**. The first device to claim ownership becomes
the owner, and only that account sees the queue afterwards. From there you
can approve or decline applications (a decline can carry a reason, shown
to the applicant), and generate, copy and revoke invite codes.

With sync on, applications from other phones arrive in the queue and
approvals flow back out. Without sync, the owner console only ever sees
applications made on that one device.

### What this is, and isn't

This is a **soft gate**. The board is a JSON blob in the browser, so
someone who opens dev tools can set the flag on their own device, and
singer contact details are already in the synced board for anyone who can
read it. What the gate does buy you is real: it stops casual sign-ups,
makes scout status something you grant deliberately, and leaves an audit
trail of who applied, what they claimed, and who approved them.

Enforcement that actually holds needs Firebase Auth plus database rules —
approved scouts recorded at a path only the owner can write, and singer
contact details moved to a path readable only by those accounts. That's a
bigger change (everyone signs in, the app loses its no-signup character),
which is why it isn't here yet. Don't market this as "verified scouts
only" to singers until that exists.

## Scout tools

The scout side is the part somebody would actually pay for, so it's built
as a working surface rather than a bookmark list.

- **Filters** on Discover: originals only, posted within 24h/7d/30d, and
  based-in city, on top of the search box and genre chips. The Filters
  chip shows how many are active.
- **Saved searches** — name the current search and it lands at the top of
  Discover with a **"N new"** badge counting matching clips posted since
  you last opened it. That badge is the reason a scout comes back daily;
  opening the search re-applies every criterion and marks it seen.
- **Shortlist** — the Saved tab becomes a working list: singer, city,
  song, plays and chart score per row, with **notes**, a **Get in touch**
  button, and remove. Notes are deliberately kept in `localStorage` and
  never written to the shared board — a scout's opinion of a singer has no
  business syncing to anyone, least of all the singer.
- **Export CSV** — the whole shortlist as a spreadsheet: name, handle,
  city, genres, contact, song, original?, caption, plays, likes,
  comments, score, date and your note. Downloads as a file, falls back to
  the clipboard if the browser blocks it.
- **Contact route** — singers add a booking email or link in Edit
  profile, which shows up as *Get in touch* on shortlist rows (`mailto:`
  or the link). If a singer hasn't added one, the row says so and points
  at commenting instead. There's no in-app messaging: with no accounts or
  moderation, a DM inbox would be a liability rather than a feature.

## Where the data lives

- **Clip metadata** (profiles, captions, likes, comments, play counts) —
  `localStorage` under `spotlight.board`.
- **Video files and poster frames** — IndexedDB (`spotlight` → `media`).
  Nothing is uploaded anywhere until you turn on sync, and the local copy
  stays even after upload so your own clips play instantly and offline.
- **Your identity** — a generated id in `spotlight.me`. No password, no
  server, no account recovery.
- **Scout notes and saved searches** — `spotlight.notes` and
  `spotlight.searches`, deliberately outside the synced board so they stay
  private to the device.

The app seeds six demo singers and eight demo clips on first run so the
feed, chart and search aren't empty. Demo clips have no video file, so
they render as an animated stage visual labelled "Demo clip" — everything
else about them (likes, comments, following, ranking) works normally.
Settings → *Reset everything on this device* clears all of it.

## Sync between devices

Settings (cog on your profile) → *Sync across devices* takes a Firebase
web config and shares everything: the board through Realtime Database,
and the video files themselves through Cloud Storage. Everyone pasting
the same config sees the same singers, clips, likes and comments — and
can play each other's clips.

1. Create a project at https://console.firebase.google.com/ and register a
   **Web app** to get the config object.
2. Enable **Build → Realtime Database**, and scope its rules to the path
   the app uses:

```json
{
  "rules": {
    "spotlightBoard": { ".read": true, ".write": true }
  }
}
```

3. Enable **Build → Storage**, and scope its rules to the two folders the
   app writes:

```json
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /clips/{clip} {
      allow read: if true;
      allow write: if request.resource.size < 100 * 1024 * 1024
                   && request.resource.contentType.matches('video/.*');
    }
    match /posters/{poster} {
      allow read: if true;
      allow write: if request.resource.size < 2 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

4. Paste the config JSON into the sync panel and turn it on. The config
   must include `storageBucket` — without it you get metadata-only sync
   and the app says so.

### How it behaves

- **Posting doesn't wait on the network.** The clip appears in your feed
  immediately and uploads in the background, with a progress pill at the
  top of the screen. `videoUrl` and `posterUrl` land on the clip record
  when it finishes, and sync carries them to everyone else.
- **Clips you posted before turning sync on get backfilled** — connecting
  queues every clip of yours that has no `videoUrl` yet, oldest first. A
  failed upload is retried the same way next time sync connects.
- **Playback falls back**: local file first (instant, offline), then the
  Storage URL, and only if neither exists does the card say the video
  isn't on this device.
- **Deleting a clip** removes the video and poster from Storage too.
- Metadata merging is per entity: the newer `updatedAt` wins for edits,
  likes and follows union together, comments dedupe by id, and play
  counts take the maximum — so two phones editing at once don't wipe
  each other out.

### Cost and codec caveats

- Firebase's free Spark plan gives ~5GB stored and ~1GB/day of downloads.
  A 60-second clip is roughly 15–20MB, and remote clips stream on every
  view without being cached locally, so a busy feed eats the daily
  download allowance quickly. Watch the console usage tab.
- Chrome records `webm`, iOS Safari records `mp4`. A clip stays in the
  format it was recorded in, so a Chrome-recorded webm will not play on
  an iPhone — that card shows "This clip will not play on this browser"
  rather than failing silently. Transcoding server-side (or a Cloud
  Function) is the real fix.
- The rules above are open to anyone with the config. Fine for a demo or
  a small group; add Firebase Auth before anything public.

## Known limits

- No moderation, reporting or age gating — needed before real users.
- No accounts: identity is a generated id in this browser. Clearing site
  data loses your profile, and there's no way to sign in on a new phone
  as the same singer.
- Browser storage is finite (IndexedDB is typically capped at a few
  hundred MB); posting fails with a warning when it's full.
- Plus the Firebase caveats above: open rules, free-tier bandwidth, and
  the webm/mp4 split between Chrome and Safari.
