# Blocker: the privacy policy describes an app this branch is not

**Raised 15 November 2026. Nothing has been changed to fix it — this needs a
decision, not a guess.**

Commit `1a1c9f2` ("Update privacy policy disclosures", 13 November) rewrote
`outside/privacy.html`. The new policy describes advertising, a paid Premium
tier, map tiles and a warnings service. **None of that exists in this
repository, on any branch.**

The test suite is currently **red** because of it.

---

## What the policy now claims

| Claim in `privacy.html` | In the code? |
|---|---|
| Google AdMob via the Capacitor AdMob plugin, Android Mobile Ads SDK 25.4.0, iOS SDK 13.11.0 | **No** |
| Google UMP consent flow, privacy-options control in Settings | **No** |
| Premium, £4.79 one-time purchase, product ID `blooming_weather_premium` | **No** |
| Google Play Billing, purchase tokens, Restore Purchases | **No** |
| Purchase verification Worker at `blooming-weather-purchases.…workers.dev/verify` | **No** |
| Met Office warnings Worker at `blooming-weather-warnings.…workers.dev/api/warnings` | **No** |
| Storm Tracker map using OpenFreeMap tiles at `tiles.openfreemap.org` | **No** |

Verified by grepping the whole of `outside/` (excluding `privacy.html` itself,
`node_modules` and generated copies) for: `admob`, `advert`, `in-app`,
`purchase`, `premium`, `billing`, `map tile`, `4.79`. Only hits were the About
text saying the app has **no** advertising and **no** analytics.

Also checked every branch on the remote — `main`, `new-session-4swdoc`,
`family-bets-task-flmg6n` and the rest. **No branch in this repository
contains AdMob.**

## What the rewrite got right

Not all of it is wrong, and this part should survive whatever is decided:

- The browser-geolocation caveat is **more honest than what it replaced**:
  `enableHighAccuracy: false` asks for a lower-accuracy fix but does not
  guarantee only coarse location is given. True, and the old wording glossed
  over it.
- The import caveat is **accurate**: the settings import at `app.js:1409`
  accepts a JSON file whose places can carry more than four decimal places,
  and the app uses them as imported.
- Naming `api.open-meteo.com` and `geocoding-api.open-meteo.com` explicitly is
  an improvement on "the weather service".

## Why this matters more than a wrong document

1. **It contradicts what Open-Meteo were told.** Free API use was confirmed in
   writing on the basis of no advertising, no in-app purchases, no paid
   features and no analytics — see `OPEN-METEO.md`. A policy describing AdMob
   and a £4.79 purchase describes an app that does **not** qualify.
2. **Google Play's Data Safety form must match the policy.** Filing one that
   matches this text, for a build with no ads in it, is a false declaration.
3. **It is a public promise about data.** It tells users an advertising SDK is
   processing their IP address and device identifiers. For this build, that is
   not true.

## The three possibilities

1. **There is another build, elsewhere**, with ads and Premium in it, and this
   policy belongs to that. Then the policy is fine — but it is on the wrong
   branch, and this branch needs its own accurate one.
2. **The features are planned, not built.** Then the policy is premature and
   must not ship until they exist.
3. **It was committed here by mistake.** Then it should be reverted, keeping
   the three genuine improvements listed above.

## What has deliberately not been done

- The policy has **not** been rewritten or reverted. If possibility 1 is the
  real one, stripping the advertising sections would destroy a correct
  document.
- The failing test has **not** been weakened. It is red for a true reason.
  `the conditions the licence rests on` sweeps shipped files for advertising,
  analytics and billing SDK names, and it is doing exactly its job:

  ```
  ✗ no advertising, analytics or tracking SDK anywhere in the app
      — got ["privacy.html: admob"], wanted []
  453 passed, 1 failed
  ```

**Nothing should be merged or submitted to either store until this is
settled.**
