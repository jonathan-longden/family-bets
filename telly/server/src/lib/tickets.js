/**
 * Playback tickets.
 *
 * The client is never given the upstream stream URL, and never given the
 * provider's credentials. It gets a channel id and asks for a ticket; the
 * ticket says "this user, on this device, may open this channel, for the next
 * few minutes" and is signed so it cannot be edited or invented.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function sign(payload) {
  return createHmac('sha256', config.secret).update(payload).digest('base64url');
}

/**
 * A signature for one piece of cached artwork.
 *
 * Posters are the one thing a client fetches with a plain <img src>, which
 * cannot carry an Authorization header — so the authenticated route for them
 * has never actually worked in a browser: every cached poster 401'd and the
 * card fell back to Telly's generated artwork. A ticket is the wrong shape
 * here too, because a lazily-loaded rail is fetched minutes or hours after
 * the page was opened and a five-minute ticket would have expired.
 *
 * So the address itself is the credential: an id plus a short signature over
 * it, which cannot be guessed and does not expire. Somebody who can already
 * read the catalogue has the address; somebody who cannot has nothing to
 * enumerate. It carries no user and no device, because a poster is not
 * somebody's private file — it is a picture of a film, fetched once for the
 * whole house.
 */
export function artSignature(id) {
  return sign(`art:${Number(id)}`).slice(0, 22);
}

export function artSignatureOk(id, sig) {
  const want = Buffer.from(artSignature(id));
  const got = Buffer.from(String(sig || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * `resource` is what the ticket is for. A live channel is its numeric id, as
 * it always was; a file from the server's own library is "movie-12",
 * "episode-98", "recording-3". One mechanism, so a personal film is no more
 * reachable without a ticket than a subscription channel is.
 */
export function issueTicket({ userId, deviceId, channelId, resource,
                              ttlSeconds = config.tokens.ticketTtlSeconds }) {
  const what = String(resource == null ? channelId : resource);
  if (!/^[A-Za-z0-9_-]+$/.test(what)) throw new Error('A ticket resource must be plain id text.');
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${deviceId}.${what}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the ticket's claims, or null if it is invalid, edited or expired. */
export function readTicket(ticket) {
  if (typeof ticket !== 'string') return null;
  const parts = ticket.split('.');
  if (parts.length !== 5) return null;
  const [userId, deviceId, resource, expires, mac] = parts;
  const payload = `${userId}.${deviceId}.${resource}.${expires}`;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expires) * 1000 <= Date.now()) return null;
  return {
    userId: Number(userId),
    deviceId: Number(deviceId),
    resource,
    // Unchanged for a live channel, whose resource is its id. NaN for a file,
    // which the media route reads from `resource` instead.
    channelId: Number(resource),
    expiresAt: new Date(Number(expires) * 1000).toISOString()
  };
}
