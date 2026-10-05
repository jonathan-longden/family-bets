import { config } from '../config.js';
import { entitledChannel } from '../services/library.js';
import { issueTicket, readTicket } from '../lib/tickets.js';
import { markWatched } from '../services/profile.js';
import { playableMedia } from '../services/media.js';
import { decide, sendDirect, sendTranscoded, MIME } from '../services/playback.js';
import { badRequest, forbidden, notFound, upstreamFailed } from '../lib/errors.js';
import { openDb } from '../db/index.js';

const MEDIA_KINDS = ['movie', 'episode', 'recording'];

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

  /* ------------------------------------------------- the server's own disk --
   *
   * The same two steps, for a file in a media folder. The client holds an id
   * and a ticket and never sees a path: /stream/media/movie/12, not
   * C:\Media\Movies\Arrival (2016)\Arrival.mkv.
   */
  app.post('/stream/media/:kind/:id/ticket', { preHandler: [app.authenticate] }, async (request) => {
    const kind = String(request.params.kind);
    if (!MEDIA_KINDS.includes(kind)) throw badRequest('That is not a kind of media.');
    const id = Number(request.params.id);
    const item = playableMedia(kind, id);          // 404s before a ticket is cut
    const capability = request.query.capability === 'native' ? 'native' : 'browser';
    const plan = decide(item.container, { capability });
    const ticket = issueTicket({
      userId: request.auth.user.id,
      deviceId: request.auth.deviceId,
      resource: `${kind}-${id}`
    });
    return {
      url: `/api/v1/stream/media/${kind}/${id}?ticket=${encodeURIComponent(ticket)}`,
      expiresIn: config.tokens.ticketTtlSeconds,
      kind,
      title: item.title,
      container: item.container,
      /* Said plainly so a client can choose a player rather than guess:
         direct means byte ranges and seeking, remux means a single
         progressive stream, unsupported means do not try. */
      mode: plan.mode,
      mimeType: plan.mime,
      seekable: plan.mode === 'direct',
      reason: plan.reason || undefined
    };
  });

  app.get('/stream/media/:kind/:id', async (request, reply) => {
    const kind = String(request.params.kind);
    const id = Number(request.params.id);
    if (!MEDIA_KINDS.includes(kind)) throw badRequest('That is not a kind of media.');

    const claims = readTicket(request.query.ticket);
    if (!claims) throw forbidden('That playback link has expired. Choose it again.');
    if (claims.resource !== `${kind}-${id}`) throw forbidden('That playback link is for something else.');

    const device = openDb().prepare('SELECT revoked_at FROM devices WHERE id = ? AND user_id = ?')
      .get(claims.deviceId, claims.userId);
    if (!device || device.revoked_at) throw forbidden('This device has been removed from the account.');

    const item = playableMedia(kind, id);
    const capability = request.query.capability === 'native' ? 'native' : 'browser';
    const plan = decide(item.container, { capability });

    if (plan.mode === 'direct') {
      return sendDirect(item.path, reply, request.headers.range, plan.mime || MIME[item.container]);
    }
    if (plan.mode === 'remux') {
      return sendTranscoded(item.path, reply, { encode: request.query.encode === '1' });
    }
    throw upstreamFailed(plan.reason || 'That file cannot be played by this server.');
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
