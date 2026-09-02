# Telly for Android

A native player for the same playlists the web version reads — because a
browser cannot play most of them.

## Why this exists

The web app is a real IPTV player, but a web page has three rules it cannot
opt out of, and IPTV providers break all three:

| | In a browser | Here |
|---|---|---|
| `http://` streams on an `https://` page | refused before a request is made | played |
| `.m3u8` from a server with no CORS headers | blocked by the browser | played |
| raw MPEG-TS (`.ts`) | cannot be decoded | played |

ExoPlayer has no notion of CORS or mixed content, and decodes MPEG-TS. On a
real playlist of 2,038 free channels, 295 of them are non-HLS — that is the
part a browser simply cannot reach.

## What it does

- **Add a playlist** by M3U URL, by file from the device, or with Xtream
  Codes credentials.
- **Browse** by category, search by name, and keep favourites.
- **Play** with ExoPlayer: HLS, MPEG-TS, progressive files, `http` or `https`.
- **Remembers** the playlist and the last channel, and reloads on launch.
- Runs on phones, tablets and Android TV — it declares the leanback launcher
  and does not require a touchscreen.

It ships with no channels, exactly like the web version. What you point it at
is your business; nothing is bundled.

## Layout

    core/   plain Kotlin: the M3U parser, the Xtream URL builder, and the
            rules about which stream addresses are playable. No Android in
            it, so it is unit-tested on any machine with `gradle test`.
    app/    the Android application: Compose UI and ExoPlayer. It compiles
            core's sources directly rather than keeping a second copy.

## Building

The APK is built by CI on every push — see `.github/workflows/android.yml` —
and attached to the run as `telly-debug-apk`. Download it from the Actions
tab and sideload it.

To build it yourself you need the Android SDK (Android Studio, or the
command-line tools):

    gradle --project-dir telly/android assembleDebug

The unit tests need nothing but a JDK:

    gradle --project-dir telly/android/core test

## Cleartext traffic

The manifest permits `http://`, because that is what IPTV providers serve
and refusing it would make the app pointless. It is stated here rather than
buried: streams you play over `http` are not encrypted in transit, and an
Xtream password travels inside every stream URL. That is how Xtream Codes
works, and it is a reason to use a private device.
