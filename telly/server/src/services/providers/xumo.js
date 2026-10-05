import { ACCESS, STATUS, PLAYBACK, NO_INTERFACE } from './contract.js';

/**
 * Xumo Play — licensed, ad-supported, now part of the Comcast/Charter venture.
 *
 * Worth being precise about, because Xumo is half-available to Telly already
 * and it would be easy to overclaim.
 *
 *   Live channels   Xumo's free channel line-up is carried by the public IPTV
 *                   playlist projects Telly already imports from, and plays in
 *                   Telly today through Live TV. That path is unchanged and
 *                   needs nothing here.
 *
 *   On-demand       the films-and-series catalogue is a different thing, served
 *                   to Xumo's own apps through an internal API. Nothing public
 *                   or documented describes it for third parties.
 *
 * So this adapter covers the on-demand catalogue only, and declares that it
 * has no permitted way in. It does not interfere with the live channels.
 */
export default {
  key: 'xumo',
  name: 'Xumo Play',
  baseUrl: 'https://play.xumo.com/',
  termsUrl: 'https://www.xumo.com/terms',
  robotsUrl: 'https://play.xumo.com/robots.txt',
  enabledByDefault: false,

  access: {
    method: ACCESS.none,
    status: STATUS.noOfficialApi,
    reason: NO_INTERFACE + ' No public or documented Xumo API for the on-demand ' +
      'catalogue could be identified. Xumo\'s free live channels are a separate ' +
      'matter and already reach Telly through the public IPTV playlists in Live TV.',
    assessedAt: '2026-10-05',
    recheck: [
      'A documented Xumo on-demand catalogue API or feed',
      'A published partner interface'
    ]
  },

  capabilities: {
    metadata: false, artwork: false, playback: false,
    playbackType: PLAYBACK.webOnly
  },

  limits: { refreshIntervalSeconds: 86400 }
};
