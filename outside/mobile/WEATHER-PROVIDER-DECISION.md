# Which weather provider for the commercial launch

Blooming Weather is going to Google Play with AdMob and a £4.79 Premium
purchase. That makes it a commercial product, and Open-Meteo's free tier does
not cover commercial products. This is the decision that unblocks everything
else, so it is written up on its own.

**Researched 25 November 2026. Nothing has been changed in the app, no account
has been created, and nothing has been paid for.**

---

## The recommendation, up front

**Pay Open-Meteo €29/month and change no code.**

That is not the answer the brief expected, so here is the reasoning before the
detail.

MET Norway is genuinely excellent and genuinely free for commercial use. The
problem is not the licence — it is that swapping to it is not a swap. It is a
rewrite of the layer every other feature stands on, it loses two data fields
the app currently uses, and it still leaves place search unsolved. Against
that, €29/month on an app with ad revenue and £4.79 purchases is close to
noise.

| | Open-Meteo paid | MET Norway |
|---|---|---|
| Cost | **€29/month** | **£0** |
| Commercial use | ✅ Yes, explicitly | ✅ Yes, CC BY 4.0 |
| API key | Yes (their endpoint) | None needed |
| Code change | **One URL and a key** | **Rewrite the weather layer** |
| Place search included | ✅ Yes | ❌ No — needs a third provider |
| CAPE (storm fuel) | ✅ Yes | ❌ **Not available** |
| Visibility | ✅ Yes | ❌ **Not available** (fog fraction only) |
| Weather codes | WMO — what the app speaks | MET's own vocabulary — needs a new mapping |
| Existing 457 tests | ✅ Stay valid | ❌ Every fixture rewritten |
| Storm thresholds | ✅ Already tuned and live-verified | ❌ Re-tune and re-verify from scratch |

The £25-ish a month difference buys away a multi-week rewrite with real
feature loss, on the critical path to launch.

---

## The evidence

### Open-Meteo — commercial tier

Their free tier is explicitly non-commercial, and their worked example of
commercial use is "websites or apps that have subscriptions or display
advertisements". That is this app now, so the free tier is out. Already
established in `OPEN-METEO.md`, including their emailed confirmation, which
was conditional on no ads and no purchases.

Paid tiers, from their pricing page: **API Standard** (1M calls/month),
**API Professional** (5M), **API Enterprise** (50M+). Paid plans add a
dedicated endpoint at `customer-api.open-meteo.com`, an API key, no daily cap
and a 99.9% uptime target.

Standard is reported at **$29/€29 a month**. That figure comes from secondary
sources — the price is not in their published page source and their site is
unreachable from this environment. **Verify it before paying.**

**Integration cost: trivial.** The app already builds its own URL in
`W.forecastUrl`. Moving to the customer endpoint is a hostname change plus an
`apikey` parameter. Every field stays identical, so `W.parse`, the storm read,
the quote engine, the icons and all 457 tests keep working untouched.

**One caveat worth knowing:** a paid key embedded in a shipping app is
extractable. Open-Meteo bill a flat monthly fee rather than per call, so the
exposure is quota abuse rather than a surprise bill — but it is a reason to
consider proxying through a Cloudflare Worker later, the same way the purchase
verification already works.

### MET Norway — free, and genuinely commercial-friendly

**Commercial use is allowed.** Their API home page says the data are freely
available under a Creative Commons licence, and the Terms of Service say that
unless stated otherwise everything is **CC BY 4.0**, which permits commercial
use by definition. Some products are additionally under the Norwegian Licence
for Open Government Data 2.0.

Their FAQ describing MET as "a non-commercial operation" means they do not sell
service levels — not that you may not use the data commercially.

**Conditions:**

- **Identifying User-Agent is mandatory.** Application name and a contact email
  or website. Generic or missing User-Agents are *blocked* on Locationforecast
  2.0, not merely throttled.
- **Attribution**: credit, link to the licence, and indicate if changes were
  made.
- **Caching is required**: respect `Expires`, use `If-Modified-Since`, and do
  not fetch while the app is not in use. Their Terms were revised on
  **5 November 2026** specifically to make the client-side caching rules
  consistent — three weeks ago, so this is live and they care about it.
- No registration, no key, no cost.

**Why it is still the wrong move right now — four concrete losses:**

1. **No CAPE.** The Storm card's instability reasoning uses it. The live run
   showed CAPE is dormant in UK winter anyway (max 110 J/kg against gates of
   500), so this is a summer-season loss rather than an immediate one — but it
   is a permanent capability loss.
2. **No visibility.** Only `fog_area_fraction`, which is a percentage of
   surrounding area, not a distance. The app uses visibility in its icon
   choice and in the "beautiful day" test.
3. **A different weather vocabulary.** MET uses `symbol_code` strings like
   `partlycloudy_day`. The app speaks WMO numeric codes throughout — the
   `CODES` table, `W.family()`, every storm rule and the selection logic
   behind all 786 quote pairs. That is a new mapping table and a re-audit of
   everything downstream of it.
4. **No geocoding.** MET Norway does not do place search, so a third provider
   is needed regardless.

**Honest assessment:** if this app were starting today with no code, MET Norway
would be a strong first choice. It is not worth unwinding a working,
live-verified implementation to get there.

### WeatherAPI.com

**Commercial use is allowed on every plan, including the free one** — unusual
and worth noting. Free tier is 100,000 calls/month (one secondary source says
1M; treat 100K as the number until verified). **Starter is $7/month** for 3M
calls.

It also includes **place search and autocomplete**, which would solve geocoding
in the same subscription — a real advantage over MET Norway.

**Against it:** it requires an API key, and in a client-side app with no
backend that key ships inside the APK and is extractable. Unlike Open-Meteo's
flat fee, an abused key on a call-metered plan is a route to either a service
cut-off or a bill. Properly handled it needs a proxy Worker, which is work.

Its data model is also its own, so it carries the same rewrite cost as MET
Norway — without being free.

### Met Office — for the UK warnings only

Two routes, and the distinction matters:

- **RSS feeds.** The Met Office website terms say the RSS feeds are "free
  services offered by the Met Office for any purpose", with attribution
  required. They reserve the right to withdraw any feed at any time without
  notice. ⚠️ That terms page appears to be around 979 days old, so confirm it
  is current before relying on it.
- **Weather DataHub.** Commercial use allowed subject to licence, attribution
  "Powered by Met Office data" required. Free within usage limits; the Map
  Images product is free up to 1,000 images/day. Radar product pricing is not
  published — it needs a quote from `licensing@metoffice.gov.uk`.

**Keeping the Met Office warnings service is sound.** The brief's instinct here
is right.

**But there is an open question I cannot close:** the privacy policy says
warnings come from a Cloudflare Worker at
`blooming-weather-warnings.…workers.dev/api/warnings`, and that "how the Worker
obtains and handles that feed is governed by the service operator's
arrangements". I cannot see that Worker's code. **Where it gets Met Office
data from, and under which licence, is unverified.** If it scrapes an HTML page
rather than consuming the RSS feed or DataHub, that is a licensing problem
wearing a technical disguise. This needs checking before launch.

---

## The other external services

| Service | Commercial use | Key | Attribution | Risk |
|---|---|---|---|---|
| **OpenFreeMap** tiles | ✅ Allowed, free, unlimited views | None | **Required** — OSM credit is an ODbL condition, not optional | ⚠️ No SLA, "may discontinue at any time". Weak dependency for a paid feature — needs a fallback |
| **RainViewer** radar | ❌ **Free tier is personal/educational only** | — | Required | Commercial needs a bespoke deal. **Do not ship on the free tier** |
| **Nominatim** geocoding | ⚠️ Disputed; 1 req/sec; **no autocomplete**; a May 2026 policy change restricts AI-built platforms | None | ODbL | Not suitable for shipping place search |
| **Open-Meteo geocoding** | ❌ Free tier non-commercial | None | CC BY | Covered by the paid plan |
| **WeatherAPI search** | ✅ All plans | Yes | Unclear | Included if you take WeatherAPI |

**RainViewer is the one to watch.** If the Storm Tracker shows RainViewer radar
tiles on the free tier in a commercial app, that breaches their terms. It is
not currently in this branch's code, but it is named in the brief.

---

## What I recommend, in order

1. **Take Open-Meteo API Standard at €29/month.** Verify the price first. One
   hostname and one key; everything else keeps working. This is the single
   cheapest path from "not compliant" to "compliant".
2. **Keep the Met Office route for UK warnings**, but verify what the warnings
   Worker actually consumes and under what licence.
3. **Keep OpenFreeMap for tiles**, with attribution displayed, and accept it as
   a best-effort dependency. Have a fallback for when it is down.
4. **Do not ship RainViewer on the free tier.** Either leave radar out, or get
   a commercial quote from them.
5. **Revisit MET Norway later if cost ever matters.** It is a good provider and
   the migration is a sensible project — just not on the critical path to a
   first launch.

**Second choice, if you would rather not pay monthly:** WeatherAPI.com Starter
at $7/month solves forecasts *and* place search in one subscription with
commercial use explicitly allowed. It costs a data-layer rewrite and needs a
proxy Worker for the key, but it is cheaper and removes a provider.

---

## What I have not done

- **Not signed up for anything.** Creating an account means accepting terms,
  which is yours to do.
- **Not paid anything.**
- **Not changed any provider code.** The app is still on the Open-Meteo free
  tier, which is correct until a commercial licence is actually in place.
- **Not verified the €29 price**, because their site is unreachable from this
  environment.

## What I need from you

1. **Which provider** — my recommendation is Open-Meteo paid.
2. **Confirm the price** on their pricing page before paying.
3. **Where does the warnings Worker get Met Office data from?** This is the one
   licensing question I cannot answer without seeing its code.

---

**Sources:** MET Norway [Terms](https://docs.api.met.no/doc/TermsOfService.html) ·
[Licence](https://developer.yr.no/doc/License/) ·
[API home](https://api.met.no/) ·
[ToS revision 5 Nov 2026](https://api.met.no/blog/2026-11-05-service-distruptions-revised-tos) ·
[Locationforecast data model](https://docs.api.met.no/doc/locationforecast/datamodel.html) ·
[WeatherAPI.com](https://www.weatherapi.com/) ·
Met Office [website terms](https://www.metoffice.gov.uk/policies/tandc) ·
[RSS guidance](https://weather.metoffice.gov.uk/guides/rss) ·
[DataHub FAQs](https://datahub.metoffice.gov.uk/support/faqs) ·
[OpenFreeMap](https://openfreemap.org/) ·
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) ·
[RainViewer API](https://www.rainviewer.com/api.html)
