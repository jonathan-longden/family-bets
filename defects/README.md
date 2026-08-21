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
- **Runs the Cat 1 escalation test in front of you.** Depth against the limit
  for the surface — 40 mm on a carriageway, 20 mm on a footway or cycleway —
  and whether it is wider than a tyre. Both limbs, stated separately, so an
  incomplete test reads as incomplete rather than as a pass.
- **Never estimates depth from a picture.** There is a field for a gauge
  reading and no way to guess one. Ungauged is saved as ungauged.
- **Keeps hundreds of defects.** Entries live in IndexedDB with the
  photographs held as files rather than as text, so a full day of captures
  fits and the app tells you how much room is left.
- **Exports both ways.** CSV for the data and the coordinates, opened straight
  into a spreadsheet; JSON when you need the photographs to travel with it.

## The matrix

Risk factor is impact × probability, and the category follows the number:

| Risk factor | Category | Response |
| --- | --- | --- |
| 25 | Emergency | 2 hours |
| 16–20 | Category 1 | 1 working day |
| 9–15 | Category 2 | 28 calendar days |
| 6–8 | Category 3 | 90 calendar days |
| Under 6 | Below threshold | No response category |

A defect under the threshold on the matrix can still be a Category 1 on the
escalation test — that is what the test is for, and why it sits on the same
screen.

## What gets recorded

Time, coordinates, GPS accuracy and fix age, defect type, surface, impact,
probability, risk factor, category, response time, gauged depth, whether it is
wider than a tyre, your notes, and the photograph.

## Storage and export

Everything is on the one device, in that browser. Clearing the browser's site
data takes the log with it, and there is no copy anywhere else.

- **CSV** carries the data and the coordinates. It is written with a byte
  order mark so a road name with an accent in it survives being double-clicked
  into Excel.
- **JSON** carries the same fields plus the photographs, embedded, so one file
  is the whole round.

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

It is a screening aid. It records what you confirmed on site — it does not
detect defects, measure them, or decide anything for you, and the category it
shows is the one your own numbers produce. Depth comes off a gauge or it is
not recorded.
