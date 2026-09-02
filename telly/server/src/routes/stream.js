import { config } from '../config.js';
import { entitledChannel } from '../services/library.js';
import { issueTicket, readTicket } from '../lib/tickets.js';
import { markWatched } from '../services/profile.js';
import { forbidden, notFound, upstreamFailed } from '../lib/errors.js';
import { openDb } from '../db/index.js';

/**
 * Playback in two steps.
 *
 * The app asks for a ticket while it is holding a bearer token; it then hands
 * the ticket to the player, which cannot carry an Authorization header. The
 * ticket is signed, short-lived, and bound to the user, the device and the one
 * channel, so a copied URL is worth very little for very long.
 */
export default async function streamRoutes(app) {
  app.post('/stream/:channelId/ticket', { preHandler: [app.authenticate] }, async (request) => {
    const channelId = Number(request.params.channelId);
    const channel = entitledChannel(request.auth.user.id, channelId);
    markWatched(request.auth.user.id, channelId);
    const ticket = issueTicket({
      userId: request.auth.user.id,
      deviceId: request.auth.deviceId,
      channelId
    });
    return {
      url: `/api/v1/stream/${channelId}?ticket=${encodeURIComponent(ticket)}`,
      expiresIn: config.tokens.ticketTtlSeconds,
      kind: channel.kind
    };
  });

  app.get('/stream/:channelId', async (request, reply) => {
    const claims = readTicket(request.query.ticket);
    if (!claims) throw forbidden('That playback link has expired. Choose the channel again.');
    if (claims.channelId !== Number(request.params.channelId)) throw forbidden('That playback link is for another channel.');

    // The device could have been revoked since the ticket was cut.
    const device = openDb().prepare('SELECT revoked_at FROM devices WHERE id = ? AND user_id = ?')
      .get(claims.deviceId, claims.userId);
    if (!device || device.revoked_at) throw forbidden('This device has been removed from the account.');

    const channel = entitledChannel(claims.userId, claims.channelId);
    if (!channel) throw notFound('No such channel.');

    if (config.streamMode === 'proxy') return proxy(channel.stream_url, request, reply);

    // Default: hand the player the upstream address and step out of the way,
    // so the server never carries the video.
    return reply.redirect(302, channel.stream_url);
  });
}

/** Relay mode: the upstream address never reaches the device. */
async function proxy(url, request, reply) {
  const headers = { 'user-agent': 'Telly-Server/1.0' };
  if (request.headers.range) headers.range = request.headers.range;

  let upstream;
  try {
    upstream = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    throw upstreamFailed(`The stream did not answer: ${e.message}`);
  }
  if (!upstream.ok && upstream.status !== 206) {
    throw upstreamFailed(`The stream replied ${upstream.status} ${upstream.statusText}.`);
  }
  for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) reply.header(h, v);
  }
  reply.status(upstream.status);
  return reply.send(upstream.body);
}
