# Bloody Weather

An accurate forecast with a running commentary.

The weather is real, the numbers are real, and the app has a mouth on it. It is
the friend who happens to know exactly what the sky is doing and cannot resist
saying something about it.

It runs on a phone, installs to the home screen, and opens with no signal at
all on the last forecast that reached it.

## The rule the whole app is built on

**The jokes sit on top of the weather. They never replace it, and they never
contradict it.**

Every line in the app is attached to something the forecast actually said. If
it is grey, nothing here will tell you the sun is out. If it is raining,
nothing will call it lovely. The personality picks from a bank of lines that
match the conditions, so the humour is always about the weather you are
actually having.

## What is on screen

- **The headline.** One enormous line, chosen by the real conditions and the
  time of day. *GOOD MORNING, YOU RAY OF FUCKING SUNSHINE* on a bright morning;
  *GREY. MOODY. VERY FUCKING BRITISH* when it is grey; *BLOODY HELL, IT IS
  WINDY* when the gusts say so.
- **The temperature**, big, with the place above it and the honest one-line
  summary beside it.
- **The facts.** Feels-like, chance of rain, wind, gusts, humidity, visibility,
  sunrise, sunset, today's high and low. These are the point of a weather app
  and they never move to make room for a joke.
- **The moments.** Small true observations pulled out of the forecast: rain
  ending at four, a much better tomorrow, a hot spell building, a cold snap
  coming. Two at most, and only when the numbers support them.
- **Next 24 hours.** Each hour wearing what it actually feels like — 😎 for
  weather you would squint in, ☔ for a soaking, 🧣 bright but freezing, ❄️, ⛈️,
  💨, 🥶, 🥵, 🌙 — with its temperature and chance of rain.
- **The next 15 days.** Every day with its picture, high and low, chance of
  rain and a one-line opinion. Tap one for the full detail.

## Fifteen days, honestly labelled

Day fifteen is not day one, and the app does not pretend otherwise. The list is
grouped, and the grouping is the honesty:

| | | |
|---|---|---|
| **The next few days** | days 1–3 | high, low, rain, wind, and the hour-by-hour when you open the day |
| **Later this week** | days 4–7 | high, low, condition, rain probability, wind |
| **Long range** | days 8–15 | the shape of it: condition, high, low, and rain probability *where the model still offers one* |

Past about a week the forecast stops giving a rain probability at all. Those
days show a dash rather than a zero, because "no chance of rain" and "nobody
knows yet" are different sentences and only one of them is true.

## The mouth

Lines are chosen by situation, not at random. Thunder beats temperature. A
downpour beats a grey sky. "Quite nice, actually" only wins when nothing louder
is happening. Morning, evening and night have their own voices on top of that.

Within an hour the headline is stable — it will not reshuffle itself while you
are reading it — and it rotates as the day and the conditions move, so the same
weather does not produce the same sentence forever.

**Let it swear at me** lives in Settings and is on by default. Turned off,
every line has a twin written to be funny in its own right rather than the
sweary one with the word cut out:

> **On:** THE SUN HAS LOST THE FUCKING PLOT.
> **Off:** THE SUN HAS COMPLETELY LOST THE PLOT.

The app renames itself too — *Bloody Weather* becomes *Blooming Weather* — so a
phone handed across the breakfast table does not announce itself. A test walks
every line in the app and fails the build if a clean twin swears, if a line is
missing its pair, or if swearing creeps into more than half of the lines. It is
seasoning, not the meal.

## What it will not do

There are no notifications, no reminders, no goals, no streaks and nothing to
maintain. It will never tell you how to spend your afternoon. It tells you what
the weather is doing, and then it has a laugh about it.

## Where the weather comes from

[Open-Meteo](https://open-meteo.com/), which answers a browser directly and
wants no key, no account and no email address. The place search is theirs too.

The only thing that ever leaves the phone is a pair of coordinates, rounded to
four decimal places. There is no server of mine anywhere in this app.

**When it fails**, it says so in its own voice, shows what actually went wrong,
and offers a retry. If there is a saved forecast it draws that instead, with
the age of it in the footer — never a stale forecast passed off as current.

## Setting it up

Open it, and either let it use where you are or search for a town. That is the
setup. The place and the settings live on that phone and nowhere else.

## Renaming it

The working name swears, which will not survive a shop front. To rename:

1. `brand.js` — `name` and `clean`, which drive the header, About and the title
2. `manifest.json` — `name` and `short_name`
3. `index.html` — `<title>` and the `apple-mobile-web-app-title` meta
4. `README.md` — this file

Nothing else hardcodes the name.

## Hosting it

Static files, no build:

```
outside/
  index.html      the screen
  brand.js        the name, in one place
  weather.js      asking for the forecast and reading it
  voice.js        the personality engine
  app.js          the drawing, the settings, the buttons
  styles.css
  sw.js           the shell cache, and nothing else
  manifest.json
  icon-192.png  icon-512.png
```

Any static host works; GitHub Pages serves this repo. On a release, bump the
build stamp in `app.js`, the `?v=` on the stylesheet and all four scripts in
`index.html` and `sw.js`, and the cache name in `sw.js` — they go together.
