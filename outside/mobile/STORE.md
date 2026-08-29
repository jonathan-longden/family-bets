# Store listings

Everything the App Store and Google Play ask for, written out and ready to
paste. Nothing here has been submitted to anybody, and nothing here submits
itself.

---

## The name: settled

The app is **Blooming Weather**, everywhere — home screen, About, share card,
splash, both listings. It swears at you by default anyway.

That pairing is the point rather than a compromise. A respectable name is what
gets the listing approved:

- **Apple**, guideline 1.1.1, refuses profanity in an app name and its
  metadata in practice, because names appear in search results shown to every
  account including children's, regardless of the app's own age rating.
- **Google Play**'s Inappropriate Content policy treats a profane store title
  the same way, and the title is surfaced across the whole store.

Neither shop applies that reasoning to what is *inside* an app. Content is what
the age rating is for, and the rating is where the swearing shows up — see the
age rating sections below, which are the part of this document to read
carefully.

The app used to rename itself when swearing was switched off; it does not any
more, because there is no longer a ruder name to switch to. Only the mouth
changes.

To change the name, set `name` in `../app.config.json` and run
`npm run config`. Names already considered and parked: Weather You Legend, What
The Weather, Proper Weather. **Do it before the first submission** — a store
name can be changed later, but an iOS bundle identifier and an Android
application id cannot, ever, once published.

---

## The identifier

```
io.github.jonathanlongden.weather
```

Reverse-DNS of a domain you actually control (`jonathan-longden.github.io`),
which is what both stores expect and what keeps it collision-free. If you buy a
proper domain for this, change `id` in `app.config.json` and rerun
`npm run config` — but only **before** the first upload. After that it is the
app's permanent identity on both platforms and changing it means a new listing
with no reviews and no existing users.

---

## Apple App Store

**Name** (30 characters max)

```
Blooming Weather
```

**Subtitle** (30 max)

```
The forecast, with an attitude
```

**Promotional text** (170 max — editable without a new build)

```
Fifteen days of proper forecast, and an app that has something to say about
every one of them. Now, hourly, tomorrow, and a fortnight out.
```

**Description**

```
A proper weather app that tells you exactly what the sky is doing, then takes
the mickey out of it.

The weather always wins. Every number on the screen is the real forecast, and
every joke is chosen by those numbers — if it is grey, nothing in here will
tell you the sun is out.

WHAT YOU GET

• Right now — temperature, what it actually feels like, and the sky in plain
  English
• How's it looking? — the day summed up the way a person would say it: "Mild,
  showery for the rest of the afternoon, rain likely from about seven"
• Sky Mood — the weather as a personality, chosen by the same numbers
• Today's best bit and worst bit, each pinned to an hour
• The next 24 hours, each hour wearing what it feels like, with a timeline
  naming the moments it changes its mind
• Tomorrow, its own card, because tomorrow is the day people actually ask about
• Fifteen days ahead, honestly labelled

FIFTEEN DAYS, HONESTLY LABELLED

High confidence for the first three days. Good for the rest of the week. Lower
after that. Past about a week the forecast stops offering a rain probability at
all, and those days show a dash rather than a zero — because "no chance of
rain" and "nobody knows yet" are different sentences and only one of them is
true.

IT HAS A MOUTH ON IT

Sunny, and it is delighted. Raining, and it has opinions. Grey, and it is very
committed to grey.

Let it swear at me is a setting, and it is on by default. Turned off, every
line has a twin written to be funny in its own right — not the same sentence
with the word cut out.

WHAT IT WILL NOT DO

No account. No sign-in. No analytics, no tracking, no advertising. No
notifications, no reminders, no streaks, nothing to maintain and nothing to
nag about. It will never tell you how to spend your afternoon.

Your location and settings stay on your phone. The only thing that ever leaves
it is a pair of coordinates — rounded first — sent to the weather service to
ask what the weather is there.

Works with no signal, on the last forecast it managed to get, clearly labelled
with when that was. It will never show you old weather and call it current.

Forecasts by Open-Meteo.
```

**Keywords** (100 characters total, comma separated, no spaces)

```
weather,forecast,rain,hourly,15day,funny,temperature,wind,sky,british,umbrella
```

**Category** — Primary: Weather. Secondary: Entertainment.

**Age rating.** Answer the questionnaire honestly. With swearing on by default,
"Profanity or Crude Humor" is **Frequent/Intense**, which lands the app at
**17+**. Do not answer this one optimistically to chase a lower rating: an app
rated 12+ that swears at the user on first launch is a guaranteed rejection and
a removal risk, and the swearing is a genuine feature rather than an accident.
If a lower rating matters more than the default, ship with swearing **off** by
default (`sweary: false` in `defaults()` in `app.js`) and answer Infrequent/Mild.

**Support URL** — required. Set `support.url` in `app.config.json`.

**Privacy policy URL**

```
https://jonathan-longden.github.io/family-bets/outside/privacy.html
```

**App Privacy ("nutrition label")** — the honest answers:

| Question | Answer |
|---|---|
| Do you collect data from this app? | **No** |

That single answer is correct and covers the whole form. The app has no
analytics, no accounts and no server; location is used on the device and sent
to a third-party weather API to fetch a forecast, and is never collected by
you, never linked to an identity and never used for tracking. If App Store
Connect pushes for detail, the position is: *location is used, not collected.*

**Export compliance** — already answered in `Info.plist`
(`ITSAppUsesNonExemptEncryption` = false). The app makes ordinary HTTPS
requests and contains no other cryptography.

**Screenshots** — required sizes, portrait:

| Device | Pixels | How many |
|---|---|---|
| 6.9" iPhone (16 Pro Max) | 1320 × 2868 | 3–10 |
| 6.5" iPhone (11 Pro Max) | 1242 × 2688 | 3–10, optional if 6.9 supplied |
| 13" iPad (only if you ship iPad) | 2064 × 2752 | 3–10 |

Take them in the iOS Simulator (⌘S saves at the exact required size). Five
worth having: the main screen on a good day, the main screen in the rain, the
24-hour strip and timeline, the 15-day list, and a share card.

---

## Google Play

**App name** (30 max)

```
Blooming Weather
```

**Short description** (80 max)

```
The real forecast, 15 days out, from an app with strong opinions about it.
```

**Full description** (4000 max) — the Apple description above works as-is.

**Category** — Weather. **Tags**: Weather, Daily forecast.

**Content rating.** Fill in the IARC questionnaire honestly. Profanity that the
user can turn off, no violence, no sexual content, no gambling, no user-generated
content, no data sharing — with swearing on by default expect **PEGI 12 /
ESRB Teen** or thereabouts. Same rule as Apple: answer it straight.

**Data safety** — the form Google actually reads. The answers:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | Yes — every request is HTTPS |
| Do you provide a way for users to request data deletion? | Yes — Settings → Erase everything, and uninstalling |

Location deserves a note if the reviewer asks: the app requests **approximate**
location only, uses it on the device, and sends rounded coordinates to
Open-Meteo to fetch a forecast. It is not collected by the developer, not
stored off the device, not linked to a user and not used for tracking or
advertising.

**Permissions declaration.** The app declares `INTERNET` and
`ACCESS_COARSE_LOCATION`. It explicitly removes `ACCESS_FINE_LOCATION`, which
the geolocation library would otherwise have added — so there is no sensitive
permission to justify.

**Graphics** — all generated into `resources/store/`:

| Asset | Size | File |
|---|---|---|
| App icon | 512 × 512 | `play-icon-512.png` |
| Feature graphic | 1024 × 500 | `play-feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | take these yourself |

Apple's 1024 × 1024 icon is `app-icon-1024.png` in the same folder.

**Release** — upload an `.aab`. Use a closed test track first: Play's review of
a brand-new developer account can take days, and an internal test build is the
cheapest way to find out that something is wrong on a real phone.

---

## What only you can do

Everything below needs an account, a payment or a Mac. None of it has been
started, and none of it can be.

| | What | Cost |
|---|---|---|
| Apple | Developer Program membership | £79 / $99 a year |
| Apple | A Mac with Xcode | — |
| Apple | Signing certificate and provisioning (Xcode does it once you pick a Team) | — |
| Apple | App Store Connect record, listing, screenshots, submit | — |
| Google | Play Console developer account | £20 / $25, once |
| Google | Upload keystore, generated and kept by you | — |
| Google | Play Console listing, data safety, content rating, submit | — |
| Both | A support email address that you read | — |

`support.email` in `app.config.json` is deliberately empty. Both stores require
a working contact and will reject a listing without one, and it is not a thing
to be filled in with a guess.
