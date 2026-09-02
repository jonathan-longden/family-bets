import { createUser, listUsers, setPassword, setEnabled, setSections, getUser, SECTIONS } from '../services/users.js';
import { listDevices, revokeDevice } from '../services/devices.js';
import { createSource, listSources, publicSource, assign, unassign, syncSource, getSource } from '../services/sources.js';
import { revokeAllForUser } from '../services/sessions.js';
import { openDb, nowIso } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

/**
 * The administrator API. The panel that will eventually sit on top of this is
 * not built yet; these are the endpoints it will call, so building it later
 * changes no schema and breaks no client.
 */
export default async function adminRoutes(app) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireAdmin);

  app.get('/users', async () => ({ users: listUsers() }));

  app.post('/users', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 32 },
          password: { type: 'string', minLength: 8, maxLength: 200 },
          displayName: { type: 'string', maxLength: 64 },
          role: { type: 'string', enum: ['user', 'admin'] },
          maxDevices: { type: 'integer', minimum: 1, maximum: 20 },
          expiresAt: { type: ['string', 'null'] },
          sections: { type: 'array', items: { type: 'string', enum: SECTIONS } }
        }
      }
    }
  }, async (request, reply) => {
    const user = await createUser(request.body);
    return reply.status(201).send({ user: { id: user.id, username: user.username } });
  });

  app.patch('/users/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          password: { type: 'string', minLength: 8, maxLength: 200 },
          maxDevices: { type: 'integer', minimum: 1, maximum: 20 },
          expiresAt: { type: ['string', 'null'] },
          displayName: { type: 'string', maxLength: 64 },
          sections: { type: 'array', items: { type: 'string', enum: SECTIONS } }
        }
      }
    }
  }, async (request) => {
    const id = Number(request.params.id);
    const body = request.body || {};
    getUser(id);
    if (body.password !== undefined) { await setPassword(id, body.password); revokeAllForUser(id); }
    if (body.enabled !== undefined) { setEnabled(id, body.enabled); if (!body.enabled) revokeAllForUser(id); }
    if (body.sections !== undefined) setSections(id, body.sections);
    if (body.maxDevices !== undefined)
      openDb().prepare('UPDATE users SET max_devices = ?, updated_at = ? WHERE id = ?').run(body.maxDevices, nowIso(), id);
    if (body.expiresAt !== undefined)
      openDb().prepare('UPDATE users SET expires_at = ?, updated_at = ? WHERE id = ?').run(body.expiresAt, nowIso(), id);
    if (body.displayName !== undefined)
      openDb().prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(body.displayName, nowIso(), id);
    return { user: getUser(id) };
  });

  app.delete('/users/:id', async (request) => {
    const id = Number(request.params.id);
    if (id === request.auth.user.id) throw badRequest('You cannot delete the account you are signed in with.');
    openDb().prepare('DELETE FROM users WHERE id = ?').run(id);
    return { ok: true };
  });

  app.get('/users/:id/devices', async (request) => ({ devices: listDevices(Number(request.params.id)) }));

  app.delete('/users/:id/devices/:deviceId', async (request) => {
    revokeDevice(Number(request.params.id), Number(request.params.deviceId));
    return { ok: true };
  });

  app.get('/sources', async () => ({ sources: listSources().map(publicSource) }));

  app.post('/sources', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'kind'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          kind: { type: 'string', enum: ['m3u_url', 'm3u_text', 'xtream'] },
          url: { type: 'string', maxLength: 2000 },
          username: { type: 'string', maxLength: 200 },
          password: { type: 'string', maxLength: 200 },
          epgUrl: { type: 'string', maxLength: 2000 }
        }
      }
    }
  }, async (request, reply) => {
    const s = createSource(request.body);
    return reply.status(201).send({ source: publicSource(s) });
  });

  app.post('/sources/:id/sync', async (request) => {
    const result = await syncSource(Number(request.params.id));
    return { ...result, source: publicSource(getSource(Number(request.params.id))) };
  });

  app.put('/users/:id/sources/:sourceId', async (request) => {
    assign(Number(request.params.id), Number(request.params.sourceId));
    return { ok: true };
  });

  app.delete('/users/:id/sources/:sourceId', async (request) => {
    unassign(Number(request.params.id), Number(request.params.sourceId));
    return { ok: true };
  });

  app.get('/audit', async () => ({
    entries: openDb().prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT 200').all()
  }));
}
