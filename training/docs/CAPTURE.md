# What to photograph

## The highest-priority source, by a distance

**Frames from a phone mounted in a vehicle, driving.** Not because they are
easier to get, but because they are the only images that match what the
product actually sees:

- windscreen height, roughly 1.2–1.5 m, looking forward and slightly down
- the road filling the lower two thirds, sky and hedge above
- motion blur at speed, rain on the glass, wiper streaks, dashboard reflection
- a 2340×1080 frame **stretched into a 640 square**, which squashes a round
  pothole to roughly half as wide as it is tall

Every one of those is a property of the product. A model trained without them
is being trained for a photograph nobody will ever take.

Defect Log already records survey footage locally (Diagnostics → footage), so
the frames exist. Extracting them into `incoming/` is a manual export today,
and deliberately so — see the note at the foot of this page.

## The warning that applies to the September 2026 inspection photographs

The 16 photographs in `insp-2026-09-03`, `insp-2026-09-04` and
`insp-2026-09-07` are handheld inspection shots, and nearly every pothole in
them is **ringed in survey paint**.

That paint is a leak. Train on these as the bulk of the positive set and the
model learns *"a pothole is a thing with yellow marks round it"* — which is
true of every training image and false of every road the product will drive
down. It will then score beautifully on a held-out slice of the same
photographs and find nothing in the field.

They are still worth having, for three things:

1. **Labelling practice and rule-setting** — they are clear, well lit, and the
   edge cases (a run of connected edge failures; a patch that has itself
   failed) are visible enough to settle the rules on.
2. **Hard negatives** — the manholes, gully gratings, tar bands and completed
   patches in these frames are unmarked and perfectly usable.
3. **A small, capped share of the positives**, well under a fifth, mixed with
   real driving frames.

They are registered as `hold` in `sessions.csv` rather than assigned to a
split, precisely because that decision should be made deliberately. If they go
anywhere near `test`, the test set stops measuring the product.

Two further things about them: they are handheld at walking distance, so the
potholes are far larger in frame than a driving camera ever sees; and they
contain number plates and an identifiable person, which is the other reason
the image directories are not committed.

## The variation to chase

The dataset should be **difficult on purpose**. A set of obvious potholes in
good light produces a model that finds obvious potholes in good light, which
the current one already does.

**Defect:** small · large · shallow · deep · fresh with sharp broken edges ·
old with rounded worn edges · a single hole · a run of connected holes · one
that has opened inside an old patch

**Water and weather:** dry · wet surface · standing water in the hole ·
full puddle hiding the hole · raining · after rain with the road drying in
patches

**Light:** flat overcast · direct sun · deep shade under trees · dappled shade
(the hardest case — it looks exactly like a hole) · low sun casting long
shadows · dawn · dusk · headlights

**Position:** hard against the kerb · in the gully channel · in the wheel
track · in the centre of the lane · on the crown · at a junction mouth ·
partly under a parked car · entering the bottom of the frame

**Distance:** 2 m · 5 m · 10 m · 20 m and barely resolvable. Vary this
deliberately — it is what decides the range at which the survey is useful.

**Surface:** new blacktop · old oxidised grey · surface dressing with loose
chippings · concrete · block paving · a patchwork of previous repairs

**Road:** urban residential · estate roads · town centre · rural lane with no
markings · single-track with a broken edge · A-road at speed

**Camera:** different mount heights · different phones · zoom 1× and 2× ·
different windscreen angles

## What must also be in there

**Hard negatives — plan for roughly a third to a half of the set.** Images of
road with no pothole in them at all:

manholes · drain covers and gully gratings · completed square patches ·
tar-band crack sealing · cracking and crazing with nothing lost · shadows ·
dappled tree shade · puddles on sound road · wet patches · leaves · grit and
debris · oil stains · road markings and worn white line · rough surface
dressing · plain, sound, boring road

Boring road matters more than it sounds. Most of what the survey sees is
nothing at all, and a model that has never been shown "nothing" has no reason
to say so.

## Practical notes

- **Do not delete a frame because the model missed it.** That is the single
  most valuable image in the set — see [HARD_NEGATIVES.md](HARD_NEGATIVES.md).
- **Keep the original resolution.** The build resizes; the archive should not.
- **One road per session**, or a short contiguous stretch. Sessions are the
  splitting unit, so a session covering half the county cannot be held out
  cleanly.
- **Note the conditions** in `sessions.csv` — weather, light, surface, zoom.
  It costs a moment and it is the only way to answer "does it fail in the
  wet?" later.
- **Balance across sessions, not within one.** Thirty frames of one pothole is
  one example, not thirty.

## On automatic collection

Defect Log could save the frames it detects on, and the frames it was unsure
about, straight into this pipeline. That would be by far the fastest way to
fill the hard-negative side of the set.

**It has not been built, and will not be without asking.** It changes what the
app does with a user's camera, and that is a decision to make deliberately
rather than to find already made.
