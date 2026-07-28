# Turning Spotlight into a real service

Out of the box the app is local-first: every install is its own isolated world,
there's no sign-in, and identity is a random id in the browser. That's fine for
a demo and useless as a product — a singer who clears their site data loses
their profile, clips and followers, and nobody can see anyone else.

Filling in `config.js` flips it into connected mode: one shared room, sign-in
with Google or Apple, and the rules in this folder deciding who can read and
write what.

> **None of this has been run against a real Firebase project.** It was built
> in an environment with no network access to Firebase, and verified against a
> mock of the SDK. The logic is tested; the rules and the OAuth setup are not.
> Expect to spend an hour shaking it out on a throwaway project first.

## Setup

1. **Create a project** at https://console.firebase.google.com/ and register a
   **Web app** to get the config object.

2. **Authentication → Sign-in method**
   - Enable **Google**. Nothing else to configure for web.
   - Enable **Apple**. This needs an Apple Developer account: a Services ID, a
     private key, and your Team ID. Apple also requires the Firebase auth
     domain to be listed as a Return URL. Apple sign-in is mandatory in the App
     Store if you offer Google sign-in, so do it before you wrap the app.
   - Under **Settings → Authorized domains**, add the domain the app is served
     from (e.g. `jonathan-longden.github.io`).

3. **Realtime Database** → create, then paste `database.rules.json` into the
   Rules tab.

4. **Storage** → create, then paste `storage.rules` into its Rules tab.

5. **Fill in `singers/config.js`** with the web config. These values are public
   by design — the rules are what protect the data, not the config.

6. **Claim ownership**: open the app, sign in, then Settings → Owner tools →
   Claim ownership. Do this before sharing the link. The first account to claim
   becomes the only one who can approve scouts, issue codes and action reports,
   and `spotlightOwner` can only be written once.

## What the rules actually enforce

- **You can only write your own profile.** `artists/$uid` is writable by that
  uid, or by the owner. `id` must match the path, so nobody can impersonate.
- **Scout status can't be self-granted.** `scoutVerified` is owner-writable
  only, and `role: 'scout'` is rejected unless `spotlightScouts/$uid` exists —
  which only the owner can write. This is the part that was previously a soft
  gate in the client.
- **Contact details are readable only by verified scouts** (and the owner, and
  yourself). They live at `spotlightContacts/$uid`, not on the artist record,
  because a field on the shared board is readable by anyone who can read the
  board. `contact` on the artist record is now explicitly rejected.
- **Clips belong to their poster.** Creating a clip requires `artistId` to be
  your own uid; editing or deleting is you or the owner. Likes and shortlists
  are per-uid keys writable only by that uid, so nobody can stuff someone
  else's numbers.
- **Applications can be filed by anyone but only decided by the owner** —
  `status` is only writable as `pending` unless you're the owner.
- **Invite codes are owner-created**, and `usedBy` can only be written once, by
  the person spending it.
- **Storage** allows any signed-in user to read, and to write video/image files
  under the size caps.

## Known gaps in the rules

- `plays` and `comments` are writable by any signed-in user, because both are
  legitimately written by people who don't own the clip. A malicious client
  could inflate a play count or delete a comment thread. Fixing that properly
  means moving both behind Cloud Functions.
- Deleting a clip doesn't cascade to its Storage objects at the rules level —
  the client does it, and a client that doesn't will leave orphans. A Storage
  cleanup function would close that.
- There's no rate limiting. A determined account can post as fast as it likes.

## Costs

Auth is free at this scale. The database and Storage are the same free-tier
maths as before: roughly 15–20MB per 60-second clip, against ~1GB/day of
downloads on Spark. Deploy the transcoding function in `../functions/` before
you have real traffic — it shrinks files and is also the only fix for
Chrome-recorded WebM not playing on iPhones.
