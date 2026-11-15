# Open-Meteo: licence position, evidence, and the email to send

Blooming Weather gets every forecast from [Open-Meteo](https://open-meteo.com/).
Before putting the app on two shops it is worth having written down, in one
place, whether that is allowed — with the evidence rather than a recollection
of it.

This file holds the question, what their terms actually say, what was done
about it, and the email that is still to be sent. When a reply comes back,
record it at the bottom.

**Status: settled. Open-Meteo were asked directly and confirmed this app may
use the free API. Staying on the free tier, with conditions — see
[The answer](#the-answer-23-october-2026) below.**

---

## The answer (23 October 2026)

**Open-Meteo replied, and the answer is yes.**

Their guidance, as relayed by the project owner — this is a summary of their
reply rather than a verbatim quotation of it:

> Commerciality depends on whether the app supports a business, a paid
> product or service, advertising, affiliate revenue, client work, or
> internal business operations.
>
> Personal hobby projects and non-commercial community projects may use the
> free API, subject to the usage limits.

Blooming Weather is none of those things, so it qualifies.

Worth noticing that their reply frames the test slightly **wider** than the
examples on their terms page do. The page asks about subscriptions and
advertising. The reply adds affiliate revenue, client work and internal
business operations. Nothing in the wider framing catches this app, but it is
the version to measure against in future, because it is the one they gave
when asked about this app specifically.

### The decision

**Stay on the free API. Do not buy a subscription at this stage.**

### The conditions it depends on

This permission is conditional, and the conditions are product decisions that
could drift without anybody connecting the drift to a data licence. The app
must stay:

- Completely free
- No advertising
- No affiliate links
- No subscriptions
- No in-app purchases
- No paid features
- No analytics or tracking

**Break any one of these and the free tier no longer applies.** Not as a
matter of interpretation — their reply names most of them directly.

These are not left as prose. The test suite checks them on every run, under
*the conditions the licence rests on*: shipped files are swept for advertising,
analytics, tracking, crash-reporting and billing SDKs; the page is checked for
anything loaded from a third-party server; the native plugin list is pinned to
the capabilities the app actually uses; and the app's live network traffic is
watched to confirm `api.open-meteo.com` is the only host it ever calls. If
somebody adds a crash reporter one wet Tuesday, the suite fails and tells them
what else they have just changed.

### What stays as it is

- The attribution added in `e263b09` stays. It is a CC BY 4.0 condition and is
  required regardless of tier.
- The usage limits still apply, and the question of how they are counted for a
  distributed mobile app is covered in [section 3](#3-rate-limits--the-open-question)
  below. The app's own call rate is measured there.

---

## Where the evidence came from

Their website could not be reached directly from the machine this was
researched on, so the pages were read from the site's own source, which they
publish:

| | |
|---|---|
| Repository | `open-meteo/open-meteo-website` |
| Commit | `53f0bf019395abd29d8d5a404e7a39c3457f90d7` |
| Dated | 20 October 2026 |
| Pages read | `src/routes/en/terms`, `src/routes/en/licence`, `src/routes/en/pricing` |

Everything quoted below is verbatim from those files. Anything that could
**not** be verified from them is marked as unverified.

---

## 1. Is a free app on Google Play and the App Store allowed?

**Yes, on their own definition** — as long as the app stays free of
subscriptions and advertising.

> This section was the reading of their published terms, written before they
> were asked. They have since confirmed it directly, in terms slightly wider
> than this: see [The answer](#the-answer-23-october-2026). Where the two
> differ, their reply wins.

Their terms give worked examples. These qualify as **non-commercial**:

> - **Private or non-profit websites or apps that do not have subscriptions or advertising.**
> - Personal home automation purposes.
> - Public research conducted at public institutions.
> - Use in educational content.
> - **Voluntary donations, including contributions through a tip jar, are permitted.**

And these are **commercial**:

> - **Websites or apps that have subscriptions or display advertisements.**
> - **Commercial products** or promotional activities.
> - Undisclosed research at commercial entities.

The word "app" is on both lists. What separates them is subscriptions and
advertising — **not** how the app is distributed. Nothing in their terms
mentions app stores, publishing, or download counts.

Blooming Weather has no subscriptions, no in-app purchases, no advertising, no
analytics, no accounts and no server. It matches their non-commercial example
almost word for word.

They also defer to the
[Creative Commons NonCommercial interpretation](https://wiki.creativecommons.org/wiki/NonCommercial_interpretation)
for the underlying definition.

### What would change this

| Change | Effect |
|---|---|
| Charging for the app | Almost certainly commercial — "commercial products" |
| Adding a subscription | Commercial, explicitly |
| Adding advertising | Commercial, explicitly |
| Adding a tip jar or donations | **Still non-commercial** — permitted explicitly |

---

## 2. Attribution — required, and now done

From their licence page:

> API data are offered under **Attribution 4.0 International (CC BY 4.0)**
>
> **Attribution:** You must give appropriate credit, provide a link to the
> licence, and indicate if changes were made.
>
> **You must include a link next to any location Open-Meteo data are
> displayed**, for example:
> ```html
> <a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>
> ```

The credit used to live only inside the About sheet, which is somewhere a
person has to go looking for — so the screen actually showing the weather
carried no attribution at all.

**Fixed.** "Weather data by Open-Meteo.com" now sits in the footer of the main
weather screen, on the same scrolling page as the hero, the storm card, the
hourly strip, tomorrow and the fifteen days. Sixteen assertions in the test
suite hold it there: visible, outside any dialog, below the weather, big
enough to tap, and still inside a 320px screen next to the longest status line
the footer can produce.

This was required **whether or not** the app ever moves to a paid tier.

---

## 3. Rate limits — the open question

Free tier, from their pricing table:

| Limit | Free tier |
|---|---|
| Per minute | 600 |
| Per hour | 5,000 |
| Per day | 10,000 |
| **Per month** | **300,000** |
| Uptime guarantee | None |

Two lines from the terms matter more than the numbers:

> "Rate limits are applied by **IP addresses and application**."

> "We reserve the right to block applications and IP addresses that misuse our
> service **without prior notice**."

**This is the genuine unknown, and it has nothing to do with commerciality.**
If limits are per IP, every user's phone counts separately and the app would
never approach them. If there is also an aggregate limit per application, then
10,000/day and 300,000/month become a ceiling on how many people can use the
app at all.

The "without prior notice" part is why it is worth asking rather than waiting.
On a server you would notice being blocked. In a published app the first sign
would be one-star reviews saying it stopped working.

### What the app actually asks for

Measured from the code, not estimated:

- Each saved location's forecast is cached for **15 minutes** (`STALE_MS`).
- A tick runs every 5 minutes but does nothing unless that cache is stale.
- Only the location **currently on screen** is ever refreshed. Saved locations
  sitting in the list cost nothing.
- Geocoding is called only when somebody searches for a town.

So a user opening the app a few times a day generates roughly **5–20 forecast
requests a day**. An app left open continuously generates **at most 4 an hour**.

---

## 4. Pricing — partially verified

The tier structure is confirmed from the page source:

| Tier | Monthly calls | Commercial use |
|---|---|---|
| Free / Open-Access | 300,000 | No |
| API Standard | 1M | Yes |
| API Professional | 5M | Yes |
| API Enterprise | 50M+ | Yes |

Paid tiers remove the daily cap, add a dedicated endpoint (`customer-api.open-meteo.com`)
and an API key, a 99.9% uptime target, and the commercial licence.

> "The free API is for non-commercial use, rate-limited to 10,000 calls/day,
> and carries no uptime guarantee. The customer API runs on dedicated servers,
> has no daily rate limit, and includes a commercial use licence."

**⚠️ The actual prices are not in the page source** — they are fetched at
runtime — and their site could not be loaded. Secondary sources report **$29 /
€29** for Standard and **$99 / €99** for Professional. **Treat those as
unverified** and check the pricing page directly before relying on them.

---

## 5. The email that was sent

**Sent and answered — see [The answer](#the-answer-23-october-2026) at the top.**
Kept here as the record of what was actually asked, since the reply only makes
sense alongside the question.

Send it from **the address you intend to use as `support.email`** in
`app.config.json`. Their reply then lands in the mailbox you will be
monitoring anyway, and you will have had a real message arrive in it before
you put it on a store listing.

```
To:      info@open-meteo.com
Subject: Non-commercial use and rate limits for a free mobile weather app

Hello,

I'm about to publish a small weather app called Blooming Weather on Google
Play and the App Store, built on your forecast API. Before I do, I'd like to
check I've read your terms correctly and ask one question about rate limits
that I couldn't answer from the published pages.

About the app:

  - Free to download, on both stores.
  - No subscriptions, no in-app purchases, no advertising.
  - No analytics, no tracking, no accounts, no server of my own.
  - It calls api.open-meteo.com directly from the device, with no API key.
  - Coordinates are rounded to four decimal places before any request.

On that basis I believe it falls under your non-commercial examples — "private
or non-profit websites or apps that do not have subscriptions or advertising."
Could you confirm that's right? I'd rather ask than assume.

My actual question is about how the limits apply to an app that runs on many
devices rather than one server.

Your terms say rate limits are applied "by IP addresses and application". Each
user's phone makes its own requests from its own IP, so per-IP I'd never come
close. But if there's also an aggregate limit per application, the free tier's
10,000/day and 300,000/month would become a ceiling on how many people can use
the app.

For scale, measured from the code: the app caches each saved location's
forecast for 15 minutes, and only ever refreshes the location currently on
screen. A typical user generates roughly 5-20 forecast requests a day. An app
left open continuously would generate at most 4 an hour.

So:

  1. Do the daily and monthly limits apply per device IP, per application in
     aggregate, or both?
  2. If there's an aggregate limit, roughly what level of usage should prompt
     me to move to a paid plan?
  3. Is there a way you'd like the app to identify itself, so you can reach me
     if it ever causes you a problem? I'd rather hear from you than be blocked
     without warning, which your terms reserve the right to do.

On attribution: the app shows "Weather data by Open-Meteo.com", linked to
open-meteo.com, in the footer of the main weather screen alongside the
forecast, and credits you again on its About screen. Let me know if you'd like
that done differently.

Thanks for building and running this — it's the reason a hobby weather app
like mine is possible at all. Happy to move to a paid plan if that's the right
answer; I just wanted to understand which situation I'm in first.

Best regards,
[your name]
```

### Why it is written that way

- **It asks rather than asserts.** The position is strong, but a written
  answer from them is worth more than a correct reading of their terms.
- **Question 3 is the one that matters most.** Being blocked without notice is
  the real risk, and being a known name costs nothing to arrange now.
- **It offers to pay.** That tends to get a straighter answer than a free-tier
  enquiry, and it is honest.

---

## 6. The record

| | |
|---|---|
| Asked | October 2026, by email to `info@open-meteo.com` |
| Answered | 23 October 2026 |
| Outcome | Free API confirmed for this app as a personal hobby project |
| Decision | Stay on the free tier. No subscription bought |
| Conditions | Free, no ads, no affiliate links, no subscriptions, no in-app purchases, no paid features, no analytics — checked by the test suite |
| Attribution | Added in `e263b09`, stays regardless of tier |

### When this has to be revisited

- Anything on the conditions list changes — the test suite will say so first
- The app starts earning money in any form other than voluntary donations
  (their terms permit a tip jar explicitly; their reply did not contradict
  that, but it is worth re-asking if it ever becomes real money)
- Usage approaches the free limits, if they turn out to be counted per
  application rather than per device

---

## Still open

- [ ] `support.email` in `app.config.json` is still empty, and both shops
      reject a listing without one
- [ ] The live Open-Meteo round trip has never been made from a development
      machine — the API is unreachable from there. It needs testing on a real
      phone, and it is the first item on the device checklist in
      `ANDROID-TESTING.md`
