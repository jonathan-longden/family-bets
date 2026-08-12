# Neon Chomp

A modern take on the maze chase everyone already knows how to play,
except you're a springer spaniel: fetch every bone in the maze without
being caught by the four cats. No downloads, no account, no signal
needed.

Underneath it's the classic 28×31 maze — 240 bones, four tennis balls,
the side tunnel, the cat basket in the middle — rendered as glowing neon
and with a couple of modern habits bolted on.

## What's different from the original

- **Bone chains.** Fetch bones back to back and a chain builds; the
  longer you keep it alive, the more each bone is worth, up to ×5.
  Stopping to think costs you the multiplier, so the game rewards
  committing to a route.
- **A maze that reacts.** Screen shake, particle bursts, and a colour
  scheme that shifts hue every level.
- **Synthesised sound.** Every effect — the pickup blip, the siren that
  tracks how much of the maze is left, the death slide — is generated with
  WebAudio at runtime. There are no audio files to download.
- **Built for a phone too.** Swipe anywhere on the board to turn, or use
  the on-screen pad — its keys are spaced apart so a thumb can't catch two
  at once. The board scales to whatever room the screen has.

## The cats

The four of them behave exactly like the ghosts they replace, which is
what makes the maze readable once you know it:

| Cat | Chases you by |
| --- | --- |
| Red | Heading straight for your tile |
| Pink | Aiming four tiles ahead of you, to cut you off |
| Cyan | Bouncing its target off the red cat's position |
| Ginger | Chasing until it gets close, then wandering off to its corner |

They alternate between scattering to their corners and hunting you, and
they all turn on their heel when the mood changes — the classic tell that
the chase is starting. A tennis ball sends the loose ones scattering, ears
flat and worth 200, 400, 800 and 1600 in a single burst; catch one and its
eyes hurry back to the basket to be reborn.

## Difficulty

Level 1 is deliberately gentle and every level tightens the screws, until
the ramp levels off around level 10. What changes:

| | Level 1 | Level 10+ |
| --- | --- | --- |
| Cat speed, relative to yours | 80% | 94% |
| Scared cat speed | 52% | 72% |
| Tennis ball lasts | 9s | 2s |
| Last cat leaves the basket after | ~20s | ~5s |
| Scattering to corners (safe) | 11s | 4s |
| Hunting you | 15s | 26s |

Your own speed barely moves — it's the gap between you and them that
closes. On level 1 you can simply outrun anything; by level 10 you only
stay ahead by taking corners better than they do, and the red cat finds an
extra gear once the maze is nearly clear.

## Controls

| | |
| --- | --- |
| Move | Arrow keys, WASD, swipe, or the on-screen pad |
| Pause | P or Esc |
| Mute | M, or the sound button |

## Scoring

- Bone: 10 × chain multiplier
- Tennis ball: 50 × chain multiplier
- Cats: 200 → 400 → 800 → 1600 within one tennis ball
- Treats (appear twice a level below the cat basket): 100 up to 5000 as
  the levels climb
- An extra life every 10,000 points

Your best score is kept in the browser, on that device.

## Running it

It's a static page with no build step — open `index.html`, or host the
folder anywhere. It's part of the same site as
[Family Bets](../), so if that's hosted on GitHub Pages this is already
live at `/chomp/`.

A service worker caches the whole game on first visit, so add it to your
home screen and it plays in flight mode.
