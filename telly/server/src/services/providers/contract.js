/**
 * The adapter contract: the vocabulary, and nothing else.
 *
 * This file imports nothing. The adapters import it, and the registry imports
 * both — so an adapter never depends on the registry that loads it, and a
 * provider can be added without touching anything that is already working.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * An adapter is an object:
 *
 *   key, name, baseUrl, termsUrl, robotsUrl
 *   enabledByDefault      only `local` sets this
 *
 *   access: {
 *     method        one of ACCESS — how a catalogue may be read, if at all
 *     status        one of STATUS — whether it can be read now
 *     reason        a sentence a person reads in Settings
 *     assessedAt    when somebody last looked
 *     recheck       [] what would have to change for this to be revisited
 *   }
 *
 *   capabilities: { metadata, artwork, playback, playbackType }
 *   limits: { requestDelayMs, concurrency, timeoutMs, maxRetries, pageLimit,
 *             refreshIntervalSeconds }
 *   settings: {}          adapter-specific, read through ctx.setting()
 *
 *   discover(ctx)         ONLY where access.status is `available`. An async
 *                         generator yielding works. Its absence is what makes
 *                         a provider un-importable, so there is no way to run
 *                         one that does not have one.
 *
 * A work it yields:
 *
 *   { kind: 'movie' | 'series',
 *     title, originalTitle, year, releaseDate, description, runtimeMinutes,
 *     rating, ageRating,
 *     genres: [], countries: [], languages: [], keywords: [],
 *     poster, backdrop, thumbnail,
 *     cast: [{name, character, image}], directors: [], writers: [],
 *     externalIds: { imdb, tmdb, tvdb, … },
 *     source: { contentId, metadataUrl, playbackUrl, playbackType,
 *               availability, quality, localKind, localId },
 *     seasons: [{ number, title, episodes: [{ number, title, …, source }] }] }
 *
 * Note what the work does NOT carry: the provider. Identity belongs to the
 * work; the provider belongs to the source.
 */

/** How a catalogue may be read from a provider, if at all. */
export const ACCESS = {
  officialApi: 'official_api',        // a documented interface meant for this
  publicFeed: 'public_feed',          // a published feed meant to be read
  localFilesystem: 'local_filesystem',
  none: 'none'
};

/**
 * What the provider's state is. `enabled` is the operator's switch and is kept
 * separately, so the six states the brief asks to see are
 * (enabled | disabled) × (available | unavailable | no_official_api |
 * no_permitted_automated_access).
 */
export const STATUS = {
  available: 'available',
  unavailable: 'unavailable',
  noOfficialApi: 'no_official_api',
  noPermittedAccess: 'no_permitted_automated_access'
};

/** What a source from a provider can offer the player. */
export const PLAYBACK = {
  direct: 'direct',       // a progressive file the player can open
  hls: 'hls',             // an HLS manifest
  dash: 'dash',
  webOnly: 'web_only',    // the provider's own app or site, and only that
  none: 'none'
};

/** The sentence the brief asks for, said once, in one place. */
export const NO_INTERFACE = 'No permitted automated catalogue interface available.';

/** Playback a client can actually open. */
export const PLAYABLE_TYPES = [PLAYBACK.direct, PLAYBACK.hls, PLAYBACK.dash];

/**
 * True when this adapter may actually be run.
 *
 * Three conditions, and all three have to hold: it has to have a way in, that
 * way has to be a permitted one, and the provider has to be assessed as
 * readable now. An adapter cannot opt itself past this.
 */
export function importable(adapter) {
  return Boolean(adapter && adapter.discover) &&
    adapter.access.status === STATUS.available &&
    adapter.access.method !== ACCESS.none;
}
