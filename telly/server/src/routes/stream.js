import { config } from '../config.js';
import { entitledChannel } from '../services/library.js';
import { issueTicket, readTicket } from '../lib/tickets.js';
import { markWatched } from '../services/profile.js';
import { playableMedia } from '../services/media.js';
import { decide, sendDirect, sendTranscoded, MIME } from '../services/playback.js';
import { badRequest, forbidden, notFound, upstreamFailed, webOnly } from '../lib/errors.js';
import {
  movie as catMovie, episode as catEpisode, movieSources, episodeSources, preferredSource,
  sourceAddress
} from '../services/catalogue.js';
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

  /* --------------------------------------------- a work in the catalogue --
   *
   * One call that answers "play this film" however many providers have it.
   * The client holds a catalogue id — not a provider's id, and never a path or
   * a page URL — and gets back one of three answers:
   *
   *   local     this server has the file. A ticket is cut exactly as before,
   *             so the path guard and the remux decision are unchanged.
   *   direct    a provider publishes a stream for this purpose. Its address is
   *             handed over as it was published; nothing is derived from a web
   *             page and nothing is unwrapped.
   *   web_only  every provider that has this plays it in its own app or site.
   *             Said plainly, with the link, rather than a player that will
   *             never start.
   */
  app.post('/stream/catalogue/:kind/:id/ticket', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          capability: { type: 'string', enum: ['browser', 'native'] },
          /* Which provider to use, when the person picked one from the Play
             menu. Left out, the preferred working source is chosen. */
          source: { type: 'integer', minimum: 1 },
          provider: { type: 'string', maxLength: 40 }
        }
      }
    }
  }, async (request, reply) => {
    const kind = String(request.params.kind);
    if (!['movie', 'episode'].includes(kind)) throw badRequest('Play a movie or an episode.');
    const id = Number(request.params.id);

    /* 404s before anything else happens, so a bad id never produces a ticket. */
    const work = kind === 'movie' ? catMovie(id) : catEpisode(id);
    const all = kind === 'movie' ? movieSources(id) : episodeSources(id);

    let chosen = null;
    if (request.query.source) chosen = all.find(s => s.id === Number(request.query.source)) || null;
    else if (request.query.provider) {
      chosen = all.find(s => s.providerKey === request.query.provider && s.playable) || null;
    } else {
      /* Nothing playable does not mean nothing at all: a work every provider
         keeps behind its own app still has sources, and saying so is more use
         than a 404. So the first of those is picked, and reported below. */
      chosen = preferredSource(kind, id) || all[0] || null;
    }

    if (!chosen) throw notFound('No source for that, from any provider.');

    if (!chosen.playable) {
      throw webOnly(
        `${chosen.providerName} plays this in its own app or site, so Telly cannot open it ` +
        'in the player.',
        {
          playbackType: chosen.playbackType,
          provider: chosen.providerName,
          webUrl: chosen.webUrl || '',
          /* Where another provider does offer a stream, say so — that is the
             answer the person actually wants. */
          alternatives: all.filter(s => s.playable)
            .map(s => ({ sourceId: s.id, provider: s.providerName, playbackType: s.playbackType }))
        });
    }

    if (chosen.local) {
      /* The source carries the row id of the file, so this is the existing
         path: the same lookup, the same guard, the same ticket. */
      const mediaKind = chosen.localKind || kind;
      const item = playableMedia(mediaKind, chosen.localId);
      const capability = request.query.capability === 'native' ? 'native' : 'browser';
      const plan = decide(item.container, { capability });
      const ticket = issueTicket({
        userId: request.auth.user.id,
        deviceId: request.auth.deviceId,
        resource: `${mediaKind}-${chosen.localId}`
      });
      return {
        mode: 'local',
        provider: chosen.providerName,
        sourceId: chosen.id,
        url: `/api/v1/stream/media/${mediaKind}/${chosen.localId}?ticket=${encodeURIComponent(ticket)}`,
        expiresIn: config.tokens.ticketTtlSeconds,
        playbackType: chosen.playbackType,
        container: item.container,
        playback: plan.mode,
        title: titleOf(work)
      };
    }

    const alternatives = all.filter(s => s.playable && s.id !== chosen.id)
      .map(s => ({ sourceId: s.id, provider: s.providerName,
                   source: s.sourceLabel || undefined, playbackType: s.playbackType }));

    if (chosen.credentialed) {
      /* A subscription's address has its username and password in it, so the
         client is given a ticket for this server instead. The server redirects
         the player to the panel when the ticket is presented; the video never
         passes through here unless the operator asked for proxy mode, and the
         credentials never reach the device. */
      const ticket = issueTicket({
        userId: request.auth.user.id,
        deviceId: request.auth.deviceId,
        resource: `cat-${kind}-${chosen.id}`
      });
      return {
        mode: 'remote',
        provider: chosen.providerName,
        source: chosen.sourceLabel || undefined,
        sourceId: chosen.id,
        url: `/api/v1/stream/catalogue/${kind}/${id}?source=${chosen.id}` +
             `&ticket=${encodeURIComponent(ticket)}`,
        expiresIn: config.tokens.ticketTtlSeconds,
        playbackType: chosen.playbackType,
        quality: chosen.quality || undefined,
        title: titleOf(work),
        alternatives
      };
    }

    return {
      mode: 'direct',
      provider: chosen.providerName,
      source: chosen.sourceLabel || undefined,
      sourceId: chosen.id,
      /* The provider's own published address, unchanged. */
      url: chosen.url,
      playbackType: chosen.playbackType,
      quality: chosen.quality || undefined,
      title: titleOf(work),
      alternatives
    };
  });

  /**
   * A catalogue source played through this server.
   *
   * The same shape as the live-channel route below it, and for the same
   * reason: the address belongs to the operator's subscription, so it is
   * resolved here and the player is sent to it. A ticket is accepted because a
   * `<video>` element cannot send a header; a bearer token is accepted too, so
   * the Android app and curl can use it directly.
   *
   * Nothing is stored and nothing is downloaded. In the default mode the
   * server answers with a redirect and steps out of the way; in proxy mode it
   * relays, which is the operator's choice and is what keeps the upstream
   * address off the device entirely.
   */
  app.get('/stream/catalogue/:kind/:id', async (request, reply) => {
    const kind = String(request.params.kind);
    if (!['movie', 'episode'].includes(kind)) throw badRequest('Play a movie or an episode.');
    const id = Number(request.params.id);

    /* 404 before anything else, so a bad id never reaches a lookup. */
    const work = kind === 'movie' ? catMovie(id) : catEpisode(id);
    if (!work) throw notFound('No such title.');

    const all = kind === 'movie' ? movieSources(id) : episodeSources(id);
    const chosen = request.query.source
      ? all.find(s => s.id === Number(request.query.source)) || null
      : preferredSource(kind, id);
    if (!chosen || !chosen.playable) throw notFound('Nothing here can play that.');

    const ticket = readTicket(request.query.ticket);
    if (ticket) {
      if (ticket.resource !== `cat-${kind}-${chosen.id}`) {
        throw forbidden('That playback link is for something else.');
      }
      const device = openDb().prepare('SELECT revoked_at FROM devices WHERE id = ? AND user_id = ?')
        .get(ticket.deviceId, ticket.userId);
      if (!device || device.revoked_at) throw forbidden('This device has been removed from the account.');
    } else {
      /* No ticket, then a token. Never neither: an address that carries a
         subscription is not something to hand to whoever asks. */
      await app.authenticate(request, reply);
      if (reply.sent) return reply;
    }

    if (chosen.local) {
      /* Not this route's job — the file path, the guard and the remux
         decision belong to /stream/media, which is where this points. */
      return reply.redirect(302, `/api/v1/stream/media/${chosen.localKind}/${chosen.localId}` +
        (request.query.ticket ? `?ticket=${encodeURIComponent(request.query.ticket)}` : ''));
    }

    const address = sourceAddress(kind, chosen.id);
    if (!address || !address.url) throw upstreamFailed('That source has no usable address.');

    /* A credentialed address is relayed rather than redirected to, because a
       302 would put the subscription's username and password in a Location
       header on the device. The operator can trade that back for the
       bandwidth with TELLY_VOD_MODE=redirect. A public address — the Internet
       Archive's, say — is redirected to as before: there is nothing in it to
       keep back, and relaying a film nobody is hiding would be pure cost. */
    const relay = address.credentialed
      ? config.vodMode !== 'redirect'
      : config.streamMode === 'proxy';
    if (relay) return proxy(address.url, request, reply);
    return reply.redirect(302, address.url);
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

const titleOf = (work) => work.canonical_title || work.title || '';
