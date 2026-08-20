# Pigment

Colour by number, on a phone. Six pictures are built in, and any photo
already on the device can be turned into another. No account, no
downloads, no signal needed.

Each picture is a set of outlined areas, and every area carries one
number. Pick that number from the row of colours along the bottom and
tap: the whole area fills at once. Areas waiting for the colour in your
hand are tinted, so you can see where to go next, and dragging fills
every waiting area the finger passes over. An area with a different
number ignores you and says which number it actually wants.

## What's in it

- **Six pictures** — a hot air balloon, a rocket, a butterfly, a springer
  spaniel, a boat at sunset, and a cupcake. Between 30 and 80 areas each,
  in 14 to 17 colours.
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
   with. Nothing survives that can't hold its own number.
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

## The pictures aren't images

There isn't a picture file in this folder. Each one is *drawn* by
`pictures.js` onto that grid using a handful of primitives — ellipses,
polygons, lines, a text-art stamp for eyes and beaks, and a fold that
mirrors the left half onto the right. A picture costs a few dozen lines
of code instead of a download.

They're authored on a grid of about 32×40 units but drawn four times
finer than that, which is what turns a staircase of squares into a
curve. The same drawing code would give a coarser or finer picture just
by changing that one number.

## Turning a photo into a picture

Choose a photo, how many colours (8–20) and how big (80–180 squares
along the longest side). What happens next is all local:

1. **Shrink it in halves.** Going straight from a 12-megapixel photo to
   120 squares makes some browsers point-sample it, which turns a face
   into confetti. Halving repeatedly averages instead.
2. **Find the colours** with k-means, started with k-means++ so the first
   guesses are spread out — which is what stops a photo of grass coming
   back as eight greens.
3. **Fold colours together.** The number you picked is a ceiling, not a
   quota: colours a person couldn't tell apart on a swatch are merged,
   as is anything covering less than a sixth of a percent of the
   picture.
4. **Tidy stray squares**, then cut the result into areas exactly as
   above.
5. **Number by area**, so colour 1 is always the one there's most of.

A photograph of foliage — about the worst case there is — comes out as a
few hundred areas in under half a second. Photos are never uploaded
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
