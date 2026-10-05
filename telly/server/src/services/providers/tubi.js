import { ACCESS, STATUS, PLAYBACK, NO_INTERFACE } from './contract.js';

/**
 * Tubi — a licensed, ad-supported service owned by Fox.
 *
 * There is no adapter body below, on purpose.
 *
 * Tubi publishes no documented catalogue interface for third parties. Its
 * catalogue is served to its own apps through an internal API, its terms of
 * use prohibit automated access and scraping, and its video is delivered under
 * DRM. The only way to read its catalogue automatically would be to use that
 * internal API against its terms, so Telly does not.
 *
 * This is not a limitation to be worked around. If Tubi opens a partner or
 * public feed, `discover` goes here and `access` changes — and nothing else in
 * Telly needs to change, because the catalogue, the deduplication and the
 * player do not know one provider from another.
 */
export default {
  key: 'tubi',
  name: 'Tubi',
  baseUrl: 'https://tubitv.com/',
  termsUrl: 'https://tubitv.com/static/terms',
  robotsUrl: 'https://tubitv.com/robots.txt',
  enabledByDefault: false,

  access: {
    method: ACCESS.none,
    status: STATUS.noPermittedAccess,
    reason: NO_INTERFACE + ' Tubi documents no public or partner catalogue API, ' +
      'and its terms of use prohibit automated access. Its own apps read an internal ' +
      'API, which is not a permitted interface for this.',
    assessedAt: '2026-10-05',
    /* Recorded so the next person can check rather than take this on trust. */
    recheck: [
      'A documented Tubi partner or developer catalogue API',
      'An official MRSS or JSON content feed offered to third parties',
      'A change to the terms of use permitting automated catalogue collection'
    ]
  },

  capabilities: {
    metadata: false,
    artwork: false,
    playback: false,
    /* Tubi plays in its own app and site. A Tubi page is a page, not a
       stream, and Telly will not pretend otherwise. */
    playbackType: PLAYBACK.webOnly
  },

  limits: { refreshIntervalSeconds: 86400 }
};
