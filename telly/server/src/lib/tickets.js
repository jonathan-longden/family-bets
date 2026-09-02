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

export function issueTicket({ userId, deviceId, channelId, ttlSeconds = config.tokens.ticketTtlSeconds }) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${userId}.${deviceId}.${channelId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the ticket's claims, or null if it is invalid, edited or expired. */
export function readTicket(ticket) {
  if (typeof ticket !== 'string') return null;
  const parts = ticket.split('.');
  if (parts.length !== 5) return null;
  const [userId, deviceId, channelId, expires, mac] = parts;
  const payload = `${userId}.${deviceId}.${channelId}.${expires}`;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expires) * 1000 <= Date.now()) return null;
  return {
    userId: Number(userId),
    deviceId: Number(deviceId),
    channelId: Number(channelId),
    expiresAt: new Date(Number(expires) * 1000).toISOString()
  };
}
