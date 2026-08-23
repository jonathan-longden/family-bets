# Ten a Win

A moneybox with a rule: **Arsenal win, ten pounds goes in.**

It reads the results itself, so there is nothing to remember on a Sunday
night. Open it and the jar is already heavier — or it isn't, and you know why.

It runs on a phone, installs to the home screen, and the jar itself works with
no signal. Reading the scores needs one.

## The shape of it

One screen. The trophy and the figure at the top — the cup fills with what you
have saved, towards a target where you have set one and through the current
hundred where you have not — the next fixture under it with the tenner already
riding on it, and the ledger below: every match the jar has read, what it was
worth, and whether the money has actually moved.

- **Check for wins** reads the results feed and banks anything new. It also
  happens on its own when you open the app, when you come back to it, and
  every so often while it is in front of you.
- **Mark moved** is for the manual way of doing this: you have shifted the
  money into savings yourself, and the jar should stop nagging.
- **Add by hand** is there for when the feed is down, the match was a friendly
  it does not carry, or you simply want to put a tenner in.
- **Break it open** takes money back out and says what for. The jar keeps the
  line either way, so the history stays honest.

## What counts as a win

Two things about a results feed cost real money if you get them wrong, and
both are handled here rather than hoped about.

**A score is not a result.** Feeds carry live scores as happily as final ones,
so a jar that trusted the first 1-0 it saw would bank a tenner at half time
and keep it when the match finished 1-2. A match only counts once it is
finished: by its own status where the feed gives one, and otherwise by the
clock — two and a half hours after kick-off, which is late enough for injury
time and a slow update.

**A win pays once.** Every match carries an id, and the jar remembers the ids
it has banked. Opening the app fifty times on a Sunday night reads the same
win fifty times and banks it once. Deleting a line forgets its id too, so a
line removed by mistake comes back on the next check rather than being lost
for good.

Draws and losses are recorded as £0 lines. They are not clutter: without them
the win streak would count wins either side of a thrashing as consecutive.

## How the money actually moves

A web page has no way into a bank account. Anything that claims otherwise is
really talking to something else that does — so this one talks to something
else that does, and it is something you own.

**Left alone, the jar keeps score.** It tells you what has gone in and how
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
  "value1": "10.00",
  "value2": "Arsenal beat Tottenham 3-1",
  "value3": "tenawin-2059331"
}
```

The key is the match, so if you ever wire the far end to check it, a repeat
cannot pay twice.

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
  Arsenal, which was the point, but the jar is not fussy.
- **What goes in.** £10 a win by default; draws and losses are £0 until you
  decide otherwise. A jar that fills on a draw is a perfectly good jar.
- **Saving for.** An optional label and target, which is what the jar fills
  towards. Without one it fills through the current hundred.
- **Scores.** The free TheSportsDB test key is used unless you paste your own.
  If results stop arriving, that is the first thing to change.
- **Notifications.** Optional, and only fire when the app is open — see below.
- **Export / import.** Everything lives in this browser and nowhere else.
  Nothing is backed up for you, so export before changing phones.

## What it does not do

- **It does not run in the background.** A page in a browser gets no
  background time it can rely on, on a phone least of all. The jar catches up
  when you open it, which for a moneybox is soon enough — a win banked on
  Sunday evening rather than Saturday teatime is still the same tenner.
- **It does not hold your bank details.** It cannot: see above.
- **It does not sync between phones.** One jar, one device, plus the export
  file.

## Running it

Static files, no build. Serve the folder over HTTPS — GitHub Pages, Firebase
Hosting, anything — open `/moneybox/`, and add it to the home screen from the
browser's share menu.
