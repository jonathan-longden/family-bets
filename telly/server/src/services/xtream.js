/**
 * Xtream Codes, server-side. The panel's username and password stay in the
 * database and in this file; a client never sees either, and never sees the
 * stream URLs they are baked into.
 *
 * A panel publishes three catalogues through the same `player_api.php`, and
 * until now Telly read one of them:
 *
 *   live     get_live_categories, get_live_streams      → the `channels` table
 *   movies   get_vod_categories, get_vod_streams,       → the catalogue
 *            get_vod_info&vod_id=…
 *   series   get_series_categories, get_series,         → the catalogue
 *            get_series_info&series_id=…
 *
 * and three stream address forms, which the API does not hand out and a
 * client has to build:
 *
 *   /live/<user>/<pass>/<stream_id>.<ext>
 *   /movie/<user>/<pass>/<stream_id>.<container_extension>
 *   /series/<user>/<pass>/<episode_id>.<container_extension>
 *
 * Reading them is authorised use of the operator's own subscription with the
 * credentials they entered. Nothing here bypasses anything: there is no
 * second way in, and a panel that refuses these credentials is reported as
 * refusing them.
 *
 * Panels disagree about their own JSON more than any published description of
 * it admits, so everything below is read through the coercions in
 * `asInt`/`asFloat`/`asList`/`firstUrl`: a number arrives as a string, a
 * backdrop as a string or an array of them, a release date as `releasedate`
 * on a film and `releaseDate` on a series, and an `info` object as an empty
 * array when the panel has nothing to say. None of that is an error.
 */
import { upstreamFailed } from '../lib/errors.js';
import { classify } from './m3u.js';

export function normaliseHost(input) {
  let h = String(input || '').trim().replace(/\/+$/, '');
  if (!h) return '';
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  return h.replace(/\/player_api\.php.*$/i, '').replace(/\/+$/, '');
}

export function apiUrl(host, user, pass, action = '') {
  const base = `${normaliseHost(host)}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  return action ? `${base}&action=${action}` : base;
}

export function streamUrl(host, user, pass, streamId, ext) {
  return `${normaliseHost(host)}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${streamId}.${ext}`;
}

/* The two VOD address forms. Built rather than taken from the panel: a
   `direct_source` field is often blank, and when it is not it may be a path on
   the panel's own disk rather than anything a player could open. */
export function movieUrl(host, user, pass, streamId, ext = 'mp4') {
  return `${normaliseHost(host)}/movie/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${streamId}.${safeExt(ext)}`;
}

export function episodeUrl(host, user, pass, episodeId, ext = 'mp4') {
  return `${normaliseHost(host)}/series/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${episodeId}.${safeExt(ext)}`;
}

/* A container extension goes into a path, so it is letters and digits or it is
   the default. Anything else is a panel sending something strange, or an
   attempt to put a slash or a query string into our own URL. */
export function safeExt(ext) {
  const e = String(ext || '').trim().toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{1,5}$/.test(e) ? e : 'mp4';
}

/* `direct_source` is only used when the panel gives a real http(s) address;
   otherwise the canonical form above is right. */
export function directOr(fallbackUrl, directSource) {
  const d = String(directSource || '').trim();
  return /^https?:\/\//i.test(d) ? d : fallbackUrl;
}

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': 'Telly-Server/1.0' } });
  } catch (e) {
    throw upstreamFailed(`Could not reach the provider: ${e.message}`);
  }
  if (!res.ok) throw upstreamFailed(`The provider replied ${res.status} ${res.statusText}.`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw upstreamFailed('The provider did not return valid JSON — check the server URL and port.'); }
}

/** Signs in and returns the full live line-up as channel rows. */
export async function loadXtream({ host, username, password }, fetchImpl = fetch) {
  if (!host || !username || !password) throw upstreamFailed('Server, username and password are all needed.');

  const info = await getJson(apiUrl(host, username, password), fetchImpl);
  const userInfo = info && info.user_info;
  if (!userInfo) throw upstreamFailed('That server did not answer like an Xtream panel.');
  if (Number(userInfo.auth) === 0) throw upstreamFailed('The provider rejected those credentials.');
  const status = String(userInfo.status || '');
  if (status && status.toLowerCase() !== 'active') throw upstreamFailed(`The provider says that account is "${status}".`);

  const catName = new Map();
  try {
    const cats = await getJson(apiUrl(host, username, password, 'get_live_categories'), fetchImpl);
    if (Array.isArray(cats)) for (const c of cats) catName.set(String(c.category_id), c.category_name || 'Ungrouped');
  } catch { /* categories are a nicety */ }

  const streams = await getJson(apiUrl(host, username, password, 'get_live_streams'), fetchImpl);
  if (!Array.isArray(streams)) throw upstreamFailed('The provider sent an unexpected channel list.');

  const formats = Array.isArray(userInfo.allowed_output_formats) ? userInfo.allowed_output_formats : [];
  const ext = formats.includes('m3u8') ? 'm3u8' : (formats[0] || 'm3u8');

  const channels = streams.map((s, i) => {
    const group = catName.get(String(s.category_id)) || 'Ungrouped';
    return {
      extId: `xc:${s.stream_id}`,
      number: Number(s.num) || i + 1,
      name: s.name || `Channel ${s.stream_id}`,
      group,
      logo: s.stream_icon || '',
      tvgId: s.epg_channel_id || '',
      url: streamUrl(host, username, password, s.stream_id, ext),
      kind: classify(group)
    };
  });

  return { channels, epgUrl: '', expiresAt: userInfo.exp_date ? new Date(Number(userInfo.exp_date) * 1000).toISOString() : null };
}

/* ------------------------------------------------------------- coercions ---
 *
 * What a panel sends and what it is supposed to send are different things.
 * Every reader below goes through these, so one panel quoting `"rating":"7.4"`
 * and another `"rating":7.4` produce the same row, and neither produces an
 * exception that loses the import.
 */

/**
 * A number that may have arrived as a string, or as '', or as 'N/A'.
 *
 * Blank is not zero. `Number('')` is 0, which would quietly turn a missing
 * episode number into episode 0 and a missing season into season 0 — so
 * nothing but actual digits produces a number here.
 */
export function asInt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function asFloat(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * A rating out of ten.
 *
 * Panels send `rating` out of ten, or out of five, or empty, and separately a
 * `rating_5based`. A zero means "nobody has rated this", which is not the same
 * as "rated zero", so it is dropped rather than stored as a bottom score.
 */
export function asRating(info = {}) {
  const ten = asFloat(info.rating);
  if (ten != null && ten > 0 && ten <= 10) return Math.round(ten * 10) / 10;
  const five = asFloat(info.rating_5based);
  if (five != null && five > 0 && five <= 5) return Math.round(five * 2 * 10) / 10;
  return null;
}

/** A field that is a string, an array of strings, or absent. */
export function asList(v) {
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
  const s = String(v ?? '').trim();
  return s ? [s] : [];
}

/** The first usable picture address out of a string or an array of them. */
export function firstUrl(v) {
  return asList(v).find(u => /^https?:\/\//i.test(u)) || '';
}

/** "Tom Hanks, Robin Wright" or "Tom Hanks , , Robin Wright" → two names. */
export function people(v) {
  return String(v ?? '').split(/\s*[,;|/]\s*/).map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'n/a').slice(0, 40);
}

/** Genres, the same way, but keeping "Science Fiction" in one piece. */
export function genres(v) {
  return String(v ?? '').split(/\s*[,;|]\s*/).map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'n/a').slice(0, 12);
}

/** A year out of '2016', '2016-11-11', '11/11/2016' or ''. */
export function asYear(v) {
  const m = String(v ?? '').match(/(19|20)\d{2}/);
  const y = m ? Number(m[0]) : null;
  return y && y >= 1870 && y <= 2100 ? y : null;
}

/** An ISO-ish date, left alone when it already is one and dropped when not. */
export function asDate(v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * Minutes, from whichever of the three duration fields the panel filled in.
 * `duration` is 'HH:MM:SS' or 'MM:SS'; `duration_secs` is seconds;
 * `episode_run_time` is already minutes.
 */
export function asMinutes(info = {}) {
  const secs = asInt(info.duration_secs);
  if (secs && secs > 0) return Math.max(1, Math.round(secs / 60));
  const hhmmss = String(info.duration || '').trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(hhmmss)) {
    const parts = hhmmss.split(':').map(Number);
    const s = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    if (s > 0) return Math.max(1, Math.round(s / 60));
  }
  const mins = asInt(info.episode_run_time);
  return mins && mins > 0 && mins < 2000 ? mins : 0;
}

/**
 * `info` is an object — except when the panel has nothing and sends `[]`, or
 * null, which would otherwise throw on the first property read.
 */
export function infoOf(body, key = 'info') {
  const v = body && body[key];
  return v && !Array.isArray(v) && typeof v === 'object' ? v : {};
}

/** A panel's own id, as decisive text. Empty when it has not given one. */
export const idOf = (v) => {
  const s = String(v ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '';
};

/* -------------------------------------------------------------- the panel --- */

/**
 * Sign in. Returns what the account is allowed to do, which is also what says
 * which container a live stream should be asked for.
 *
 * The three refusals are kept apart on purpose: a wrong address, wrong
 * credentials and a suspended account are different problems and the operator
 * should be told which one they have.
 */
export async function signIn({ host, username, password }, fetchImpl = fetch) {
  if (!host || !username || !password) throw upstreamFailed('Server, username and password are all needed.');
  const info = await getJson(apiUrl(host, username, password), fetchImpl);
  const userInfo = info && info.user_info;
  if (!userInfo) throw upstreamFailed('That server did not answer like an Xtream panel.');
  if (Number(userInfo.auth) === 0) throw upstreamFailed('The provider rejected those credentials.');
  const status = String(userInfo.status || '');
  if (status && status.toLowerCase() !== 'active') {
    throw upstreamFailed(`The provider says that account is "${status}".`);
  }
  return { userInfo, serverInfo: info.server_info || {} };
}

/** A list action that must come back as an array, or is treated as empty. */
async function list(host, user, pass, action, fetchImpl, extra = '') {
  const body = await getJson(apiUrl(host, user, pass, action) + extra, fetchImpl);
  return Array.isArray(body) ? body : [];
}

export const categoryNames = (rows) => {
  const m = new Map();
  for (const c of rows || []) m.set(String(c.category_id), String(c.category_name || '').trim() || 'Ungrouped');
  return m;
};

export const vodCategories = (c, f) => list(c.host, c.username, c.password, 'get_vod_categories', f);
export const vodStreams = (c, f) => list(c.host, c.username, c.password, 'get_vod_streams', f);
export const seriesCategories = (c, f) => list(c.host, c.username, c.password, 'get_series_categories', f);
export const seriesList = (c, f) => list(c.host, c.username, c.password, 'get_series', f);

export function vodInfoUrl(c, vodId) {
  return `${apiUrl(c.host, c.username, c.password, 'get_vod_info')}&vod_id=${encodeURIComponent(vodId)}`;
}

/* Both spellings. The usual parameter is series_id; some panels want `series`,
   and asking with both costs nothing and saves an empty import. */
export function seriesInfoUrl(c, seriesId) {
  const id = encodeURIComponent(seriesId);
  return `${apiUrl(c.host, c.username, c.password, 'get_series_info')}&series_id=${id}&series=${id}`;
}

/**
 * What this panel actually exposes.
 *
 * The diagnostic behind `telly-admin probe`: it asks for each of the seven
 * catalogue actions and reports what came back, so "Synced 15 channels" can be
 * checked against what is really there rather than assumed to be all of it.
 * It reads one movie and one series in full as well, so the answer says which
 * metadata this panel carries rather than which metadata Xtream can carry.
 */
export async function probeXtream({ host, username, password }, fetchImpl = fetch) {
  const c = { host, username, password };
  const { userInfo, serverInfo } = await signIn(c, fetchImpl);
  const out = {
    host: normaliseHost(host),
    account: {
      username: userInfo.username || username,
      status: userInfo.status || '',
      expiresAt: userInfo.exp_date ? new Date(Number(userInfo.exp_date) * 1000).toISOString() : null,
      maxConnections: asInt(userInfo.max_connections) || null,
      allowedOutputFormats: asList(userInfo.allowed_output_formats)
    },
    server: { url: serverInfo.url || '', port: serverInfo.port || '', https: serverInfo.https_port || '' },
    counts: {},
    problems: []
  };

  const count = async (label, fn) => {
    try { out.counts[label] = (await fn()).length; }
    catch (e) { out.counts[label] = null; out.problems.push(`${label}: ${e.message}`); }
  };

  await count('liveCategories', () => list(host, username, password, 'get_live_categories', fetchImpl));
  await count('liveStreams', () => list(host, username, password, 'get_live_streams', fetchImpl));
  await count('vodCategories', () => vodCategories(c, fetchImpl));
  await count('vodStreams', () => vodStreams(c, fetchImpl));
  await count('seriesCategories', () => seriesCategories(c, fetchImpl));
  await count('series', () => seriesList(c, fetchImpl));

  /* One of each, read in full, to report the metadata this panel supplies. */
  try {
    const movies = await vodStreams(c, fetchImpl);
    if (movies.length) {
      const body = await getJson(vodInfoUrl(c, movies[0].stream_id), fetchImpl);
      const info = infoOf(body), data = infoOf(body, 'movie_data');
      out.sampleMovie = {
        name: movies[0].name || data.name || '',
        streamId: String(movies[0].stream_id ?? ''),
        container: safeExt(data.container_extension || movies[0].container_extension),
        fields: Object.keys(info).sort(),
        has: {
          plot: Boolean(info.plot || info.description), poster: Boolean(firstUrl(info.movie_image) || firstUrl(info.cover_big)),
          backdrop: Boolean(firstUrl(info.backdrop_path)), genre: Boolean(info.genre),
          cast: Boolean(info.cast || info.actors), director: Boolean(info.director),
          year: asYear(info.releasedate || info.releaseDate) != null,
          rating: asRating(info) != null, runtime: asMinutes(info) > 0,
          tmdbId: Boolean(idOf(info.tmdb_id))
        }
      };
    }
  } catch (e) { out.problems.push(`get_vod_info: ${e.message}`); }

  try {
    const shows = await seriesList(c, fetchImpl);
    if (shows.length) {
      const body = await getJson(seriesInfoUrl(c, shows[0].series_id), fetchImpl);
      const eps = episodesBySeason(body);
      out.sampleSeries = {
        name: shows[0].name || '',
        seriesId: String(shows[0].series_id ?? ''),
        seasons: Object.keys(eps).length,
        episodes: Object.values(eps).reduce((n, a) => n + a.length, 0),
        fields: Object.keys(infoOf(body)).sort()
      };
    }
  } catch (e) { out.problems.push(`get_series_info: ${e.message}`); }

  return out;
}

/**
 * The episodes of a series, keyed by season number.
 *
 * Panels send `episodes` as an object keyed by season, or as a flat array, or
 * not at all. All three come back the same way here, and an episode that does
 * not say which season it is in is filed under the key it arrived under, then
 * under its own `season`, then under 1 — a season number is needed and
 * guessing 1 is better than losing the episode.
 */
export function episodesBySeason(body) {
  const raw = body && body.episodes;
  const out = {};
  const push = (season, ep) => {
    const n = asInt(season) ?? asInt(ep && ep.season) ?? 1;
    (out[n] = out[n] || []).push(ep);
  };
  if (Array.isArray(raw)) {
    for (const ep of raw) push(ep && ep.season, ep);
  } else if (raw && typeof raw === 'object') {
    for (const [key, eps] of Object.entries(raw)) {
      if (!Array.isArray(eps)) continue;
      for (const ep of eps) push(key, ep);
    }
  }
  return out;
}

/** The season rows a panel sends, which are optional and often empty. */
export function seasonMeta(body) {
  const out = new Map();
  const rows = body && body.seasons;
  if (!Array.isArray(rows)) return out;
  for (const s of rows) {
    const n = asInt(s && (s.season_number ?? s.season));
    if (n == null) continue;
    out.set(n, {
      title: String((s.name ?? s.title) || '').trim(),
      description: String(s.overview || '').trim(),
      poster: firstUrl(s.cover_big) || firstUrl(s.cover),
      airDate: asDate(s.air_date)
    });
  }
  return out;
}

/* ------------------------------------------------- panel JSON → a work ----
 *
 * The adapter's contract: a work carries its own identity and its metadata,
 * and one `source` describing where this copy can be played. The provider is
 * not named on the work — that belongs to the source — which is what lets the
 * same film arrive from a panel, from the Internet Archive and from the
 * household's own disk and become one card with three ways to play it.
 */

/**
 * The content id a source is filed under.
 *
 * It carries the Telly source row, so two panels that both carry a film give
 * that film two playback sources rather than overwriting each other, and
 * re-importing the same panel updates the row it created last time. The
 * panel's own stream id is the stable part — a title or a year is not, and a
 * panel renaming a film must not create a second copy of it.
 */
export const contentId = (sourceId, kind, id) => `s${Number(sourceId)}:${kind}:${idOf(id) || 'x'}`;

/** One film, from its list row and whatever get_vod_info added. */
export function movieWork(cred, sourceId, row, body = null) {
  const info = infoOf(body);
  const data = infoOf(body, 'movie_data');
  const streamId = idOf(row.stream_id ?? data.stream_id);
  const ext = safeExt(data.container_extension || row.container_extension || 'mp4');
  const raw = String(info.o_name || row.name || data.name || '').trim() || `Film ${streamId}`;
  const named = splitTitleYear(raw);
  const url = movieUrl(cred.host, cred.username, cred.password, streamId, ext);

  return {
    kind: 'movie',
    title: named.title,
    originalTitle: splitTitleYear(info.o_name || '').title,
    /* The panel's own release date first; the year in the name only when it
       has not given one. */
    year: asYear(info.releasedate || info.releaseDate || row.year) ?? named.year,
    releaseDate: asDate(info.releasedate || info.releaseDate),
    description: String(info.plot || info.description || '').trim(),
    runtimeMinutes: asMinutes(info),
    rating: asRating({ rating: info.rating ?? row.rating, rating_5based: info.rating_5based ?? row.rating_5based }),
    ageRating: String(info.age || info.mpaa_rating || '').trim(),
    genres: genres(info.genre),
    countries: genres(info.country),
    poster: firstUrl(info.movie_image) || firstUrl(info.cover_big) || firstUrl(row.stream_icon),
    backdrop: firstUrl(info.backdrop_path),
    /* A panel's tmdb id is the one piece of cross-provider identity it
       supplies, and it is the rung the matcher prefers over any title. */
    externalIds: tmdb(info.tmdb_id),
    cast: people(info.cast || info.actors).map(name => ({ name })),
    directors: people(info.director),
    source: {
      contentId: contentId(sourceId, 'movie', streamId),
      playbackUrl: directOr(url, data.direct_source || row.direct_source),
      playbackType: PLAYBACK_FOR(ext),
      availability: 'available',
      quality: qualityOf(info),
      /* The address carries the subscription's username and password, so it
         is never handed to a client. See publicSource. */
      credentialed: true,
      /* Which subscription this copy is on, so two panels carrying the same
         film give one card with two ways to play it, each named. */
      sourceId,
      sourceLabel: cred.label || ''
    }
  };
}

/** One series, with its seasons and episodes, ready to ingest in one piece. */
export function seriesWork(cred, sourceId, row, body = null) {
  const info = infoOf(body);
  const seriesId = idOf(row.series_id ?? info.series_id);
  const named = splitTitleYear(String(row.name || info.name || '').trim() || `Series ${seriesId}`);
  const bySeason = episodesBySeason(body);
  const meta = seasonMeta(body);

  const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b).map(n => {
    const m = meta.get(n) || {};
    return {
      number: n,
      title: m.title || '',
      description: m.description || '',
      poster: m.poster || '',
      episodes: bySeason[n].map(ep => episodeWork(cred, sourceId, ep, n)).filter(Boolean)
    };
  });

  return {
    kind: 'series',
    title: named.title,
    year: asYear(info.releaseDate || info.releasedate || row.releaseDate || row.releasedate) ?? named.year,
    releaseDate: asDate(info.releaseDate || info.releasedate || row.releaseDate || row.releasedate),
    description: String(info.plot || row.plot || '').trim(),
    runtimeMinutes: asMinutes({ episode_run_time: info.episode_run_time ?? row.episode_run_time }),
    rating: asRating({
      rating: info.rating ?? row.rating,
      rating_5based: info.rating_5based ?? row.rating_5based
    }),
    genres: genres(info.genre || row.genre),
    poster: firstUrl(info.cover) || firstUrl(row.cover),
    backdrop: firstUrl(info.backdrop_path) || firstUrl(row.backdrop_path),
    externalIds: tmdb(info.tmdb_id || row.tmdb_id),
    cast: people(info.cast || row.cast).map(n => ({ name: n })),
    directors: people(info.director || row.director),
    source: {
      contentId: contentId(sourceId, 'series', seriesId),
      /* A series itself is not a stream; its episodes are. So the series
         source records where it came from and nothing is invented for it. */
      availability: 'available',
      sourceId,
      sourceLabel: cred.label || ''
    },
    seasons
  };
}

function episodeWork(cred, sourceId, ep, seasonNumber) {
  const id = idOf(ep && (ep.id ?? ep.episode_id));
  const number = asInt(ep && (ep.episode_num ?? ep.episode_number ?? ep.num));
  if (!id || number == null) return null;             // nothing to play, or nowhere to file it
  const info = infoOf(ep);
  const ext = safeExt(ep.container_extension || info.container_extension || 'mp4');
  const url = episodeUrl(cred.host, cred.username, cred.password, id, ext);

  return {
    number,
    title: String(ep.title || info.name || '').trim() || `Episode ${number}`,
    description: String(info.plot || info.description || '').trim(),
    airDate: asDate(info.air_date || info.releasedate || ep.added),
    runtimeMinutes: asMinutes(info),
    rating: asRating(info),
    thumbnail: firstUrl(info.movie_image) || firstUrl(info.cover_big),
    season: seasonNumber,
    externalIds: tmdb(info.tmdb_id),
    source: {
      contentId: contentId(sourceId, 'episode', id),
      playbackUrl: directOr(url, ep.direct_source),
      playbackType: PLAYBACK_FOR(ext),
      availability: 'available',
      quality: qualityOf(info),
      credentialed: true,
      sourceId,
      sourceLabel: cred.label || ''
    }
  };
}

/* A panel's VOD is a progressive file — mp4, mkv, avi — except when it is a
   manifest, which some panels do serve for VOD. Said as what it is, because
   it decides what the player does with it. */
function PLAYBACK_FOR(ext) {
  if (ext === 'm3u8') return 'hls';
  if (ext === 'mpd') return 'dash';
  return 'direct';
}

/* The resolution the panel's own ffprobe recorded, where it recorded one.
   Shown next to a source so a person choosing between two knows which. */
function qualityOf(info = {}) {
  const v = info.video && typeof info.video === 'object' ? info.video : {};
  const h = asInt(v.height);
  if (!h) return '';
  if (h >= 2000) return '4K';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  return `${h}p`;
}

const tmdb = (v) => {
  const id = idOf(v);
  return id && id !== '0' ? { tmdb: id } : {};
};

/**
 * Panels put the quality, the language and the year into the name, because a
 * name is all a playlist has. The catalogue has columns for those, so the
 * decoration comes off the title — otherwise "Arrival (2016) 1080p" and
 * "Arrival" are two films.
 */
export function cleanTitle(raw) {
  return splitTitleYear(raw).title;
}

/**
 * The title and the year, separately.
 *
 * "Arrival (2016) 1080p" is one string in a panel and two columns in the
 * catalogue, and getting it wrong is what makes a film appear twice: the local
 * scanner already files that film as "Arrival" with year 2016, and a title
 * carrying its own year would not match it.
 *
 * A bare trailing number is left alone, because Blade Runner 2049 is called
 * that. A bracketed one is taken, because nothing is called "(2049)".
 */
export function splitTitleYear(raw) {
  let t = String(raw || '').trim();
  let year = null;

  t = t.replace(/\.(mp4|mkv|avi|m3u8|mpd|ts)$/i, '');
  t = t.replace(/\b(4k|uhd|fhd|hd|sd|1080p?|720p?|480p?|2160p?|x264|x265|hevc|web-?dl|webrip|bluray|hdrip|dvdrip|multi|dual|vose?)\b/gi, ' ');
  t = t.replace(/\s*\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

  const bracketed = t.match(/[([{]\s*((?:19|20)\d{2})\s*[)\]}]\s*$/);
  if (bracketed) {
    const y = Number(bracketed[1]);
    if (y >= 1870 && y <= 2100) { year = y; t = t.slice(0, bracketed.index).trim(); }
  }

  t = t.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s{2,}/g, ' ')
       .replace(/[\s\-–_·]+$/, '').trim();
  return { title: t || String(raw || '').trim(), year };
}
