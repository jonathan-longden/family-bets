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

**Scout accounts** — pick "Scout" at signup (or in Edit profile) if you're
looking for talent rather than posting. Scouts get a Shortlist tab, and a
shortlist is the heaviest signal in the chart score.

## Where the data lives

- **Clip metadata** (profiles, captions, likes, comments, play counts) —
  `localStorage` under `spotlight.board`.
- **Video files and poster frames** — IndexedDB (`spotlight` → `media`),
  on that device only. Nothing is uploaded anywhere.
- **Your identity** — a generated id in `spotlight.me`. No password, no
  server, no account recovery.

The app seeds six demo singers and eight demo clips on first run so the
feed, chart and search aren't empty. Demo clips have no video file, so
they render as an animated stage visual labelled "Demo clip" — everything
else about them (likes, comments, following, ranking) works normally.
Settings → *Reset everything on this device* clears all of it.

## Optional sync between devices

Settings (cog on your profile) → *Sync across devices* takes a Firebase
web config and mirrors the board through Realtime Database, the same
pattern the Family Bets app uses. Everyone pasting the same config sees
the same profiles, clips, likes and comments.

1. Create a project at https://console.firebase.google.com/ and register a
   **Web app** to get the config object.
2. Enable **Build → Realtime Database**.
3. Scope the rules to the path the app uses:

```json
{
  "rules": {
    "spotlightBoard": { ".read": true, ".write": true }
  }
}
```

4. Paste the config JSON into the sync panel and turn it on.

Merging is per-entity: the newer `updatedAt` wins for edits, likes and
follows union together, comments dedupe by id, and play counts take the
maximum — so two phones editing at once don't wipe each other out.

**Video files still stay local.** Sync shares the metadata; a clip
recorded on another phone shows "Video not stored on this device" over its
card. Sharing the actual video needs Firebase Storage (upload the blob on
post, store the download URL on the clip, and use it as the `<video>`
source) — the clip record already has room for it.

## Known limits

- Open rules mean anyone with the config can write. Fine for a demo or a
  small group; add Firebase Auth before anything public.
- No moderation, reporting or age gating — needed before real users.
- iOS Safari records `video/mp4` where Chrome records `webm`; both play
  back on the device that recorded them, but a webm clip won't play on
  Safari if you later add cross-device video sharing.
- Storage is finite: browsers cap IndexedDB (typically a few hundred MB),
  and posting fails with a warning when it's full.
