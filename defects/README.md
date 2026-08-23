# Defect Log

A screening tool for highway defects. It opens on the camera, watches the road
while you drive or walk it, and writes down what it finds with the coordinates
and the time already attached — rather than a clipboard, a memory and a folder
of photographs to be matched up afterwards.

It runs on a phone, installs to the home screen, and works with no signal.
Nothing leaves the device: there is no account, no upload and no server —
which also means nothing is backed up for you, so export at the end of a
round.

## The shape of it

There is one screen: the road. The viewfinder is the app, not a tab inside it,
and it comes up looking at the road the moment the app opens — no start screen,
nothing to dismiss.

- **One round button** starts and stops the survey. That tap is also the
  gesture a browser demands before it will give a page the whole screen and
  lock it to landscape, so both are taken with it rather than hidden behind a
  control nobody would find with a phone on a windscreen mount.
- **It is landscape, whatever the phone thinks.** The manifest declares it, the
  orientation lock is asked for on load, and the first touch anywhere is spent
  on full screen and the lock rather than waiting for the record button. When
  all of that is refused and the viewport still comes up portrait, **the app
  turns itself** — see below. There is no portrait layout to fall back to.
- **Three dots, top right** open everything else: the defect log, the map, the
  surface you are surveying, full screen, and stopping the camera. They are the
  only thing on the glass that is always tappable.
- **The log and the map come up over the road**, not instead of it. Closing one
  is a single tap and the camera never stopped, which is the difference between
  a layer and a tab.

There is no shutter. Nothing is photographed by hand any more: the survey takes
the picture when it finds something, and a person's job is to open the entry
afterwards and either sign it off or put it right.

## What it does

- **Ties the photograph to a place.** The camera and the location are watched
  together, and the fix that was live when the find was written down is what
  gets saved — with its accuracy and its age. A defect logged from a van at ±40 m,
  or tagged with a fix that was two minutes stale, is recorded as exactly
  that and flagged in the log. That is the gap most footage has.
- **Scores it against the matrix, not against a memory.** The 5×5 laminated
  card is on the confirm screen: impact down the side, probability across the
  top, tap the cell. The risk factor, the category and the response time come
  straight out of it.
- **Proposes a score, and shows its working.** A pothole detection model runs
  on the phone and finds the defect. From the outline's
  share of the frame and the surface you are on, the app proposes a cell and
  writes the entry with it. Open the entry to confirm it and the proposal is
  pre-selected with, in words, what it was based on and how sure the model was
  that the thing is a pothole at all. One tap on any other cell overrules it,
  and the entry records whether the score was an accepted proposal or yours.
- **Never estimates depth from a picture.** It never did and it still doesn't.
- **Keeps hundreds of defects.** Entries live in IndexedDB with the
  photographs held as files rather than as text, so a full day of finds fits
  and the app tells you how much room is left.
- **Exports three ways**, from the menu rather than from under the log: CSV for
  the data and the coordinates, opened straight into a spreadsheet; JSON when
  you need the photographs to travel with it; GeoJSON to drop the located
  defects onto someone else's map.

## Turning the app instead of the phone

A web page cannot make a phone rotate. The orientation lock needs full screen,
full screen needs a gesture, and a phone locked to portrait in its own settings
overrules all of it. So when the viewport comes up portrait anyway, the app is
turned rather than the phone: one CSS transform on the element everything sits
inside.

That one element does the whole job because a transform makes it the containing
block for the `position: fixed` layers inside it — the viewfinder, the menu, the
sheets and the photo viewer all turn together and keep stacking in the order
they already had. The right way up it carries no transform at all, so nothing
about the normal case changes.

**The picture does not turn with it.** The camera already hands over a frame the
right way up for how the phone is being held — the browser orients it — so
turning it again along with everything else spins it away from the world. Rotate
a screenshot of that until the buttons read correctly and the ceiling ends up at
the bottom. So inside the turned wrapper the video cancels its parent's rotation
and is sized to the physical screen rather than to the turned box it sits in.
The chrome turns; the road does not.

Two things this deliberately does not touch:

- **What the model sees.** The video element is measured in its own pixels, so
  the frame handed to the model is the camera's, turned or not. A CSS transform
  cannot reach it.
- **Sizes written in `vh` and `vw`.** Inside the turn those still measure the
  phone's real screen, not the turned container — a menu capped at `100vh` ran
  off the side of a 412-tall box. Anything that has to fit the turned app is
  written in percentages, which resolve against the containing block and so are
  right both ways round.

## Recording

Tap the round button. The model starts watching the picture about once a
second, and anything it finds is photographed, scored and written to the log
without being asked. A clock counts the run and a tally counts what has been
logged. Mount the phone, drive or walk the road, and read the log afterwards.

Some things about it are worth knowing before trusting it:

- **Set the surface before you set off.** Every find is recorded against it,
  and it changes the score — the same hole on a footway is a trip rather than a
  jolt. It is one setting, shared with the confirm screen: set it in the menu,
  or tap the chip on the glass to flip it mid-run.
- **Entries are marked unconfirmed.** Nobody looked at them. They are saved as
  `survey, unconfirmed` and read that way in the log and the CSV, so they never
  pass for a category an inspector stood over. Treat them as a list of places
  to go and look.
- **It needs a strong opinion.** A find has to clear a higher confidence bar
  than the model's own floor before it is written down, because nothing is
  checking it at the time.
- **The same hole is not logged fifty times.** One pothole stays in shot for
  many frames and, from a vehicle, many metres. A find within twenty metres of
  the last one logged is taken to be the same defect. With no GPS fix there is
  no distance to compare, so it falls back to time alone — cruder, and the app
  says so when it starts without a fix.
- **It stops when the app does.** A web page cannot hold the camera once it is
  not the app on screen; the browser suspends it. So the survey runs with the
  app open and the phone mounted, and ends rather than pretending to watch.
- **Full screen needs a tap, and any tap will do.** Browsers only grant it off
  a gesture, so the first touch anywhere is spent on it. The viewfinder fills
  the screen without it, so a browser that refuses is not an error worth
  interrupting a run over.
- **The model is already there.** It used to be fetched on the first record
  tap, which put a several-megabyte download between someone parking at the top
  of a road and starting. It is now fetched the moment the app opens, and a chip
  by the camera state says whether it is loading, ready, or would not come.

## The frame the model is shown

The model is handed a 640 by 640 square, stretched, because that is what it was
trained on — and because a phone-shaped frame turned out to break the boxes
coming back from it. On a 1920 by 1080 frame a returned box measured 3145 by
5234: bigger than the picture, and wrong by 1.6 across and 4.8 down. A single
wrong scale is wrong by the same factor both ways, so two different factors
means width and height are being scaled by each other's axis — invisible while
the input is square and ruinous the moment it is not.

The square also puts the boxes, the shadow test and the share of the frame in
one coordinate space, which removes a rescaling step that used to sit between
them.

One thing to know if you compare old entries with new: the share of the frame
is now measured against that square rather than against the camera's own
dimensions. Stretching preserves proportions, so a defect covers the same
fraction either way — but a box measured in one space and divided by the other
does not, which is what the older numbers were.

## Not knowing means not knowing

A find is believed only once every part of it has been checked: a class the app
has a type for, a box with a real position and a real size, and a share of the
frame that is a fraction between nought and one. Anything failing that is
dropped, not repaired, and if a frame produces results but none of them survive,
the app says so and writes down nothing.

This is here because of what happened without it. A survey returned twenty
results a frame carrying scores of 1.004 — and once 5,323,169.5, which is not a
confidence — and no measurable boxes. The share came out as not-a-number, every
comparison against not-a-number is false, and the band lookup ended with "return
the largest band". So an unmeasurable nothing scored impact 5, probability 4,
gained a point for being one of several, and was written into the log as an
**Emergency requiring attention within two hours**. Five of them, including a
photograph of the inside of a van.

The failure was not the model's. The app turned "I could not measure this" into
the most serious category it has, silently, in a tool whose output is a response
time. Every entry now carries the box it was measured from, so a wrong one can
be taken apart afterwards rather than guessed at.

### Why the numbers came back wrong

The library ships a decoder per architecture. `YOLOv11` is a subclass of
`YOLOv8` that overrides only the **input** side: YOLOv8 feeds the model
`[1, 3, 640, 640]` (channels first), YOLOv11 feeds `[1, 640, 640, 3]` (channels
last). It inherits YOLOv8's **output** handling unchanged — and that handling
transposes the result on the assumption of a channels-first output, which is the
one that goes with a channels-first input.

Running the library's own decoder arithmetic over both layouts settles what that
costs:

| Output layout | Decoder reads | Scores |
| --- | --- | --- |
| `[1, 6, 8400]` channels-first | 8400 boxes × 2 classes | 0.0025 – 0.83, all inside 0–1 |
| `[1, 8400, 6]` channels-last | **6 boxes × 8396 classes** | up to **599**, mostly outside 0–1 |

Read the wrong way round, the four box numbers of each row become the "boxes"
and everything after them becomes 8,396 "class scores" to take a maximum over —
so the score is really a pixel coordinate, which is why confidences came back in
the hundreds. The boxes still look plausible, because raw pixel coordinates
divided by 640 land in a believable range. That is why it was believed: a
detection with a sensible-looking outline and a nonsense confidence.

An entry logged that way is in the log at the top of this README's cautionary
tale: a living room, scored Category 2, on a 28-day clock.

So the model is a **yolov8n**, not a yolo11n — the change is about the library,
not the data. Both were fine-tuned from COCO on the same 17,497-image, two-class
version; only the architecture differs, and yolov8 is the one whose input and
output layouts the decoder agrees on.

The version still carries the yolo11n model too, which is why the app names the
yolov8n one exactly rather than asking for whatever is deployed on version 1.

The transcribed arithmetic is kept as a test so this stays a finding rather than
a memory.

It is a short run — 50 epochs rather than the default 300 — deliberately.
Epochs do not change how a model's output is laid out, so a long run would have
proved nothing about decoding that a short one does not. Now that the path is
proven, a longer run is worth having and costs only time.

### What model this actually is

The library picks its decoder from one field in the model's metadata, inside a
worker with no way to see in. That made every decoding fix a guess checked
against a screenshot. It does not have to be: the metadata is a plain GET, so
when something has already gone wrong the app fetches the same document and
says what the library will have made of it — the model type Roboflow reports and
the decoder class that type selects. It goes on screen and into the JSON export
under `model.roboflow`.

The dispatch table is copied out of the library's own bundle, which is not ideal
but beats guessing. One thing it makes visible: there is a case for `yolov11`
and none for `yolo11`, so a model whose type is spelled without the `v` is
refused outright rather than mis-decoded — worth being able to read rather than
infer.

Nothing is asked for while the app is working. A run that logs cleanly spends no
request on this.

### When it says the output is unusable

It also says what came back: how many results, which keys they carried, the
range of the confidences, and how many had a box that could be measured. The
same summary, the frame size, and one result verbatim go into the JSON export
under `lastUnusableOutput`, alongside the model id and the build.

That is there because the shape the library builds is fixed — class, confidence,
bbox — so when the numbers inside it are wrong, it is the model's output layout
that does not match what the library expects. Which model to try instead is a
guess, and every guess otherwise costs a deploy and a drive. The ranges say
which.

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
and can be waved through as a shadow.** That is a miss, and the survey says on
screen when it has thrown something out as a shadow rather than doing it
quietly.

## Ironwork

The model knows two things: potholes and manholes. The second matters because
of what it is **not** — a sound cover is part of the road, not a defect. Its
value is negative: knowing a dark round thing is a cover is what stops it being
written down as a hole, which is what the previous single-class model did every
time.

So ironwork is recognised and passed over. A survey does not log it — one that
wrote down every manhole it drove over would bury the finds that matter — and
says so on screen when it does, so a cover you know is rocking does not simply
vanish without comment. Whether a cover is sunken, proud, rocking or cracked is
decided on site and is not in the photograph, so a defective one is a job for a
person standing over it, not for this.

## Confirming an entry

Everything the survey writes down is a machine's opinion, and the log says so:
`survey, unconfirmed`, a dashed border, and one orange **Confirm** button. That
opens the photograph, the matrix with the proposed cell already selected, what
the model said at the time, and what was recorded about the fix. Accept the
cell and the entry reads `app proposal, accepted`; tap a different one and it
reads `inspector`. Either way it stops being unconfirmed, and the GeoJSON
export carries `confirmed: true` so an asset system can filter on it before
anything starts a statutory clock.

Confirming is the only way an entry becomes a person's judgement. That is
deliberate: there is no longer a path that produces a signed-off score without
someone having looked at the photograph.

## Putting an entry right

The model has one class, so everything it finds is offered as a pothole. An
inspection cover, a gully grate or a worn joint is a real defect in the wrong
words — deleting it loses a defect, so entries can be amended instead. **Amend**
sets the type and the surface, marks the entry as amended, and where the score
was the app's proposal rather than yours, moving it between surfaces re-scores
it. A score you chose is yours and is left alone.

Four things can be done with an entry, in rising order of finality: confirm it,
amend it, mark it as not a defect (which keeps it as a correction), or remove it
outright.

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
app is explicit on the confirm screen that the cell wants checking before it is
signed off.

Detection runs on the phone. The model is downloaded once, as the app opens,
and kept — so the first opening needs a signal and none of the ones after it
do. The chip by the camera state says where that got to. Until it has loaded
somewhere with a signal, recording says the model is unavailable and logs
nothing.

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

## Three-word addresses

A what3words key ships with the app, so every located entry picks up a
three-word address as it is logged. It is looked up once, when the entry is
written, because the address of a fixed point never changes.

**The address is shown in place of the coordinates**, in the log and in the map
popup, because it is the thing a person reads out on a radio or types into a
van's satnav — six decimal places of latitude is not. The coordinates are still
what is stored and what every export carries; they are simply not the useful
thing to put on screen. Accuracy stays alongside it either way, because how well
the fix is known is not a detail. An entry logged before the lookup could run,
or with no signal, still shows its coordinates.

That key is readable by anyone who opens the source. That is not a slip; it is
what putting a key in a static site means, and what3words is metered and paid.
The protection has to be at their end: **restrict the key to this domain in the
what3words dashboard**, and a copy of it is worth nothing anywhere else. The
field in the log stays for that reason too — paste a different key over it to
bill another account, or clear it to stop the lookups and keep coordinates
only. An emptied field is treated as a decision and stays empty; it does not
quietly revert to the built-in key on the next load.

The lookup needs a signal, which coordinates do not, so it is never allowed to
hold up or fail a save: the entry is written first and the words are added
afterwards if they arrive.

## The map

**Map** in the menu puts every located defect on one. Pins are coloured by category,
and a survey find nobody has confirmed is drawn hollow rather than filled — a
map that showed a guess and a judgement as the same mark would be worse than no
map. Tap one for its category, type, surface, coordinates, three-word address
where there is one, and when it was logged.

Leaflet is vendored, so the map is part of the app and runs with no signal. Its
tiles are not: they come from OpenStreetMap as you pan, and are cached as they
arrive. Ground you have already looked at stays available offline; ground you
have not comes up blank until there is a signal. The app says so on the screen
rather than leaving you to wonder why a map is empty in a lay-by.

## what3words

Off unless you turn it on, because it is a paid service and the key is yours,
not the app's. Get one at developer.what3words.com and paste it into the field
at the bottom of the log; it stays on the device. With no key nothing changes
and entries carry coordinates as they always did.

The lookup happens once, when an entry is saved: a three-word address for a
fixed point never changes, so there is nothing to refresh and no reason to spend
a call on it twice. It needs a signal, which coordinates do not, so it is never
allowed to hold up or fail a save — the entry is written first and the words are
added afterwards if they arrive. Entries already in the log are left as they
are; only new ones are looked up.

Addresses show in the log, in a pin's popup, and in a `what3words` column in the
CSV.

## Storage and export

Everything is on the one device, in that browser. Clearing the browser's site
data takes the log with it, and there is no copy anywhere else.

- **CSV** carries the data and the coordinates. It is written with a byte
  order mark so a road name with an accent in it survives being double-clicked
  into Excel.
- **JSON** carries the same fields plus the photographs, embedded, so one file
  is the whole round.
- **GeoJSON** is for handing to an asset management system — Causeway Alloy
  takes it, so does anything else with a map in it. Only entries with a location
  can go in one, and the app says how many that leaves out before you export.

  Every feature carries `confirmed`. **Filter on it before any of this reaches a
  system that starts a response clock**: a defect record commits somebody to a
  working day, and an unconfirmed survey find is a machine's guess that nobody
  has stood over. Photographs are not in a GeoJSON; the JSON export has those.

  On the two things that are easy to get wrong here: coordinates are written
  longitude first, as the spec requires — the other way round puts every defect
  in the sea off Somalia without complaining — and properties are flat scalars,
  because a nested object is what makes a GIS import quietly drop a column.

The detection model was trained for this app: `yolo11n` over 17,497 images
forked from `pothole-model-for-zed-cameras/pothole-fine-tuning-ghl9u`, two
classes, `pothole` and `manhole`. The architecture was picked for the decoder
rather than for accuracy — the browser library ships a yolov11 decoder, and the
public model that came before it returned confidences of 1.004 and 5,323,169.5
because its head was one the library could not read. It is loaded by model id
rather than by project and version, so there is no question which model of the
several on a version is being asked for. The library is vendored at
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
