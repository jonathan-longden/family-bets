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
- **Proposes a score, and shows its working.** The photograph goes to a
  pothole segmentation model, which outlines the defect. From the outline's
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

Detection needs a signal. With none, the matrix is simply blank and you score
it yourself — everything else in the app still works offline.

When a check fails, the panel says which of three things went wrong: the
request never got a reply (no route, or a cross-origin refusal), the service
refused it (with the status and whatever the server itself said), or it timed
out. They are different problems with different fixes, and a screen that
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
probability, risk factor, category, response time, whether the score was the
app's proposal or yours, what the model saw (its confidence, the share of the
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
(`potdet/pothole-detection-o4ys9`), called with a publishable workspace key.
That key is meant to live in client code — it can run inference and nothing
else — but it is visible in this page's source, so anyone who finds it can
spend inference against the same workspace.

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

## What it is not

It is a screening aid. It detects a defect and proposes a score; it does not
measure anything, and it does not decide. The photograph is what it sees, and a
photograph does not contain depth, scale, or how the road is used. Every entry
is still one you confirmed — the app records which scores were its own
proposals so that a later reader can tell the difference.
