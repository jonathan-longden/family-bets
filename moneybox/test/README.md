# Tests

Two Playwright scripts. Neither needs a build; both drive the real app in a
real browser against a stubbed feed.

```sh
python3 -m http.server 8765 --directory ../..     # serve the repo
node click-everything.js                          # every control, no page errors
node no-double-count.js                           # a win cannot be paid twice
```

`click-everything.js` exists because a release once removed a function that
only the settings sheet called, and the sheet stopped opening. Nothing threw
until a person tapped the cannon, by which point it was on their phone. It
clicks every control on the screen and every control in settings, and fails on
any error the page throws.

`no-double-count.js` guards the one thing a moneybox must never get wrong:
paying for the same win twice. It covers a match added by hand that a feed
later catches up with, and the same fixture arriving from two feeds under two
different ids.
