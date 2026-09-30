# Building and testing on a real Android phone

Everything you need to get Blooming Weather off this repository and onto a
phone in your hand, written for somebody who has not done it before.

Every version number below is read from this project's own configuration
rather than from general advice, so if one of them looks unusual, it is
deliberate.

Branch these instructions were written against:

```
claude/weather-app-motivation-notifications-x24m6h
fffc124  Quality pass: quote library, Edit mode at 320px, three location bugs
```

---

## Part one — what to install

### Node.js — version 22 or newer

The Capacitor 8.5 command line tool declares `"node": ">=22.0.0"`. Node 20 is
not enough and will fail partway through with an unhelpful message.

Get it from [nodejs.org](https://nodejs.org) — the LTS download, as long as it
is 22 or above. Then check:

```bash
node --version    # must be v22.x.x or higher
npm --version
```

### Java — JDK 21

Capacitor's Android module compiles at `JavaVersion.VERSION_21`.

**The easy path: do not install Java separately.** Android Studio ships its own
JDK. Install Android Studio first (below), then set it here:

> Settings → Build, Execution, Deployment → Build Tools → Gradle → **Gradle JDK**
> → choose the bundled **jbr-21**

If you would rather have a command-line JDK as well, install Temurin 21 from
[adoptium.net](https://adoptium.net) and check `java -version` says `21`.

> Two errors mean you are on the wrong JDK and nothing else:
> `Unsupported class file major version` and `invalid source release: 21`.

### Android Studio

From [developer.android.com/studio](https://developer.android.com/studio). Any
current release is fine. Run it once and let the first-run wizard finish — that
is what installs the SDK.

### Android SDK — API 36

This project builds against API 36 and runs on API 24 and up, which is Android
7.0 — practically any phone made in the last several years.

| Setting | Value |
|---|---|
| `compileSdkVersion` | 36 |
| `targetSdkVersion` | 36 |
| `minSdkVersion` | 24 |

In Android Studio: **Settings → Languages & Frameworks → Android SDK → SDK
Platforms**, tick **Android API 36**, Apply.

### Build Tools

**Not pinned by this project**, so the Android Gradle Plugin (8.13.0) chooses
its own. You only need to make sure two things are installed under **SDK Tools**,
both of which are ticked by default:

- **Android SDK Build-Tools** (latest)
- **Android SDK Platform-Tools** — this is what gives you the `adb` command

Gradle itself is downloaded automatically by the wrapper (8.14.3). Nothing to
install.

---

## Part two — build it

### 1. Clone the branch

```bash
git clone https://github.com/jonathan-longden/family-bets.git
cd family-bets
git checkout claude/weather-app-motivation-notifications-x24m6h
git log --oneline -1
```

That last command should print `fffc124 Quality pass: …`. If it prints
something else, you are on the wrong branch or there is newer work.

### 2. Install the dependencies

```bash
cd outside/mobile
npm install
```

A couple of minutes the first time.

### 3. Build and sync — one command does both

```bash
npm run build
```

That runs three steps in order, which is why there is no separate sync command
to remember:

1. `npm run config` — stamps the name, id and version from `app.config.json`
   into every project file
2. `npm run www` — copies the web app into `mobile/www`
3. `npx cap sync` — pushes it into the Android and iOS projects and installs
   the native plugin code

**Optional but worth it:** run the automated suite first. 327 assertions,
about a minute, and it is the same app the phone runs.

```bash
npm test
```

### 4. Open the Android project

```bash
npx cap open android
```

Android Studio opens on the right project. **Wait for the Gradle sync to
finish** — the progress bar at the bottom of the window. The first one
downloads Gradle and can take five to ten minutes on a fresh machine. Do not
start clicking things until it settles.

---

## Part three — get it onto the phone

### 5. Turn on USB debugging

On the phone:

1. **Settings → About phone**
2. Tap **Build number** seven times. It will say *"You are now a developer."*
3. Go to **Settings → System → Developer options**
   (on Samsung: **Settings → Developer options**)
4. Turn on **USB debugging**
5. Plug the phone into the computer — **with a data cable.** Charge-only cables
   look identical and are the single most common reason this does not work.
6. The phone asks *"Allow USB debugging?"* → tick **Always allow from this
   computer** → **Allow**

Check the computer can see it:

```bash
adb devices
```

| What you see | What it means |
|---|---|
| a line ending `device` | ready |
| a line ending `unauthorized` | look at the phone, the prompt is waiting |
| empty list | try a different cable first |

### 6. Run it

In Android Studio, choose your phone from the device dropdown in the toolbar,
then press the green **▶ Run** button. It compiles, installs and launches.

The first build is slow. Every one after that takes seconds.

### 7. Build a debug APK

```bash
cd outside/mobile/android
./gradlew assembleDebug
```

On Windows that is `gradlew.bat assembleDebug`.

Or in Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.

### 8. Where it ends up

```
outside/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

### 9. Installing it by hand

With the phone plugged in:

```bash
adb install -r outside/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`-r` replaces an existing copy rather than refusing. Alternatively, copy the
file onto the phone and tap it — Android will ask you to allow "install unknown
apps" for whichever app you opened it from.

> **This is a debug build.** It is for your own phone only. Google Play needs a
> signed **.aab**, not an APK, and that is a separate job covered in `STORE.md`.

---

## Part four — the real device checklist

The automated suite proves the arithmetic, the mouth and the screen in a
desktop browser. This list is only the things a test in a browser cannot reach.

### Basic

- [ ] Launches without crashing
- [ ] Icon is the cheeky sun, not a default Android robot
- [ ] Splash screen appears and dismisses cleanly
- [ ] Says **Blooming Weather** — launcher, splash, app switcher
- [ ] Layout fits the screen; nothing hidden under the status bar or the
      gesture bar; no sideways scrolling

### Weather

- [ ] **Real Open-Meteo data loads.** The most important line on this page: the
      live API has never been reached from the development environment, so
      every forecast proved so far came from a stub.
- [ ] Current temperature matches what it is like outside the window
- [ ] Hourly strip — 24 hours, times in your own clock
- [ ] 15-day forecast, all fifteen present
- [ ] Tomorrow card
- [ ] Sky Mood matches the actual sky
- [ ] Best bit and worst bit of today make sense

### Quotes

- [ ] They are funny
- [ ] Swearing is on by default
- [ ] Settings → swearing off gives clean lines everywhere, and they are still
      funny
- [ ] The line matches the weather — no "GLORIOUS" while it is raining
- [ ] **They do not constantly change.** Pull to refresh several times; the
      line should stay put within the same hour and change across the day.

### Locations — use **London, Manchester and Nottingham**

- [ ] Add all three by search
- [ ] Rename one (Edit → pencil)
- [ ] Delete one, then add it back
- [ ] Reorder with the ▲ ▼ arrows
- [ ] Pin a default (◉), force-close the app, reopen — it opens there
- [ ] Switch between them; each shows its own weather
- [ ] "Use where I am" finds you
- [ ] **Deny the location permission** — the app must stay completely usable
      and must not nag
- [ ] Aeroplane mode on → switching between all three still works from cache,
      and each says how old it is
- [ ] **Switch while loading.** The one that matters most. Pull to refresh on
      London, then tap straight to Manchester, then Nottingham, faster than
      they can answer. **No city may ever show another city's weather.** Repeat
      several times, ideally on a poor connection.

### Native

- [ ] Share raises Android's share sheet, and the card image arrives intact in
      WhatsApp
- [ ] Privacy policy opens, and its back link returns you to the weather
- [ ] Android back button behaves — closes sheets, exits from the top, never
      strands you mid-flow
- [ ] Close from the app switcher and reopen — comes back where you left it
- [ ] Background it for ten minutes and return — it refreshes rather than
      showing stale numbers
- [ ] No crashes anywhere

---

## Before store submission

One field is deliberately blank and nobody but you can fill it in:

```json
"support": {
  "email": ""
}
```

It needs **a real mailbox you actually read**, and which will still work in two
years. Both stores publish it on your listing, and Google Play also uses it for
policy notices — miss one of those and an app can be suspended.

Two practical constraints:

- **It becomes public.** Anyone viewing the listing sees it, and scrapers will
  find it. Use a dedicated address rather than your main personal one.
- **It must accept mail from strangers.** No allow-list, no filter that bins
  unknown senders.

Apple separately asks for a support *contact* during review — name, email and
phone — but that is entered in App Store Connect, not in this file.
`support.url` is already set and satisfies the "Support URL" requirement on
both stores.

When you have chosen one, change that single line and run `npm run config` from
`outside/mobile`. It propagates to both store listings.

---

## When something goes wrong

| Symptom | Almost always |
|---|---|
| `Unsupported class file major version` | Gradle JDK is not 21 |
| `invalid source release: 21` | same |
| Capacitor CLI dies on startup | Node is older than 22 |
| `adb devices` is empty | charge-only USB cable |
| `adb devices` says `unauthorized` | the prompt is waiting on the phone |
| Gradle sync hangs on a fresh clone | it is downloading Gradle — let it |
| App installs but shows old content | `npm run build` was not re-run |

That last one is worth remembering: **the web files are copied into the Android
project at build time.** Editing anything in `outside/` and then pressing Run in
Android Studio will install the previous copy. Always `npm run build` first.
