import { config } from '../config.js';
import { authenticate, publicUser, sectionsFor } from '../services/users.js';
import { registerDevice, listDevices } from '../services/devices.js';
import { issueSession, rotate, revoke } from '../services/sessions.js';
import { sourcesForUser } from '../services/sources.js';
import { openDb, nowIso } from '../db/index.js';

const loginBody = {
  type: 'object',
  required: ['username', 'password', 'device'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
    device: {
      type: 'object',
      required: ['key'],
      properties: {
        key: { type: 'string', minLength: 8, maxLength: 128 },
        name: { type: 'string', maxLength: 64 },
        platform: { type: 'string', maxLength: 32 },
        appVersion: { type: 'string', maxLength: 32 }
      }
    }
  }
};

function audit(userId, action, detail, ip) {
  openDb().prepare('INSERT INTO audit_log (at, user_id, actor, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nowIso(), userId, 'api', action, detail || '', ip || '');
}

/** Everything the app needs to draw itself, in one reply after signing in. */
export function environmentFor(user) {
  return {
    user: publicUser(user),
    sections: sectionsFor(user.id),
    playlists: sourcesForUser(user.id).map(s => ({
      id: s.id, name: s.name, kind: s.kind, channelCount: s.channel_count, lastSyncedAt: s.last_synced_at
    })),
    devices: listDevices(user.id).map(d => ({
      id: d.id, name: d.name, platform: d.platform, lastSeenAt: d.last_seen_at, active: d.active_sessions > 0
    }))
  };
}

export default async function authRoutes(app) {
  app.post('/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: config.rateLimit.loginPerMinute, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { username, password, device } = request.body;
    const user = await authenticate(username, password);
    const dev = registerDevice(user.id, {
      key: device.key, name: device.name, platform: device.platform,
      appVersion: device.appVersion, ip: request.ip
    }, user.max_devices);
    const tokens = issueSession(user.id, dev.id);
    audit(user.id, 'login', `device=${dev.name}`, request.ip);
    return reply.send({ ...tokens, ...environmentFor(user), device: { id: dev.id, name: dev.name } });
  });

  app.post('/refresh', {
    schema: {
      body: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string', minLength: 16 } } }
    }
  }, async (request, reply) => {
    const { session, tokens } = rotate(request.body.refreshToken);
    const { getUser, assertUsable } = await import('../services/users.js');
    const user = assertUsable(getUser(session.user_id));
    return reply.send({ ...tokens, ...environmentFor(user) });
  });

  app.post('/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    revoke(request.auth.session.id);
    audit(request.auth.user.id, 'logout', '', request.ip);
    return reply.send({ ok: true });
  });
}
