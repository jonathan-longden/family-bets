# Pigment

Colour by number, on a phone. Six pictures are built in, and any photo
already on the device can be turned into a seventh. No account, no
downloads, no signal needed.

Every square carries a number. Pick that number from the row of colours
along the bottom and the square is yours; squares waiting for the colour
in your hand are tinted, so you can see where to go next. Drag to fill a
run of them. Squares with a different number ignore you and say which
number they actually want.

## What's in it

- **Six pictures** — a hot air balloon, a rocket, a butterfly, a springer
  spaniel, a boat at sunset, and a cupcake. Between 1,150 and 1,280
  squares each, in 8 to 11 colours.
- **Your own photos.** Pick one and it's turned into a picture to colour
  in, here on the phone.
- **It keeps your place.** Progress is stored per picture, so you can put
  one down halfway through the sky and come back to it.
- **Finish one and you can save it** as a PNG.
- **Sound.** A pentatonic blip per square, a chime when a colour is
  finished, and a fanfare at the end — all synthesised, no audio files.
  The note button turns it off.

## The pictures aren't images

There isn't a single picture file in this folder. Each one is *drawn* by
`pictures.js` onto a grid of numbers using a handful of primitives —
ellipses, polygons, lines, a text-art stamp for eyes and beaks, and a
fold that mirrors the left half onto the right. A picture costs thirty
lines of code instead of a download, which is what keeps the whole app
smaller than one photograph.

It also means the artwork is exact. There's no resampling, no
anti-aliasing, and no palette drift: a square is one number, decided when
the picture is drawn, and it comes out identical on every device.

Colours that end up unused are dropped when a picture is built, so a
picture never offers a swatch with nothing to fill.

## Turning a photo into a picture

Choose a photo, how many colours (8–20) and how big (32–60 squares along
the longest side). What happens next is all local:

1. **Shrink it in halves.** Going straight from a 12-megapixel photo to
   44 squares makes some browsers point-sample it, which turns a face
   into confetti. Halving repeatedly averages instead.
2. **Find the colours** with k-means over the squares — started with
   k-means++ so the first guesses are spread out, which is what stops a
   photo of grass coming back as eight greens.
3. **Fold colours together.** The number you picked is a ceiling, not a
   quota: colours a person couldn't tell apart on a swatch are merged,
   and so are any covering less than half a percent of the picture.
   Nobody wants a colour worth three squares.
4. **Tidy stray squares.** A square outvoted by all four of its
   neighbours joins them — single specks are miserable to colour in and
   add nothing.
5. **Number by area**, so colour 1 is always the one there's most of.

Photos are never uploaded anywhere. They're read, converted and thrown
away in the page; only the finished grid of numbers is kept, which is a
couple of kilobytes.

## Getting around a picture

| | |
| --- | --- |
| Fill a square | Tap it, or drag across a run of them |
| Zoom | Pinch, double tap, or scroll wheel |
| Move around | Drag with two fingers |
| Pick a colour | Tap a swatch, or press 1–9 |
| Find a square | **Hint** — points at the nearest one waiting |
| Whole picture | **Fit** |

## What's stored on the device

Progress is one bit per square — a couple of hundred bytes a picture,
however long it took. Pictures made from photos are kept as the grid of
numbers plus their palette, up to 24 of them; the oldest drops off after
that. Everything lives in this browser on this device: there's no
account and nothing is sent anywhere. Clearing site data clears it all.

## Running it

A static page with no build step — open `index.html`, or host the folder
anywhere. It's part of the same site as [Family Bets](../), so if that's
on GitHub Pages this is already live at `/pigment/`.

A service worker caches the app on first visit, so add it to your home
screen and it opens in flight mode.
