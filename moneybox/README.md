# Ten a Win

A moneybox with a rule: **Arsenal win, ten pounds goes in.**

It reads the results itself, so there is nothing to remember on a Sunday
night. Open it and the trophy is already heavier — or it isn't, and you know
why.

It runs on a phone, installs to the home screen, and the trophy itself works
with no signal. Reading the scores needs one.

## The shape of it

One screen. The trophy and the figure at the top — the cup fills with what you
have saved, towards a target where you have set one and through the current
hundred where you have not — the next fixture under it with the tenner already
riding on it, and the ledger below: every match the trophy has read, what it
was worth, and whether the money has actually moved.

- **Check for wins** reads the results feed and banks anything new. It also
  happens on its own when you open the app, when you come back to it, and
  every so often while it is in front of you.
- **Mark moved** is for the manual way of doing this: you have shifted the
  money into savings yourself, and the trophy should stop nagging.
- **Add by hand** is there for when the feed is down, the match was a friendly
  it does not carry, or you simply want to put a tenner in.
- **Take some out** takes money back out and says what for. The trophy keeps
  the line either way, so the history stays honest.

## What counts as a win

Two things about a results feed cost real money if you get them wrong, and
both are handled here rather than hoped about.

**A score is not a result.** Feeds carry live scores as happily as final ones,
so a trophy that trusted the first 1-0 it saw would bank a tenner at half
time and keep it when the match finished 1-2. A match only counts once it is
finished: by its own status where the feed gives one, and otherwise by the
clock — two and a half hours after kick-off, which is late enough for injury
time and a slow update.

**A win pays once.** Every match carries an id, and the trophy remembers the
ids it has banked. Opening the app fifty times on a Sunday night reads the same
win fifty times and banks it once. Deleting a line forgets its id too, so a
line removed by mistake comes back on the next check rather than being lost
for good.

Draws and losses are recorded as £0 lines. They are not clutter: without them
the win streak would count wins either side of a thrashing as consecutive.

## The table

Under the next fixture there is the league table, the whole of it, laid out on
the page and read by scrolling the page — the gesture a phone is actually good
at. **Show less** shrinks it back to a scrolling box about ten rows tall if
you would rather have the screen; the choice is remembered. The followed club
is highlighted either way, and pulled into view when the card is the short
one.

**The table is added up here from the league's own results**, not taken from
the published standings. Those standings are maintained separately and lag —
a Saturday of football can still be missing from them on Sunday, which makes
the card wrong exactly when someone looks at it. The results are the same feed
the trophy already trusts to bank a win, and three points for a win is not a
calculation worth outsourcing: every finished match in the season is counted
into played, goals for and against, and points, and the same rule as the
trophy decides what "finished" means, so a match kicking off later tonight
cannot creep in. The standings are still the fallback for when the results are
not available, and the card says which of the two it is showing, and when it
was read.

Two things the results cannot tell you, so the league's club list is read
alongside them and kept for a week — asked for three ways, because the free
key does not answer all of them, and the published standings answer last but
most reliably: stale on points, which does not matter here, and complete on
membership and badges, which is all that is wanted from them. The reasons: a club that has not kicked a ball yet
appears in no result — which is how a twenty-club division renders as sixteen
rows on the opening weekend — and no result carries a badge. Everyone in the
division goes into the table first on nothing, and the results are added on
top.

**The fixtures decide who is in the league, and nothing else gets a vote.** A
club with a league fixture is in the league: that comes from the same list the
results come from, so it cannot import somebody else's division. The season
feed on the free key returns played matches only, so a round and the next
fixtures are read alongside it to reach the clubs who have not kicked off yet,
with the same event arriving twice dropped on its id rather than counted
twice.

The lists of "all the teams in a league" are asked for after that and only to
fill in whoever the fixtures still have not named, and to supply badges. None
of them is believed on its own: a candidate list is scored against the clubs
the fixtures already named, and one that barely overlaps them is somebody
else's division and is thrown out whole — which is what a Premier League table
with Stockport County in it costs, one comparison. The same test is applied to
a list already kept on the phone, so a wrong one cannot survive into the next
read.

Cup ties go for the same reason: an event naming another competition is not a
league match, however much it was worth to the trophy.

Positions are worked out here in both cases — points, then goal difference,
then goals scored. If the new season has not kicked off yet there is nothing
to add up, so the season before is fetched instead and the card says which
season it is showing.

It is read alongside the results and then kept, so it draws instantly on the
next open and still draws with no signal at all — an hour-old league table is
a league table, which is not true of an hour-old score. A check that banks a
result re-reads it, since that result has just moved somebody. Following a
club in another league switches the table with it.

## The noise it makes

A win is worth hearing. The app fires a **cannon** — a burst of noise pushed
through a closing filter for the powder, a sine dropping an octave and a half
underneath it for the weight, and three notes over the top so it reads as a
celebration rather than an explosion. It is built by the phone at the moment
it is needed, so it adds nothing to the download and works with no signal.

If you would rather hear something else, **Settings → The noise it makes →
Play my own sound** takes an audio file you already have on the phone. It is
kept on the device in IndexedDB and played from there: it is never uploaded,
never sent to the bank link, and never leaves the phone. Only the first 45
seconds are played, and then it fades — a moneybox that plays a whole song
every time Arsenal beat Fulham gets turned off by February — so trim the clip
to the part you want before you choose it. No music is shipped with this app;
whatever you point it at is your own copy of your own file.

Two limits worth knowing. A sound can only be played while the app is open,
because a page that is shut gets no time to run. And phones will not make a
sound until the person has touched the screen, so a win found on the way in
is held and fired on your first tap rather than being swallowed.

## Moving the money

The app does not move money, and after trying every way a page can, that is a
decision rather than a shortfall. A browser will not let a page call a bank at
all — Starling refuses it outright — and a page that is shut cannot notice
that Arsenal have won in the first place.

So the trophy keeps the count and you make the transfer. When there is
something owed, the second button on the trophy card reads **I've moved £10**:
move it into your space or pot however you normally would, tap that, and the
trophy stops asking. Individual lines have a **Moved** button of their own if
you would rather tick them off one at a time.

If you ever do want it done for you, [`worker/`](worker/) still holds a
Cloudflare worker that pays into a Starling space on a schedule, with the token
living on Cloudflare rather than on the phone. It is about ten minutes of
setting up, and nothing in the app depends on it.

## How the money actually moves

A web page has no way into a bank account. Anything that claims otherwise is
really talking to something else that does — so this one talks to something
else that does, and it is something you own.

**Left alone, the trophy keeps score.** It tells you what has gone in and how
much of that you have not moved yet. Plenty of people want no more than that.

**Wired up, it fires the money.** In Settings there is a *bank link*: the
address of a webhook. Every win posts to it, and the automation on the other
end moves the money.

The usual way to build that end, no code involved:

1. In IFTTT (or Zapier, or Make), create an automation triggered by
   **Webhooks — receive a web request**. Name the event, e.g. `arsenal_win`.
2. Give it an action from your bank's own connector — Monzo's *Deposit into a
   pot* is the obvious one, but any "move money to savings" action works.
3. Map the amount to the webhook's `value1`, and the reference to `value2`.
4. Copy the webhook URL (the one ending `/with/key/…`) into **Settings → Bank
   link**, and send the test £0.01 to prove the wiring before a real match
   does it for you.

Each fire carries the same three things twice over — as JSON, and as
`value1`/`value2`/`value3` form fields — because different services read
different shapes:

```json
{
  "event": "win",
  "amount": 10,
  "currency": "GBP",
  "team": "Arsenal",
  "opponent": "Tottenham",
  "score": "3-1",
  "played_at": "2026-08-23T16:30:00.000Z",
  "match_id": "2059331",
  "idempotency_key": "tenawin-2059331",
  "trophy_total_pence": 3000,
  "value1": "10.00",
  "value2": "Arsenal beat Tottenham 3-1",
  "value3": "tenawin-2059331"
}
```

The key is the match, so if you ever wire the far end to check it, a repeat
cannot pay twice. `jar_total_pence` still goes out beside
`trophy_total_pence` holding the same number, so a recipe already reading the
old name keeps working.

One honest caveat. Most webhook endpoints answer a browser with no CORS
headers, which the browser reports to the page as a plain network error even
though the request arrived and the money moved. So the JSON post is tried
first, and if it throws, the same thing goes again as an ordinary form post
the browser will send without asking permission — and whose answer it is not
allowed to read. That second case is recorded as *fired at the bank link*
rather than dressed up as confirmed. If you want a confirmed answer instead,
point the link at something that returns `Access-Control-Allow-Origin: *`.

Nothing else leaves the phone. No account, no server of mine, and no bank
credentials anywhere in here — the webhook address is the only thing the app
knows, and pulling it out of Settings stops everything.

## Settings

- **The team.** Search and follow any club the feed knows. It opens on
  Arsenal, which was the point, but the trophy is not fussy.
- **What goes in.** £10 a win by default; draws and losses are £0 until you
  decide otherwise. A trophy that fills on a draw is a perfectly good trophy.
- **Saving for.** An optional label and target, which is what the trophy fills
  towards. Without one it fills through the current hundred.
- **Scores.** The free TheSportsDB test key is used unless you paste your own.
  If results stop arriving, that is the first thing to change.
- **Notifications.** Optional, and only fire when the app is open — see below.
- **Export / import.** Everything lives in this browser and nowhere else.
  Nothing is backed up for you, so export before changing phones.

## What it does not do

- **It does not run in the background.** A page in a browser gets no
  background time it can rely on, on a phone least of all. The trophy catches
  up when you open it, which for a moneybox is soon enough — a win banked on
  Sunday evening rather than Saturday teatime is still the same tenner.
- **It does not hold your bank details.** It cannot: see above.
- **It does not sync between phones.** One trophy, one device, plus the
  export file.

## Getting updates onto the phone

The first version of the service worker cached the app and then never asked
the network again, which is the classic way to ship an update that reaches
nobody: the files are already in the cache, so a new release lands on the
server and stays there.

It now works the other way round. The shell is fetched from the network first
and falls back to the cache only when there is no signal — or when the network
has not answered in two and a half seconds, which on a phone amounts to the
same thing. Anything that does arrive replaces what is cached, so the next
open is current either way, and the page asks the browser to re-check the
worker every time it loads.

Two things had to be closed off before that was actually true. A plain
`fetch()` inside a worker is answered by the browser's own HTTP cache first,
and GitHub Pages puts ten minutes of freshness on these files — so a worker
fetching "from the network" could be handed the very copy it was trying to
replace. The shell is now fetched with `cache: 'no-store'`. The worker script
itself had the same problem, so it is registered with `updateViaCache: 'none'`.

If a phone is ever stuck anyway, **Settings → Fetch the latest version**
throws away the caches and the worker and asks for the app again under a URL
the browser has never seen. It leaves the trophy, the results and the bank
link alone — they are not part of the app's copy. The build the phone is
running is printed just above that button, and in the footer.

The stylesheet and the script are also asked for by version (`app.js?v=17`).
That is what lets a phone still holding the old cache-first worker escape it:
those URLs are not in its cache, so it has no choice but to go to the network.
**A phone stuck on an old copy should be opened once at `…/moneybox/?v=17`** —
after that it is on the new worker and updates arrive on their own. Bump the
version in `index.html` and `sw.js` together on a release.

## Running it

Static files, no build. Serve the folder over HTTPS — GitHub Pages, Firebase
Hosting, anything — open `/moneybox/`, and add it to the home screen from the
browser's share menu.
