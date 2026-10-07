import { config } from '../config.js';

/**
 * PeerTube — reading a federation, carefully.
 *
 * PeerTube publishes a documented REST API and most instances leave it open,
 * so there is nothing here to bypass and nothing to scrape: this is
 * `/api/v1/search/videos` and `/api/v1/videos/{uuid}`, asked politely, over
 * material whose uploaders have licensed it openly.
 *
 * Three things make this different from every other provider Telly reads,
 * and all three are about trust.
 *
 * WHO IS ASKED. PeerTube is a federation, not a service. Anybody may run an
 * instance, and `searchTarget=search-index` will happily return videos from
 * servers nobody has ever assessed. So Telly never searches the index: it
 * asks named instances on its own allowlist, and checks that list again at
 * import time rather than trusting that the source row was legitimate when
 * it was created.
 *
 * WHAT MAY BE TAKEN. The licence is the permission. A video whose licence is
 * missing, unknown, or anything other than one Telly explicitly permits is
 * not imported — not shown greyed out, not queued for review, not imported.
 * The default list is the three that unambiguously allow redistribution:
 * public domain, CC BY and CC BY-SA. There is no setting that widens it to
 * "anything", and `All rights reserved` can never be added.
 *
 * WHAT COUNTS AS A FILM. An instance's idea of a video is anything from a
 * conference talk to a two-second test upload. Movies is for feature-length
 * work, so the default floor is forty-five minutes, live streams are out,
 * and a title or description that announces itself as a trailer or a clip is
 * out whatever its duration says.
 *
 * Nothing here downloads a video. What it produces is an address the player
 * opens itself, on the instance that published it.
 */

/* ------------------------------------------------------------- licences -- */

/**
 * PeerTube's licence ids, which are a fixed enumeration in its own API.
 *
 * `permitted` is the whole of the policy: a licence not marked permitted is
 * not importable, and an id that is not in this table at all is unknown,
 * which is also not importable. There is deliberately no "unknown but
 * probably fine".
 */
export const LICENCES = {
  1:  { name: 'Attribution',                        short: 'CC BY',       permitted: true,
        url: 'https://creativecommons.org/licenses/by/4.0/' },
  2:  { name: 'Attribution - Share Alike',          short: 'CC BY-SA',    permitted: true,
        url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  3:  { name: 'Attribution - No Derivatives',       short: 'CC BY-ND',    permitted: false,
        url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
  4:  { name: 'Attribution - Non Commercial',       short: 'CC BY-NC',    permitted: false,
        url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  5:  { name: 'Attribution - Non Commercial - Share Alike', short: 'CC BY-NC-SA', permitted: false,
        url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  6:  { name: 'Attribution - Non Commercial - No Derivatives', short: 'CC BY-NC-ND', permitted: false,
        url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
  7:  { name: 'Public Domain Dedication',           short: 'CC0',         permitted: true,
        url: 'https://creativecommons.org/publicdomain/zero/1.0/' }
};

/**
 * The ones Telly takes unless an operator narrows it further.
 *
 * ND and the NC family are excluded on purpose. ND forbids the derivative
 * works that transcoding and re-presentation can amount to; NC turns on
 * whether a use is commercial, which is a question about the household
 * running the server rather than about the video, and a question Telly is in
 * no position to answer. Where the answer is unclear the video is not taken.
 */
export const DEFAULT_LICENCES = [7, 1, 2];        // CC0, CC BY, CC BY-SA

/** Licence ids that may never be permitted, whatever a source asks for. */
const NEVER = new Set([3, 4, 5, 6]);

/**
 * What a source is allowed to ask for, cleaned up.
 *
 * A source may narrow the default list; it may not widen it past what this
 * module permits. An empty or nonsensical setting falls back to the default
 * rather than to "everything".
 */
export function permittedLicences(wanted) {
  const asked = Array.isArray(wanted) ? wanted.map(Number).filter(Number.isFinite) : [];
  const ok = asked.filter(id => LICENCES[id] && LICENCES[id].permitted && !NEVER.has(id));
  return ok.length ? ok : [...DEFAULT_LICENCES];
}

/**
 * The licence of one video, as Telly will record it.
 *
 * PeerTube gives `{ id, label }`. The id is authoritative — the label is
 * whatever the instance has translated it to — so an id Telly does not
 * recognise is `unknown` however reassuring the label.
 */
export function licenceOf(video) {
  const raw = video && video.licence;
  const id = raw && typeof raw === 'object' ? Number(raw.id) : Number(raw);
  const known = Number.isFinite(id) ? LICENCES[id] : null;
  if (!known) {
    return { id: Number.isFinite(id) ? String(id) : '', name: 'Unknown', short: 'Unknown',
             url: '', permitted: false, known: false };
  }
  return { id: String(id), name: known.name, short: known.short, url: known.url,
           permitted: known.permitted, known: true };
}

/* ------------------------------------------------------------- the hosts -- */

/**
 * The host of a base URL, lowercased, with no port and no path.
 *
 * Deliberately port-less, because this is what the allowlist matches on: a
 * port is not a different operator, and allowing an instance means allowing
 * the people who run it rather than one socket they happen to listen on.
 */
export function hostOf(baseUrl) {
  try {
    const u = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
    return u.hostname.toLowerCase();
  } catch { return ''; }
}

/**
 * The instance's identity, which is not the same question.
 *
 * Two PeerTube instances on one machine, told apart by port, are two
 * different libraries with two different sets of rights — so the port is
 * part of who published a video, part of the deduplication key, and part of
 * what the details screen shows. It is left off where it is the default,
 * because `films.example:443` is nobody's idea of a server's name.
 */
export function instanceOf(baseUrl) {
  try {
    const u = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
    const port = u.port && !(u.protocol === 'https:' && u.port === '443')
                        && !(u.protocol === 'http:' && u.port === '80') ? `:${u.port}` : '';
    return `${u.hostname.toLowerCase()}${port}`;
  } catch { return ''; }
}

/**
 * Is this instance one Telly is willing to ask?
 *
 * Checked when a source is created and again on every import. A list only
 * enforced at creation time is not enforced: an allowlist can be tightened
 * after the fact, and a source added under the old one must stop being read.
 */
export function instanceAllowed(baseUrl, hosts = config.peertube.allowedHosts) {
  const host = hostOf(baseUrl);
  if (!host) return false;
  return (hosts || []).some(h => host === h);
}

/* ------------------------------------------------------------ the search -- */

/**
 * One search, as a URL.
 *
 * `searchTarget` is deliberately absent: its other value is the global index,
 * and asking an instance about itself is the whole point. The duration and
 * NSFW bounds go to the server as well as being checked on the way back —
 * the server-side ones save everybody's bandwidth, the ones on the way back
 * are the ones that are actually trusted.
 */
export function searchUrl(baseUrl, opts = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (opts.search) params.set('search', String(opts.search));
  params.set('durationMin', String(Math.max(Number(opts.durationMin) || 0, 0)));
  if (opts.durationMax) params.set('durationMax', String(Number(opts.durationMax)));
  params.set('nsfw', 'false');
  params.set('isLive', 'false');
  params.set('count', String(Math.min(Math.max(Number(opts.count) || 25, 1), 100)));
  params.set('start', String(Math.max(Number(opts.start) || 0, 0)));
  params.set('sort', String(opts.sort || '-publishedAt'));
  for (const id of opts.licenceOneOf || []) params.append('licenceOneOf', String(id));
  if (opts.hasHLSFiles) params.set('hasHLSFiles', 'true');
  if (opts.hasWebVideoFiles) params.set('hasWebVideoFiles', 'true');
  return `${base}/api/v1/search/videos?${params}`;
}

/** One video's full record, which is where the files live. */
export function videoUrl(baseUrl, uuid) {
  return `${String(baseUrl).replace(/\/+$/, '')}/api/v1/videos/${encodeURIComponent(uuid)}`;
}

/* ------------------------------------------------------------- the files -- */

/* An address that looks like it was minted for one viewer for a short while.
   PeerTube uses these for private and internal videos. Storing one as though
   it were permanent would give the catalogue a poster-shaped hole in a week,
   so a video whose only addresses look like this is treated as having none
   and its identity is kept instead. */
const SIGNED = /[?&](token|jwt|expires|Expires|Signature|X-Amz-|Policy|Key-Pair-Id)/;

const isPublic = (url) => Boolean(url) && /^https?:\/\//i.test(url) && !SIGNED.test(url);

/**
 * What to play, best first.
 *
 * HLS when the instance has it — it is what adapts on a television and what
 * the player prefers — and a progressive file when it does not. Both are
 * public addresses on the instance that published the video: the player
 * opens them itself, and nothing passes through this server.
 */
export function playbackFor(video, { requireHls = false, webVideoAccepted = true } = {}) {
  const streaming = Array.isArray(video && video.streamingPlaylists) ? video.streamingPlaylists : [];
  for (const p of streaming) {
    /* type 1 is HLS. A playlist with no resolutions behind it is a shell. */
    const url = p && p.playlistUrl;
    const files = Array.isArray(p && p.files) ? p.files : [];
    if (isPublic(url) && files.length) {
      return { url, type: 'hls', quality: bestLabel(files) };
    }
  }
  if (requireHls) return null;
  if (!webVideoAccepted) return null;

  /* `files` is the modern name, `webVideoFiles` the one before it, and older
     instances still say `videoFiles`. All three mean the same thing. */
  const direct = [video && video.files, video && video.webVideoFiles, video && video.videoFiles]
    .find(f => Array.isArray(f) && f.length) || [];
  const best = [...direct]
    .filter(f => isPublic(f && (f.fileUrl || f.fileDownloadUrl)))
    .sort((a, b) => res(b) - res(a))[0];
  if (!best) return null;
  return { url: best.fileUrl || best.fileDownloadUrl, type: 'direct', quality: label(best) };
}

const res = (f) => Number((f && f.resolution && f.resolution.id) || (f && f.resolution) || 0);
const label = (f) => {
  const r = res(f);
  return r ? `${r}p` : '';
};
const bestLabel = (files) => label([...files].sort((a, b) => res(b) - res(a))[0]);

/* -------------------------------------------------------- what is a film -- */

/* Things that say plainly they are not the feature. Matched on the title and
   the first part of the description, not on the whole text, so a film whose
   synopsis mentions a trailer is not thrown away. */
const NOT_A_FILM = /\b(trailer|teaser|clip|extrait|bande[- ]annonce|preview|promo|behind the scenes|making[- ]of|bloopers?|outtakes?|interview|q ?& ?a|panel discussion|episode \d+ preview)\b/i;

/** Does the metadata itself say this is not a feature? */
export function looksLikeAnExtra(video) {
  const title = String((video && video.name) || '');
  const blurb = String((video && video.description) || '').slice(0, 300);
  return NOT_A_FILM.test(title) || NOT_A_FILM.test(blurb);
}

/* ------------------------------------------------------------ the verdict -- */

/**
 * May this video be imported?
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`, where the reason is one
 * of the counters the import log shows. Every condition is checked here, in
 * one place, in a function that touches neither the network nor the database
 * — so the policy can be tested exhaustively and read in one sitting.
 *
 * The order matters only for which reason gets reported, and it runs cheapest
 * and most categorical first.
 */
export function admissible(video, opts = {}) {
  const {
    baseUrl = '', hosts = config.peertube.allowedHosts,
    licences = DEFAULT_LICENCES,
    minDuration = config.peertube.minDurationSeconds,
    maxDuration = config.peertube.maxDurationSeconds,
    requireHls = false, webVideoAccepted = true
  } = opts;

  if (!instanceAllowed(baseUrl, hosts)) return no('instance', 'that instance is not on the allowlist');
  if (!video || !video.uuid) return no('other', 'no video identity');

  /* A live stream is not a film, and `isLive` is the instance telling us so
     directly. A permanent/replayable live is still a live. */
  if (video.isLive === true || video.state === 2) return no('live', 'live stream');

  /* NSFW is an instance's own flag and is taken at face value. Anything that
     does not say false is treated as unsafe, because the absence of a flag
     is not a statement that there is nothing to flag. */
  if (video.nsfw !== false) return no('nsfw', 'flagged or unflagged NSFW');

  const duration = Number(video.duration) || 0;
  if (duration < Number(minDuration)) return no('short', `${Math.round(duration / 60)} min`);
  if (maxDuration && duration > Number(maxDuration)) {
    return no('other', `${Math.round(duration / 60)} min is longer than the ceiling`);
  }
  if (looksLikeAnExtra(video)) return no('other', 'titled as a trailer, clip or extra');

  /* The licence. Last of the metadata checks and first in importance: the
     others are about whether Telly wants it, this is about whether Telly may
     have it. */
  const licence = licenceOf(video);
  if (!licence.known) return no('licence', 'unknown or missing licence');
  if (!licence.permitted) return no('licence', `${licence.short} is not redistributable`);
  if (!permittedLicences(licences).includes(Number(licence.id))) {
    return no('licence', `${licence.short} is not permitted for this source`);
  }

  /* And finally something to play. Checked last because it needs the full
     record, which is the expensive call. */
  const playback = playbackFor(video, { requireHls, webVideoAccepted });
  if (!playback) return no('unplayable', 'no public HLS or web video');

  return { ok: true, licence, playback };
}

const no = (reason, detail) => ({ ok: false, reason, detail });

/* ------------------------------------------------------------- the mapping -- */

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function yearOf(v) {
  const m = String(v || '').match(/(1[89]\d{2}|20\d{2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1870 && n <= new Date().getFullYear() + 2 ? n : null;
}

/** Who to credit, as PeerTube describes them. */
export function authorOf(video) {
  const acc = (video && video.account) || {};
  const chan = (video && video.channel) || {};
  const name = String(acc.displayName || acc.name || chan.displayName || chan.name || '').trim();
  const handle = String(acc.name && acc.host ? `${acc.name}@${acc.host}` : '').trim();
  return { name, handle };
}

/**
 * The credit line a licence may require.
 *
 * CC BY and CC BY-SA both require attribution, and "required" means Telly
 * shows it rather than storing it for an audit nobody runs. Built to the
 * usual shape — title, author, licence, and where it came from — and kept
 * with the copy so the details screen can display it verbatim.
 */
export function attributionFor(video, licence, canonicalUrl) {
  if (!licence || !licence.permitted) return '';
  const who = authorOf(video).name;
  const title = String((video && video.name) || '').trim();
  const bits = [title ? `"${title}"` : null, who ? `by ${who}` : null];
  if (licence.short === 'CC0') {
    /* CC0 waives the requirement. Crediting anyway is simply good manners,
       and costs a line. */
    return [...bits.filter(Boolean), 'dedicated to the public domain (CC0)', canonicalUrl]
      .filter(Boolean).join(' · ');
  }
  return [...bits.filter(Boolean), `licensed ${licence.short}`, canonicalUrl]
    .filter(Boolean).join(' · ');
}

/** The page a person would open to see the original. */
export function canonicalUrlFor(baseUrl, video) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const url = String((video && video.url) || '');
  /* The instance's own canonical URL where it gives one — a federated video
     belongs to the instance that published it, not the one we asked. */
  if (/^https?:\/\//i.test(url)) return url;
  return `${base}/w/${encodeURIComponent((video && video.shortUUID) || (video && video.uuid) || '')}`;
}

/**
 * One PeerTube video, as a catalogue work.
 *
 * `contentId` is `<host>:<uuid>`, which is the first rung of the
 * deduplicator: the same video from the same instance is the same copy,
 * however its title has been edited since. Two different films with similar
 * names cannot collide here, because neither the host nor the UUID is a
 * guess.
 */
export function movieWork(baseUrl, sourceRow, video, { licence, playback }) {
  const host = instanceOf(baseUrl);
  const canonical = canonicalUrlFor(baseUrl, video);
  const author = authorOf(video);
  const published = String(video.originallyPublishedAt || video.publishedAt || '');

  return {
    kind: 'movie',
    title: String(video.name || '').trim(),
    originalTitle: '',
    year: yearOf(published),
    releaseDate: (published.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
    description: stripTags(video.description || video.truncatedDescription || ''),
    runtimeMinutes: Math.round((Number(video.duration) || 0) / 60),
    rating: null,
    genres: categoryOf(video),
    languages: languageOf(video),
    keywords: (Array.isArray(video.tags) ? video.tags : []).map(t => String(t).trim())
      .filter(Boolean).slice(0, 12),
    /* The uploader is credited as the author of the work, which on PeerTube
       is usually literally true. */
    directors: author.name ? [author.name] : [],
    poster: thumbnail(baseUrl, video),
    thumbnail: thumbnail(baseUrl, video),
    backdrop: preview(baseUrl, video),
    source: {
      contentId: `${host}:${video.uuid}`,
      metadataUrl: canonical,
      playbackUrl: playback.url,
      playbackType: playback.type,
      availability: 'available',
      quality: playback.quality || '',
      /* Public addresses on somebody else's server: nothing to keep secret,
         so the client is handed the address and plays it directly. */
      credentialed: false,
      sourceId: sourceRow ? sourceRow.id : null,
      sourceLabel: sourceRow ? sourceRow.name : host,
      /* The provenance, which for this provider is the permission. */
      licence: licence.short,
      licenceId: licence.id,
      licenceUrl: licence.url,
      attribution: attributionFor(video, licence, canonical),
      author: author.name,
      authorHandle: author.handle,
      sourceInstance: host,
      sourceUrl: canonical,
      externalUuid: String(video.uuid)
    }
  };
}

const abs = (baseUrl, p) => {
  const s = String(p || '');
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `${String(baseUrl).replace(/\/+$/, '')}${s.startsWith('/') ? '' : '/'}${s}`;
};
const thumbnail = (b, v) => abs(b, v.thumbnailUrl || v.thumbnailPath);
const preview = (b, v) => abs(b, v.previewUrl || v.previewPath);

const categoryOf = (v) => {
  const c = v && v.category;
  const name = c && typeof c === 'object' ? c.label : c;
  return name ? [String(name).trim()] : [];
};
const languageOf = (v) => {
  const l = v && v.language;
  const name = l && typeof l === 'object' ? l.label : l;
  return name ? [String(name).trim()] : [];
};

/* -------------------------------------------------- a source's own settings -- */

/**
 * What one instance has been configured to take, with every field defaulted.
 *
 * Stored as JSON on the source row because these are per-instance choices —
 * which searches, how long, which licences — and inventing eleven columns
 * that only one kind of source would use is the wrong trade. Nonsense in the
 * column yields the defaults rather than an exception: a bad setting should
 * narrow what is imported, never stop the server starting.
 */
export function sourceSettings(row) {
  let raw = {};
  try { raw = JSON.parse(String((row && row.settings) || '') || '{}') || {}; } catch { raw = {}; }
  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  return {
    searches: (Array.isArray(raw.searches) ? raw.searches : [])
      .map(s => String(s).trim()).filter(Boolean).slice(0, 12),
    minDuration: num(raw.minDuration, config.peertube.minDurationSeconds),
    maxDuration: num(raw.maxDuration, config.peertube.maxDurationSeconds),
    licences: permittedLicences(raw.licences),
    requireHls: raw.requireHls === undefined ? config.peertube.requireHls : Boolean(raw.requireHls),
    webVideoAccepted: raw.webVideoAccepted === undefined
      ? config.peertube.webVideoAccepted : Boolean(raw.webVideoAccepted),
    pageSize: Math.min(num(raw.pageSize, config.peertube.pageSize), 100),
    maxPages: Math.min(num(raw.maxPages, config.peertube.maxPages), 20)
  };
}

/** The same, on the way out to the admin screen. */
export function publicSettings(row) {
  const s = sourceSettings(row);
  return {
    ...s,
    licenceNames: s.licences.map(id => (LICENCES[id] || {}).short).filter(Boolean),
    host: instanceOf(row && row.url),
    allowed: instanceAllowed(row && row.url)
  };
}
