import { ACCESS, STATUS, PLAYBACK } from './contract.js';

/**
 * movy.sx — not implemented, and for a different reason from the others.
 *
 * Tubi, The Roku Channel, Fawesome and Xumo are licensed services that simply
 * do not publish a catalogue interface. This one could not be established as a
 * licensed distributor of the films and series it indexes at all.
 *
 * That matters more than an API question. An adapter here would not be reading
 * a catalogue a service is entitled to offer; it would be indexing someone
 * else's films on behalf of a site that does not appear to have the right to
 * carry them. So there is no adapter body, and this is not a case of waiting
 * for a feed to appear: if one appeared, the licensing question would still be
 * the one that matters.
 *
 * It is listed rather than dropped so the answer is visible in Settings
 * instead of looking like an oversight.
 */
export default {
  key: 'movy',
  name: 'Movy',
  baseUrl: 'https://movy.sx/',
  termsUrl: '',
  robotsUrl: 'https://movy.sx/robots.txt',
  enabledByDefault: false,
  permanentlyUnavailable: true,

  access: {
    method: ACCESS.none,
    status: STATUS.noPermittedAccess,
    reason: 'Not implemented: this site could not be established as a licensed ' +
      'distributor of the content it indexes, so Telly will not import a catalogue ' +
      'from it. This is a licensing judgement, not a missing API — a feed appearing ' +
      'would not change it.',
    assessedAt: '2026-10-05',
    recheck: [
      'Evidence that the service is licensed to distribute the content it lists',
      'An identifiable operator and terms of service'
    ]
  },

  capabilities: {
    metadata: false, artwork: false, playback: false,
    playbackType: PLAYBACK.none
  },

  limits: { refreshIntervalSeconds: 0 }
};
