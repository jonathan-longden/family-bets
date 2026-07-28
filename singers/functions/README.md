# Clip transcoding (optional, needs deploying)

Chrome records WebM, iOS Safari records MP4, and Spotlight stores a clip in
whatever format it was recorded in. Once clips sync between phones, a
Chrome-recorded clip will not play on an iPhone — the card says so rather than
failing silently, but the clip is still unwatchable for that person.

`index.js` is a Cloud Function that fixes it: every non-MP4 upload to `clips/`
is transcoded to H.264/AAC MP4, the clip record is repointed at the new file,
and the original is deleted. Files also get `+faststart` so they begin playing
before they've fully downloaded, and come out considerably smaller, which helps
the download quota.

> **This has not been deployed or run.** It was written against the documented
> APIs in an environment with no Firebase project, so there was no way to
> execute it. Test it on a throwaway project before pointing it at anything you
> care about.

## Deploying

Requires the **Blaze (pay-as-you-go) plan** — Cloud Functions that touch
Storage aren't available on the free Spark plan. Transcoding a 60-second clip
is a few seconds of 2GB-memory compute; budget accordingly and set a billing
alert before you turn it on.

```sh
npm install -g firebase-tools
firebase login
cd singers/functions
npm init -y
npm install firebase-functions firebase-admin ffmpeg-static
firebase deploy --only functions:transcodeClip
```

Set `BOARD_PATH` in `index.js` if you changed the database path the app writes
to (default `spotlightBoard`).

## Checking it works

1. Record a clip in desktop Chrome with sync on — it uploads as `.webm`.
2. Watch the function logs: `firebase functions:log --only transcodeClip`.
3. In the Storage console, `clips/<id>.webm` should be replaced by
   `clips/<id>.mp4`.
4. The clip's `videoUrl` in Realtime Database should now end in `.mp4`, and the
   clip should play on an iPhone.

## Things to watch

- **Signed URL expiry.** The function mints a URL expiring in 2100. If you'd
  rather use short-lived URLs, the app would need to fetch them on demand
  instead of storing one on the clip.
- **Devices that cached the old file.** The app caches remote clips in
  IndexedDB, so a phone that already downloaded the WebM keeps playing it until
  that cache entry is evicted. Harmless, but it's why a re-test can look like a
  no-op.
- **Failures are silent to the singer.** If ffmpeg fails the original stays put
  and the clip keeps working for everyone except iOS. Watch the logs rather
  than assuming.
