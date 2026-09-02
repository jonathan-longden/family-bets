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

## Two ways to use it

**With a server** — sign in to a [Telly backend](../server/) and the app draws
itself from that account: the channels it is entitled to, its favourites, its
recently watched. The server holds the provider's credentials; this app never
sees them, and asks for a short-lived ticket at the moment you press play.

**On its own** — add an M3U link, a file or Xtream details on the device, as
the app has always done. Nothing about that changed, and it needs no server.

The API endpoint is a setting from the first run. Nothing has an address
compiled into it, so moving the backend from a PC to a VPS is one box on the
Connect screen.

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

    core/   plain Kotlin: the M3U parser, the Xtream URL builder, the rules
            about which stream addresses are playable, and the API client for
            the backend. No Android in it, so all of that is unit-tested on
            any machine with `gradle test` — the API client against a real
            HTTP server rather than a mock object.
    app/    the Android application: Compose UI, ExoPlayer, the Connect and
            Sign in screens, and encrypted storage for tokens. It compiles
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

## When something goes wrong

Every failure has a name and a sentence rather than a status code: no server
at that address, something else answering there, a timeout, wrong password, a
disabled or expired account, the device limit reached, a lapsed session, too
many attempts. A session that has expired while the television slept is
refreshed once, quietly; only a refusal of that refresh becomes a login
screen.

## Cleartext traffic

The manifest permits `http://`, because that is what IPTV providers serve
and refusing it would make the app pointless. It is stated here rather than
buried: streams you play over `http` are not encrypted in transit, and an
Xtream password travels inside every stream URL. That is how Xtream Codes
works, and it is a reason to use a private device.

## A note on token storage

Tokens are kept in `EncryptedSharedPreferences`. Some older TV boxes have a
keystore that refuses to co-operate; rather than failing to start, the app
falls back to ordinary preferences on those devices. Said here rather than
left to be discovered.
