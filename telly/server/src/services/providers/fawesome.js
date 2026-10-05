import { ACCESS, STATUS, PLAYBACK, NO_INTERFACE } from './contract.js';

/**
 * Fawesome — a licensed, ad-supported service from Future Today.
 *
 * No public or documented catalogue interface could be identified. Future
 * Today distributes through its own apps across platforms; what those apps
 * call is internal. Without something published and meant to be read, there
 * is nothing for an adapter to use, so this one declares that and stops.
 */
export default {
  key: 'fawesome',
  name: 'Fawesome',
  baseUrl: 'https://fawesome.tv/',
  termsUrl: 'https://fawesome.tv/terms',
  robotsUrl: 'https://fawesome.tv/robots.txt',
  enabledByDefault: false,

  access: {
    method: ACCESS.none,
    status: STATUS.noOfficialApi,
    reason: NO_INTERFACE + ' No public or documented Fawesome catalogue API or ' +
      'content feed for third parties could be identified.',
    assessedAt: '2026-10-05',
    recheck: [
      'A documented Future Today / Fawesome catalogue API or feed',
      'A published partner interface'
    ]
  },

  capabilities: {
    metadata: false, artwork: false, playback: false,
    playbackType: PLAYBACK.webOnly
  },

  limits: { refreshIntervalSeconds: 86400 }
};
