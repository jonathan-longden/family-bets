# Fucking Weather

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
cut out, and the app renames itself to *Blooming Weather*:

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

## Renaming it

The working name swears, which will not survive a shop front. To rename:

1. `brand.js` — `name` and `clean`, which drive the header, About, the page
   title and the share card
2. `manifest.json` — `name` and `short_name`
3. `index.html` — `<title>` and the `apple-mobile-web-app-title` meta
4. `README.md` — this file

Nothing else hardcodes it. The saved-settings key is deliberately neutral, so a
rename never loses anybody's location.

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
  manifest.json
  icon-192.png  icon-512.png
```

On a release, bump the build stamp in `app.js`, the `?v=` on the stylesheet and
all four scripts in `index.html` and `sw.js`, and the cache name in `sw.js` —
they go together.
