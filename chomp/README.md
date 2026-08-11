# Neon Chomp

A modern take on the maze chase everyone already knows how to play:
clear the pellets, dodge four ghosts, and get out of a squeeze with a
dash. No downloads, no account, no signal needed.

It's the classic 28×31 maze — 240 pellets, four power pellets, the side
tunnel, the ghost house — rendered as glowing neon and with a couple of
modern habits bolted on.

## What's different from the original

- **Dash.** A short burst of speed on a cooldown (Space, or the dash
  button on a phone). It's the difference between a dead end and an
  escape, and it's the only reason a pincer isn't automatically fatal.
- **Pellet chains.** Eat pellets back to back and a chain builds; the
  longer you keep it alive, the more each pellet is worth, up to ×5.
  Stopping to think costs you the multiplier, so the game rewards
  committing to a route.
- **A maze that reacts.** Screen shake, particle bursts, after-images
  behind a dash, and a colour scheme that shifts hue every level.
- **Synthesised sound.** Every effect — the pellet blip, the siren that
  tracks how much of the maze is left, the death slide — is generated with
  WebAudio at runtime. There are no audio files to download.
- **Built for a phone too.** Swipe anywhere on the board to turn, tap to
  dash, or use the on-screen pad. The board scales to whatever room the
  screen has.

## The ghosts

The four of them behave the way they always have, which is what makes the
maze readable once you know it:

| Ghost | Chases you by |
| --- | --- |
| Red | Heading straight for your tile |
| Pink | Aiming four tiles ahead of you, to cut you off |
| Cyan | Bouncing its target off the red ghost's position |
| Orange | Chasing until it gets close, then wandering to its corner |

They alternate between scattering to their corners and hunting you, and
they all reverse direction when the mood changes — the classic tell that
the chase is starting. A power pellet turns the loose ones blue and worth
200, 400, 800 and 1600 in a single burst; eat one and its eyes hurry back
to the house to be reborn.

## Controls

| | |
| --- | --- |
| Move | Arrow keys, WASD, swipe, or the on-screen pad |
| Dash | Space, tap the board, or the dash button |
| Pause | P or Esc |
| Mute | M, or the sound button |

## Scoring

- Pellet: 10 × chain multiplier
- Power pellet: 50 × chain multiplier
- Ghosts: 200 → 400 → 800 → 1600 within one power pellet
- Fruit (appears twice a level below the ghost house): 100 up to 5000 as
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
