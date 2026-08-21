# Defect Log

A screening tool for highway defects. Photograph one, score it on the risk
matrix, and the coordinates, the time and the measurements go with the
photograph rather than being written on a clipboard and matched up later.

It runs on a phone, installs to the home screen, and works with no signal.
Nothing leaves the device: there is no account, no upload and no server —
which also means nothing is backed up for you, so export at the end of a
round.

## What it does

- **Ties the photograph to a place.** The camera and the location are watched
  together, and the fix that was live when the shutter went is what gets saved
  — with its accuracy and its age. A defect photographed from a van at ±40 m,
  or tagged with a fix that was two minutes stale, is recorded as exactly
  that and flagged in the log. That is the gap most footage has.
- **Scores it against the matrix, not against a memory.** The 5×5 laminated
  card is on screen: impact down the side, probability across the top, tap the
  cell. The risk factor, the category and the response time come straight out
  of it.
- **Proposes a score, and shows its working.** A pothole detection model runs
  on the phone and finds the defect. From the outline's
  share of the frame and the surface you are on, the app proposes a cell,
  pre-selects it, and says in words what it based that on and how sure it is
  that the thing is a pothole at all. One tap on any other cell overrules it,
  and the entry records whether the score was the app's proposal or yours.
- **Never estimates depth from a picture.** It never did and it still doesn't.
- **Keeps hundreds of defects.** Entries live in IndexedDB with the
  photographs held as files rather than as text, so a full day of captures
  fits and the app tells you how much room is left.
- **Exports both ways.** CSV for the data and the coordinates, opened straight
  into a spreadsheet; JSON when you need the photographs to travel with it.

## Survey mode

The camera opens by itself when the app does. Tap **Start survey** and the
viewfinder takes the whole screen, the model watches it about once a second,
and anything it finds is photographed, scored and written to the log without
being asked. Mount the phone, drive or walk the road, and read the log
afterwards.

Some things about it are worth knowing before trusting it:

- **Entries are marked unconfirmed.** Nobody looked at them. They are saved as
  `survey, unconfirmed` and read that way in the log and the CSV, so they never
  pass for a category an inspector stood over. Treat them as a list of places
  to go and look.
- **It needs a stronger opinion than you do.** A find has to clear a higher bar
  than a deliberate capture before it is written down, because nothing is
  checking it.
- **The same hole is not logged fifty times.** One pothole stays in shot for
  many frames and, from a vehicle, many metres. A find within twenty metres of
  the last one logged is taken to be the same defect. With no GPS fix there is
  no distance to compare, so it falls back to time alone — cruder, and the app
  says so when it starts without a fix.
- **It stops when the app does.** A web page cannot hold the camera once it is
  not the app on screen; the browser suspends it. So the survey runs with the
  app open and the phone mounted, and ends rather than pretending to watch.
- **Full screen and landscape need a tap.** Browsers only grant either off a
  gesture, so the button is that gesture. The viewfinder fills the screen
  without it either way.

## Shadows

Tree shadows across a carriageway are what this model gets wrong, and it is
easy to see why: a dark irregular patch on tarmac is the thing it was trained
to find. Raising the confidence bar does not help, because the model is as sure
about the shadow as it is about the hole.

What separates them is not darkness, it is texture. **A shadow is the road with
the light turned down** — the same chippings, the same grain, scaled. A hole
breaks the surface: a rim, broken edges, loose material. So each find is
measured against the road immediately around it, and a patch that is
substantially darker but grained exactly like its surroundings is thrown out. A
long thin band, the shape a tree or a pole throws, is thrown out on shape alone.

On synthetic road, a dimmed patch scores 1.00 against its surroundings, a
broken-up hole scores 9.99, and a shallow worn hollow — the hardest real case —
scores 2.59, against a cut-off of 1.18. The margin is wide, but it is a filter
and not a cure, and it cuts both ways: **a real hole in deep shade looks smooth
and can be waved through as a shadow.** In a survey that is a miss. In a
deliberate capture the app says what it decided and leaves you free to score it
anyway.

## Teaching it

The app cannot teach the model. A model learns by being retrained on labelled
examples, and nothing in a web page can do that.

What it can do is keep the evidence. Any entry can be marked **Not a defect**:
it leaves the log — a thing you have said is not a defect must never read as
one — and is kept as a correction with its photograph. Corrections travel in
the JSON export, under `notDefects`, which is exactly what a retraining run
needs: examples of what the model called a pothole and a person did not.

Feeding them back is a job for Roboflow, not for this app: upload them to the
project as negative examples, train a new version, and change the model id in
`app.js`.

> The JSON export changed shape for this. It used to be a bare array of
> entries; it is now `{ "defects": [...], "notDefects": [...] }`. CSV is
> unchanged and still carries the defects only.

## What the photograph can and cannot tell you

This is the part to understand before trusting a proposed score.

The model is good at one thing: finding a pothole in a photograph and drawing
round it. It correctly finds nothing when you point the camera at your
dashboard.

What no single photograph can give you is **scale**. A small hole photographed
from close up fills the frame exactly like a large one photographed from
further back. The app's size band is therefore a proxy, and it is only worth
anything under the assumption printed on screen every time: that you are
standing over the defect with the phone pointed down, which is how these
photographs actually get taken. Photograph one from a van window and the
proposal is meaningless.

And a photograph says nothing at all about **depth**, the speed limit, the
traffic, the footfall, or whether the defect sits in the wheel track or the
gutter. Those are half of what probability means on the matrix. The app fills
that half from the surface type and the number of defects it can see, which is
a starting point and not a judgement.

So: the proposal exists to save you the tapping, not to make the decision. The
category it lands on drives a two-hour or one-working-day obligation, and the
app is explicit on screen that the cell wants checking before you save.

Detection runs on the phone. The model is downloaded once, on the first check,
and kept — so the first check needs a signal and none of the ones after it do.
Until it has run somewhere with a signal, the matrix is simply blank and you
score it yourself.

This is the second attempt. The obvious approach — post the photograph to the
hosted inference API — works from a terminal and cannot work from a web page:
the service answers, and the browser will not hand a page a reply from a
service that has not agreed to be read by one. That is not a bug to work
around. Running the model here instead means the only thing crossing the
network is the weights, once.

One thing was lost in the move. Running on the phone rules out segmentation —
the library carries detection architectures only — so the defect arrives as a
box round it rather than an outline. A box is generous around an irregular
hole, so the size band reads slightly high. The app says so on screen.

When a check fails, the panel says what went wrong: the service refused it
(with the status and whatever the server itself said), it timed out, or the
request never completed. That last one arrives as a bare error the browser will
not explain, so the app asks again with the reply waived — a request nothing
can be read out of. If that one comes back, the service is reachable and the
problem is that it will not let a web page read its answer; if it does not,
there is no route to the service at all. Two different problems that look
identical until something separates them. They are different problems with different fixes, and a screen that
collapses them into "the service did not answer" leaves you guessing at one the
server already explained.

## The matrix

Risk factor is impact × probability, and the category follows the number:

| Risk factor | Category | Response |
| --- | --- | --- |
| 25 | Emergency | 2 hours |
| 16–20 | Category 1 | 1 working day |
| 9–15 | Category 2 | 28 calendar days |
| 6–8 | Category 3 | 90 calendar days |
| Under 6 | Below threshold | No response category |

### How a cell gets proposed

The defect's share of the frame picks a band, and the surface adjusts it:

| Share of frame | | Carriageway | Footway / cycleway |
| --- | --- | --- | --- |
| under 2% | barely registers | 1 × 1 | 1 × 1 |
| 2–6% | small | 2 × 2 | 3 × 3 |
| 6–15% | moderate | 3 × 3 | 4 × 4 |
| 15–30% | large | 4 × 4 | 5 × 5 |
| over 30% | very large | 5 × 4 | 5 × 5 |

A footway counts for more because the same hole is a trip rather than a jolt,
and pedestrians use the whole width rather than two wheel tracks. Three or more
defects in one frame add a point of probability, on the grounds that a cluster
is harder to steer around. Everything else — depth, speed, volume — is yours.

## What gets recorded

Time, coordinates, GPS accuracy and fix age, defect type, surface, impact,
probability, risk factor, category, response time, whether the score was
yours, an app proposal you accepted, or an unconfirmed survey find, what the model saw (its confidence, the share of the
frame, how many defects), your notes, and the photograph.

Depth and "wider than a tyre" are no longer collected, and the Cat 1
escalation test that stood on them has gone with them. Entries saved before
that change keep their gauged depth, still show it in the log, and still export
it — the CSV carries those two columns for as long as any entry has one.

## Storage and export

Everything is on the one device, in that browser. Clearing the browser's site
data takes the log with it, and there is no copy anywhere else.

- **CSV** carries the data and the coordinates. It is written with a byte
  order mark so a road name with an accent in it survives being double-clicked
  into Excel.
- **JSON** carries the same fields plus the photographs, embedded, so one file
  is the whole round.

The detection model is a public one on Roboflow Universe
(`cvhelmet/cv-helmet-combined-dataset-rf4bc`, a single pothole class over 5,482
images), loaded by Roboflow's browser library, which is vendored at
`vendor/inference.es.js` rather than pulled from a CDN so that the app depends
on nothing but itself. It is six megabytes and is deliberately not precached:
the first visit should not pay for it before the camera opens.

The publishable workspace key is in the page source. It is meant to live in
client code and can do nothing but load models and run them.

An earlier build of this app kept its entries — photographs included — in
`localStorage`, which holds about five megabytes in total. Around the third or
fourth capture the write failed, the failure was swallowed, and the log looked
right until the app was next opened. Anything that build left behind is
imported the first time this one runs.

## Running it

A static page with no build step — open `index.html`, or host the folder
anywhere. It is part of the same site as [Family Bets](../), so if that is on
GitHub Pages this is already live at `/defects/`.

Two things need a secure address, which means https or `localhost`, not a file
opened off the phone: the camera and the location. Hosted, both work; opened
as a file, neither does, and the app says so rather than appearing to be
broken.

A service worker caches the app on first visit, so add it to the home screen
and it runs in a lay-by with no bars.

It goes to the network before the cache, so a deploy lands on the next load
rather than whenever the cache happens to turn over. Two things are needed for
that to be true and both were missing at first: the worker has to ask the
network with the browser's own cache bypassed, and it has to hand back a copy
the browser is not allowed to keep — otherwise the reply's `max-age` lets the
browser answer the load after next by itself, without the network and without
the worker, which never gets asked and never learns there is a new build.

The build is printed in the footer. If a fix is meant to be there and the
footer still shows the old one, that is the answer.

## What it is not

It is a screening aid. It detects a defect and proposes a score; it does not
measure anything, and it does not decide. A survey run is a list of places
worth looking at, not a set of findings. The photograph is what it sees, and a
photograph does not contain depth, scale, or how the road is used. Every entry
is still one you confirmed — the app records which scores were its own
proposals so that a later reader can tell the difference.
