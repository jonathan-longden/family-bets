# Family Bets

A simple installable web app for family match-score betting, with a
rollover pot and optional real-time sync across everyone's phones.

By default the app stores everything in the browser's local storage,
so it only works on one device. To let everyone see the same bets and
pot live, connect it to a free Firebase Realtime Database.

> Also in this repo:
>
> - **[Spotlight](singers/)** (`/singers/`) — a short-video app for
>   singers who want to get noticed.
> - **[Tunage](radio/)** (`/radio/`) — your own music playing nonstop
>   with no signal at all, in one pool plus any playlists you build
>   from it.
> - **[Neon Chomp](chomp/)** (`/chomp/`) — a springer spaniel loose in a
>   neon maze: fetch the balls, dodge four cats. Plays offline.
> - **[Take One](studio/)** (`/studio/`) — a voice studio: record a take
>   and it comes back finished, tuned and levelled for release, without
>   the audio leaving the device.
> - **[Defect Log](defects/)** (`/defects/`) — photograph a highway
>   defect and it finds the pothole, proposes a cell on the risk matrix
>   with its reasoning shown, and keeps the coordinates with the
>   photograph. The log works with no signal; the detection needs one.
> - **[Ten a Win](moneybox/)** (`/moneybox/`) — a moneybox with a rule:
>   Arsenal win, £10 goes in. It reads the results itself, banks each
>   win once, and — pointed at a webhook wired to your bank — moves the
>   tenner into a savings pot for you.
> - **[Fucking Weather](outside/)** (`/outside/`) — a proper weather app
>   that tells you exactly what the sky is doing, then takes the mickey
>   out of it: now, hour by hour, today's best and worst bits, tomorrow,
>   and fifteen days out. Puts the temperature on its own icon, and comes
>   with an iPhone home-screen widget. Swearing optional. Also builds as a
>   real iOS and Android app — see [`outside/mobile/`](outside/mobile/).
>
> All seven are separate PWAs with the same no-build setup.

## Firebase setup (for cross-device sync)

1. **Create a Firebase project**
   - Go to https://console.firebase.google.com/ and sign in with a
     Google account.
   - Click **Add project**, give it a name (e.g. `family-bets`), and
     finish the wizard (you can disable Google Analytics, it's not
     needed).

2. **Register a Web App**
   - In the project overview page, click the **</>** (Web) icon to
     add a web app.
   - Give it a nickname (e.g. `family-bets-web`) and click
     **Register app**. You don't need Firebase Hosting.
   - Firebase will show a `firebaseConfig` object that looks like:
     ```json
     {
       "apiKey": "AIza...",
       "authDomain": "family-bets.firebaseapp.com",
       "databaseURL": "https://family-bets-default-rtdb.firebaseio.com",
       "projectId": "family-bets",
       "storageBucket": "family-bets.appspot.com",
       "messagingSenderId": "...",
       "appId": "1:...:web:..."
     }
     ```
   - Keep this page open, you'll paste this JSON into the app in step 4.

3. **Enable the Realtime Database**
   - In the left sidebar, go to **Build → Realtime Database**.
   - Click **Create Database**, choose a location, and start in
     **test mode** for now (lets you get going quickly).
   - Once created, go to the **Rules** tab and set rules scoped to
     the path the app uses (`familyBetsState`), for example:
     ```json
     {
       "rules": {
         "familyBetsState": {
           ".read": true,
           ".write": true
         },
         "$other": {
           ".read": false,
           ".write": false
         }
       }
     }
     ```
     This is open (anyone with the database URL can read/write the
     bet state) but fine for a private family game. Firebase's
     "test mode" default expires after 30 days, so applying rules
     like these avoids the database locking itself out later. If you
     want tighter security, add Firebase Authentication and scope
     the rules to signed-in users instead — not required for normal
     family use.

4. **Connect the app**
   - Open the app (`index.html`, or wherever you're hosting it).
   - Scroll to **Realtime Sync (optional)**.
   - Paste the whole `firebaseConfig` JSON object from step 2 into
     the text box.
   - Click **Enable Firebase**. The status line should change to
     "Synced via Firebase".
   - Repeat this step on every family member's device (same config,
     pasted once per device) — they'll then all read/write the same
     shared state and stay in sync live.

5. **Everyday use**
   - Once enabled, the app remembers the config in that browser and
     reconnects automatically next time it's opened.
   - To go back to local-only mode on a device, click
     **Disable Firebase**.

## Hosting the app

The app is a static site (`index.html`, `manifest.json`, `sw.js` +
icons), so any static host works, e.g.:

- **Firebase Hosting** (`firebase init hosting` in this repo, then
  `firebase deploy`) — convenient since you're already using Firebase.
- **GitHub Pages** — enable Pages on this repo (Settings → Pages),
  serving from the `main` branch root.

Once hosted, add the page to each phone's home screen (browser share
menu → "Add to Home Screen") to use it like an installed app.
