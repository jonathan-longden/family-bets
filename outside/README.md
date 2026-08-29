# Blooming Weather

*A proper weather app that tells you exactly what the sky is doing, then takes
the mickey out of it.*

The weather is real, the numbers are real, and the app has a mouth on it. You
open it because you want to know whether to take a coat. You smile because it
has something to say about the answer.

It runs on a phone, installs to the home screen, and opens with no signal at
all on the last forecast that reached it.

## The rule everything is built on

**The weather always wins.** In order: accurate weather, clear information,
good presentation, personality, joke. Every line in the app is attached to
something the forecast actually said — a grey afternoon is never told the sun
is out, and rain that is still falling is never described as cleared.

## What is on screen, in order

1. **Where you are, and what it is doing.** Location, temperature, feels-like,
   condition — then the headline, chosen by the real conditions and the time of
   day.
2. **Warnings**, when the numbers are serious enough to matter. Factual, never
   fearmongering: the lead-in gets a bit of personality, the sentence under it
   does not.
3. **Worth knowing** — what has changed since the last forecast this phone saw,
   and the moments the forecast throws up: rain clearing at four, sun turning
   up after it, the first dry day after a wet run, thunder due at nine.
4. **How's it looking?** The forecast in plain English, the way a person would
   say it. *"Mild, mostly showery for the rest of the afternoon, and rain is
   likely. Rain arrives around 19:00."* Under it, **Sky Mood** — the weather as
   a personality, chosen by the same numbers.
5. **The numbers.** Feels-like, rain chance, rain so far, wind, gusts,
   humidity, visibility, high, low, sunrise, sunset — in your units, never
   moved to make room for a joke.
6. **Next 24 hours**, each hour wearing what it feels like, with a **timeline**
   underneath naming the moments it changes its mind: rain arriving, sun
   breaking through, cloud building, wind getting up, sunrise, sunset.
7. **Today's best bit and worst bit**, each pinned to an hour with its
   temperature, sky and rain chance.
8. **Tomorrow**, its own card, because tomorrow is the day people actually ask
   about.
9. **The next 15 days**, grouped by how much the forecast really knows.

## Fifteen days, honestly labelled

| | | |
|---|---|---|
| **High confidence** | days 1–3 | high, low, rain, wind, and the hours when you open the day |
| **Good confidence** | days 4–7 | high, low, condition, rain probability, wind |
| **Lower confidence** | days 8–15 | condition, high, low, rain probability where the model still offers one |

Past about a week the model stops giving a rain probability at all. Those days
show a dash rather than a zero, because "no chance of rain" and "nobody knows
yet" are different sentences and only one of them is true.

## The mouth

Lines are chosen by situation, never at random. Thunder beats temperature, a
downpour beats a grey sky, and "quite nice, actually" only wins when nothing
louder is happening. Morning, afternoon, evening and night have their own
voices on top of that.

Within an hour the headline holds still — it will not reshuffle while you are
reading it — and it rotates as the day and the conditions move, so the same
weather never produces the same sentence forever.

**Let it swear at me** is on by default. Turned off, every line has a twin
written to be funny in its own right rather than the sweary one with the word
cut out:

> **On:** THE SUN HAS LOST THE FUCKING PLOT.
> **Off:** THE SUN HAS COMPLETELY LOST THE PLOT.

A test walks every line in the app and fails the build if a clean twin swears,
if a pair is malformed, or if swearing appears in more than half the lines. It
is seasoning, not the meal. The plain-English brief and the warnings never
swear at all — they are the useful bits.

## Sharing

The share button draws a card — location, temperature, icon, the headline, and
the day's numbers under it — and hands it to the phone's own share sheet where
there is one. Where there is not, it saves the image or copies the text. It is
a picture of the weather with a joke on it, not a joke with some weather
attached.

## Moving weather

Rain falls, clouds drift, snow flutters, stars twinkle, the sun breathes. All
of it is CSS transforms on a handful of elements — no canvas loop, nothing
running in the background — and all of it is decorative: the app is complete
with it switched off. It is off automatically for anyone whose phone asks for
reduced motion, and there is a toggle in Settings on top of that.

## On the home screen

A web app cannot install a real widget by itself — iOS and Android only accept
widgets from native app packages, and a page saved to the home screen is an
icon, not a widget. So there are two things here instead, one of each.

### The number on the icon

The installed app writes the current temperature onto its own icon, the way a
mail app writes an unread count. Nothing to set up: install it, and the number
appears. Two honesty rules apply, the same ones the rest of the app follows:

- **Nothing stale.** If the last forecast is more than three hours old the
  number comes off the icon entirely rather than sitting there being wrong.
- **Nothing below zero.** The badge is a positive whole number — the platform
  will not carry a minus sign — so at minus three the icon shows nothing and
  the screen shows `-3`. A badge reading `3` in a hard frost would be a lie.

There is a toggle in Settings. Turning it off clears the icon immediately. It
works on iOS 16.4+ and on Android through Chrome, both only once the app is
installed to the home screen; in a browser tab there is no icon to write on,
and Settings says so rather than pretending.

### A real widget on iPhone, via Scriptable

`widget/scriptable-widget.js` is a proper iOS home-screen widget — small or
medium, temperature, icon, high/low, rain chance and the headline — that runs
inside [Scriptable](https://apps.apple.com/app/scriptable/id1405459188), a free
app that hosts scripts as widgets.

It does not reimplement anything. It downloads the app's own `weather.js` and
`voice.js` and runs them, so the widget and the app read the same forecast and
tell the same joke. Tapping it opens the app.

1. Install Scriptable from the App Store.
2. Open it, tap **+**, paste in the whole of `widget/scriptable-widget.js`, and
   name it **Blooming Weather**.
3. Long-press the home screen → **+** → **Scriptable** → pick a size → **Add**.
4. Long-press the new widget → **Edit Widget** → set **Script** to *Blooming
   Weather*. Leave **Parameter** empty to use where the phone is, or type a
   place as `Name,lat,lon` — e.g. `Ilkley,53.925,-1.822`.
5. Done. The script asks iOS to refresh hourly; iOS treats that as a hint.

`UNITS` and `SWEARY` at the top of the script are yours to change, and `SITE`
points at wherever the app is hosted. If the widget cannot reach the weather it
draws the last reading it had, labelled with how old it is — never a stale
number passed off as current.

### A real widget on Android, what it would take

Android will not run the Scriptable trick — there is no equivalent host app —
so a genuine Android widget means shipping a native package. It is not a large
job, but it is a different kind of job to this one:

1. **Wrap the site in a Trusted Web Activity.** Android Studio, or Bubblewrap
   (`npx @bubblewrap/cli init --manifest .../manifest.json`), turns the PWA into
   an APK that opens the real site full screen with no browser chrome. The web
   app stays the product; the package is a shell around it.
2. **Add an `AppWidgetProvider`.** A small Kotlin class plus a
   `RemoteViews` layout — Android widgets are drawn by the system from a fixed
   set of views, so the widget layout is written natively rather than in HTML.
3. **Feed it.** A `WorkManager` job every hour or so calls Open-Meteo directly,
   writes the reading to `SharedPreferences`, and pokes the widget to redraw.
   The forecast-reading and line-choosing logic would have to be ported to
   Kotlin, or the job could call a tiny endpoint that runs the existing
   JavaScript — the first is more work up front, the second adds a server.
4. **Get it onto the phone.** Either sideload the APK (fine for a family; needs
   "install unknown apps" turned on and a manual re-install for each update) or
   pay the one-off Google Play developer fee and publish it, which also gets
   automatic updates and Play Store install.

Until that exists, Android gets the icon badge, which needs nothing.

## What it will not do

No notifications, no reminders, no goals, no streaks, nothing to maintain and
nothing to nag about. It will never tell you how to spend your afternoon.

## Where the weather comes from

[Open-Meteo](https://open-meteo.com/) — current conditions, hourly, fifteen
days ahead and three days behind (the history is what lets it say "first sun
after a grey run" and mean it). No key, no account, no email address.

The only thing that ever leaves the phone is a pair of coordinates, rounded to
four decimal places.

**When it fails** it says so in its own voice, shows what actually went wrong,
and offers a retry. If there is a saved forecast it draws that instead, clearly
labelled with when it was fetched — never a stale forecast passed off as
current, and never invented weather.

## Accessibility

Semantic sections with proper headings, an accessible name on every control,
one sentence per hour and per day for screen readers rather than a pile of
orphaned numbers, visible focus rings for keyboard users, no meaning carried by
colour alone, and nothing pinned to a fixed height so large text grows rather
than clips.

## The same app, on a phone

There are iOS and Android builds of this, made with Capacitor, and they run
*these* files — not a rewrite of them. No bundler, no framework, no second
version of the forecast logic to drift out of step. One file, `native.js`,
knows a phone might be involved; everything else is written as though only the
browser existed.

What changes on a phone: the location prompt is the OS one and asks for
approximate location only, the share sheet is the OS one and carries the image,
there is a splash screen, and there is no service worker (the files are already
on the phone). Everything else is identical, which is why one test suite covers
all three.

See **[mobile/README.md](mobile/README.md)** for building and releasing, and
**[mobile/STORE.md](mobile/STORE.md)** for the store listings — including why
the shop front cannot use the app's actual name.

The website is unaffected by any of it and always deploys first.

## Renaming it

Everything that names the app comes from **`app.config.json`**. Change it
there, run `npm run config` in `mobile/`, and the name is written into
`brand.js`, `manifest.json`, `index.html`, the Capacitor config, the iOS
Info.plist and Xcode project, and the Android strings and Gradle build.

```json
"name":  "Blooming Weather",
"store": { "name": "Blooming Weather" }
```

One name, whatever the swearing setting says. The app used to rename itself
when swearing was switched off, back when its own name was the rudest thing
about it — it does not any more. `store.name` exists only because the two
listings have their own rules about length and search terms, and is normally
the same thing.

Nothing else hardcodes any of it. The saved-settings key is deliberately
neutral, so a rename never loses anybody's location.

## Hosting it

Static files, no build, no framework, no dependencies:

```
outside/
  index.html      the screen
  brand.js        the name, in one place
  weather.js      asking for the forecast, reading it, and everything factual
  voice.js        the personality engine
  app.js          the drawing, the share card, the settings
  styles.css
  sw.js           the shell cache, and nothing else
  native.js       the one file that knows a phone might be involved
  privacy.html    the privacy policy, linked from the app and both stores
  manifest.json
  icon-192.png  icon-512.png  icon-maskable-512.png
  app.config.json every name, id and version number, in one place
  widget/
    scriptable-widget.js   the iPhone home-screen widget (not served, pasted)
  mobile/         the iOS and Android projects, the tooling and the tests
```

On a release, bump `version` and `build` in `app.config.json`, then the `?v=` on
the stylesheet and all five scripts in `index.html` and `sw.js`, and the cache
name in `sw.js` — they go together. The full sequence, including the two app
stores, is in [mobile/README.md](mobile/README.md).
