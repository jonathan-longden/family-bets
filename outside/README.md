# Step Out

A weather app with one opinion: **you should go outside, and this is when.**

It reads the forecast for where you are, scores every hour against the things
you would actually leave the house for, and finds the runs of hours worth
putting your shoes on for. Then — the bit that matters — it tells you as one
is starting, rather than sitting there waiting to be opened.

It runs on a phone, installs to the home screen, and opens with no signal on
the last forecast that reached it.

## The shape of it

One screen, and the top card is the whole app: what to do, when, and the
reason it is worth doing now rather than later.

- **The verdict.** *Go for a walk. At 07:00. This is the good bit of today.*
  The span, what it feels like, the gusts, the chance of rain. **I went** logs
  it; **Not today** shuts the nudges up until tomorrow.
- **Now.** What it is doing outside this minute, which is usually why you
  opened it.
- **Hour by hour.** The next day and a half as bars, scored. Tap one and it
  says what that hour is doing, and if it is no good, why not. This is the
  app's working shown: you can see the window it picked and the hours it threw
  away.
- **Windows ahead.** The rest of them, today and tomorrow.
- **The streak.** Days in a row you have been out. Seven dots, and the one
  that matters is today's.

## How an hour is scored

Four things, weighted differently for each activity:

- **What it feels like**, not what the thermometer says — the wind is already
  in that number, and it is the one you dress for.
- **Rain**: how likely, and how much.
- **The gusts**, rather than the average wind. The gust is what pushes a bike
  about.
- **The sky**. A bright dry hour and a grey dry hour are not the same
  invitation.

Each activity has a range where a number is simply right and a range where it
stops counting as going out at all; between the two the score falls away in a
straight line. A run wants it colder than a walk, minds rain less, and is the
only one happy in the dark. Sitting outside with a coffee is the fussiest
thing on the list. A ride weights the wind like the ride-ruiner it is.

**How fussy** moves every threshold at once, because "I don't mind a bit of
drizzle" is one opinion rather than six numbers. What it will not move:
thunder, freezing rain and heavy snow are refused at any setting.

## What counts as a window

A run of consecutive hours that all clear the bar, long enough to be worth the
coat — an hour for a walk, two for a ride.

Two things about that are deliberate:

**An hour of rain in the middle is not a window with a hole in it.** It is two
windows, and only one of them may be long enough to count.

**A window is never longer than six hours.** Nobody needs telling that the
next twenty-three hours are fine, and a stretch that long would otherwise
swallow the day — an overnight window touching everything after it wins the
headline just by overlapping the good afternoon. A longer stretch is trimmed
to its best six hours and the card says it stays good after that.

## The nudge

The whole point, and the part that has to be got right, because an app that
nudges too often gets its notifications turned off and then never nudges
again:

- It goes out when a window is **about to start** — as it starts, or up to an
  hour before, your choice.
- **Never twice for the same window**, however many times the check runs.
- **Never in your quiet hours**, judged where the weather is rather than where
  the phone is. Nine at night to seven in the morning by default.
- **Never more times in a day than you allow.**
- **Not for the fag end of a window** — less than three quarters of an hour
  left in it is not an invitation.
- Not at all after **Not today**, until tomorrow.

The words are chosen to earn the interruption. "It is 18 degrees" does not;
"best it gets today", "the rain is off for two hours", "last of the light" do,
and each of those lines is only used when it is true of that window. If there
is a streak to lose, it says so.

### When it can reach you

A web page with no server behind it cannot be pushed to. So:

- **Android, installed to the home screen**: the browser wakes the app in the
  background every so often (Periodic Background Sync) and the nudge arrives
  on its own. Settings says so when this is switched on and working.
- **Everywhere else, iPhone included**: the check runs whenever the app is
  open or comes back to the front, so the nudge arrives the next time you look
  at it. Settings says that plainly rather than pretending otherwise.

Either way the decision is made by the same code — the service worker loads
the same file the page does, so a nudge sent while the app is closed cannot
disagree with what the app says when you open it.

## Where the weather comes from

[Open-Meteo](https://open-meteo.com/), which answers a browser directly, needs
no key and no account, and asks nothing about who is asking. The place search
is theirs too.

The only thing that ever leaves the phone is a pair of coordinates, rounded to
four decimal places, sent to them. There is no server of mine in this app at
all.

## Setting it up

Open it, and either let it use where you are or search for a town. Then pick
what you would go out for. That is the setup.

Everything — the place, the settings, the days you have logged — lives on that
phone and nowhere else. Nothing is backed up for you, so use **Export** before
changing phones.

## Hosting it

Static files, no build. Serve the folder from any static host, alongside the
rest of this repo:

```
outside/
  index.html      the screen
  forecast.js     the arithmetic, shared with the worker
  app.js          the drawing, the settings, the buttons
  styles.css
  sw.js           the shell cache and the background nudge
  manifest.json
  icon-192.png  icon-512.png
```

Notifications and background sync need HTTPS (or localhost). GitHub Pages and
Firebase Hosting both qualify.

On a release, bump the build stamp in `app.js`, the `?v=` on the stylesheet
and both scripts in `index.html` and `sw.js`, and the cache name in `sw.js` —
they go together.
