# The phone apps

The iOS and Android builds of the weather app, made with
[Capacitor](https://capacitorjs.com/).

The app itself is one directory up, in `outside/`. It is not built, compiled,
bundled or transpiled by anything here — the files the phone runs are the same
files the website runs, copied. This directory is the shell around them and the
tooling that stamps a name and a version into nine places at once.

## What runs where

| | Web / PWA | iOS | Android |
|---|---|---|---|
| The screen, the forecast, the mouth | same files | same files | same files |
| Service worker | yes | no | no |
| Location | browser prompt | native, coarse | native, coarse |
| Share | Web Share, or download | OS share sheet, with the image | OS share sheet, with the image |
| Temperature on the icon | yes, once installed | not yet | not yet |
| Splash screen | none | yes | yes |

Everything in the "same files" row is proved by one test suite, because it is
one app.

## Layout

```
outside/
  app.config.json     ← every name, id and version, in one file
  index.html …        the app
  native.js           the only file that knows a phone might be involved
  privacy.html        the policy, served on the web and linked in-app
  mobile/
    package.json      Capacitor and the tooling. Not shipped to the phone.
    capacitor.config.json   generated — do not edit
    scripts/          config, www build, icon rendering, release
    resources/        the artwork, as vector, and the store images
    tests/            the suite: `npm test`
    www/              generated — the copy Capacitor bundles
    ios/  android/    the two native projects, committed
```

## The one config file

`../app.config.json` is the only place the app's identity is written down.
Everything else is generated from it by `npm run config`:

- `brand.js` — the names the app calls itself, and the version in Settings
- `manifest.json` — the PWA name, colours and description
- `index.html` — title, description, iOS home-screen name, theme colour
- `capacitor.config.json` — app id, app name, plugin setup
- `ios/App/App/Info.plist` — display name, version, build number
- `ios/App/App.xcodeproj/project.pbxproj` — bundle id, version, build number
- `android/…/strings.xml` — app name, package name
- `android/app/build.gradle` — application id, versionName, versionCode

Every one of those edits is anchored to a pattern that has to match. If a file
moves on and an anchor stops fitting, `npm run config` stops and says which one
rather than writing a half-configured app — a build that fails loudly beats a
submission with last month's version number on it.

**Clean name, rude mouth.** The app is called *Blooming Weather* everywhere —
home screen, About, share card, both listings — and it swears at you by
default anyway. The name and the mouth are separate decisions and only the
mouth has a switch. It is also the reason the age rating is what it is: see
[STORE.md](STORE.md), which is about the content, not the title.

## Everyday commands

Run these from this directory.

```
npm install        once
npm test           the whole suite in headless Chromium (~30s)
npm run config     app.config.json → everywhere
npm run www        copy the web app into www/
npm run icons      re-render every icon and splash from the vector artwork
npm run build      config + www + cap sync — the one to run before opening an IDE
npm run ios        build, then open Xcode
npm run android    build, then open Android Studio
```

`npm run build` is the one that matters. Anything you change in `outside/` is
invisible to the phone until it has run.

## iOS

**Needs a Mac.** Xcode does not exist for anything else, and neither does the
iOS Simulator. Everything up to that point works anywhere.

1. `npm run ios` — builds and opens `ios/App/App.xcworkspace`.
2. Xcode → **App** target → **Signing & Capabilities** → pick your Team. This
   is the first point that needs an **Apple Developer account** (£79/$99 a
   year). Without one you can still run on the Simulator and, for seven days at
   a time, on your own device with a free Apple ID.
3. Product → Run to try it, or Product → **Archive** → Distribute App → App
   Store Connect to upload a build.

Capacitor 8 uses Swift Package Manager, so there is no `pod install` and no
`Podfile` — Xcode resolves the plugin packages itself the first time it opens
the project. Give it a minute.

Already configured, so you do not have to: bundle id, display name, version and
build number, portrait-only orientation, the location and photo-library usage
strings, reduced-accuracy location, the export-compliance answer, the app icon
and the launch screen.

## Android

**Works on any machine.** Android Studio is free and there is no fee to build
or sideload — the £20/$25 one-off **Google Play developer account** is needed
only to publish.

1. `npm run android` — builds and opens `android/` in Android Studio.
2. Let it sync Gradle the first time.
3. Run ▶ on a device or emulator.

To publish you need an upload key, which you make once and must never lose or
commit:

```
keytool -genkey -v -keystore ~/blooming-weather-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Keep the file and its passwords somewhere safe and out of this repository —
`.gitignore` refuses `*.jks`, `*.keystore` and `keystore.properties`, but the
only real protection is not putting them here. A lost upload key means asking
Google to reset it; a leaked one means somebody else can ship an update to your
users.

Then either sign through Android Studio (**Build → Generate Signed App
Bundle**) or add an untracked `android/keystore.properties` and wire it into
`app/build.gradle`. Google Play wants an **.aab**, not an APK.

## Releasing

One version number covers all three. To cut a release:

1. Bump `version` and `build` in `../app.config.json`. `version` is what people
   see (`1.1.0`); `build` must go **up by at least one every single upload** —
   both stores reject a build number they have seen before.
2. Bump the cache in the web app: the `?v=` on the stylesheet and all five
   scripts in `index.html`, the same in `sw.js`, and `CACHE_NAME`. They move
   together or a phone runs half of one version and half of another.
3. `npm run build`
4. `npm test` — it has to be green before anything is uploaded.
5. Commit and push. GitHub Pages deploys the web app from `main` on its own.
6. Xcode: Archive → upload. Android Studio: Generate Signed App Bundle →
   upload to the Play Console.

The web version does not wait for the stores and never should. A phone app
sitting in review for two days is not a reason to hold a fix back from the
website.

## What is native, and what is deliberately not

**Native:** the location prompt (coarse only), the share sheet with the image
attached, the splash screen, the status bar, resume-from-background, and
Android's back button.

**Not native, on purpose:**

- **No notifications.** The app asks for no notification permission and sends
  nothing. There is nothing here worth interrupting somebody for.
- **No analytics, no crash reporting, no advertising ID, no third-party SDK.**
  The only network calls the app makes are to Open-Meteo.
- **No account, no server.** There is nothing to sign into and nothing of ours
  for data to sit on.
- **No temperature on the icon yet.** Both platforms put the app icon's badge
  behind native code, so it is a small piece of Swift and Kotlin rather than a
  web setting. Settings says so plainly rather than showing a switch that does
  nothing. It belongs with the widget work below.

## Adding widgets later

Not in the first release, and the project is arranged so they can go in without
disturbing anything.

**iOS.** A WidgetKit extension is a new target in the same Xcode project,
sharing the app's App Group so both read one saved forecast. The work is: add
an App Group capability to the app and the widget; have `app.js` write the last
forecast into the shared container (a small addition to `native.js`); write the
widget's SwiftUI views. The forecast logic does not need porting — the widget
reads what the app already saved.

An iPhone widget exists today without any of that: `../widget/scriptable-widget.js`
runs inside Scriptable and downloads the app's own `weather.js` and `voice.js`.
It is a real home-screen widget and needs no developer account at all.

**Android.** An `AppWidgetProvider` plus a `RemoteViews` layout in
`android/app/src/main`, fed by a `WorkManager` job that reads the same saved
forecast. Android widgets are drawn by the system from a fixed set of views, so
the layout is written natively rather than in HTML.

**Both.** The honest way to feed a widget is to have the app write its forecast
somewhere the widget can read, rather than giving the widget its own copy of
the forecast logic to drift out of step with. That is the one thing worth
getting right before either is started.

## Testing on real devices

`npm test` covers 197 assertions about the forecast maths, the words, the
screen and the honesty rules, but it runs in a desktop browser. These are the
things only a phone can answer.

**iPhone** — a small one (SE) and a large one (Pro Max), on current iOS:

- [ ] The splash gives way to weather with no white flash between
- [ ] Nothing hides under the notch or the Dynamic Island
- [ ] Nothing sits under the home indicator; the 15-day list scrolls clear of it
- [ ] Scrolling has native momentum and does not rubber-band the whole page
- [ ] The status bar clock is legible against the app's background
- [ ] Tap targets are comfortable one-handed
- [ ] Location: the app's own explainer appears **before** iOS's prompt
- [ ] Allow → the forecast is for where you are
- [ ] Deny → a clear sentence, and town search still works
- [ ] Deny, then allow in iOS Settings → it recovers without a reinstall
- [ ] The keyboard in town search pushes the field up rather than covering it
- [ ] Share → the OS sheet opens with the image attached
- [ ] Share → Save Image works and does not crash (this is what the photo
      library usage string is for)
- [ ] Aeroplane mode → the cached forecast shows, labelled with its age
- [ ] Aeroplane mode with nothing cached → the trouble card and a working retry
- [ ] Background for ten minutes, come back → it refreshes rather than lying
- [ ] Force quit and reopen → the place and settings are still there
- [ ] Settings → Erase everything → really erases
- [ ] Large text (Accessibility → larger text) → nothing clips
- [ ] Reduce Motion on → the sky stops moving

**Android** — a small phone and a large one, on a recent version:

- [ ] Everything in the iPhone list above
- [ ] The back button closes an open sheet, and exits from the main screen
- [ ] Gesture navigation and three-button navigation both leave content clear
- [ ] The status and navigation bars are the app's colour, not black bars
- [ ] The permission dialog offers **Approximate** and the app is happy with it
- [ ] Rotating the phone does nothing (portrait is locked on purpose)
- [ ] Split-screen does not break the layout
- [ ] Share → the Android sheet opens with the image attached

Anything that fails here is a bug in the app, not in the checklist.
