# Ten a Win — the worker

The part that moves the money, running on Cloudflare rather than on a phone.

The app cannot do this itself, and not for want of trying: a browser will not
let a page call a bank at all, and a page that is shut cannot notice that
Arsenal have won. This worker has neither problem. It wakes every half hour,
reads the results, and puts the stake into a Starling space — with the phone in
your pocket, or off, or at the bottom of a bag.

**The token lives here, in this worker's secrets.** Not on a phone, not in a
page, and not passing through anybody else's server. If you delete the worker,
the token goes with it.

## What it will not do

**Pay for the same match twice.** Every transfer id is hashed from the match
id, and Starling treats a repeat of an id as the same transfer — so a second
attempt is refused by the bank rather than trusted not to happen. The app uses
the identical hash, so even a phone still configured to pay cannot produce a
second tenner for the same win.

**Pay for the backlog.** On its first run it writes down everything already
finished *without paying for any of it*. A worker installed on a Sunday night
should not empty an account for a season played before it existed. If you do
want the history paid, set `PAY_BACKLOG = "true"` before the first run.

**Give up quietly on a failed transfer.** A refusal leaves the match unrecorded
so the next run tries again — with the same transfer id, so the bank decides
whether that is a repeat, not this code.

## Setting it up

1. **Get the tools.**
   ```sh
   npm install -g wrangler
   wrangler login
   ```

2. **Make somewhere to remember what has been paid.**
   ```sh
   cd moneybox/worker
   wrangler kv namespace create JAR
   ```
   Paste the id it prints into `wrangler.toml`.

3. **Give it your token.** Create a personal access token at
   developer.starlingbank.com with the narrowest scopes that work: reading
   accounts, reading spaces, and paying into a space. Nothing that can pay
   another person.
   ```sh
   wrangler secret put STARLING_TOKEN
   wrangler secret put STATUS_KEY     # any password you like, to guard the status page
   ```

4. **Deploy it.**
   ```sh
   wrangler deploy
   ```

5. **Find your account and space.** Open, with the key you just set:
   ```
   https://ten-a-win.<your-subdomain>.workers.dev/spaces?key=<STATUS_KEY>
   ```
   It lists every account and space your token can see, labelled with the two
   values to copy. Put them into `wrangler.toml` as `ACCOUNT_UID` and
   `SPACE_UID`, then `wrangler deploy` again.

That is the setup. It will now pay a tenner into that space every time Arsenal
win, within half an hour of the final whistle.

## Checking on it

- `/status?key=…` — when it was installed, when it last ran, how many wins it
  has paid for, how much has gone in, and the last twenty things it did.
- `/run?key=…` — check now rather than waiting for the next half hour.
- `/spaces?key=…` — the accounts and spaces the token can see.

## The phone app alongside it

Leave **Settings → Starling → Move the money on every win** switched off in the
app. Nothing terrible happens if you do not — the shared transfer id means the
bank will not pay twice — but there is no reason for both to try.

The app remains the thing you look at: the trophy, the ledger, the table. The
worker is the thing that pays.

## What it costs

Nothing. Cloudflare's free plan covers a worker waking every half hour and a
handful of KV reads, with room to spare.
