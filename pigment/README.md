# Pigment

Colour by number, on a phone. Eleven pictures are built in, and any photo
already on the device can be turned into another. No account, no
downloads, no signal needed.

Each picture is a set of outlined areas, and every area carries one
number. Pick that number from the row of colours along the bottom and
tap: the whole area fills at once. Areas waiting for the colour in your
hand are tinted, so you can see where to go next, and dragging fills
every waiting area the finger passes over. An area with a different
number ignores you and says which number it actually wants.

## What's in it

- **Eleven pictures** — a hot air balloon, a rocket, a butterfly, a
  springer spaniel, a boat at sunset, a cupcake, a desert at sundown, an
  old teddy, a lighthouse at night, a hat and boot left by a crate out
  west, and a stadium under floodlights. Between 96 and 302 areas each, in
  23 to 45 colours.
- **Your own photos.** Pick one and it becomes a picture to colour in,
  worked out here on the phone.
- **It keeps your place**, picture by picture, so you can put one down
  halfway through the sky and come back to it.
- **Print it** to colour in on paper — the print dialogue is also where
  "save as PDF" lives — or save a finished one as a PNG, or the outlines
  as an SVG that can be blown up to any size.
- **Sound.** A pentatonic blip per area, a chime when a colour is
  finished, and a fanfare at the end — all synthesised, no audio files.

## How a picture becomes areas

Underneath, a picture is a grid of colour numbers. `regions.js` turns
that grid into the shapes you actually colour in:

1. **Join up** every run of touching squares of the same colour. Squares
   that touch only at a corner count as separate shapes, because that is
   how anyone looking at them would read it.
2. **Absorb the specks.** An area too small — or too *thin*, which is not
   the same thing: a one-square ring around an eye can be large and still
   be invisible — is given to whichever neighbour it shares the most edge
   with.

   How small is too small depends on where the picture came from. In a
   drawn picture a small area is there on purpose — a star, a stitch, a
   lamp in a floodlight — and merging it away means the finished colouring
   is missing what the picture was drawn with. In a photograph a small
   area is usually noise, and keeping it means a hundred specks nobody
   wants to fill in. So drawn pictures are cut finer than imported ones.

   This is worth watching when drawing: the stadium's crowd was first
   drawn as six hundred individual specks. It looked right and coloured in
   it wasn't there at all — every speck was smaller than the smallest area
   worth giving a number to, so the lot got merged back into the stand.
   It's patches now, which is what a crowd is from that far away anyway.
3. **Walk the edges** to get closed loops of points, one for the outside
   of the area and one for each hole.
4. **Cut the loops into arcs** that run from one meeting point to the
   next. This is the part worth knowing about: an arc belongs to exactly
   two areas, and it is tidied up *once* and shared. Simplifying each
   area's outline on its own would let two neighbours disagree about the
   line between them and open a white gap along it.
5. **Straighten and round.** Douglas–Peucker takes the staircase of
   squares back to a slope; Chaikin's corner cutting rounds what's left
   into a curve. Points on the very edge of the picture are pinned, so
   the picture keeps its own square corners.
6. **Find where the number goes.** Not the centre — the middle of a
   crescent is outside it — but the point furthest from any edge, found
   with a chamfer distance pass.

The outlines are real vector paths, which is why the picture stays sharp
however far you zoom in, and why it can be saved as an SVG.

The drawing is done once into an off-screen copy and then blitted, so
dragging a finger across a picture doesn't mean re-drawing hundreds of
outlines sixty times a second. Zoomed out, that copy is the whole
picture; zoomed right in, keeping the whole picture at that sharpness
would run to tens of megabytes, so it covers the part on screen plus a
margin and is redrawn when the view wanders out of it.

## The pictures aren't images

There isn't a picture file in this folder. Each one is *drawn* by
`pictures.js` onto that grid using a handful of primitives — ellipses,
polygons, lines, a text-art stamp for eyes and beaks, and a fold that
mirrors the left half onto the right. A picture costs a few dozen lines
of code instead of a download.

They're authored on a grid of about 32×40 units but drawn five times
finer than that, which is what turns a staircase of squares into a curve
and gives the shading room to fall in bands rather than steps. The same
drawing code would give a coarser or finer picture just by changing that
one number.

### Light, rather than flat colour

The detail in a picture comes from shading, so a colour in the palette
isn't usually one colour: it's a **ramp**, written once and turned into a
run of tones. Shadows lean towards a cold blue and highlights towards a
warm white, the way they do in daylight — a ramp made by turning the
brightness up and down alone comes out looking like plastic.

Shapes are then *lit* rather than filled. `sphere` works out how squarely
each square faces the light from where it sits on the ball, and picks the
tone to match; `gradient` runs a ramp along a line. That is what makes
the balloon look inflated, the cherry look like fruit, and the sky sit
behind everything else instead of beside it.

The balloon's envelope shows why it's worth the trouble: its five gores
are shaded as parts of *one* ball rather than five stripes shaded
separately, which is the difference between a balloon and a deckchair.

### Texture, or why flat tone bands look like cut paper

Shading alone gives smooth, plastic-looking surfaces. Real leather, rock,
sand, water and plush are *mottled*, and it is that mottling — as much as
the light — that makes a drawn surface read as a material.

`noise` is ordinary value noise: a fixed random number at every whole
coordinate, blended smoothly in between, summed at halving scales so the
result has broad patches and fine grain together. Any shading function
can add a little of it. The teddy's pile is noise stretched wider than it
is tall, so it lies one way; the hat's felt is finer and fainter; the
sea's swell is long and low, which gives water its light and dark without
drawing a single wave.

Two details that matter more than they sound:

- A brightness below zero means **leave this square alone**, which is how
  a cloud gets a ragged edge instead of the outline of the ellipse it was
  drawn inside.
- Scattered things — rocks, tufts, sprinkles — are only put down where
  the surface underneath is the one they belong on. Skip that and the
  rocks land on the hat.

## Turning a photo into a picture

Choose a photo, how many colours (8–30) and how much detail (80–240
squares along the longest side). What happens next is all local:

1. **Shrink it in halves.** Going straight from a 12-megapixel photo to
   120 squares makes some browsers point-sample it, which turns a face
   into confetti. Halving repeatedly averages instead.
2. **Find the colours** with k-means, started with k-means++ so the first
   guesses are spread out — which is what stops a photo of grass coming
   back as eight greens.
3. **Fold colours together.** The number you picked is a ceiling, not a
   quota: colours a person couldn't tell apart on a swatch are merged,
   as is anything covering less than a sixth of a percent of the
   picture. "Couldn't tell apart" is judged with the channels weighted
   by how much of a difference the eye actually sees — plain RGB
   distance reckons two greens are further apart than they look, and a
   dark blue and a dark green closer.
4. **Tidy stray squares**, then cut the result into areas exactly as
   above.
5. **Number by area**, so colour 1 is always the one there's most of.

A photograph of foliage at the finest setting — about the worst case
there is — comes out as about 600 areas in under half a second, and a
tap on one of them takes two milliseconds. Photos are never uploaded
anywhere: they're read, converted and thrown away in the page, and only
the finished grid is kept, which is a couple of kilobytes.

## Getting around a picture

| | |
| --- | --- |
| Fill an area | Tap it, or drag across several |
| Zoom | Pinch, double tap, or scroll wheel |
| Move around | Drag with two fingers |
| Pick a colour | Tap a swatch, or press 1–9 |
| Find an area | **Hint** — outlines the nearest one waiting |
| Whole picture | **Fit** |

Numbers appear once an area is big enough on screen to read one, so
zooming in brings out the small ones.

## What's stored on the device

Progress is one bit per area — a few dozen bytes a picture, however long
it took. Pictures made from photos are kept as their grid of numbers
plus a palette, up to 24 of them; the oldest drops off after that.
There's no account and nothing is sent anywhere, so clearing site data
clears it all.

## Running it

A static page with no build step — open `index.html`, or host the folder
anywhere. It's part of the same site as [Family Bets](../), so if that's
on GitHub Pages this is already live at `/pigment/`.

A service worker caches the app on first visit, so add it to your home
screen and it opens in flight mode.
