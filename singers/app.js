/* Spotlight — a short-video stage for singers.
   Everything is local-first: clip metadata lives in localStorage, the video
   files themselves live in IndexedDB, and an optional Firebase panel mirrors
   the metadata between devices. No build step, no bundler. */

/* ───────────────────────── constants & helpers ───────────────────────── */

const BOARD_KEY = 'spotlight.board';
const ME_KEY = 'spotlight.me';
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

let board = { artists: {}, clips: {} };
let meId = localStorage.getItem(ME_KEY) || null;

const me = () => (meId ? board.artists[meId] : null);
const artist = id => board.artists[id] || null;
const clipsOf = id => Object.values(board.clips).filter(c => c.artistId === id);

function loadBoard() {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      board = { artists: parsed.artists || {}, clips: parsed.clips || {} };
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

  if (feedIds.length) setActiveClip(feedIds[0]);
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
    } else {
      const flag = $('.missing-media', card);
      if (flag) flag.hidden = false;
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
const posterCache = new Map();

async function fillPoster(el, clipId) {
  const c = board.clips[clipId];
  if (!c) return;
  if (posterCache.has(clipId)) { el.innerHTML = `<img src="${posterCache.get(clipId)}" alt="">`; return; }
  const rec = await mediaGet(clipId);
  if (rec && rec.poster) {
    const url = URL.createObjectURL(rec.poster);
    posterCache.set(clipId, url);
    el.innerHTML = `<img src="${url}" alt="">`;
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

function matches(c) {
  const a = artist(c.artistId) || {};
  const q = searchTerm.toLowerCase().replace(/^#/, '');
  const hay = [c.title, c.song, c.genre, (c.tags || []).join(' '), a.name, a.handle, a.city]
    .join(' ').toLowerCase();
  const okQ = !q || hay.includes(q);
  const okG = !genreFilter || c.genre === genreFilter || (a.genres || []).includes(genreFilter);
  return okQ && okG;
}

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

  const results = Object.values(board.clips).filter(matches)
    .sort((a, b) => (searchTerm || genreFilter ? clipScore(b) - clipScore(a) : b.createdAt - a.createdAt));
  $('#gridTitle').textContent = searchTerm || genreFilter ? `Results (${results.length})` : 'Fresh clips';
  $('#discoverGrid').innerHTML = results.map(tileHTML).join('');
  $('#discoverEmpty').hidden = results.length > 0;
  $$('#discoverGrid .tile').forEach(el => fillPoster(el, el.dataset.openClip));
}

$('#searchInput').addEventListener('input', e => { searchTerm = e.target.value.trim(); renderDiscover(); });

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
        ${a.role === 'scout' ? '<span class="pill">Scout</span>' : ''}
        ${rank && rank <= 10 ? `<span class="pill hot">#${rank} on the chart</span>` : ''}
        ${(a.genres || []).map(g => `<span class="pill">${esc(g)}</span>`).join('')}
      </div>
      <div class="prof-stats">
        <div><b>${compact(clips.length)}</b><span>clips</span></div>
        <div><b>${compact(followerCount(a))}</b><span>followers</span></div>
        <div><b>${compact(totalLikes(a))}</b><span>likes</span></div>
        <div><b>${compact(totalPlays(a))}</b><span>plays</span></div>
      </div>
      <div class="prof-actions">
        ${isMe
      ? `<button class="btn-primary" data-edit>Edit profile</button>
             <button class="btn-ghost" data-new-clip>New clip</button>`
      : `<button class="${iFollow(a) ? 'btn-ghost' : 'btn-primary'}" data-follow>${iFollow(a) ? 'Following' : 'Follow'}</button>
             <button class="btn-ghost" data-share-artist>Share</button>`}
      </div>
    </div>
    ${isMe ? `<div class="prof-tabs">
      <button class="tab-pill ${profileTab === 'clips' ? 'selected' : ''}" data-ptab="clips">Clips</button>
      <button class="tab-pill ${profileTab === 'saved' ? 'selected' : ''}" data-ptab="saved">${a.role === 'scout' ? 'Shortlist' : 'Saved'}</button>
    </div>` : ''}
    <div class="prof-grid">
      ${shown.length
      ? `<div class="grid">${shown.map(c => tileHTML(c) + (isMe && profileTab === 'clips' && !c.demo
        ? `<button class="pill" data-del="${c.id}" style="grid-column:span 1;display:none"></button>` : '')).join('')}</div>`
      : `<p class="muted pad">${profileTab === 'saved' ? 'Nothing saved yet — tap the star on a clip you rate.' : (isMe ? 'No clips yet. Tap ✚ and sing something.' : 'No clips yet.')}</p>`}
    </div>`;

  $$('#profileBody .tile').forEach(el => fillPoster(el, el.dataset.openClip));

  const body = $('#profileBody');
  const on = (sel, fn) => { const el = $(sel, body); if (el) el.onclick = fn; };
  on('[data-back]', () => show('feed'));
  on('[data-settings]', openSettings);
  on('[data-edit]', openEditProfile);
  on('[data-new-clip]', openRecord);
  on('[data-follow]', () => toggleFollow(a.id));
  on('[data-share-artist]', async () => {
    try {
      const text = `${a.name} (@${a.handle}) on Spotlight`;
      if (navigator.share) await navigator.share({ title: 'Spotlight', text, url: location.href });
      else { await navigator.clipboard.writeText(`${text} ${location.href}`); toast('Link copied'); }
    } catch (e) { /* dismissed */ }
  });
  $$('[data-ptab]', body).forEach(btn => btn.onclick = () => { profileTab = btn.dataset.ptab; renderProfile(a.id); });

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

function confirmDelete(clipId) {
  const c = board.clips[clipId];
  if (!c || c.artistId !== meId) return;
  if (!confirm(`Delete "${c.song || c.title}"? This can't be undone.`)) return;
  delete board.clips[clipId];
  mediaDelete(clipId);
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
      <label class="switch-row"><span>I'm a scout, not a singer</span><input id="epScout" type="checkbox" ${a.role === 'scout' ? 'checked' : ''}></label>
      <span class="field-label">Genres</span>
      <div class="chips" id="epGenres">${genreChipsHTML(genres)}</div>
      <button class="btn-primary block" id="epSave">Save</button>`,
    onFoot: null,
  });
  wireGenreChips($('#epGenres'), genres);
  $('#epSave').onclick = () => {
    const name = $('#epName').value.trim();
    const handle = $('#epHandle').value.trim().replace(/[^a-z0-9._]/gi, '').toLowerCase();
    if (!name || !handle) { toast('Name and handle are required'); return; }
    Object.assign(a, { name, handle, city: $('#epCity').value.trim(), bio: $('#epBio').value.trim(),
      role: $('#epScout').checked ? 'scout' : 'singer', genres, updatedAt: now() });
    saveBoard();
    closeSheet();
    renderProfile(meId);
    renderFeed({ keepScroll: true });
    toast('Profile saved');
  };
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
      </div>
      <div class="set-group">
        <p class="tiny muted">Clip metadata lives in this browser; video files are stored in IndexedDB on this device only.
        Turning on sync shares profiles, captions, likes and comments — video files stay local unless you add Firebase Storage.</p>
      </div>
      <button class="btn-danger block" id="setReset">Reset everything on this device</button>`,
  });
  $('#setEdit').onclick = openEditProfile;
  $('#setSync').onclick = openSyncPanel;
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
      <p class="tiny muted">Paste a Firebase web config (Realtime Database enabled) to share the board between
      phones. Everyone using the same config sees the same profiles, clips, likes and comments.</p>
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
  const out = { artists: {}, clips: {} };
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
    }
    if (firebase.apps.length) await firebase.app().delete();
    firebase.initializeApp(config);
    fbRef = firebase.database().ref(FB_PATH);
    fbRef.on('value', snap => {
      const remote = snap.val();
      if (!remote) { fbRef.set(board); return; }
      applyingRemote = true;
      board = mergeBoards(board, { artists: remote.artists || {}, clips: remote.clips || {} });
      localStorage.setItem(BOARD_KEY, JSON.stringify(board));
      applyingRemote = false;
      if (currentScreen === 'feed') renderFeed({ keepScroll: true });
      if (currentScreen === 'discover') renderDiscover();
      if (currentScreen === 'charts') renderChart();
      if (currentScreen === 'profile') renderProfile(viewedArtistId || meId);
    });
    localStorage.setItem(FB_KEY, JSON.stringify(config));
    toast('Sync on');
    return true;
  } catch (e) {
    console.error(e);
    fbRef = null;
    toast('Could not connect — check the config and database rules');
    return false;
  }
}

function disconnectFirebase() {
  if (fbRef) { fbRef.off(); fbRef = null; }
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

    meId = uid();
    board.artists[meId] = {
      id: meId, name, handle, role, genres, bio: '', city: '',
      followers: {}, followerSeed: 0, createdAt: now(), updatedAt: now(),
    };
    localStorage.setItem(ME_KEY, meId);
    saveBoard();
    overlay.hidden = true;
    renderFeed();
    show('feed');
    toast(role === 'scout' ? 'Welcome — go find someone good' : 'Welcome to the stage');
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
