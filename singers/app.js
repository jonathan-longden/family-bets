/* Spotlight — a short-video stage for singers.
   Everything is local-first: clip metadata lives in localStorage, the video
   files themselves live in IndexedDB, and an optional Firebase panel mirrors
   the metadata between devices. No build step, no bundler. */

/* ───────────────────────── constants & helpers ───────────────────────── */

const BOARD_KEY = 'spotlight.board';
const ME_KEY = 'spotlight.me';
const NOTES_KEY = 'spotlight.notes';        // private to this device, never synced
const SEARCHES_KEY = 'spotlight.searches';
const FB_KEY = 'spotlight.firebase';
const FB_PATH = 'spotlightBoard';
const MAX_CLIP_MS = 60000;
const GENRES = ['Pop', 'R&B', 'Soul', 'Rock', 'Indie', 'Country', 'Musical theatre',
  'Jazz', 'Gospel', 'Rap', 'Afrobeats', 'Classical', 'Folk', 'Metal', 'K-pop'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function compact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + 'K';
  return String(n);
}

function ago(ts) {
  const s = Math.max(1, Math.round((now() - ts) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  if (s < 604800) return Math.round(s / 86400) + 'd';
  return Math.round(s / 604800) + 'w';
}

function hueOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function gradientFor(id) {
  const h = hueOf(id);
  return `linear-gradient(145deg,hsl(${h} 80% 55%),hsl(${(h + 55) % 360} 85% 45%))`;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function avatarHTML(artist, cls = '') {
  if (!artist) return `<div class="avatar ${cls}"></div>`;
  return `<div class="avatar ${cls}" style="background:${gradientFor(artist.id)}">${esc(initials(artist.name))}</div>`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ───────────────────────── IndexedDB (video blobs) ───────────────────────── */

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('spotlight', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function mediaPut(rec) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('media', 'readwrite');
    tx.objectStore('media').put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function mediaGet(id) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction('media', 'readonly');
      const req = tx.objectStore('media').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return null; }
}

async function mediaDelete(id) {
  try {
    const d = await db();
    await new Promise(resolve => {
      const tx = d.transaction('media', 'readwrite');
      tx.objectStore('media').delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) { /* ignore */ }
}

/* ───────────────────────── board state ───────────────────────── */

let board = { artists: {}, clips: {}, codes: {}, applications: {}, owner: null };
let meId = localStorage.getItem(ME_KEY) || null;

const me = () => (meId ? board.artists[meId] : null);
const artist = id => board.artists[id] || null;
const clipsOf = id => Object.values(board.clips).filter(c => c.artistId === id);

function loadBoard() {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      board = {
        artists: parsed.artists || {}, clips: parsed.clips || {},
        codes: parsed.codes || {}, applications: parsed.applications || {},
        owner: parsed.owner || null,
      };
    }
  } catch (e) { /* start fresh */ }
}

let saveTimer = null;
function saveBoard({ sync = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(BOARD_KEY, JSON.stringify(board));
    } catch (e) {
      toast('Storage is full — delete a clip to free space.');
    }
  }, 120);
  if (sync) pushToFirebase();
}

const likeCount = c => (c.likeSeed || 0) + Object.keys(c.likes || {}).length;
const commentCount = c => (c.comments || []).length;
const shortlistCount = c => (c.shortlistSeed || 0) + Object.keys(c.shortlists || {}).length;
const followerCount = a => (a.followerSeed || 0) + Object.keys(a.followers || {}).length;
const iLike = c => !!(meId && c.likes && c.likes[meId]);
const iSaved = c => !!(meId && c.shortlists && c.shortlists[meId]);
const iFollow = a => !!(meId && a && a.followers && a.followers[meId]);

/* ── scout verification ──
   Scout accounts can see singers' contact details, so they are gated. An
   invite code you issued unlocks the account immediately; anyone else lands
   in a review queue that the owner device approves or rejects.

   Be clear-eyed about what this is: a soft gate. The board is a JSON blob in
   the browser, so a determined person with dev tools can flip the flag on
   their own device. It stops casual sign-ups and gives you a real audit
   trail; it is not security. Enforcement that actually holds needs Firebase
   Auth plus database rules, with contact details behind a path only approved
   accounts can read. See README. */

const isVerifiedScout = a => !!(a && a.role === 'scout' && a.scoutVerified);
const iAmVerifiedScout = () => isVerifiedScout(me());
const iAmOwner = () => !!(board.owner && meId && board.owner.artistId === meId);
const myApplication = () => Object.values(board.applications || {})
  .filter(x => x.artistId === meId)
  .sort((a, b) => b.createdAt - a.createdAt)[0] || null;

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1
  const block = () => Array.from({ length: 4 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `SPOT-${block()}-${block()}`;
}

function findCode(raw) {
  const key = normalizeCode(raw);
  if (!key) return null;
  return Object.values(board.codes || {}).find(c => normalizeCode(c.code) === key) || null;
}

/* Returns { ok } or { error } — the single place that decides whether a code
   can be spent, so onboarding and the later apply flow can't drift apart. */
function redeemCode(raw, artistId) {
  const code = findCode(raw);
  if (!code) return { error: 'That code is not recognised' };
  if (code.revoked) return { error: 'That code has been revoked' };
  if (code.usedBy && code.usedBy !== artistId) return { error: 'That code has already been used' };
  code.usedBy = artistId;
  code.usedAt = now();
  code.updatedAt = now();
  return { ok: true, code };
}

function applicationFrom(fields, artistId, status) {
  return {
    id: uid(), artistId, status,
    company: fields.company || '', title: fields.title || '',
    workEmail: fields.workEmail || '', website: fields.website || '',
    codeUsed: fields.codeUsed || '',
    createdAt: now(), updatedAt: now(),
  };
}

function grantScout(artist, application) {
  artist.role = 'scout';
  artist.scoutVerified = true;
  artist.company = application.company || artist.company || '';
  artist.scoutTitle = application.title || '';
  artist.scoutSince = now();
  artist.scoutStatus = 'approved';
  artist.updatedAt = now();
}

function decideApplication(appId, approved, reason) {
  const app = board.applications[appId];
  if (!app || !iAmOwner()) return;
  const a = artist(app.artistId);
  app.status = approved ? 'approved' : 'rejected';
  app.decidedAt = now();
  app.decidedBy = meId;
  app.reason = reason || '';
  app.updatedAt = now();
  if (a) {
    if (approved) grantScout(a, app);
    else {
      a.scoutStatus = 'rejected';
      a.scoutRejectReason = reason || '';
      a.updatedAt = now();
    }
  }
  saveBoard();
}

/* Chart score: attention over the last week, decayed by age. */
function clipScore(c) {
  const raw = (c.plays || 0) + likeCount(c) * 5 + commentCount(c) * 8 + shortlistCount(c) * 15;
  const days = (now() - c.createdAt) / 86400000;
  return raw * Math.pow(0.82, Math.max(0, days));
}

function artistScore(a) {
  const clips = clipsOf(a.id);
  if (!clips.length) return 0;
  return clips.reduce((sum, c) => sum + clipScore(c), 0) + followerCount(a) * 4;
}

function totalPlays(a) { return clipsOf(a.id).reduce((s, c) => s + (c.plays || 0), 0); }
function totalLikes(a) { return clipsOf(a.id).reduce((s, c) => s + likeCount(c), 0); }

/* ───────────────────────── seed content ───────────────────────── */

const DEMO_LYRICS = [
  ['I sang it to an empty room', 'and the empty room sang back'],
  ['Take the long way home', 'I am not done with this night yet'],
  ['You said my name like a chorus', 'now I cannot stop the song'],
  ['Every door is a maybe', 'so I keep on knocking'],
  ['Hold the note, hold the note', 'til the ceiling gives way'],
  ['Small town, big lungs', 'somebody out there hears me'],
];

function seedBoard() {
  const day = 86400000;
  const people = [
    { name: 'Maya Rivers', handle: 'mayarivers', city: 'Manchester, UK', genres: ['Soul', 'R&B'],
      bio: 'Soul singer, mostly unsigned, entirely unbothered. Originals only on Sundays.', followerSeed: 4821 },
    { name: 'Theo Ade', handle: 'theoade', city: 'Lagos → London', genres: ['Afrobeats', 'Pop'],
      bio: 'Writing hooks in two languages. Looking for a producer who moves fast.', followerSeed: 2740 },
    { name: 'Nina Kowal', handle: 'ninakowal', city: 'Kraków, PL', genres: ['Musical theatre', 'Pop'],
      bio: 'Belting since 2009. Currently understudy, permanently ready.', followerSeed: 1985 },
    { name: 'Cass Holloway', handle: 'cassholloway', city: 'Nashville, TN', genres: ['Country', 'Folk'],
      bio: 'Porch songs and a beat-up Gibson. Three chords, no shortcuts.', followerSeed: 3612 },
    { name: 'Jules Park', handle: 'julespark', city: 'Seoul, KR', genres: ['K-pop', 'R&B'],
      bio: 'Trainee for four years. Now doing it my way.', followerSeed: 5290 },
    { name: 'Odie Bell', handle: 'odiebell', city: 'Atlanta, GA', genres: ['Gospel', 'Soul'],
      bio: 'Raised in the choir loft. Still singing like the roof is listening.', followerSeed: 1204 },
  ];

  const clipSpecs = [
    { a: 0, title: 'One take, kitchen floor, no autotune.', song: 'Empty Room', original: true, tags: ['soul', 'onetake', 'unsigned'], age: 0.3 * day, plays: 18420, likes: 3106, cmts: 41, saves: 12 },
    { a: 1, title: 'Made this hook on the bus this morning 🚌', song: 'Long Way Home', original: true, tags: ['afrobeats', 'hook', 'newmusic'], age: 0.8 * day, plays: 12750, likes: 2211, cmts: 27, saves: 9 },
    { a: 2, title: 'The bridge everyone skips — it deserves better.', song: 'Chorus of You', original: false, tags: ['theatre', 'belt', 'cover'], age: 1.4 * day, plays: 9310, likes: 1755, cmts: 33, saves: 6 },
    { a: 3, title: 'Wrote this after a very long drive.', song: 'Keep On Knocking', original: true, tags: ['country', 'acoustic', 'original'], age: 2.2 * day, plays: 15680, likes: 2640, cmts: 19, saves: 14 },
    { a: 4, title: 'Falsetto run at 0:14 — tell me if it lands.', song: 'Hold The Note', original: false, tags: ['rnb', 'falsetto', 'runs'], age: 3.1 * day, plays: 21400, likes: 4021, cmts: 58, saves: 21 },
    { a: 5, title: 'Sunday soundcheck, nobody in the building.', song: 'Big Lungs', original: true, tags: ['gospel', 'live', 'raw'], age: 4.5 * day, plays: 7420, likes: 1380, cmts: 15, saves: 8 },
    { a: 0, title: 'Same song, six days later, different key.', song: 'Empty Room (Reprise)', original: true, tags: ['soul', 'reprise'], age: 5.6 * day, plays: 6210, likes: 940, cmts: 11, saves: 4 },
    { a: 2, title: 'Warm-ups nobody asked for.', song: 'Scales & Coffee', original: false, tags: ['warmup', 'theatre'], age: 6.4 * day, plays: 4180, likes: 610, cmts: 7, saves: 2 },
  ];

  const DEMO_COMMENTS = [
    'that run at the end. absolute chills.',
    'the tone on this is unreal — how are you not signed yet',
    'played this four times already',
    'more originals please 🙏',
    'the control in your lower register is nuts',
    'sending this to my producer friend right now',
  ];

  const ids = people.map((p, i) => {
    const id = 'demo-' + p.handle;
    board.artists[id] = {
      id, handle: p.handle, name: p.name, bio: p.bio, city: p.city,
      genres: p.genres, role: 'singer', demo: true,
      followers: {}, followerSeed: p.followerSeed,
      createdAt: now() - (30 - i * 3) * day, updatedAt: now(),
    };
    return id;
  });

  clipSpecs.forEach((s, i) => {
    const id = 'democlip-' + i;
    const lyric = DEMO_LYRICS[i % DEMO_LYRICS.length];
    board.clips[id] = {
      id, artistId: ids[s.a], title: s.title, song: s.song, original: s.original,
      genre: board.artists[ids[s.a]].genres[0], tags: s.tags,
      demo: true, lyric, hue: (hueOf(id) + i * 40) % 360,
      durationMs: 18000 + i * 3000,
      plays: s.plays, likes: {}, likeSeed: s.likes, shortlists: {}, shortlistSeed: s.saves,
      comments: Array.from({ length: Math.min(4, s.cmts) }, (_, k) => ({
        id: `${id}-c${k}`,
        artistId: ids[(s.a + k + 1) % ids.length],
        text: DEMO_COMMENTS[(i + k) % DEMO_COMMENTS.length],
        at: now() - s.age + (k + 1) * 1800000,
      })),
      commentSeed: Math.max(0, s.cmts - 4),
      createdAt: now() - s.age, updatedAt: now(),
    };
  });
}

/* ───────────────────────── screens / router ───────────────────────── */

let currentScreen = 'feed';
let viewedArtistId = null;

function show(screen, opts = {}) {
  if (screen === 'record' && !opts.force) { openRecord(); return; }
  if (currentScreen === 'record' && screen !== 'record') closeRecord({ silent: true });

  currentScreen = screen;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + screen));
  $$('#tabbar .tab').forEach(t => t.classList.toggle('active', t.dataset.screen === screen));
  document.body.classList.toggle('hide-tabbar', false);

  if (screen === 'feed') resumeActiveClip(); else pauseAllClips();
  if (screen === 'discover') renderDiscover();
  if (screen === 'charts') renderChart();
  if (screen === 'profile') renderProfile(opts.artistId || meId);
}

function openArtist(id) {
  viewedArtistId = id;
  show('profile', { artistId: id });
}

/* ───────────────────────── feed ───────────────────────── */

let feedMode = 'foryou';
let feedIds = [];
let activeClipId = null;
let muted = true;
const objectUrls = new Map();
const playedThisSession = new Set();
let feedObserver = null;

function feedList() {
  const all = Object.values(board.clips);
  if (feedMode === 'following') {
    const followed = Object.values(board.artists).filter(a => iFollow(a)).map(a => a.id);
    return all.filter(c => followed.includes(c.artistId) || c.artistId === meId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  if (feedMode === 'fresh') return all.sort((a, b) => b.createdAt - a.createdAt);
  // "For you": score-ranked, with a nudge for clips you haven't seen this session.
  return all.sort((a, b) => {
    const bump = c => (playedThisSession.has(c.id) ? 0.55 : 1);
    return clipScore(b) * bump(b) - clipScore(a) * bump(a);
  });
}

function clipCardHTML(c) {
  const a = artist(c.artistId) || { id: c.artistId, name: 'Unknown', handle: 'unknown' };
  const isMine = c.artistId === meId;
  const tags = (c.tags || []).map(t => '#' + t).join(' ');
  const visual = c.demo
    ? `<div class="demo-visual" style="background:linear-gradient(160deg,hsl(${c.hue} 70% 32%),hsl(${(c.hue + 60) % 360} 65% 18%))">
         <div class="demo-note">
           <div class="lyric">${c.lyric ? c.lyric.map(esc).join('<br>') : esc(c.song)}</div>
           <span class="tag">Demo clip · audio-free preview</span>
         </div>
         <div class="demo-bars">${Array.from({ length: 26 }, (_, i) =>
      `<i style="animation-delay:${(i % 7) * 0.13}s;animation-duration:${0.75 + (i % 5) * 0.16}s"></i>`).join('')}</div>
       </div>`
    : `<video playsinline loop preload="none" ${c.mirror ? 'class="mirror"' : ''}></video>
       <div class="missing-media" hidden>Video not stored on this device</div>`;

  return `
    <article class="clip" data-clip="${c.id}">
      ${visual}
      <div class="clip-shade"></div>
      <div class="tap-flash"><svg class="ic"><use href="#i-play"/></svg></div>
      <div class="clip-meta">
        <div class="who">
          <span>@${esc(a.handle)}</span>
          ${c.original ? '<span class="badge">Original</span>' : ''}
          ${isMine ? '<span class="badge">You</span>' : ''}
        </div>
        <p class="caption">${esc(c.title)}</p>
        ${tags ? `<div class="tags">${esc(tags)}</div>` : ''}
        <div class="song"><svg class="ic"><use href="#i-sound"/></svg><span>${esc(c.song || 'Original sound')} · ${esc(a.name)} · ${ago(c.createdAt)} ago</span></div>
      </div>
      <div class="rail">
        <button class="avatar-btn" data-act="artist">
          ${avatarHTML(a)}
          ${!isMine ? `<span class="follow-dot ${iFollow(a) ? 'following' : ''}"><svg class="ic"><use href="#${iFollow(a) ? 'i-star' : 'i-plus'}"/></svg></span>` : ''}
        </button>
        <button data-act="like" class="${iLike(c) ? 'liked' : ''}">
          <svg class="ic"><use href="#i-heart"/></svg><span data-count="like">${compact(likeCount(c))}</span>
        </button>
        <button data-act="comment">
          <svg class="ic"><use href="#i-comment"/></svg><span data-count="comment">${compact(commentCount(c) + (c.commentSeed || 0))}</span>
        </button>
        <button data-act="save" class="${iSaved(c) ? 'saved' : ''}">
          <svg class="ic"><use href="#i-star"/></svg><span data-count="save">${compact(shortlistCount(c))}</span>
        </button>
        <button data-act="share"><svg class="ic"><use href="#i-share"/></svg><span>Share</span></button>
      </div>
      <div class="clip-progress"></div>
    </article>`;
}

function renderFeed({ keepScroll = false } = {}) {
  const feed = $('#feed');
  const prevScroll = keepScroll ? feed.scrollTop : 0;
  feedIds = feedList().map(c => c.id);

  for (const [, url] of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();

  feed.innerHTML = feedIds.map(id => clipCardHTML(board.clips[id])).join('');
  $('#feedEmpty').hidden = feedIds.length > 0;
  feed.scrollTop = prevScroll;

  if (feedObserver) feedObserver.disconnect();
  feedObserver = new IntersectionObserver(onClipVisibility, { root: feed, threshold: [0.25, 0.7] });
  $$('.clip', feed).forEach(el => feedObserver.observe(el));

  // The cards are brand new DOM, so nothing is loaded yet — clearing this makes
  // setActiveClip re-attach the media instead of short-circuiting on the id it
  // was already showing. Without it a re-render mid-watch (a sync update, say)
  // leaves the visible clip blank until you scroll away and back.
  activeClipId = null;
  if (feedIds.length && !keepScroll) setActiveClip(feedIds[0]);
}

function onClipVisibility(entries) {
  for (const entry of entries) {
    const id = entry.target.dataset.clip;
    if (entry.intersectionRatio >= 0.7) setActiveClip(id);
    else if (entry.intersectionRatio < 0.25) {
      const v = $('video', entry.target);
      if (v) v.pause();
    }
  }
}

async function setActiveClip(id) {
  if (activeClipId === id) { resumeActiveClip(); return; }
  activeClipId = id;
  pauseAllClips();

  const c = board.clips[id];
  if (!c) return;

  const card = $(`.clip[data-clip="${id}"]`);
  if (!card) return;

  const video = $('video', card);
  if (video && !video.src) {
    const rec = await mediaGet(id);
    if (rec && rec.video) {
      const url = URL.createObjectURL(rec.video);
      objectUrls.set(id, url);
      video.src = url;
    } else if (c.videoUrl) {
      video.src = c.videoUrl;                     // streams from Firebase Storage
      video.onerror = () => flagMissing(card,
        'This clip will not play on this browser (recorded in another video format)');
    } else {
      flagMissing(card, 'Video not stored on this device');
    }
  }
  if (video && video.src) {
    video.muted = muted;
    video.currentTime = video.currentTime || 0;
    video.play().catch(() => { /* autoplay blocked until a tap */ });
  }

  // Count a play once per clip per session, after a second of real attention.
  if (!playedThisSession.has(id)) {
    setTimeout(() => {
      if (activeClipId === id && !playedThisSession.has(id)) {
        playedThisSession.add(id);
        c.plays = (c.plays || 0) + 1;
        c.updatedAt = now();
        saveBoard();
      }
    }, 1000);
  }
  startProgress(card, c);
}

function flagMissing(card, text) {
  const flag = $('.missing-media', card);
  if (!flag) return;
  flag.textContent = text;
  flag.hidden = false;
}

function resumeActiveClip() {
  if (currentScreen !== 'feed' || !activeClipId) return;
  const v = $(`.clip[data-clip="${activeClipId}"] video`);
  if (v && v.src && v.paused) { v.muted = muted; v.play().catch(() => {}); }
}

function pauseAllClips() {
  $$('#feed video').forEach(v => { if (!v.paused) v.pause(); });
}

let progressTimer = null;
function startProgress(card, c) {
  clearInterval(progressTimer);
  const bar = $('.clip-progress', card);
  const video = $('video', card);
  const started = now();
  progressTimer = setInterval(() => {
    let pct;
    if (video && video.src && video.duration && isFinite(video.duration)) {
      pct = (video.currentTime / video.duration) * 100;
    } else {
      pct = ((now() - started) % (c.durationMs || 20000)) / (c.durationMs || 20000) * 100;
    }
    bar.style.width = clamp(pct, 0, 100) + '%';
  }, 120);
}

/* feed interactions */

function toggleLike(id, { force = false } = {}) {
  const c = board.clips[id];
  if (!c) return;
  c.likes = c.likes || {};
  const already = !!c.likes[meId];
  if (already && force) return;
  if (already) delete c.likes[meId]; else c.likes[meId] = true;
  c.updatedAt = now();
  saveBoard();
  const card = $(`.clip[data-clip="${id}"]`);
  if (card) {
    const btn = $('[data-act="like"]', card);
    btn.classList.toggle('liked', !!c.likes[meId]);
    $('[data-count="like"]', btn).textContent = compact(likeCount(c));
  }
}

function toggleSave(id) {
  const c = board.clips[id];
  if (!c) return;
  c.shortlists = c.shortlists || {};
  if (c.shortlists[meId]) delete c.shortlists[meId];
  else { c.shortlists[meId] = true; toast(me() && me().role === 'scout' ? 'Shortlisted' : 'Saved to your list'); }
  c.updatedAt = now();
  saveBoard();
  const card = $(`.clip[data-clip="${id}"]`);
  if (card) {
    const btn = $('[data-act="save"]', card);
    btn.classList.toggle('saved', !!c.shortlists[meId]);
    $('[data-count="save"]', btn).textContent = compact(shortlistCount(c));
  }
}

function toggleFollow(artistId) {
  const a = artist(artistId);
  if (!a || artistId === meId) return;
  a.followers = a.followers || {};
  if (a.followers[meId]) delete a.followers[meId];
  else { a.followers[meId] = true; toast('Following @' + a.handle); }
  a.updatedAt = now();
  saveBoard();
  $$(`.clip[data-clip] `).forEach(card => {
    const c = board.clips[card.dataset.clip];
    if (!c || c.artistId !== artistId) return;
    const dot = $('.follow-dot', card);
    if (dot) {
      dot.classList.toggle('following', iFollow(a));
      $('use', dot).setAttribute('href', iFollow(a) ? '#i-star' : '#i-plus');
    }
  });
  if (currentScreen === 'profile') renderProfile(viewedArtistId || meId);
}

async function shareClip(id) {
  const c = board.clips[id];
  const a = artist(c.artistId);
  const text = `${a.name} — "${c.song}" on Spotlight`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Spotlight', text, url: location.href }); return; }
    await navigator.clipboard.writeText(`${text} ${location.href}`);
    toast('Link copied');
  } catch (e) { /* user dismissed */ }
}

function heartBurst(card, x, y) {
  const el = document.createElement('div');
  el.className = 'heart-pop';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = '<svg class="ic"><use href="#i-heart"/></svg>';
  card.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

let lastTap = 0;
$('#feed').addEventListener('click', e => {
  const card = e.target.closest('.clip');
  if (!card) return;
  const id = card.dataset.clip;
  const btn = e.target.closest('[data-act]');

  if (btn) {
    const act = btn.dataset.act;
    if (act === 'like') toggleLike(id);
    if (act === 'save') toggleSave(id);
    if (act === 'comment') openComments(id);
    if (act === 'share') shareClip(id);
    if (act === 'artist') {
      const c = board.clips[id];
      if (e.target.closest('.follow-dot')) toggleFollow(c.artistId);
      else openArtist(c.artistId);
    }
    return;
  }

  const t = now();
  if (t - lastTap < 300) {
    lastTap = 0;
    const r = card.getBoundingClientRect();
    heartBurst(card, e.clientX - r.left, e.clientY - r.top);
    toggleLike(id, { force: true });
    return;
  }
  lastTap = t;
  setTimeout(() => {
    if (lastTap !== t) return;      // a double-tap took over
    const v = $('video', card);
    const flash = $('.tap-flash', card);
    if (v && v.src) {
      if (v.paused) { v.play().catch(() => {}); } else v.pause();
    }
    flash.classList.remove('show');
    void flash.offsetWidth;
    flash.classList.add('show');
  }, 300);
});

$$('.feed-head [data-feed]').forEach(btn => btn.addEventListener('click', () => {
  feedMode = btn.dataset.feed;
  $$('.feed-head [data-feed]').forEach(b => b.classList.toggle('selected', b === btn));
  renderFeed();
}));

$('#muteBtn').addEventListener('click', () => {
  muted = !muted;
  $$('#feed video').forEach(v => { v.muted = muted; });
  $('#muteBtn use').setAttribute('href', muted ? '#i-mute' : '#i-sound');
  if (!muted) resumeActiveClip();
  toast(muted ? 'Sound off' : 'Sound on');
});

/* ───────────────────────── comments ───────────────────────── */

function openComments(clipId) {
  const c = board.clips[clipId];
  if (!c) return;
  const render = () => {
    const list = (c.comments || []).slice().sort((x, y) => x.at - y.at);
    $('#sheetBody').innerHTML = list.length
      ? list.map(cm => {
        const a = artist(cm.artistId) || { name: 'Someone', handle: 'someone', id: cm.artistId };
        return `<div class="comment">${avatarHTML(a, 'sm')}
            <div class="body"><div class="who">@${esc(a.handle)} · ${ago(cm.at)}</div>
            <div class="txt">${esc(cm.text)}</div></div></div>`;
      }).join('')
      : '<p class="muted pad">No comments yet. Say something useful — singers read these.</p>';
    $('#sheetTitle').textContent = `${compact(commentCount(c) + (c.commentSeed || 0))} comments`;
  };

  openSheet({
    title: 'Comments',
    render,
    foot: `<input id="commentInput" placeholder="Add a comment…" maxlength="200" />
           <button id="commentSend" class="btn-primary">Post</button>`,
    onFoot: () => {
      const send = () => {
        const input = $('#commentInput');
        const text = input.value.trim();
        if (!text) return;
        c.comments = c.comments || [];
        c.comments.push({ id: uid(), artistId: meId, text, at: now() });
        c.updatedAt = now();
        input.value = '';
        saveBoard();
        render();
        const card = $(`.clip[data-clip="${clipId}"] [data-count="comment"]`);
        if (card) card.textContent = compact(commentCount(c) + (c.commentSeed || 0));
        $('#sheetBody').scrollTop = $('#sheetBody').scrollHeight;
      };
      $('#commentSend').onclick = send;
      $('#commentInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    },
  });
}

/* ───────────────────────── sheets ───────────────────────── */

function openSheet({ title, html, render, foot, onFoot }) {
  const sheet = $('#sheet');
  $('#sheetTitle').textContent = title || '';
  if (render) render(); else $('#sheetBody').innerHTML = html || '';
  const footEl = $('#sheetFoot');
  footEl.hidden = !foot;
  footEl.innerHTML = foot || '';
  sheet.hidden = false;
  if (onFoot) onFoot();
}

function closeSheet() { $('#sheet').hidden = true; }
$$('[data-close-sheet]').forEach(el => el.addEventListener('click', closeSheet));

/* ───────────────────────── discover ───────────────────────── */

let genreFilter = '';
let searchTerm = '';
let filters = { originals: false, days: 0, city: '' };
const posterCache = new Map();

/* ── scout tools: saved searches and private notes ──
   Both live only on this device. Notes especially: a scout's opinion of a
   singer has no business travelling through the shared board. */

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch (e) { return fallback; }
}

const savedSearches = () => readLocal(SEARCHES_KEY, []);
const setSavedSearches = list => localStorage.setItem(SEARCHES_KEY, JSON.stringify(list));
const allNotes = () => readLocal(NOTES_KEY, {});
const noteFor = clipId => allNotes()[clipId] || '';

function setNote(clipId, text) {
  const notes = allNotes();
  if (text.trim()) notes[clipId] = text.trim(); else delete notes[clipId];
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

const activeFilterCount = () =>
  (filters.originals ? 1 : 0) + (filters.days ? 1 : 0) + (filters.city ? 1 : 0);

function currentCriteria() {
  return { q: searchTerm, genre: genreFilter, originals: filters.originals,
    days: filters.days, city: filters.city };
}

function criteriaLabel(c) {
  const bits = [];
  if (c.q) bits.push(`"${c.q}"`);
  if (c.genre) bits.push(c.genre);
  if (c.originals) bits.push('originals');
  if (c.city) bits.push('in ' + c.city);
  if (c.days) bits.push('last ' + (c.days === 1 ? '24h' : c.days + 'd'));
  return bits.join(' · ') || 'Everything';
}

/* Does this clip match a set of criteria? Shared by the grid and the
   unseen-count badge on each saved search. */
function matchesCriteria(c, crit) {
  const a = artist(c.artistId) || {};
  const q = (crit.q || '').toLowerCase().replace(/^#/, '');
  const hay = [c.title, c.song, c.genre, (c.tags || []).join(' '), a.name, a.handle, a.city]
    .join(' ').toLowerCase();
  if (q && !hay.includes(q)) return false;
  if (crit.genre && c.genre !== crit.genre && !(a.genres || []).includes(crit.genre)) return false;
  if (crit.originals && !c.original) return false;
  if (crit.city && !String(a.city || '').toLowerCase().includes(crit.city.toLowerCase())) return false;
  if (crit.days && now() - c.createdAt > crit.days * 86400000) return false;
  return true;
}

async function fillPoster(el, clipId) {
  const c = board.clips[clipId];
  if (!c) return;
  if (posterCache.has(clipId)) { el.innerHTML = `<img src="${posterCache.get(clipId)}" alt="">`; return; }
  const rec = await mediaGet(clipId);
  const url = rec && rec.poster ? URL.createObjectURL(rec.poster) : c.posterUrl;
  if (url) {
    posterCache.set(clipId, url);
    el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
  }
}

function tileHTML(c) {
  const a = artist(c.artistId) || { name: '', handle: '' };
  return `<button class="tile" data-open-clip="${c.id}">
    <div class="tile-fallback" style="background:linear-gradient(160deg,hsl(${c.hue != null ? c.hue : hueOf(c.id)} 65% 35%),hsl(${((c.hue != null ? c.hue : hueOf(c.id)) + 60) % 360} 60% 18%))"></div>
    <div class="tile-top">@${esc(a.handle)}</div>
    <div class="tile-meta"><svg class="ic"><use href="#i-play"/></svg>${compact(c.plays || 0)}</div>
  </button>`;
}

const matches = c => matchesCriteria(c, currentCriteria());

function renderDiscover() {
  const chips = $('#genreChips');
  if (!chips.dataset.built) {
    chips.innerHTML = ['All', ...GENRES].map(g =>
      `<button class="chip ${g === 'All' ? 'selected' : ''}" data-genre="${g === 'All' ? '' : g}">${g}</button>`).join('');
    chips.dataset.built = '1';
    chips.addEventListener('click', e => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      genreFilter = btn.dataset.genre;
      $$('.chip', chips).forEach(c => c.classList.toggle('selected', c === btn));
      renderDiscover();
    });
  }

  const rising = Object.values(board.artists)
    .filter(a => clipsOf(a.id).length)
    .sort((x, y) => artistScore(y) - artistScore(x))
    .slice(0, 10);
  $('#rising').innerHTML = rising.map((a, i) => `
    <button class="rising-card" data-open-artist="${a.id}">
      ${avatarHTML(a)}
      <div class="name">${esc(a.name)}</div>
      <div class="stat">#${i + 1} · ${compact(followerCount(a))} followers</div>
    </button>`).join('');
  $('#risingWrap').hidden = rising.length === 0;

  const narrowed = searchTerm || genreFilter || activeFilterCount();
  const results = Object.values(board.clips).filter(matches)
    .sort((a, b) => (narrowed ? clipScore(b) - clipScore(a) : b.createdAt - a.createdAt));
  $('#gridTitle').textContent = narrowed ? `Results (${results.length})` : 'Fresh clips';
  $('#discoverGrid').innerHTML = results.map(tileHTML).join('');
  $('#discoverEmpty').hidden = results.length > 0;
  $$('#discoverGrid .tile').forEach(el => fillPoster(el, el.dataset.openClip));

  const count = activeFilterCount();
  const badge = $('#filterCount');
  badge.hidden = !count;
  badge.textContent = count;
  $('#filterBtn').classList.toggle('selected', !!count);
  renderSavedSearches();
}

function renderSavedSearches() {
  const list = savedSearches();
  $('#savedWrap').hidden = list.length === 0;
  $('#savedList').innerHTML = list.map(s => {
    const fresh = Object.values(board.clips)
      .filter(c => c.createdAt > (s.seenAt || 0) && matchesCriteria(c, s)).length;
    return `<div class="saved-row">
      <button class="saved-open" data-open-search="${s.id}">
        <span class="t">${esc(s.name)}</span>
        <span class="s">${esc(criteriaLabel(s))}</span>
      </button>
      ${fresh ? `<span class="fresh-pill">${fresh} new</span>` : ''}
      <button class="icon-btn ghost sm" data-del-search="${s.id}" aria-label="Delete saved search">
        <svg class="ic"><use href="#i-trash"/></svg></button>
    </div>`;
  }).join('');

  $$('#savedList [data-open-search]').forEach(btn => btn.onclick = () => applySavedSearch(btn.dataset.openSearch));
  $$('#savedList [data-del-search]').forEach(btn => btn.onclick = () => {
    setSavedSearches(savedSearches().filter(s => s.id !== btn.dataset.delSearch));
    renderSavedSearches();
    toast('Saved search removed');
  });
}

function applySavedSearch(id) {
  const list = savedSearches();
  const s = list.find(x => x.id === id);
  if (!s) return;
  searchTerm = s.q || '';
  genreFilter = s.genre || '';
  filters = { originals: !!s.originals, days: s.days || 0, city: s.city || '' };
  $('#searchInput').value = searchTerm;
  $$('#genreChips .chip').forEach(c => c.classList.toggle('selected', c.dataset.genre === genreFilter));
  s.seenAt = now();                     // everything from here on counts as seen
  setSavedSearches(list);
  renderDiscover();
  $('.screen-body', $('#screen-discover')).scrollTop = 0;
}

function saveCurrentSearch() {
  const crit = currentCriteria();
  const suggested = criteriaLabel(crit);
  if (suggested === 'Everything') { toast('Search or filter something first'); return; }
  const name = prompt('Name this search', suggested);
  if (name === null) return;
  const list = savedSearches();
  list.unshift({ id: uid(), name: name.trim() || suggested, ...crit, seenAt: now() });
  setSavedSearches(list.slice(0, 12));
  renderDiscover();
  toast('Search saved — new matches show up here');
}

function openFilters() {
  const draft = { ...filters };
  openSheet({
    title: 'Filters',
    html: `
      <label class="switch-row"><span>Original songs only</span>
        <input id="fOriginals" type="checkbox" ${draft.originals ? 'checked' : ''}></label>
      <span class="field-label">Posted within</span>
      <div class="chips" id="fDays">
        ${[[0, 'Any time'], [1, '24 hours'], [7, '7 days'], [30, '30 days']].map(([d, label]) =>
      `<button type="button" class="chip ${draft.days === d ? 'selected' : ''}" data-days="${d}">${label}</button>`).join('')}
      </div>
      <label class="field" style="margin-top:18px"><span>Based in</span>
        <input id="fCity" maxlength="40" value="${esc(draft.city)}" placeholder="City or country"></label>
      <button class="btn-primary block" id="fApply">Show results</button>
      <button class="btn-ghost block" id="fClear" style="margin-top:10px">Clear filters</button>`,
  });
  $('#fDays').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    draft.days = Number(btn.dataset.days);
    $$('#fDays .chip').forEach(c => c.classList.toggle('selected', c === btn));
  });
  $('#fApply').onclick = () => {
    filters = { originals: $('#fOriginals').checked, days: draft.days, city: $('#fCity').value.trim() };
    closeSheet();
    renderDiscover();
  };
  $('#fClear').onclick = () => {
    filters = { originals: false, days: 0, city: '' };
    closeSheet();
    renderDiscover();
  };
}

$('#searchInput').addEventListener('input', e => { searchTerm = e.target.value.trim(); renderDiscover(); });
$('#filterBtn').addEventListener('click', openFilters);
$('#saveSearchBtn').addEventListener('click', saveCurrentSearch);

/* ───────────────────────── chart ───────────────────────── */

let chartMode = 'clips';

function renderChart() {
  const list = $('#chartList');
  let rows = [];

  if (chartMode === 'clips') {
    rows = Object.values(board.clips).sort((a, b) => clipScore(b) - clipScore(a)).slice(0, 25).map((c, i) => {
      const a = artist(c.artistId) || {};
      return { key: c.id, rank: i + 1, clipId: c.id, open: () => openClipInFeed(c.id),
        title: c.song || c.title, sub: `@${a.handle} · ${compact(c.plays || 0)} plays · ${compact(likeCount(c))} likes`,
        score: Math.round(clipScore(c)) };
    });
  } else {
    let artists = Object.values(board.artists).filter(a => clipsOf(a.id).length);
    if (chartMode === 'fresh') {
      artists = artists.filter(a => now() - a.createdAt < 14 * 86400000 || clipsOf(a.id).some(c => now() - c.createdAt < 3 * 86400000));
    }
    rows = artists.sort((x, y) => artistScore(y) - artistScore(x)).slice(0, 25).map((a, i) => ({
      key: a.id, rank: i + 1, artistId: a.id, open: () => openArtist(a.id),
      title: a.name, sub: `@${a.handle} · ${compact(followerCount(a))} followers · ${compact(totalPlays(a))} plays`,
      score: Math.round(artistScore(a)),
    }));
  }

  list.innerHTML = rows.map(r => `
    <li><button class="chart-row" data-key="${r.key}">
      <span class="chart-rank">${r.rank}</span>
      ${r.artistId ? avatarHTML(artist(r.artistId)) : `<span class="chart-thumb" data-poster="${r.clipId}" style="background:linear-gradient(160deg,hsl(${hueOf(r.clipId)} 60% 35%),hsl(${(hueOf(r.clipId) + 60) % 360} 60% 20%))"></span>`}
      <span class="chart-info"><span class="t">${esc(r.title)}</span><span class="s">${esc(r.sub)}</span></span>
      <span class="score-pill">${compact(r.score)}</span>
    </button></li>`).join('');
  $('#chartEmpty').hidden = rows.length > 0;

  $$('#chartList .chart-row').forEach(btn => {
    const row = rows.find(r => r.key === btn.dataset.key);
    btn.onclick = row.open;
  });
  $$('#chartList [data-poster]').forEach(el => fillPoster(el, el.dataset.poster));
}

$$('.chart-tabs [data-chart]').forEach(btn => btn.addEventListener('click', () => {
  chartMode = btn.dataset.chart;
  $$('.chart-tabs [data-chart]').forEach(b => b.classList.toggle('selected', b === btn));
  renderChart();
}));

function openClipInFeed(clipId) {
  feedMode = 'fresh';
  $$('.feed-head [data-feed]').forEach(b => b.classList.toggle('selected', b.dataset.feed === 'fresh'));
  renderFeed();
  show('feed');
  requestAnimationFrame(() => {
    const card = $(`.clip[data-clip="${clipId}"]`);
    if (card) { card.scrollIntoView(); setActiveClip(clipId); }
  });
}

/* ───────────────────────── profile ───────────────────────── */

let profileTab = 'clips';

function renderProfile(id) {
  const a = artist(id) || me();
  if (!a) return;
  viewedArtistId = a.id;
  const isMe = a.id === meId;
  const clips = clipsOf(a.id).sort((x, y) => y.createdAt - x.createdAt);
  const saved = Object.values(board.clips).filter(c => iSaved(c)).sort((x, y) => y.createdAt - x.createdAt);
  const rank = Object.values(board.artists).filter(x => clipsOf(x.id).length)
    .sort((x, y) => artistScore(y) - artistScore(x)).findIndex(x => x.id === a.id) + 1;

  const isScout = isMe && isVerifiedScout(a);
  // A scout's home is the shortlist, not a clip grid they'll never fill.
  if (isScout && profileTab === 'clips' && !clips.length) profileTab = 'saved';
  const shown = profileTab === 'saved' && isMe ? saved : clips;

  $('#profileBody').innerHTML = `
    <div class="prof-hero">
      ${!isMe ? `<div class="top-left"><button class="icon-btn ghost" data-back><svg class="ic"><use href="#i-back"/></svg></button></div>` : ''}
      ${isMe ? `<div class="top-right"><button class="icon-btn ghost" data-settings><svg class="ic"><use href="#i-cog"/></svg></button></div>` : ''}
      ${avatarHTML(a, 'lg')}
      <h2 class="prof-name">${esc(a.name)}</h2>
      <div class="prof-handle">@${esc(a.handle)}${a.city ? ' · ' + esc(a.city) : ''}</div>
      ${a.bio ? `<p class="prof-bio">${esc(a.bio)}</p>` : ''}
      <div class="prof-badges">
        ${isVerifiedScout(a) ? `<span class="pill verified">✓ Verified scout${a.company ? ' · ' + esc(a.company) : ''}</span>` : ''}
        ${isMe && a.scoutStatus === 'pending' ? '<span class="pill">Scout application pending</span>' : ''}
        ${rank && rank <= 10 ? `<span class="pill hot">#${rank} on the chart</span>` : ''}
        ${(a.genres || []).map(g => `<span class="pill">${esc(g)}</span>`).join('')}
      </div>
      <div class="prof-stats">
        ${isScout
      ? `<div><b>${compact(saved.length)}</b><span>shortlisted</span></div>
             <div><b>${compact(savedSearches().length)}</b><span>searches</span></div>
             <div><b>${compact(Object.values(board.artists).filter(x => iFollow(x)).length)}</b><span>following</span></div>`
      : `<div><b>${compact(clips.length)}</b><span>clips</span></div>
             <div><b>${compact(followerCount(a))}</b><span>followers</span></div>
             <div><b>${compact(totalLikes(a))}</b><span>likes</span></div>
             <div><b>${compact(totalPlays(a))}</b><span>plays</span></div>`}
      </div>
      <div class="prof-actions">
        ${isMe
      ? `<button class="btn-primary" data-edit>Edit profile</button>
             ${isScout
        ? '<button class="btn-ghost" data-find>Find talent</button>'
        : '<button class="btn-ghost" data-new-clip>New clip</button>'}`
      : `<button class="${iFollow(a) ? 'btn-ghost' : 'btn-primary'}" data-follow>${iFollow(a) ? 'Following' : 'Follow'}</button>
             <button class="btn-ghost" data-share-artist>Share</button>`}
      </div>
    </div>
    ${isMe ? `<div class="prof-tabs">
      <button class="tab-pill ${profileTab === 'clips' ? 'selected' : ''}" data-ptab="clips">Clips</button>
      <button class="tab-pill ${profileTab === 'saved' ? 'selected' : ''}" data-ptab="saved">${isScout ? 'Shortlist' : 'Saved'}</button>
    </div>` : ''}
    <div class="prof-grid">
      ${isMe && profileTab === 'saved'
      ? shortlistHTML(saved)
      : shown.length
        ? `<div class="grid">${shown.map(tileHTML).join('')}</div>`
        : `<p class="muted pad">${isMe ? 'No clips yet. Tap ✚ and sing something.' : 'No clips yet.'}</p>`}
    </div>`;

  $$('#profileBody .tile').forEach(el => fillPoster(el, el.dataset.openClip));

  const body = $('#profileBody');
  const on = (sel, fn) => { const el = $(sel, body); if (el) el.onclick = fn; };
  on('[data-back]', () => show('feed'));
  on('[data-settings]', openSettings);
  on('[data-edit]', openEditProfile);
  on('[data-new-clip]', openRecord);
  on('[data-find]', () => show('discover'));
  on('[data-follow]', () => toggleFollow(a.id));
  on('[data-share-artist]', async () => {
    try {
      const text = `${a.name} (@${a.handle}) on Spotlight`;
      if (navigator.share) await navigator.share({ title: 'Spotlight', text, url: location.href });
      else { await navigator.clipboard.writeText(`${text} ${location.href}`); toast('Link copied'); }
    } catch (e) { /* dismissed */ }
  });
  $$('[data-ptab]', body).forEach(btn => btn.onclick = () => { profileTab = btn.dataset.ptab; renderProfile(a.id); });
  if (isMe && profileTab === 'saved') wireShortlist(body);

  if (isMe && profileTab === 'clips') {
    $$('#profileBody .tile', body).forEach(tile => {
      let timer = null;
      const start = () => { timer = setTimeout(() => confirmDelete(tile.dataset.openClip), 550); };
      const cancel = () => clearTimeout(timer);
      tile.addEventListener('touchstart', start, { passive: true });
      tile.addEventListener('touchend', cancel);
      tile.addEventListener('touchmove', cancel);
      tile.addEventListener('mousedown', start);
      tile.addEventListener('mouseup', cancel);
      tile.addEventListener('mouseleave', cancel);
    });
  }
}

/* ── shortlist: the scout's working list ── */

function contactHref(a) {
  const v = String((a && a.contact) || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'mailto:' + v;
  return null;
}

function shortlistHTML(list) {
  const verified = iAmVerifiedScout();
  if (!list.length) {
    return `<p class="muted pad">Nothing shortlisted yet — tap the star on a clip you rate.
      Shortlisted singers land here with room for notes, and you can export the list as a CSV.</p>`;
  }
  const rows = list.map(c => {
    const a = artist(c.artistId) || { name: 'Unknown', handle: 'unknown' };
    const href = contactHref(a);
    const note = noteFor(c.id);
    return `<li class="shortlist-row">
      <button class="shortlist-main" data-open-clip="${c.id}">
        <span class="chart-thumb" data-poster="${c.id}" style="background:linear-gradient(160deg,hsl(${hueOf(c.id)} 60% 35%),hsl(${(hueOf(c.id) + 60) % 360} 60% 20%))"></span>
        <span class="chart-info">
          <span class="t">${esc(a.name)}</span>
          <span class="s">@${esc(a.handle)}${a.city ? ' · ' + esc(a.city) : ''}</span>
          <span class="s">${esc(c.song || c.title)}${c.original ? ' · original' : ''} · ${compact(c.plays || 0)} plays</span>
        </span>
        <span class="score-pill">${compact(Math.round(clipScore(c)))}</span>
      </button>
      ${note ? `<p class="shortlist-note">${esc(note)}</p>` : ''}
      <div class="shortlist-actions">
        <button class="chip" data-note="${c.id}">${note ? 'Edit note' : 'Add note'}</button>
        ${!verified
      ? `<button class="chip locked" data-locked="contact">Contact locked</button>`
      : href
        ? `<a class="chip" href="${esc(href)}" target="_blank" rel="noopener">Get in touch</a>`
        : `<button class="chip" data-nocontact="${c.artistId}">No contact details</button>`}
        <button class="chip" data-unsave="${c.id}">Remove</button>
      </div>
    </li>`;
  }).join('');

  return `<div class="shortlist-head">
      <span class="muted tiny">${list.length} shortlisted · notes stay on this device</span>
      ${verified
      ? '<button class="btn-ghost sm" id="exportBtn">Export CSV</button>'
      : '<button class="btn-ghost sm locked" data-locked="export">Export locked</button>'}
    </div>
    ${verified ? '' : `<p class="notice">Contact details and CSV export are for verified scouts.
      <button class="chip" data-locked="apply">Apply for access</button></p>`}
    <ul class="shortlist">${rows}</ul>`;
}

function wireShortlist(body) {
  $$('[data-poster]', body).forEach(el => fillPoster(el, el.dataset.poster));

  $$('[data-note]', body).forEach(btn => btn.onclick = () => {
    const id = btn.dataset.note;
    const c = board.clips[id];
    const a = artist(c.artistId) || {};
    openSheet({
      title: 'Note on ' + (a.name || 'this singer'),
      html: `<textarea id="noteText" maxlength="600" placeholder="Why they stood out, what to follow up on…">${esc(noteFor(id))}</textarea>
        <p class="tiny muted">Private to this device — never synced, never shown to the singer.</p>
        <button class="btn-primary block" id="noteSave">Save note</button>`,
    });
    $('#noteSave').onclick = () => {
      setNote(id, $('#noteText').value);
      closeSheet();
      renderProfile(meId);
      toast('Note saved');
    };
  });

  $$('[data-unsave]', body).forEach(btn => btn.onclick = () => {
    toggleSave(btn.dataset.unsave);
    renderProfile(meId);
  });

  $$('[data-nocontact]', body).forEach(btn => btn.onclick = () => {
    const a = artist(btn.dataset.nocontact) || {};
    toast(`@${a.handle} hasn't added contact details — leave a comment on their clip`);
  });

  const exportBtn = $('#exportBtn', body);
  if (exportBtn) exportBtn.onclick = exportShortlist;

  $$('[data-locked]', body).forEach(btn => btn.onclick = () => {
    const a = me();
    if (a.scoutStatus === 'pending') { toast('Your scout application is still under review'); return; }
    openScoutApplication();
  });
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportShortlist() {
  if (!iAmVerifiedScout()) { openScoutApplication(); return; }   // contact details ride along in the CSV
  const list = Object.values(board.clips).filter(c => iSaved(c))
    .sort((a, b) => clipScore(b) - clipScore(a));
  if (!list.length) { toast('Nothing to export yet'); return; }

  const header = ['Singer', 'Handle', 'Based in', 'Genres', 'Contact', 'Song', 'Original',
    'Caption', 'Plays', 'Likes', 'Comments', 'Score', 'Posted', 'Note'];
  const rows = list.map(c => {
    const a = artist(c.artistId) || {};
    return [a.name, '@' + a.handle, a.city, (a.genres || []).join(' / '), a.contact,
      c.song, c.original ? 'yes' : 'no', c.title, c.plays || 0, likeCount(c), commentCount(c),
      Math.round(clipScore(c)), new Date(c.createdAt).toISOString().slice(0, 10), noteFor(c.id)];
  });
  const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');

  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spotlight-shortlist-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Exported ${list.length} singers`);
  } catch (e) {
    navigator.clipboard.writeText(csv).then(() => toast('CSV copied to clipboard'),
      () => toast('Could not export on this browser'));
  }
}

function confirmDelete(clipId) {
  const c = board.clips[clipId];
  if (!c || c.artistId !== meId) return;
  if (!confirm(`Delete "${c.song || c.title}"? This can't be undone.`)) return;
  delete board.clips[clipId];
  mediaDelete(clipId);
  deleteRemoteMedia(c);
  posterCache.delete(clipId);
  saveBoard();
  toast('Clip deleted');
  renderProfile(meId);
  renderFeed();
}

/* ───────────────────────── edit profile & settings ───────────────────────── */

function genreChipsHTML(selected) {
  return GENRES.map(g => `<button type="button" class="chip ${selected.includes(g) ? 'selected' : ''}" data-g="${g}">${g}</button>`).join('');
}

function wireGenreChips(container, selected, max = 4) {
  container.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const g = btn.dataset.g;
    const i = selected.indexOf(g);
    if (i >= 0) selected.splice(i, 1);
    else if (selected.length < max) selected.push(g);
    else { toast(`Pick up to ${max}`); return; }
    btn.classList.toggle('selected', selected.includes(g));
  });
}

function scoutStatusHTML(a) {
  if (isVerifiedScout(a)) {
    return `<div class="notice ok">Verified scout${a.company ? ' · ' + esc(a.company) : ''}
      <br><small>Verified ${new Date(a.scoutSince || now()).toLocaleDateString()}</small></div>`;
  }
  if (a.scoutStatus === 'pending') {
    return `<div class="notice">Scout application under review. You can browse and post meanwhile —
      contact details and export stay locked until it's approved.</div>`;
  }
  if (a.scoutStatus === 'rejected') {
    return `<div class="notice warn">Scout application declined${a.scoutRejectReason ? ': ' + esc(a.scoutRejectReason) : ''}.
      <button class="chip" id="epApply" type="button">Apply again</button></div>`;
  }
  return `<div class="notice">Working in the industry?
    <button class="chip" id="epApply" type="button">Apply for scout access</button></div>`;
}

/* Same form as onboarding, for anyone who signed up as a singer first. */
function openScoutApplication() {
  const a = me();
  openSheet({
    title: 'Apply for scout access',
    html: `
      <p class="tiny muted">Scout accounts see singers' contact details and can export shortlists,
      so they're verified first. An invite code unlocks it immediately; otherwise this goes to review.</p>
      <label class="field"><span>Company or label</span>
        <input id="saCompany" maxlength="60" value="${esc(a.company || '')}" placeholder="Parlophone, or freelance A&amp;R"></label>
      <label class="field"><span>Your role there</span>
        <input id="saTitle" maxlength="60" placeholder="A&amp;R, booker, vocal coach, casting"></label>
      <label class="field"><span>Work email</span>
        <input id="saEmail" maxlength="80" placeholder="you@label.com" autocapitalize="off"></label>
      <label class="field"><span>Website or roster link</span>
        <input id="saSite" maxlength="140" placeholder="label.com, LinkedIn, Companies House…" autocapitalize="off"></label>
      <label class="field"><span>Invite code (optional)</span>
        <input id="saCode" maxlength="24" placeholder="SPOT-XXXX-XXXX" autocapitalize="characters" autocorrect="off"></label>
      <button class="btn-primary block" id="saSend">Submit</button>`,
  });
  $('#saSend').onclick = () => {
    const fields = {
      company: $('#saCompany').value.trim(), title: $('#saTitle').value.trim(),
      workEmail: $('#saEmail').value.trim(), website: $('#saSite').value.trim(),
      code: $('#saCode').value.trim(),
    };
    if (!fields.company || !fields.workEmail) { toast('Company and work email are required'); return; }
    if (fields.code && !findCode(fields.code)) { toast('That invite code is not recognised'); return; }

    const redeemed = fields.code ? redeemCode(fields.code, meId) : null;
    const instant = redeemed && redeemed.ok;
    if (fields.code && !instant) { toast(redeemed.error); return; }

    const app = applicationFrom({ ...fields, codeUsed: instant ? normalizeCode(fields.code) : '' },
      meId, instant ? 'approved' : 'pending');
    board.applications[app.id] = app;
    if (instant) grantScout(a, app);
    else { a.scoutStatus = 'pending'; a.scoutRejectReason = ''; a.updatedAt = now(); }
    saveBoard();
    closeSheet();
    renderProfile(meId);
    toast(instant ? 'Verified — scout tools unlocked' : 'Application sent for review');
  };
}

function openEditProfile() {
  const a = me();
  const genres = [...(a.genres || [])];
  openSheet({
    title: 'Edit profile',
    html: `
      <label class="field"><span>Name</span><input id="epName" maxlength="30" value="${esc(a.name)}"></label>
      <label class="field"><span>Handle</span><div class="handle-input"><i>@</i><input id="epHandle" maxlength="20" value="${esc(a.handle)}" autocapitalize="off"></div></label>
      <label class="field"><span>Where you're based</span><input id="epCity" maxlength="40" value="${esc(a.city || '')}" placeholder="City, country"></label>
      <label class="field"><span>Bio</span><textarea id="epBio" maxlength="200" placeholder="What should a scout know in one line?">${esc(a.bio || '')}</textarea></label>
      <label class="field"><span>Contact for work</span>
        <input id="epContact" maxlength="120" value="${esc(a.contact || '')}" placeholder="booking@email.com or a link" autocapitalize="off">
        <small class="tiny muted">Shown to scouts who shortlist you, so they can actually reach you.</small></label>
      ${scoutStatusHTML(a)}
      <span class="field-label">Genres</span>
      <div class="chips" id="epGenres">${genreChipsHTML(genres)}</div>
      <button class="btn-primary block" id="epSave">Save</button>`,
    onFoot: null,
  });
  wireGenreChips($('#epGenres'), genres);
  const applyBtn = $('#epApply');
  if (applyBtn) applyBtn.onclick = openScoutApplication;
  $('#epSave').onclick = () => {
    const name = $('#epName').value.trim();
    const handle = $('#epHandle').value.trim().replace(/[^a-z0-9._]/gi, '').toLowerCase();
    if (!name || !handle) { toast('Name and handle are required'); return; }
    Object.assign(a, { name, handle, city: $('#epCity').value.trim(), bio: $('#epBio').value.trim(),
      contact: $('#epContact').value.trim(), genres, updatedAt: now() });
    saveBoard();
    closeSheet();
    renderProfile(meId);
    renderFeed({ keepScroll: true });
    toast('Profile saved');
  };
}

/* ── owner console ──
   Ownership is claimed once, by the first device to ask, and after that only
   that account sees the review queue. With sync on, applications from other
   phones land here; without it, this only ever sees local ones. */

const pendingCount = () => iAmOwner()
  ? Object.values(board.applications || {}).filter(x => x.status === 'pending').length : 0;

function ownerLabel() {
  if (!board.owner) return 'Unclaimed — review scout applications';
  if (iAmOwner()) return 'Review applications and issue invite codes';
  const o = artist(board.owner.artistId);
  return `Owned by ${o ? '@' + o.handle : 'another account'}`;
}

function openOwnerTools() {
  if (!board.owner) {
    openSheet({
      title: 'Owner tools',
      html: `<p class="tiny muted">Nobody has claimed this Spotlight yet. The owner reviews scout
        applications and issues invite codes. This is one-time and can't be transferred from here —
        claim it on the device you'll actually use to review.</p>
        <button class="btn-primary block" id="claimBtn">Claim ownership</button>`,
    });
    $('#claimBtn').onclick = () => {
      if (board.owner) { toast('Already claimed'); return; }
      board.owner = { artistId: meId, claimedAt: now() };
      saveBoard();
      toast('You own this Spotlight');
      openOwnerTools();
    };
    return;
  }
  if (!iAmOwner()) {
    const o = artist(board.owner.artistId);
    openSheet({ title: 'Owner tools',
      html: `<p class="muted pad">This Spotlight is owned by ${o ? '@' + esc(o.handle) : 'another account'}.
        Scout applications are reviewed there.</p>` });
    return;
  }
  renderOwnerConsole();
}

function renderOwnerConsole() {
  const apps = Object.values(board.applications || {}).sort((a, b) => b.createdAt - a.createdAt);
  const pending = apps.filter(x => x.status === 'pending');
  const decided = apps.filter(x => x.status !== 'pending').slice(0, 10);
  const codes = Object.values(board.codes || {}).sort((a, b) => b.createdAt - a.createdAt);

  const appRow = a => {
    const who = artist(a.artistId) || { name: 'Unknown', handle: 'unknown' };
    return `<div class="app-card">
      <div class="app-who">${avatarHTML(who, 'sm')}
        <div class="grow"><b>${esc(who.name)}</b><div class="tiny muted">@${esc(who.handle)} · ${ago(a.createdAt)} ago</div></div>
        <span class="pill ${a.status === 'approved' ? 'verified' : a.status === 'rejected' ? 'warn' : ''}">${a.status}</span>
      </div>
      <dl class="app-facts">
        <dt>Company</dt><dd>${esc(a.company || '—')}</dd>
        <dt>Role</dt><dd>${esc(a.title || '—')}</dd>
        <dt>Work email</dt><dd>${esc(a.workEmail || '—')}</dd>
        <dt>Link</dt><dd>${a.website ? `<a href="${esc(/^https?:/i.test(a.website) ? a.website : 'https://' + a.website)}" target="_blank" rel="noopener">${esc(a.website)}</a>` : '—'}</dd>
        ${a.codeUsed ? `<dt>Code</dt><dd>${esc(a.codeUsed)}</dd>` : ''}
        ${a.reason ? `<dt>Reason</dt><dd>${esc(a.reason)}</dd>` : ''}
      </dl>
      ${a.status === 'pending' ? `<div class="app-actions">
        <button class="btn-primary sm" data-approve="${a.id}">Approve</button>
        <button class="btn-ghost sm" data-reject="${a.id}">Decline</button>
      </div>` : ''}
    </div>`;
  };

  openSheet({
    title: 'Owner tools',
    html: `
      <h4 class="owner-h">Applications${pending.length ? ` · ${pending.length} waiting` : ''}</h4>
      ${pending.length ? pending.map(appRow).join('')
      : '<p class="tiny muted">Nothing waiting. Applications from other devices appear here when sync is on.</p>'}

      <h4 class="owner-h">Invite codes</h4>
      <button class="btn-ghost sm" id="newCode">Generate a code</button>
      <div class="code-list">
        ${codes.length ? codes.map(c => `<div class="code-row">
            <div class="grow"><b class="mono">${esc(c.code)}</b>
              <div class="tiny muted">${esc(c.label || 'unlabelled')} · ${c.revoked ? 'revoked'
          : c.usedBy ? 'used by @' + esc((artist(c.usedBy) || {}).handle || '?') : 'unused'}</div></div>
            <button class="chip" data-copy="${esc(c.code)}">Copy</button>
            ${!c.usedBy && !c.revoked ? `<button class="chip" data-revoke="${esc(c.code)}">Revoke</button>` : ''}
          </div>`).join('')
      : '<p class="tiny muted">No codes yet. Generate one and send it to a scout you already trust.</p>'}
      </div>

      ${decided.length ? `<h4 class="owner-h">Recently decided</h4>${decided.map(appRow).join('')}` : ''}`,
  });

  $('#newCode').onclick = () => {
    const label = prompt('Who is this code for? (e.g. "Sony A&R — Priya")', '');
    if (label === null) return;
    const code = makeCode();
    board.codes[code] = { code, label: label.trim(), createdAt: now(), createdBy: meId, updatedAt: now() };
    saveBoard();
    renderOwnerConsole();
    toast('Code created: ' + code);
  };
  $$('#sheetBody [data-approve]').forEach(b => b.onclick = () => {
    decideApplication(b.dataset.approve, true);
    renderOwnerConsole();
    toast('Approved — scout tools unlocked for them');
  });
  $$('#sheetBody [data-reject]').forEach(b => b.onclick = () => {
    const reason = prompt('Reason (shown to them, optional)', '');
    if (reason === null) return;
    decideApplication(b.dataset.reject, false, reason.trim());
    renderOwnerConsole();
    toast('Declined');
  });
  $$('#sheetBody [data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy)
      .then(() => toast('Code copied'), () => toast(b.dataset.copy));
  });
  $$('#sheetBody [data-revoke]').forEach(b => b.onclick = () => {
    const c = findCode(b.dataset.revoke);
    if (!c) return;
    c.revoked = true;
    c.updatedAt = now();
    saveBoard();
    renderOwnerConsole();
    toast('Code revoked');
  });
}

function openSettings() {
  const synced = !!fbRef;
  openSheet({
    title: 'Settings',
    html: `
      <div class="set-group">
        <button class="list-row" id="setEdit"><svg class="ic"><use href="#i-user"/></svg><span class="grow">Edit profile</span></button>
        <button class="list-row" id="setSync"><svg class="ic"><use href="#i-share"/></svg>
          <span class="grow">Sync across devices<br><small class="muted">${synced ? 'Connected to Firebase' : 'Off — this device only'}</small></span></button>
        <button class="list-row" id="setOwner"><svg class="ic"><use href="#i-star"/></svg>
          <span class="grow">Owner tools<br><small class="muted">${ownerLabel()}</small></span>
          ${pendingCount() ? `<span class="fresh-pill">${pendingCount()}</span>` : ''}</button>
      </div>
      <div class="set-group">
        <p class="tiny muted">Clip metadata lives in this browser and video files in IndexedDB on this device.
        Turning on sync shares profiles, captions, likes and comments through Firebase, and uploads the
        video files to Firebase Storage so other phones can play them.</p>
      </div>
      <button class="btn-danger block" id="setReset">Reset everything on this device</button>`,
  });
  $('#setEdit').onclick = openEditProfile;
  $('#setSync').onclick = openSyncPanel;
  $('#setOwner').onclick = openOwnerTools;
  $('#setReset').onclick = async () => {
    if (!confirm('Delete your profile, clips and videos from this device?')) return;
    localStorage.removeItem(BOARD_KEY);
    localStorage.removeItem(ME_KEY);
    localStorage.removeItem(FB_KEY);
    try {
      const d = await db();
      await new Promise(res => { const tx = d.transaction('media', 'readwrite'); tx.objectStore('media').clear(); tx.oncomplete = res; tx.onerror = res; });
    } catch (e) { /* ignore */ }
    location.reload();
  };
}

function openSyncPanel() {
  const saved = localStorage.getItem(FB_KEY) || '';
  openSheet({
    title: 'Sync across devices',
    html: `
      <p class="tiny muted">Paste a Firebase web config to share everything between phones — profiles,
      clips, likes and comments through Realtime Database, and the video files themselves through
      Storage. Your existing clips upload in the background as soon as this connects.</p>
      <p class="tiny muted">The config needs a <b>storageBucket</b> for video; without one you get
      metadata sync only and clips stay on the phone that recorded them.</p>
      <label class="field"><span>Firebase config JSON</span>
        <textarea id="fbConfig" placeholder='{"apiKey":"…","databaseURL":"https://…firebaseio.com","projectId":"…"}'>${esc(saved ? JSON.stringify(JSON.parse(saved), null, 2) : '')}</textarea></label>
      <button class="btn-primary block" id="fbOn">${fbRef ? 'Reconnect' : 'Turn on sync'}</button>
      ${fbRef || saved ? '<button class="btn-ghost block" id="fbOff">Turn off sync</button>' : ''}`,
  });
  $('#fbOn').onclick = () => {
    let cfg;
    try { cfg = JSON.parse($('#fbConfig').value.trim()); }
    catch (e) { toast('That is not valid JSON'); return; }
    connectFirebase(cfg).then(ok => { if (ok) closeSheet(); });
  };
  const off = $('#fbOff');
  if (off) off.onclick = () => {
    disconnectFirebase();
    localStorage.removeItem(FB_KEY);
    closeSheet();
    toast('Sync off — this device only');
  };
}

/* ───────────────────────── record ───────────────────────── */

let stream = null;
let recorder = null;
let chunks = [];
let recStart = 0;
let recTimerId = null;
let facing = 'user';
let pendingBlob = null;
let pendingPoster = null;
let pendingDuration = 0;
let pendingMirror = false;
let playbackUrl = null;

function openRecord() {
  currentScreen = 'record';
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-record'));
  $$('#tabbar .tab').forEach(t => t.classList.toggle('active', t.dataset.screen === 'record'));
  pauseAllClips();
  resetRecordUI();
  startCamera();
}

function closeRecord({ silent = false } = {}) {
  stopCamera();
  if (recorder && recorder.state === 'recording') { try { recorder.stop(); } catch (e) {} }
  clearInterval(recTimerId);
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
  pendingBlob = null; pendingPoster = null;
  if (!silent) show('feed');
}

function resetRecordUI() {
  $('#recDetails').hidden = true;
  $('#recDone').hidden = true;
  $('#recControls').hidden = false;
  $('#recPlayback').hidden = true;
  $('#recPreview').hidden = false;
  $('#recBtn').classList.remove('recording');
  $('#recRing').style.strokeDashoffset = 289;
  $('#recTimer').textContent = '0:00 / 1:00';
  $('#recTimer').classList.remove('live');
  $('#recHint').hidden = true;
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#recHint').hidden = false;
    $('#recHint').textContent = 'This browser cannot record here — upload a clip instead.';
    $('#recBtn').disabled = true;
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
    });
    const prev = $('#recPreview');
    prev.srcObject = stream;
    prev.classList.toggle('back-cam', facing !== 'user');
    prev.play().catch(() => {});
    $('#recBtn').disabled = false;
    $('#recHint').hidden = true;
  } catch (e) {
    $('#recHint').hidden = false;
    $('#recHint').textContent = 'Camera or mic blocked. Allow access in your browser settings, or upload a clip with the button below.';
    $('#recBtn').disabled = true;
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  const prev = $('#recPreview');
  prev.srcObject = null;
}

function pickMime() {
  const candidates = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function countdown() {
  const el = $('#recCountdown');
  el.hidden = false;
  for (let i = 3; i > 0; i--) {
    el.innerHTML = `<b>${i}</b>`;
    await new Promise(r => setTimeout(r, 700));
  }
  el.hidden = true;
}

async function startRecording() {
  if (!stream) return;
  await countdown();
  if (!stream) return;                    // user left mid-countdown
  chunks = [];
  const mime = pickMime();
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : undefined);
  } catch (e) { toast('Recording is not supported here — try uploading'); return; }

  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => finishRecording(mime);
  recorder.start(250);
  recStart = now();
  pendingMirror = facing === 'user';
  $('#recBtn').classList.add('recording');
  $('#recTimer').classList.add('live');

  recTimerId = setInterval(() => {
    const ms = now() - recStart;
    const s = Math.floor(ms / 1000);
    $('#recTimer').textContent = `0:${String(s).padStart(2, '0')} / 1:00`;
    $('#recRing').style.strokeDashoffset = String(289 - 289 * clamp(ms / MAX_CLIP_MS, 0, 1));
    if (ms >= MAX_CLIP_MS) stopRecording();
  }, 100);
}

function stopRecording() {
  clearInterval(recTimerId);
  if (recorder && recorder.state === 'recording') recorder.stop();
  $('#recBtn').classList.remove('recording');
  $('#recTimer').classList.remove('live');
}

async function finishRecording(mime) {
  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  chunks = [];
  if (blob.size < 1000) { toast('That was too short — hold on a bit longer'); return; }
  pendingDuration = now() - recStart;
  await preparePending(blob);
}

async function preparePending(blob) {
  pendingBlob = blob;
  pendingPoster = await makePoster(blob);
  stopCamera();
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = URL.createObjectURL(blob);
  const pb = $('#recPlayback');
  pb.src = playbackUrl;
  pb.classList.toggle('mirror', pendingMirror);
  pb.hidden = false;
  pb.muted = false;
  pb.play().catch(() => {});
  $('#recPreview').hidden = true;
  $('#recControls').hidden = true;
  $('#recDone').hidden = false;
  $('#recHint').hidden = true;
}

function makePoster(blob) {
  return new Promise(resolve => {
    let settled = false;
    const finish = res => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(res); };
    const v = document.createElement('video');
    const url = URL.createObjectURL(blob);
    v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;

    const draw = () => {
      try {
        const w = 270;
        const ratio = (v.videoHeight || 16) / (v.videoWidth || 9);
        const c = document.createElement('canvas');
        c.width = w; c.height = Math.round(w * ratio);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => finish(b), 'image/jpeg', 0.72);
      } catch (e) { finish(null); }
    };
    v.onloadeddata = () => {
      const target = isFinite(v.duration) && v.duration > 0.6 ? Math.min(0.5, v.duration / 3) : 0;
      if (target > 0) { try { v.currentTime = target; } catch (e) { draw(); } } else draw();
    };
    v.onseeked = draw;
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 4000);
  });
}

$('#recBtn').addEventListener('click', () => {
  if (recorder && recorder.state === 'recording') stopRecording();
  else startRecording();
});

$('#flipBtn').addEventListener('click', async () => {
  if (recorder && recorder.state === 'recording') return;
  facing = facing === 'user' ? 'environment' : 'user';
  stopCamera();
  await startCamera();
});

$('#retakeBtn').addEventListener('click', async () => {
  pendingBlob = null; pendingPoster = null;
  const pb = $('#recPlayback');
  pb.pause(); pb.removeAttribute('src'); pb.load();
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
  resetRecordUI();
  await startCamera();
});

$('#uploadInput').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 80 * 1024 * 1024) { toast('That file is over 80MB — try a shorter clip'); return; }
  pendingMirror = false;
  pendingDuration = 0;
  toast('Preparing clip…');
  await preparePending(file);
});

$('#nextBtn').addEventListener('click', () => {
  const a = me();
  const genres = a && a.genres && a.genres.length ? [a.genres[0]] : ['Pop'];
  $('#recDetails').hidden = false;
  $('#clipTitle').value = '';
  $('#clipSong').value = '';
  $('#clipTags').value = '';
  $('#clipOriginal').checked = false;
  $('#clipGenres').innerHTML = genreChipsHTML(genres);
  $('#clipGenres').dataset.picked = genres[0];
  $('#detailsPoster').innerHTML = pendingPoster
    ? `<img src="${URL.createObjectURL(pendingPoster)}" alt="">`
    : `<div style="width:100%;height:100%;background:${gradientFor(uid())}"></div>`;
  $('#recPlayback').pause();
});

$('#clipGenres').addEventListener('click', e => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  $$('#clipGenres .chip').forEach(c => c.classList.toggle('selected', c === btn));
  $('#clipGenres').dataset.picked = btn.dataset.g;
});

$('#detailsBack').addEventListener('click', () => {
  $('#recDetails').hidden = true;
  $('#recPlayback').play().catch(() => {});
});

$('#postBtn').addEventListener('click', async () => {
  if (!pendingBlob) { toast('Record or upload a clip first'); return; }
  const title = $('#clipTitle').value.trim();
  const song = $('#clipSong').value.trim();
  const id = uid();

  const btn = $('#postBtn');
  btn.disabled = true;
  btn.textContent = 'Posting…';

  try {
    await mediaPut({ id, video: pendingBlob, poster: pendingPoster || null, at: now() });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Post to Spotlight';
    toast('Could not save the video — device storage may be full');
    return;
  }

  board.clips[id] = {
    id, artistId: meId,
    title: title || (song ? song : 'New clip'),
    song: song || 'Original sound',
    original: $('#clipOriginal').checked,
    genre: $('#clipGenres').dataset.picked || 'Pop',
    tags: $('#clipTags').value.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 6),
    durationMs: pendingDuration || 0,
    mirror: pendingMirror,
    plays: 0, likes: {}, likeSeed: 0, shortlists: {}, shortlistSeed: 0, comments: [],
    createdAt: now(), updatedAt: now(),
  };
  saveBoard();
  queueUpload(id);                                // uploads in the background if sync is on

  btn.disabled = false;
  btn.textContent = 'Post to Spotlight';
  pendingBlob = null; pendingPoster = null;
  closeRecord({ silent: true });
  feedMode = 'fresh';
  $$('.feed-head [data-feed]').forEach(b => b.classList.toggle('selected', b.dataset.feed === 'fresh'));
  renderFeed();
  show('feed');
  requestAnimationFrame(() => {
    const card = $(`.clip[data-clip="${id}"]`);
    if (card) { card.scrollIntoView(); setActiveClip(id); }
  });
  toast('Posted — good luck out there');
});

$$('[data-close-record]').forEach(b => b.addEventListener('click', () => closeRecord()));

/* ───────────────────────── optional Firebase sync ───────────────────────── */

let fbRef = null;
let fbStorage = null;
let applyingRemote = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('load failed: ' + src));
    document.head.appendChild(s);
  });
}

/* Union merge: newest wins per entity, engagement maps merge, comments dedupe by id. */
function mergeBoards(local, remote) {
  const out = { artists: {}, clips: {}, codes: {}, applications: {}, owner: null };

  // Codes and applications are plain records: whichever side was written last
  // wins, so a redemption or an approval propagates without special casing.
  for (const kind of ['codes', 'applications']) {
    const ids = new Set([...Object.keys(local[kind] || {}), ...Object.keys(remote[kind] || {})]);
    for (const id of ids) {
      const l = (local[kind] || {})[id];
      const r = (remote[kind] || {})[id];
      out[kind][id] = !l ? r : !r ? l : ((r.updatedAt || 0) > (l.updatedAt || 0) ? r : l);
    }
  }

  // Ownership is claimed once; the earliest claim wins so every device agrees.
  const owners = [local.owner, remote.owner].filter(Boolean);
  out.owner = owners.sort((a, b) => (a.claimedAt || 0) - (b.claimedAt || 0))[0] || null;

  for (const kind of ['artists', 'clips']) {
    const ids = new Set([...Object.keys(local[kind] || {}), ...Object.keys(remote[kind] || {})]);
    for (const id of ids) {
      const l = (local[kind] || {})[id];
      const r = (remote[kind] || {})[id];
      if (!l) { out[kind][id] = r; continue; }
      if (!r) { out[kind][id] = l; continue; }
      const base = (r.updatedAt || 0) > (l.updatedAt || 0) ? { ...l, ...r } : { ...r, ...l };
      base.likes = { ...(l.likes || {}), ...(r.likes || {}) };
      base.shortlists = { ...(l.shortlists || {}), ...(r.shortlists || {}) };
      base.followers = { ...(l.followers || {}), ...(r.followers || {}) };
      const seen = new Set();
      base.comments = [...(l.comments || []), ...(r.comments || [])]
        .filter(c => c && !seen.has(c.id) && seen.add(c.id))
        .sort((a, b) => a.at - b.at);
      base.plays = Math.max(l.plays || 0, r.plays || 0);
      out[kind][id] = base;
    }
  }
  return out;
}

async function connectFirebase(config) {
  try {
    if (typeof firebase === 'undefined') {
      toast('Loading Firebase…');
      await loadScript('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.13.0/firebase-storage-compat.js');
    }
    if (firebase.apps.length) await firebase.app().delete();
    firebase.initializeApp(config);
    fbRef = firebase.database().ref(FB_PATH);
    fbRef.on('value', snap => {
      const remote = snap.val();
      if (!remote) { fbRef.set(board); return; }
      applyingRemote = true;
      board = mergeBoards(board, {
        artists: remote.artists || {}, clips: remote.clips || {},
        codes: remote.codes || {}, applications: remote.applications || {},
        owner: remote.owner || null,
      });
      localStorage.setItem(BOARD_KEY, JSON.stringify(board));
      applyingRemote = false;
      if (currentScreen === 'feed') renderFeed({ keepScroll: true });
      if (currentScreen === 'discover') renderDiscover();
      if (currentScreen === 'charts') renderChart();
      if (currentScreen === 'profile') renderProfile(viewedArtistId || meId);
    });

    fbStorage = null;
    if (config.storageBucket && firebase.storage) {
      try { fbStorage = firebase.storage(); } catch (e) { console.error(e); }
    }
    localStorage.setItem(FB_KEY, JSON.stringify(config));
    toast(fbStorage ? 'Sync on — clips will upload' : 'Sync on (metadata only, no storageBucket)');
    if (fbStorage) backfillUploads();
    return true;
  } catch (e) {
    console.error(e);
    fbRef = null;
    fbStorage = null;
    toast('Could not connect — check the config and database rules');
    return false;
  }
}

function disconnectFirebase() {
  if (fbRef) { fbRef.off(); fbRef = null; }
  fbStorage = null;
  uploadQueue.length = 0;
}

/* ── video files in Firebase Storage ──
   Clips upload in the background after posting so the feed never waits on a
   network round trip. The download URLs go on the clip record, which the
   Realtime Database sync then carries to everyone else. */

const uploadQueue = [];
let uploading = false;

function extFor(type) {
  if (!type) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime')) return 'mov';
  return 'webm';
}

function showUploadProgress(pct) {
  const bar = $('#uploadPill');
  bar.hidden = false;
  $('#uploadPct', bar).textContent = Math.round(pct) + '%';
  $('#uploadFill', bar).style.width = clamp(pct, 0, 100) + '%';
}

function hideUploadProgress() { $('#uploadPill').hidden = true; }

function queueUpload(clipId) {
  if (!fbStorage || uploadQueue.includes(clipId)) return;
  uploadQueue.push(clipId);
  runUploadQueue();
}

async function runUploadQueue() {
  if (uploading) return;
  uploading = true;
  while (uploadQueue.length && fbStorage) {
    const id = uploadQueue.shift();
    try { await uploadClipMedia(id); }
    catch (e) {
      console.error(e);
      const c = board.clips[id];
      if (c) { c.uploadError = true; c.updatedAt = now(); saveBoard(); }
      toast('Clip upload failed — it will retry next time sync connects');
    }
  }
  uploading = false;
  hideUploadProgress();
}

function putWithProgress(ref, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const task = ref.put(blob, { contentType: contentType || blob.type || 'application/octet-stream' });
    task.on('state_changed',
      snap => { if (onProgress && snap.totalBytes) onProgress(snap.bytesTransferred / snap.totalBytes * 100); },
      reject,
      () => ref.getDownloadURL().then(resolve, reject));
  });
}

async function uploadClipMedia(id) {
  const c = board.clips[id];
  if (!fbStorage || !c || c.artistId !== meId || c.videoUrl) return;
  const rec = await mediaGet(id);
  if (!rec || !rec.video) return;                 // nothing local left to upload

  showUploadProgress(0);
  const ext = extFor(rec.video.type);
  const videoUrl = await putWithProgress(
    fbStorage.ref(`clips/${id}.${ext}`), rec.video, rec.video.type, showUploadProgress);

  let posterUrl = null;
  if (rec.poster) {
    try {
      posterUrl = await putWithProgress(fbStorage.ref(`posters/${id}.jpg`), rec.poster, 'image/jpeg');
    } catch (e) { console.error(e); }             // a missing poster is survivable
  }

  const fresh = board.clips[id];
  if (!fresh) return;                             // deleted while uploading
  fresh.videoUrl = videoUrl;
  fresh.videoType = rec.video.type || '';
  if (posterUrl) fresh.posterUrl = posterUrl;
  fresh.uploadError = false;
  fresh.updatedAt = now();
  saveBoard();
  hideUploadProgress();
  toast('Clip synced — everyone can see it now');
}

/* Clips posted before sync was switched on, or whose upload failed. */
function backfillUploads() {
  Object.values(board.clips)
    .filter(c => c.artistId === meId && !c.demo && !c.videoUrl)
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach(c => queueUpload(c.id));
}

async function deleteRemoteMedia(c) {
  if (!fbStorage || !c.videoUrl) return;
  const ext = extFor(c.videoType);
  for (const path of [`clips/${c.id}.${ext}`, `posters/${c.id}.jpg`]) {
    try { await fbStorage.ref(path).delete(); } catch (e) { /* already gone */ }
  }
}

let pushTimer = null;
function pushToFirebase() {
  if (!fbRef || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { try { fbRef.set(board); } catch (e) {} }, 400);
}

/* ───────────────────────── onboarding ───────────────────────── */

function startOnboarding() {
  const overlay = $('#onboarding');
  overlay.hidden = false;
  const genres = [];
  let role = 'singer';

  $('#obGenres').innerHTML = genreChipsHTML(genres);
  wireGenreChips($('#obGenres'), genres);

  $$('.role-btn').forEach(btn => btn.onclick = () => {
    role = btn.dataset.role;
    $$('.role-btn').forEach(b => b.classList.toggle('selected', b === btn));
    $('#obSingerFields').hidden = role === 'scout';
    $('#obScoutFields').hidden = role !== 'scout';
    $('#obStart').textContent = role === 'scout' ? 'Apply for scout access' : 'Enter the room';
  });

  const nameEl = $('#obName');
  const handleEl = $('#obHandle');
  nameEl.addEventListener('input', () => {
    if (handleEl.dataset.touched) return;
    handleEl.value = nameEl.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  });
  handleEl.addEventListener('input', () => { handleEl.dataset.touched = '1'; });

  $('#obStart').onclick = () => {
    const name = nameEl.value.trim();
    const handle = handleEl.value.trim().replace(/[^a-z0-9._]/gi, '').toLowerCase();
    if (!name) { toast('What should we call you?'); nameEl.focus(); return; }
    if (!handle) { toast('Pick a handle'); handleEl.focus(); return; }

    const fields = role === 'scout' ? {
      company: $('#obCompany').value.trim(),
      title: $('#obTitle').value.trim(),
      workEmail: $('#obWorkEmail').value.trim(),
      website: $('#obWebsite').value.trim(),
      code: $('#obCode').value.trim(),
    } : null;

    if (fields) {
      if (!fields.company || !fields.workEmail) {
        toast('Company and work email are required for scout access');
        return;
      }
      if (fields.code && !findCode(fields.code)) {
        toast('That invite code is not recognised — leave it blank to apply instead');
        return;
      }
    }

    meId = uid();
    const artistRecord = {
      id: meId, name, handle, role: 'singer', genres, bio: '', city: '', contact: '',
      followers: {}, followerSeed: 0, createdAt: now(), updatedAt: now(),
    };
    board.artists[meId] = artistRecord;

    let message = 'Welcome to the stage';
    if (fields) {
      const redeemed = fields.code ? redeemCode(fields.code, meId) : null;
      const instant = redeemed && redeemed.ok;
      const app = applicationFrom({ ...fields, codeUsed: instant ? normalizeCode(fields.code) : '' },
        meId, instant ? 'approved' : 'pending');
      board.applications[app.id] = app;
      if (instant) {
        grantScout(artistRecord, app);
        message = 'Verified — welcome aboard';
      } else {
        artistRecord.scoutStatus = 'pending';
        message = 'Application sent — you can browse while it\'s reviewed';
      }
    }

    localStorage.setItem(ME_KEY, meId);
    saveBoard();
    overlay.hidden = true;
    renderFeed();
    show('feed');
    toast(message);
  };
}

/* ───────────────────────── global wiring & boot ───────────────────────── */

document.addEventListener('click', e => {
  const artistBtn = e.target.closest('[data-open-artist]');
  if (artistBtn) { openArtist(artistBtn.dataset.openArtist); closeSheet(); return; }
  const clipBtn = e.target.closest('[data-open-clip]');
  if (clipBtn) { openClipInFeed(clipBtn.dataset.openClip); closeSheet(); }
});

$$('#tabbar .tab').forEach(tab => tab.addEventListener('click', () => {
  const target = tab.dataset.screen;
  if (target === 'feed' && currentScreen === 'feed') { renderFeed(); $('#feed').scrollTop = 0; return; }
  if (target === 'profile') viewedArtistId = meId;
  show(target);
}));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseAllClips(); else resumeActiveClip();
});

function boot() {
  loadBoard();
  if (!Object.keys(board.clips).length && !Object.keys(board.artists).length) {
    seedBoard();
    saveBoard({ sync: false });
  }
  $$('.feed-head [data-feed]').forEach(b => b.classList.toggle('selected', b.dataset.feed === feedMode));

  if (!meId || !board.artists[meId]) {
    startOnboarding();
  } else {
    renderFeed();
    show('feed');
  }

  const savedCfg = localStorage.getItem(FB_KEY);
  if (savedCfg) {
    try { connectFirebase(JSON.parse(savedCfg)); } catch (e) { localStorage.removeItem(FB_KEY); }
  }

  setTimeout(() => {
    const splash = $('#splash');
    splash.classList.add('hide');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  }, 900);
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
