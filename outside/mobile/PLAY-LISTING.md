# Google Play listing and declarations

Drafted 25 November 2026. **Every answer below describes the app as the code
actually is today.** Where an answer will change once AdMob and Premium land,
there is a second column saying so. Nothing here is a guess — anything I could
not substantiate is marked ⚠️ and left for you.

---

## Store listing copy

### App name (30 characters max)

```
Blooming Weather
```

16 characters. Room to spare if you ever want `Blooming Weather: Forecast`
(26) for search, though the plain name is stronger.

### Short description (80 characters max)

```
The forecast, with an attitude. 15 days, hour by hour, and a proper opinion.
```

75 characters.

### Full description (4000 characters max)

```
A proper weather app that tells you exactly what the sky is doing, then takes
the mickey out of it.

Blooming Weather gives you the real forecast — current conditions, 24 hours
ahead, and a full 15 days — and then says what it actually thinks about it.
Over 780 different lines, chosen by the weather itself. If it is grey, nothing
in this app will tell you the sun is out.

WHAT YOU GET

• Right now — temperature, what it feels like, wind, humidity and the sky
• Hour by hour for the next 24 hours
• 15 days ahead, honestly labelled by confidence, because day fifteen is not
  tomorrow and this app will not pretend otherwise
• Tomorrow at a glance, and what has changed since you last looked
• The best and worst bits of today, so you know when to go out
• Storm Watch — thunder, heavy rain and strong gusts, with an hour-by-hour
  strip and a clear all-clear when there is nothing coming

AS MANY PLACES AS YOU LIKE

Save home, work, your mum's, wherever. Each one keeps its own forecast, so
switching between them is instant and still works with no signal at all. Name
them what you like, reorder them, pin the one you want it to open on.

A MOUTH ON IT

The jokes are the point. They are built on the numbers rather than bolted on
top, so the app never says something cheerful while it is hammering down. It
swears by default. If that is not for you, there is a switch in Settings and
the clean version is just as funny.

HONEST ABOUT WHAT IT KNOWS

No signal? It shows the last forecast it managed to get and tells you how old
it is, rather than pretending that is the weather now. Long-range days that
nobody can call yet are marked as such instead of being filled in with a
confident-looking number.

PRIVACY

No account. No sign-in. Your saved places and settings stay on your phone.
Location is optional — search for a town instead, and nothing will nag you
about it. When you do use location, the app asks the phone for approximate
location only and rounds it before it goes anywhere.

Weather data by Open-Meteo.com.
```

⚠️ **Before publishing:** add a paragraph covering adverts and Premium once
that build exists. Play requires the listing to disclose in-app purchases, and
the £4.79 price should appear.

### What's new (500 characters max)

```
First release.

• Current conditions, 24 hours, and 15 days ahead
• Storm Watch — thunder, heavy rain and gusts, hour by hour
• Save as many places as you like and switch between them offline
• Over 780 jokes, chosen by the actual weather
• Swearing on by default, with a clean mode in Settings
```

### Category and contact

| Field | Value |
|---|---|
| Category | Weather |
| Email | `weatherblooming@gmail.com` |
| Website | `https://github.com/jonathan-longden/family-bets` ⚠️ a real page would look better than a repo |
| Privacy policy URL | `https://jonathan-longden.github.io/family-bets/outside/privacy.html` ⚠️ only valid once the policy matches the app |

---

## Data Safety declarations

Play asks you to declare this and holds you to it. The left column is the
truth today. **Do not submit the right column until that code exists.**

### Does the app collect or share user data?

| | Today (this branch) | Once AdMob lands |
|---|---|---|
| **Collected** | **No** | **Yes** — via Google's SDK |
| **Shared** | **No** | **Yes** — with Google |

Today the app has no analytics, no accounts, no server of its own, and makes
requests to exactly one host (`api.open-meteo.com`) — which the test suite
verifies on every run by watching live network traffic.

### Location

| Question | Today | Once AdMob lands |
|---|---|---|
| Collected? | **No** — used on device, never sent to us | ⚠️ Google's Mobile Ads SDK can collect coarse location |
| Approximate or precise? | Approximate only | Approximate |
| Shared? | No | ⚠️ Yes, with Google |
| Required? | **No** — the app is fully usable without it | No |
| Purpose | App functionality | Advertising |

The app requests only coarse location on Android (the precise permission is
not in the manifest, so it cannot be granted) and reduced accuracy on iOS, then
rounds to four decimal places before use.

⚠️ Coordinates do go to Open-Meteo with each forecast request. Play's own
guidance is that data sent to a third party for the app to function still
counts — **declare location as collected and shared with the weather provider,
or ask Play support.** I would rather over-declare than under-declare.

### Other categories

| Category | Answer | Basis |
|---|---|---|
| Personal info (name, email, ID) | **No** | No account exists |
| Financial info | **No** today / ⚠️ **Yes** once Premium ships — Play Billing handles it | |
| Messages, photos, contacts, calendar | **No** | Never requested |
| App activity / interactions | **No** today / ⚠️ **Yes** once AdMob ships | |
| Crash logs, diagnostics | **No** today / ⚠️ **Yes** once AdMob ships | No crash reporter present |
| Device or other IDs | **No** today / ⚠️ **Yes** once AdMob ships — advertising ID | |

### Security practices

| Question | Answer |
|---|---|
| Encrypted in transit? | **Yes** — every request is HTTPS |
| Can users request deletion? | **Yes** — Settings → Erase everything, plus uninstalling |
| Committed to Play Families Policy? | ⚠️ **No** — see content rating |
| Independent security review? | **No** |

---

## Ads declaration

| Question | Today | Once AdMob lands |
|---|---|---|
| Does your app contain ads? | **No** | **Yes** |

⚠️ Declaring "contains ads" when it does would be false; declaring "no" after
shipping ads gets apps removed. **This must be changed in the same release
that ships the ads.**

---

## Content rating

**Answer the questionnaire honestly about the swearing.** This is the single
most likely thing to catch you out.

The app ships with strong language **on by default** — including "fuck" and
variants across roughly 7% of its ~786 lines. There is a clean mode, but it is
opt-out, not opt-in.

| Question | Answer |
|---|---|
| Profanity or crude humour? | **Yes — frequent, and on by default** |
| Violence, sexual content, gambling, drugs | No |
| Likely IARC outcome | ⚠️ PEGI 12 / ESRB Teen or similar. **Not** suitable for a 3+ rating |

Consequences worth knowing:

- **Target audience must not include children.** Set 18+ or 13+ — never a
  child age band, which would pull the app into the Families Policy.
- Do not opt into Designed for Families.
- The listing should not read as being for children.

⚠️ I cannot run the questionnaire for you — it is in the Play Console — but
answer the profanity question "yes". Under-declaring it is a removal risk, and
it is trivially discoverable by any reviewer who opens the app.

---

## Trader status and DSA

⚠️ **Selling a £4.79 in-app purchase almost certainly makes you a "trader" in
the EU.** Play requires traders to provide a name, address and phone number,
**which are published on the store listing**.

If you would rather not publish your home address, options are a registered
business address, a virtual office, or not selling in the EU. This is worth
deciding before you fill the form in, not after.

I could not verify the current DSA wording from here, so **read what the Play
Console actually asks** rather than trusting this summary.

---

## Premium purchase disclosures

Once Premium exists, Play requires:

- The in-app products declared in the Console, with the real price
- The listing to say the app contains in-app purchases
- The price (£4.79) and what it buys (removing adverts) stated clearly in the
  app before purchase
- A restore path — your policy already describes Restore Purchases
- No misleading implication that paid features are free

⚠️ **I have not tested a purchase, a restore, or the verification Worker.**
Nothing in this document should be read as saying that path works.

---

## UMP consent

Your policy describes a Google UMP consent flow with a privacy-options control
in Settings. Once that build exists it needs checking against the code:

- Consent refreshed at startup
- The form shown only when UMP says it is required
- Ads requested only when UMP says they can be
- A privacy-options entry in Settings, shown only when UMP says one is
  required
- ⚠️ EEA/UK behaviour tested on a device, not assumed

---

## What is ready and what is not

**Ready to paste into the Console:** app name, short description, full
description, what's new, category, contact email.

**Ready but conditional:** every Data Safety answer in the left column is
accurate today and substantiated by the test suite.

**Not ready, and not fakeable:** screenshots, feature graphic, the content
rating questionnaire, trader details, the ads declaration, and anything about
purchases. These need the Console, a device, or the build that does not exist
in this repository.
