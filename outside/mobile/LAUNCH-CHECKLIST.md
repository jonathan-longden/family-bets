# Blooming Weather — Google Play launch readiness

Status as of **25 November 2026**. Updated by Claude; `[ ]` items with a name
against them are waiting on Jonathan.

**Headline: the code is in good shape. The launch is blocked on three things —
a weather licence, a build that does not exist in this repository, and a
three-week Play testing runway that has not started.**

---

## ⏰ Start this first, it has a three-week clock on it

Google Play requires personal developer accounts created after 13 November
2023 to run a **closed test with at least 12 testers, opted in continuously
for 14 days**, before production access is granted. Review then takes roughly
another 7 days.

**That is about three weeks that no amount of engineering shortens.** Testers
who drop out before 14 days do not count, and a rejoiner restarts their clock,
so recruit 15 to be safe.

Nothing else on this list is on a longer critical path. If the account exists,
the tester list can start being gathered tonight.

---

## 🔴 Blocked — needs your decision

| # | Item | What is needed |
|---|---|---|
| 1 | **Weather data licence** | The app is on Open-Meteo's free tier, which does not permit commercial use. See `WEATHER-PROVIDER-DECISION.md`. **Recommendation: Open-Meteo API Standard, ~€29/month, one hostname and one key.** Verify the price yourself; I have not signed up or paid. |
| 2 | **Where is the AdMob / Premium build?** | Not in this repository, on any branch — I searched all 12. Not in any of your other GitHub repos either. The purchase Worker *is* deployed and responding, so something exists. Until I can see that code I cannot audit, test or merge it. |
| 3 | **What does the warnings Worker consume?** | The policy says UK warnings come from your Cloudflare Worker but not where the Worker gets them. If it scrapes a web page rather than using the RSS feed or DataHub, that is a licensing problem. |
| 4 | **RainViewer, if Storm Tracker uses it** | Their free tier is personal/educational only. Shipping it in a commercial app breaches their terms. Either leave radar out or get a quote from them. |

---

## ✅ Completed

| Item | Evidence |
|---|---|
| Weather provider research | `WEATHER-PROVIDER-DECISION.md` — MET Norway, Met Office, WeatherAPI, plus tiles, geocoding and radar audited against actual licence text |
| External service audit | Same document. RainViewer and Open-Meteo geocoding both flagged as not commercially usable on free tiers |
| Branch reconciliation | All 12 branches of `family-bets` and 10 other repos searched. **Only one real foundation exists**: `claude/weather-app-motivation-notifications-x24m6h`. Nothing would be lost by building on it, because there is nothing else to lose |
| Live API verified against real data | `LIVE-API-RESULTS.md` — London, Manchester, Nottingham. Parses, 15 days, correct timezones |
| Two storm defects found and fixed | Watch-with-no-reason; CAPE zero/absent conflation. Both covered by an 80-combination sweep |
| Licence guard reframed for commercial launch | Now checks the real invariant: ads/purchase code must not ship against the free weather tier. Verified it fails when it should |
| Target API level | **Already compliant.** Play requires API 36; project is `compileSdk 36`, `targetSdk 36`, AGP 8.13 |
| Support email | `weatherblooming@gmail.com` in `app.config.json` |
| Open-Meteo attribution | On the main weather screen, 16 assertions holding it there |
| Test suite | **461 passing, 0 failing** |

---

## 🟡 In progress / prepared, awaiting a blocker above

| Item | State |
|---|---|
| Privacy policy | Currently describes ads, Premium, map tiles and warnings that this branch does not implement. **Deliberately not reverted** — your launch plan says they are coming. It must not ship until the code matches. `BLOCKER-privacy-policy.md` |
| Play Data Safety answers | Drafted for the app as it exists, in `PLAY-LISTING.md`, with a clear second column for what changes when AdMob lands. Cannot be finalised until the ads build is visible |
| Store listing copy | Drafted in `PLAY-LISTING.md` |
| Versioning | `app.config.json` is the single source; build 8, version 1.0.0. `npm run config` propagates to nine files |

---

## ⬜ Not started — and honestly, not startable by me

These need a machine with the Android SDK, a physical device, or your Play
account. I have no Android SDK here, no emulator (no KVM) and no device.

| Item | Why I cannot, what you need |
|---|---|
| **Signed App Bundle (.aab)** | Needs the Android SDK and a keystore. **I must not create or handle your signing key** — that is yours alone, and losing it means never updating the app again. Instructions below |
| **Screenshots** | Needs the app running on a real screen |
| **Feature graphic** (1024×500) | Needs design work on a real render |
| AdMob banner + UMP consent testing | Needs the ads build and a device. Keep test ad units until you are ready |
| Premium purchase / restore testing | Needs Play Console, a licence tester account and a real device. **I have not tested a purchase and will not claim otherwise** |
| Purchase Worker verification | Needs the Worker's code and a real purchase token |
| Battery / performance profiling | Needs a device |
| Content rating questionnaire | Needs the Play Console. Guidance in `PLAY-LISTING.md` — note the swearing affects this |
| Trader status / DSA declaration | Needs the Play Console; it asks whether you are trading. **Selling a £4.79 purchase almost certainly makes you a trader in the EU**, which means publishing your name and address |

---

## What you need to do, in order

1. **Tonight if possible:** confirm your Play developer account exists, and
   start gathering 12–15 testers. The 14-day clock cannot start until they are
   opted in.
2. **Decide the weather provider.** Read `WEATHER-PROVIDER-DECISION.md`. If you
   agree with the recommendation, take Open-Meteo Standard — then tell me and
   I will make the code change, which is small.
3. **Point me at the AdMob/Premium build.** Another repo, a folder on your PC,
   Base44, wherever. Without it, items 2 and 4 above and most of the technical
   audit stay impossible.
4. **Find out what the warnings Worker fetches.** Its source, in your
   Cloudflare dashboard.

---

## Making the signing key — your job, not mine

I will not touch this. If the key leaks, anyone can ship a fake update; if you
lose it, you can never update the app again. Google Play App Signing reduces
but does not remove that.

On your machine, once, with the JDK that ships with Android Studio:

```
keytool -genkey -v -keystore blooming-weather-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then:

- Store the `.jks` and its passwords in a password manager, **not in the
  repository**. `.gitignore` should cover `*.jks` and `*.keystore` before you
  create it.
- Back it up somewhere that is not only your PC.
- Opt in to **Google Play App Signing** when you upload — it lets Google
  recover signing if you lose the upload key.

Build the bundle with:

```
cd outside/mobile
npm run build
cd android
./gradlew bundleRelease
```

Output lands at
`outside/mobile/android/app/build/outputs/bundle/release/app-release.aab`.

---

## Record of changes made tonight

| Change | File | Tests |
|---|---|---|
| Licence guard reframed for the commercial plan | `tests/web-app.cjs` | 461 pass; verified the new check fails when monetisation meets the free tier |
| SDK sweep no longer reads the privacy policy as code | `tests/web-app.cjs` | A policy describing a planned feature is documentation, not that feature shipping |
| Policy/code drift reported each run | `tests/web-app.cjs` | Prints what the policy claims that the code does not yet do |
| Provider research | `WEATHER-PROVIDER-DECISION.md` | n/a |
| This checklist | `LAUNCH-CHECKLIST.md` | n/a |
| Store listing and Data Safety draft | `PLAY-LISTING.md` | n/a |

**Nothing was deleted, reset or overwritten. No branch was merged. No money
spent, no account created, no terms accepted, nothing published.**
