import { ACCESS, STATUS, PLAYBACK, NO_INTERFACE } from './contract.js';

/**
 * The Roku Channel — licensed, ad-supported, run by Roku.
 *
 * Roku has a substantial developer platform, but it points the other way: the
 * published feed specification (the Roku "direct publisher" / content feed
 * schema) is for a content owner to describe their own catalogue *to* Roku. It
 * is not an interface for reading what The Roku Channel carries.
 *
 * There is no documented API for a third party to read that catalogue, and
 * playback goes through Roku's own apps and site with its own authentication
 * and DRM. So there is nothing here to call, and no adapter body.
 */
export default {
  key: 'roku',
  name: 'The Roku Channel',
  baseUrl: 'https://therokuchannel.roku.com/',
  termsUrl: 'https://docs.roku.com/published/userterms',
  robotsUrl: 'https://therokuchannel.roku.com/robots.txt',
  enabledByDefault: false,

  access: {
    method: ACCESS.none,
    status: STATUS.noOfficialApi,
    reason: NO_INTERFACE + ' Roku\'s published content-feed specification is for ' +
      'submitting a catalogue to Roku, not for reading The Roku Channel\'s. No ' +
      'third-party catalogue API is documented.',
    assessedAt: '2026-10-05',
    recheck: [
      'A documented Roku API for reading The Roku Channel catalogue',
      'A partner programme that grants catalogue access'
    ]
  },

  capabilities: {
    metadata: false, artwork: false, playback: false,
    playbackType: PLAYBACK.webOnly
  },

  limits: { refreshIntervalSeconds: 86400 }
};
