# Live Open-Meteo API verification

First end-to-end run of the weather app's own code against the real Open-Meteo
API. Every previous test used stubs; nothing in `outside/` had ever seen a live
response until this run.

- **Run at:** 2026-11-15T13:50:36Z (`now` epoch 1794750636)
- **Code under test:** `outside/weather.js`, `outside/voice.js`, unmodified
- **Branch of app code:** `claude/weather-app-motivation-notifications-x24m6h`
  (`outside/` is byte-identical on `claude/live-api-verification`, confirmed by
  `git diff --stat` returning empty, so the code tested is the app's code)
- **Cities:** London 51.5074,-0.1278 · Manchester 53.4808,-2.2426 ·
  Nottingham 52.9548,-1.1581
- **Node:** v22.23.4, `global.self = {}` then `eval` of the source file
- **No app code was changed.**

---

## VERDICT

**Yes — the app works against real Open-Meteo data.** All three cities returned
HTTP 200, and `W.parse` consumed every one of them without throwing: 432 hourly
entries, 18 daily entries, a populated `current` block, and exactly 15 forecast
days from `todayIndex` in each case, which is precisely what `renderDays` slices.
The two fields that had never been seen live — `cape` and
`freezing_level_height` — are both genuinely present in the hourly object and
both parse correctly. Timezone handling is right, including the epoch+offset
arithmetic, and geocoding resolves Nottingham to the correct English city.
Nothing is broken and nothing needs fixing to ship.

What the live data does expose is that two of the Storm card's design
assumptions do not hold for UK November, and one logic gap is now reachable.
`cape` is never null but never large either — the maximum across all 1,296
hours sampled was 110 J/kg, against gates of 500 and 800, so every
CAPE-driven branch in `stormRead` and the `unstable` cause are dormant in
practice. `freezing_level_height` is null for 296 of 432 hours and only
covers about 2.1 days ahead of the present, so the hail-plausibility context
mostly is not there. And London produced `level: "watch"` with `causes: []` —
a card that tells the user "SOMETHING IS BREWING UP THERE" and
"Mainly between 13:00 and 14:00" with a completely empty list of reasons,
on the evidence of 2.8 mm of rain in one hour. That is a real defect, found
only because real data landed in the 2–4 mm band that stubs never covered.
No thunder or hail codes (95/96/97/99) appeared anywhere, so the hail path
remains unexercised by live data.

---

## REACHABILITY

Direct curl probe, exactly as specified:

```
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m&timezone=auto"
200
```

Full app-built requests via `W.forecastUrl(place, 15)`:

| City | HTTP | Response bytes | `generationtime_ms` |
|---|---|---|---|
| London | 200 | 30,207 | 1.3130903244018555 |
| Manchester | 200 | 30,094 | 450.6615400314331 |
| Nottingham | 200 | 30,147 | 237.03336715698242 |

The URL the app actually builds (London), unmodified:

```
https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility,cape,freezing_level_height,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,sunrise,sunset,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max&wind_speed_unit=kmh&timezone=auto&timeformat=unixtime&past_days=3&forecast_days=15
```

Every field the app asks for came back. The raw `hourly` object contains exactly
the requested keys and no others:

```
time, temperature_2m, apparent_temperature, relative_humidity_2m,
precipitation_probability, precipitation, weather_code, wind_speed_10m,
wind_gusts_10m, visibility, cape, freezing_level_height, is_day
```

`hourly_units` confirms the units the app assumes: `wind_speed_10m` in `km/h`
(the `wind_speed_unit=kmh` parameter was honoured), `cape` in `J/kg`,
`freezing_level_height` in `m`, `visibility` in `m`, `time` as `unixtime`.

---

## PARSING

**`W.parse(json, {})` threw no error for any of the three cities.** There is no
verbatim error to report, because there was none.

| | London | Manchester | Nottingham |
|---|---|---|---|
| `parse` threw | no | no | no |
| `hours` length | 432 | 432 | 432 |
| `days` length | 18 | 18 | 18 |
| `current` block exists | yes | yes | yes |
| `offset` | 0 | 0 | 0 |
| `todayIndex` | 3 | 3 | 3 |
| **days from today inclusive** | **15** | **15** | **15** |

432 hourly entries = 18 days × 24 h. 18 daily entries = `past_days=3` +
`forecast_days=15`. `todayIndex` is 3 in every case, so
`forecast.days.slice(3)` yields 15 days — the app's `renderDays` loop
(`for (var i = start; i < forecast.days.length && shown < 15; ...)`) gets
exactly the 15 days it wants, with no short-fall and nothing left over.
**15 forecast days confirmed present for all three cities.**

Current conditions, as parsed:

| | London | Manchester | Nottingham |
|---|---|---|---|
| `current.temp` | **9.7 °C** | **6.3 °C** | **6.1 °C** |
| `current.feels` | 8.1 | 4.4 | 4.4 |
| `current.humidity` | 92 | 80 | 86 |
| `current.mm` | 0.2 | 0 | 0.2 |
| `current.code` | 53 (Drizzle) | 3 (Overcast) | 53 (Drizzle) |
| `current.wind` | 8.6 km/h | 2.5 | 1.4 |
| `current.gust` | 18.7 km/h | 5.8 | 3.2 |
| `current.day` | 1 | 1 | 1 |
| **today max / min** | **10.4 / 3.3** | **6.5 / 3.0** | **6.6 / 1.5** |

The raw `current` block carries `"interval": 900`, i.e. a 15-minute
observation window, and `time: 1794750300` — 13:45 local against a run at
13:50. `W.parse` reads it through `num(c, 'temperature_2m', true)` and the
direct-access path works correctly on a real object.

### Daily `precipitation_probability_max` nulls

The app deliberately keeps these null past the model's probability horizon
rather than flattening them to zero. Live data confirms the behaviour, and
confirms the horizon is longer than the ~7 days the code comments anticipate:

| City | Daily entries | Nulls | Raw array |
|---|---|---|---|
| London | 18 | **2** | `[0,0,0,90,54,87,55,37,8,23,35,31,31,35,28,33,null,null]` |
| Manchester | 18 | **2** | `[0,0,0,88,42,83,61,29,10,40,45,57,59,45,47,47,null,null]` |
| Nottingham | 18 | **2** | `[0,0,0,78,42,86,61,25,12,33,43,36,37,35,31,37,null,null]` |

Only the final two days are null — days 16 and 17 of 18, i.e. the last two
forecast days. `maybe()` preserved them as `null` in `days[].prob` in every
case (parsed null count matches the raw null count exactly, 2/2/2), so the
"nobody knows yet" distinction survives parsing as designed. The three leading
zeros are the `past_days=3` history, where a real zero is correct.

---

## CAPE AND FREEZING LEVEL

### `cape` — present, never null, and far too small to ever matter here

**`cape` is present in the raw hourly object for all three cities, is a proper
array, and contains zero nulls.** It is not absent and not all-null. But it
never comes close to the thresholds the app gates on:

| City | Present | Values | Nulls | Min | Max | Non-zero hours | `>= 500` | `>= 800` |
|---|---|---|---|---|---|---|---|---|
| London | yes | 432 | **0** | 0 | **110** | 90/432 | **0** | **0** |
| Manchester | yes | 432 | **0** | 0 | **40** | 73/432 | **0** | **0** |
| Nottingham | yes | 432 | **0** | 0 | **50** | 55/432 | **0** | **0** |

First 12 raw values, London: `[0,0,0,0,0,0,0,0,0,0,0,10]`.
Parsed `hours[].cape` matches the raw array exactly in all three cities
(432 numeric, 0 null), so `maybe()` is passing the values through intact.

**This is the loud part.** `cape` is not missing — the opposite, it is fully
populated — but across 1,296 live UK hours the highest value seen was
110 J/kg. The app's gates are:

- `cape >= 800 && prob >= 40` → score 35
- `cape >= 500 && prob >= 30` → score 20
- `maxCape >= 500` → the `unstable` flag and the
  `'The air is unstable enough to turn showery.'` cause

**None of these can fire on this data.** The maximum observed is 110, which is
5.5× below the lower gate. Both CAPE branches in `stormRead` and the entire
`unstable` cause are dormant for UK locations in November. This is not wrong —
the thresholds are meteorologically reasonable, and 0–110 J/kg genuinely is a
stable winter atmosphere — but it means the Storm card's instability path is
untested by live data and will stay silent outside summer convective season.
Anyone reasoning about the Storm card's behaviour should treat the CAPE
branches as effectively unreachable most of the year.

A related wrinkle: `W.storm` returns `cape: maxCape > 0 ? maxCape : null`, and
the comment says null means "the model never offered a CAPE at all". Live data
makes that conflation visible — Manchester and Nottingham both got
`storm.cape: null` not because CAPE was absent but because all twelve hours in
the window were a genuine, model-supplied `0`. London got `storm.cape: 110`.
So in practice `null` here means "offered, and it was zero", which is the
opposite of what the comment claims. Harmless today, because nothing renders
the number, but the semantics are not what the code says they are.

### `freezing_level_height` — present but null for 296 of 432 hours

| City | Present | Values | **Nulls** | Numeric | Min | Max |
|---|---|---|---|---|---|---|
| London | yes | 432 | **296** | 136 | 760 m | 2,820 m |
| Manchester | yes | 432 | **296** | 136 | 510 m | 2,320 m |
| Nottingham | yes | 432 | **296** | 136 | 510 m | 2,280 m |

First 12 raw values, London: `[2210,2260,2360,2320,2240,2020,2020,1910,1740,980,1580,910]`.
Parsed `hours[].freeze` again matches raw exactly (136 numeric / 296 null).

The nulls are **not scattered — they are one contiguous tail.** In all three
cities, identically:

- last numeric index: **135**
- first null index: **136**
- every value from index 136 to 431 is null (verified: `true`)
- index 136 is **16:00 on 17 Nov** local

So `freezing_level_height` covers only the first 5.67 days of the 18-day
window. Because 3 of those days are `past_days` history, **only about 51 of
the 347 hours ahead of the present moment carry a value — roughly 2.1 days
of forward coverage.** Beyond that the app has no freezing level at all.

The field is only ever used as hail-plausibility context, and the code already
treats null as "nobody said", so nothing breaks. But the practical effect is
that for ~85% of the forecast window the app is working without it, which is
worth knowing before any feature is built on top of it.

---

## WEATHER CODES SEEN

Every distinct hourly `weather_code` across all three cities (1,296 hours
total = 3 × 432):

| Code | Meaning (app's `CODES` table) | Count |
|---|---|---|
| 0 | Clear | 312 |
| 1 | Mostly clear | 89 |
| 2 | Partly cloudy | 97 |
| 3 | Overcast | 458 |
| 51 | Light drizzle | 221 |
| 53 | Drizzle | 56 |
| 55 | Heavy drizzle | 22 |
| 61 | Light rain | 21 |
| 63 | Rain | 4 |
| 80 | Showers | 16 |

Per city:

- **London** — `0:103, 1:31, 2:35, 3:143, 51:87, 53:17, 55:1, 61:3, 63:1, 80:11`
- **Manchester** — `0:122, 1:15, 2:21, 3:146, 51:78, 53:24, 55:13, 61:7, 63:1, 80:5`
- **Nottingham** — `0:87, 1:43, 2:41, 3:169, 51:56, 53:15, 55:8, 61:11, 63:2` (no code 80)

### Thunder and hail codes

| Code | Count |
|---|---|
| **95** (thunderstorm) | **0** |
| **96** (thunderstorm with slight hail) | **0** |
| **97** (not in the app's table) | **0** |
| **99** (thunderstorm with heavy hail) | **0** |

**No thunder or hail code appeared anywhere in 1,296 live UK hours.** Every
code returned is in the app's `CODES` table, so `W.sky`/`W.family` resolved
all of them — there were no unknown codes to fall through. But it means the
hail path (`W.hasHail`, codes 96/99 only) and the thunder path are entirely
unexercised by this live data. The code comment's claim that "only models with
an explicit hail forecast emit those, so in much of the world this is always
false" is consistent with what we see: a mid-November UK sample emits none of
them. Whether the UK model ever emits 96/99 cannot be settled from this run —
it needs a summer convective day to test.

Note that code 97 is not present in the app's `CODES` table at all. It did not
appear here, so nothing broke, but if the API ever emits it, `W.sky` would fall
through to its default rather than naming it.

---

## STORM OUTPUT PER CITY

`W.storm(parsed, Math.floor(Date.now()/1000))`, full result.

### London — `watch` with no causes

```
level:           "watch"
score:           25
causes:          []            <-- EMPTY
from:            1794747600    (13:00 local)
to:              1794751200    (14:00 local)
thunder:         false
thunderNow:      false
hail:            false
rain:            false
wind:            false
unstable:        false
cape:            110
timeline length: 24
```

12-hour window, hour by hour:

```
 13:00  score=25  mm=2.8  gust=19.4  prob=90  cape=0    thunder=false hail=false
 14:00  score=0   mm=0.7  gust=18.4  prob=85  cape=0    thunder=false hail=false
 15:00  score=0   mm=0    gust=20.5  prob=76  cape=110  thunder=false hail=false
 16:00  score=0   mm=0    gust=25.6  prob=60  cape=20   thunder=false hail=false
 17:00  score=0   mm=0    gust=22    prob=39  cape=10   thunder=false hail=false
 18:00  score=0   mm=0.1  gust=24.8  prob=25  cape=0    thunder=false hail=false
 19:00  score=0   mm=0.5  gust=24.8  prob=25  cape=0    thunder=false hail=false
 20:00  score=0   mm=0.4  gust=22.7  prob=32  cape=0    thunder=false hail=false
 21:00  score=0   mm=0    gust=25.6  prob=35  cape=0    thunder=false hail=false
 22:00  score=0   mm=0    gust=23.8  prob=28  cape=0    thunder=false hail=false
 23:00  score=0   mm=0    gust=26.6  prob=18  cape=0    thunder=false hail=false
 00:00  score=0   mm=0.8  gust=28.1  prob=10  cape=0    thunder=false hail=false

window maxima: maxMm=2.8  maxGust=28.1  maxCape=110
```

The single hour at 13:00 scored 25 via the `h.mm >= 2` rung. 25 ≥ 20, so
`stormLevel` returns `watch`. But every cause gate sits higher or elsewhere:
`maxGust` 28.1 is below the 55 wind gate, `maxMm` 2.8 is below the 4 mm rain
gate, there is no thunder or hail, and the `unstable` fallback needs
`maxCape >= 500` against an actual 110. So the level is raised and **not one
cause is generated**. See PROBLEMS FOUND.

### Manchester — `clear`

```
level:           "clear"
score:           0
causes:          []
from:            null
to:              null
thunder:         false
thunderNow:      false
hail:            false
rain:            false
wind:            false
unstable:        false
cape:            null          (all 12 window hours were a real 0)
timeline length: 24

window maxima: maxMm=1.0  maxGust=25.6  maxProb=88  maxScore=0
```

Correct and self-consistent: an overcast, drizzly, still day with 88%
precipitation probability but only 1 mm an hour at worst and gusts under
26 km/h. Nothing reaches even the lowest 18-point rung. Empty causes are
right here, because the level is `clear`.

### Nottingham — `clear`

```
level:           "clear"
score:           0
causes:          []
from:            null
to:              null
thunder:         false
thunderNow:      false
hail:            false
rain:            false
wind:            false
unstable:        false
cape:            null          (all 12 window hours were a real 0)
timeline length: 24

window maxima: maxMm=1.5  maxGust=32.8  maxProb=78  maxScore=0
```

Also correct. Peak gust 32.8 km/h is below the 45 rung; peak 1.5 mm is below
the 2 mm rung.

`timeline` length is 24 in all three cities, matching `STORM_TIMELINE`, and
`W.hoursFrom` returned a full 24 forward hours from a 432-hour array without
running short.

---

## TIMEZONE

All three cities returned the same zone, as expected in November:

| City | `timezone` | `timezone_abbreviation` | **`utc_offset_seconds`** |
|---|---|---|---|
| London | Europe/London | GMT | **0** |
| Manchester | Europe/London | GMT | **0** |
| Nottingham | Europe/London | GMT | **0** |

London's first three hourly timestamps, converted with the app's own approach
(`W.at(t, offset)` = `new Date((t + offset) * 1000)`, read with UTC getters via
`W.clock`):

| Epoch | `W.clock(t, 0, false)` | 12-hour | Day |
|---|---|---|---|
| 1794441600 | **00:00** | 12am | Thursday 12 Nov |
| 1794445200 | **01:00** | 1am | Thursday 12 Nov |
| 1794448800 | **02:00** | 2am | Thursday 12 Nov |

**These are sensible on-the-hour local times: midnight, 1am and 2am on
Thursday 12 November** — the first hour of the `past_days=3` history window,
exactly where a 3-day history should start relative to a 15 November run. All
24 of the first day's timestamps land on `:00` minutes (verified: `true`).

The three hours around the moment of the run, which is what the user actually
sees, also read correctly — London: 13:00 (9.2 °C, code 63), 14:00 (9.9 °C,
code 53), 15:00 (10.3 °C, code 3), against a run at 13:50 local.

### Supplementary: the offset arithmetic is not actually exercised by the UK

Worth flagging, because a "confirmed" here would otherwise be misleading:
`utc_offset_seconds` is **0** for all three cities in November, so
`new Date((t + 0) * 1000)` read with UTC getters is the identity function.
The UK in winter cannot prove the offset path works. I ran two extra
locations purely to exercise it — these are **not** part of the requested
scope and no app code was changed to do it:

| Place | `timezone` | Offset | First 3 hourly local | Today sunrise / sunset |
|---|---|---|---|---|
| London | Europe/London | 0 s (0 h) | 00:00, 01:00, 02:00 (12 Nov) | 07:18 / 16:11 |
| Sydney | Australia/Sydney | **+39,600 s (+11 h)** | 00:00, 01:00, 02:00 (13 Nov) | 05:43 / 19:37 |
| Denver | America/Denver | **−25,200 s (−7 h)** | 00:00, 01:00, 02:00 (12 Nov) | 06:44 / 16:44 |

Both a large positive and a negative offset produce midnight-aligned local
hours and plausible sunrise/sunset times, and both parse to 15 days from
`todayIndex`. The epoch+offset-with-UTC-getters approach is sound. Sunrise and
sunset also arrive as unix integers under `timeformat=unixtime` and
`stamp()` passes them through correctly (London raw
`1794727113`/`1794759068` → 07:18/16:11, which is right for mid-November
London).

---

## GEOCODING

```
W.searchUrl('Nottingham')
→ https://geocoding-api.open-meteo.com/v1/search?name=Nottingham&count=6&language=en&format=json
```

- **HTTP status: 200**
- Response size: 2,181 bytes
- Results returned: 6 (matching `count=6`)

**First result:**

```json
{
  "id": 2641170,
  "name": "Nottingham",
  "latitude": 52.9536,
  "longitude": -1.15047,
  "elevation": 46,
  "feature_code": "PPLA2",
  "country_code": "GB",
  "timezone": "Europe/London",
  "population": 323632,
  "country": "United Kingdom",
  "admin1": "England",
  "admin2": "Nottingham"
}
```

**name `Nottingham`, lat `52.9536`, lon `-1.15047`** — the English city, ranked
first ahead of the three US namesakes, which is the correct ordering for a UK
user. The remaining results were Nottingham NH (43.11453,-71.09978),
Nottingham MD (39.364,-76.45218) and Nottingham PA (39.74844,-76.01856).

The returned lat/lon differs very slightly from the 52.9548,-1.1581 used for
the forecast tests above (about 1 km), which is immaterial.

---

## TEST SUITE

```
cd outside/mobile && npm install && node tests/web-app.cjs
```

Final line, verbatim:

```
453 passed, 1 failed

failures:
 - no advertising, analytics or tracking SDK anywhere in the app — got ["privacy.html: admob"], wanted []
```

**The suite does not pass.** It was expected to, so this is a finding. The
failure is reproducible — identical output on two consecutive runs — and is
**unrelated to the live API work**: no app code was modified in this
verification, and `outside/` is byte-identical between
`claude/live-api-verification` and
`claude/weather-app-motivation-notifications-x24m6h`, so the failure is
pre-existing on the app branch.

Cause: the test at `outside/mobile/tests/web-app.cjs:1637` scans the lowercased
text of the app's files for vendor names and asserts no hits. The most recent
commit on the app branch, `1a1c9f2 "Update privacy policy disclosures"`, added
prose about AdMob to `outside/privacy.html` — seven mentions, at lines 68, 125,
129, 131, 132, 133 and 135, e.g.:

```
The app includes the Google Mobile Ads SDK through the Capacitor AdMob plugin.
```

The scan is a plain substring match, so a privacy policy *describing* AdMob
trips a test designed to catch AdMob being *loaded*. The two adjacent
assertions still pass — `and nothing is loaded from anybody else servers`
(no off-site `script`/`iframe`/`img`/`stylesheet`) and `the native plugins are
only the capabilities the app uses` — so no tracker is actually present in the
web app. It is a test-vs-disclosure collision, not a privacy regression. Fixing
it is a judgement call for whoever owns that test (exclude `privacy.html` from
the text scan, or scan only executable files) and I have not touched it.

---

## PROBLEMS FOUND

**1. A `watch` level can render with zero causes, and London did exactly that.**
This is the one genuine logic defect the live run exposed. The score ladder in
`stormRead` has a rung at `h.mm >= 2` → score 25, but the cause ladder in
`W.storm` has no rain cause below `maxMm >= 4`. Any window whose worst hour is
2–4 mm of rain, with gusts under 55 km/h, no thunder, no hail and CAPE under
500, therefore scores 20–44, crosses the `watch` threshold at 20, and generates
no cause at all. London hit this precisely: 2.8 mm at 13:00, everything else
quiet.

The card the user sees in that state, with the real text from `voice.js`:

```
status:  "KEEP AN EYE ON IT"
line:    "SOMETHING IS BREWING UP THERE."
when:    "Mainly between 13:00 and 14:00."
why:     (empty <ul> — storm.causes is [])
foot:    "From the forecast, not live radar. Check an official warning before travelling."
```

`renderStorm` shows `stormWhen` whenever `level !== 'clear' && storm.from`, so
the time range appears; `storm.causes.forEach` over an empty array leaves the
"why" list blank. The app raises an alarm, puts a time on it, tells the user to
check an official warning, and then offers no reason — on the evidence of a
single hour of ordinary November rain. For an app whose stated principle is
that "the numbers underneath are straight", asserting "something is brewing"
with an empty explanation is the failure mode most at odds with its own design.
The gap is in the band 20 ≤ score < 45; the `gust >= 45` rung at score 18
correctly stays below `watch`, so wind does not have the same hole.

**2. `cape` is populated but never large enough to reach any gate.** Max 110
J/kg across 1,296 live UK hours, against gates of 500 and 800. Both CAPE rungs
in `stormRead` and the `unstable` cause are unreachable on this data. Not a
bug, but it means the Storm card's instability reasoning is dead weight outside
summer, and it has still never been exercised by real data.

**3. `storm.cape`'s null no longer means what its comment says.** The code
returns `maxCape > 0 ? maxCape : null` with a comment explaining that null
means "the model never offered a CAPE at all". Live data shows CAPE is always
offered and frequently a real `0`, so Manchester and Nottingham both returned
`cape: null` from a fully-populated field. Nothing renders this value today, so
there is no user-visible effect, but the invariant the comment asserts is false.

**4. `freezing_level_height` covers only ~2.1 days ahead.** Null for 296 of
432 hours in all three cities, as one contiguous tail starting at index 136
(16:00 on 17 Nov). Because 3 days of the window are history, only ~51 of the
347 hours ahead of the present carry a value. The app's null handling is
correct and nothing breaks, but any future use of this field should assume it
is absent for most of the forecast.

**5. No thunder or hail codes in the live sample.** Codes 95/96/97/99 appeared
zero times in 1,296 hours, so the thunder and hail paths — including
`W.hasHail`, the `thunderNow` logic and the `hail` cause — got no live
coverage. Whether the UK model ever emits 96/99 is still unknown and needs a
summer convective day to establish.

**6. Code 97 is missing from the app's `CODES` table.** It did not appear in
this sample, so nothing fell through, but `W.sky` has no entry for it should
the API emit it.

**7. The test suite has one pre-existing failure** (`privacy.html: admob`),
detailed in TEST SUITE above. Unrelated to the API; caused by the most recent
commit on the app branch adding AdMob prose to the privacy policy, which a
substring-based tracker scan reads as a tracker.

### Not problems

For completeness, these were checked and are correct: `W.parse` threw for
nobody; 15 forecast days present for all three cities with `todayIndex` 3;
`current` block present and read correctly through the direct-access `num`
path; `wind_speed_unit=kmh` honoured; daily probability nulls preserved as
null rather than zero (2 per city, the last two days only); all returned
weather codes resolvable by `W.sky`/`W.family`; timestamps on-the-hour local
and offset arithmetic correct for positive, negative and zero offsets;
sunrise/sunset parse correctly from unixtime; geocoding returns the English
Nottingham first; `timeline` length 24 and `hoursFrom` never ran short.
