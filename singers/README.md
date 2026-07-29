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

**Activity** — the bell in the feed header. Likes, comments, follows and
shortlists on your clips, newest first, with a dot when there's something
unseen. The headline event is a **verified scout shortlisting you**, shown
with their name and company — a singer should know when a label is
listening. Everyone else appears by handle.

**Captions** — clips can carry lyrics or a transcript, toggled with the CC
button. For watching on mute, and for anyone who can't hear the audio.

**Safety** — a report button and a per-device block on every clip that
isn't yours. Reports go to the owner's console; blocking hides that
singer's clips and comments from you and never leaves your device.

**Collabs** — a board where singers post what they're looking for: a rapper
for verse two, a harmony, a producer, a duet partner. Pick up to three
things you need, add the detail (tempo, key, what you've got so far), and
optionally attach one of your own clips so people can hear the track.
Anyone can reply publicly, with a clip of their own attached. Filter by
what's wanted, see only yours, mark a callout filled when someone lands.

Replies are public on purpose. A private inbox aimed at singers, many of
them teenagers, is a moderation problem I'd rather not create — and a
reply people can see tends to be a better reply.

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

### How hard the gate is

Depends which mode you're in.

**Local mode: soft.** The board is a JSON blob in the browser, so anyone
with dev tools can set the flag on their own device, and contact details
sit on the shared board where any reader can see them. What it buys you is
still real — scout status is granted deliberately, and there's an audit
trail of who applied and who approved them — but it is not security.

**Connected mode: enforced.** Approval writes `spotlightScouts/{uid}`,
which only the owner can write, and the database rules reject
`role: 'scout'` on any account without that entry. Contact details live at
`spotlightContacts/{uid}`, readable only by verified scouts, the owner and
the person themselves — a `contact` field on the artist record is rejected
outright. Faking scout status now means getting past the rules, not
editing localStorage.

The rules are in `firebase/database.rules.json`, and their known gaps are
listed in `firebase/README.md` — chiefly that play counts and comments are
still writable by any signed-in user.

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

## Two modes

`config.js` decides which one you're in.

**Local mode** (config left as `null`) — what you get out of the box. One
isolated world per device, no sign-in, identity is a random id in the
browser. Fine for demos; useless as a product, because a singer who
clears their site data loses everything and nobody can see anyone else.

**Connected mode** (config filled in) — a real service. Everyone lands in
the same room, signs in with Google or Apple, and the security rules in
`firebase/` enforce who can read and write what. Sign-in is required
before anything renders, and an account made in local mode is migrated to
the signed-in identity on first sign-in, clips and all.

Connected mode also adds, because app stores require them: **download my
data** (profile, clips, notes as JSON) and **delete my account** (clips,
Storage objects, contact details and the auth user itself).

See `firebase/README.md` for the ten-minute setup.

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
- **Contact details** — in connected mode these live at
  `spotlightContacts/{uid}`, not on the artist record, because a field on
  the shared board is readable by anyone who can read the board. The rules
  let only verified scouts, the owner, and you read them.
- **Deletions** leave a tombstone (`deleted: {"clips:abc": 1690000000}`).
  The sync merge is a union, so without one a deleted clip or account
  comes straight back from any device that still has a copy.

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

## Age and safeguarding

Everyone gives a birth year at signup. The year itself stays on the device;
only a coarse band (`adult` / `under18`) goes on the shared board, because
that's all anyone else needs.

- Under 13 can't sign up at all.
- **Under 18 accounts can't share contact details**, whatever they type —
  scouts see "Under 18 — no direct contact" and are told to approach
  through a parent or guardian.
- Scout accounts require an adult birth year on top of verification.
- Accounts created before this existed are asked once, on next launch, and
  can't dismiss the prompt. Defaulting either way would be wrong: "adult"
  would hand a minor's details to scouts, "under18" would silently break
  an adult's contact route.

This is age *declaration*, not age verification — a determined teenager can
type 1990. Real verification means ID or a third-party provider, which is a
decision about what kind of service you're running.

## Discovery fairness

Pure score ranking is a ratchet: clips with plays get more plays, and a clip
with none never surfaces. For an app whose promise is *get noticed*, that
quietly makes the promise false. Every fourth slot in the For You feed is
reserved for an under-exposed clip (fewer than 50 plays), newest first, so a
first-time singer is seen within the first few swipes.

## Bandwidth

Remote clips are cached in IndexedDB after first play, up to 24 clips, with
the oldest evicted first. Clips you recorded yourself are never evicted.
Without this, every view re-downloaded the whole video and a busy week would
have burned through the Firebase free tier's daily download allowance.

## Known limits

- **No accounts.** Identity is a generated id in this browser. Clearing
  site data destroys a singer's profile, clips and followers with no
  recovery, and there's no way to sign in on a new phone as the same
  person. This is the single biggest remaining gap, and fixing it with
  Firebase Auth is also what would make the scout gate real rather than
  soft.
- **Moderation is one person with a queue.** Reports reach the owner and
  the owner can take a clip down, but there's no proactive scanning, no
  appeals, and nothing stops a bad clip being visible until someone
  reports it.
- **Age is declared, not verified** (see above).
- **Legal docs are drafts.** `legal.html` is a plain-English starting
  point written by the person who built the app, not by a lawyer. Have it
  reviewed before opening this to the public.
- Browser storage is finite (IndexedDB is typically capped at a few
  hundred MB); posting fails with a warning when it's full.
- Plus the Firebase caveats above: open rules, free-tier bandwidth, and
  the webm/mp4 split between Chrome and Safari.
