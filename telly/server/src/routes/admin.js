import { createUser, listUsers, setPassword, setEnabled, setSections, getUser, SECTIONS } from '../services/users.js';
import { listDevices, revokeDevice } from '../services/devices.js';
import { createSource, updateSource, deleteSource, listSources, publicSource, assign, unassign,
         syncSource, getSource } from '../services/sources.js';
import { createRoot, updateRoot, deleteRoot, listRoots, publicRoot, scanRoot, scanAll } from '../services/media.js';
import { createEpgSource, updateEpgSource, deleteEpgSource, listEpgSources, publicEpgSource,
         syncEpgSource, getEpgSource } from '../services/xmltv.js';
import { exportM3u } from '../services/library.js';
import { runOnce } from '../services/scheduler.js';
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

  /* A source is managed, not just created: turned off without losing its
     channels, renamed, re-pointed, given its own refresh interval. */
  app.patch('/sources/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          url: { type: 'string', maxLength: 2000 },
          username: { type: 'string', maxLength: 200 },
          password: { type: 'string', maxLength: 200 },
          epgUrl: { type: 'string', maxLength: 2000 },
          enabled: { type: 'boolean' },
          refreshIntervalSeconds: { type: 'integer', minimum: 60, maximum: 2592000 }
        }
      }
    }
  }, async (request) => ({ source: publicSource(updateSource(Number(request.params.id), request.body)) }));

  app.delete('/sources/:id', async (request) => {
    deleteSource(Number(request.params.id));
    return { ok: true };
  });

  app.post('/sources/:id/sync', async (request) => {
    const result = await syncSource(Number(request.params.id));
    return { ...result, source: publicSource(getSource(Number(request.params.id))) };
  });

  /**
   * The catalogue back out as an M3U. It carries real stream addresses, which
   * is the point of an export and the reason only an administrator may ask.
   */
  app.get('/sources/export.m3u', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          sourceId: { type: 'integer', minimum: 1 },
          kind: { type: 'string', enum: ['live', 'movie', 'series'] }
        }
      }
    }
  }, async (request, reply) => {
    reply.header('content-type', 'audio/x-mpegurl; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="telly.m3u"');
    return reply.send(exportM3u(request.query));
  });

  /* ------------------------------------------------------ media folders -- */
  app.get('/media-roots', async () => ({ roots: listRoots().map(publicRoot) }));

  app.post('/media-roots', {
    schema: {
      body: {
        type: 'object',
        required: ['path', 'kind'],
        properties: {
          label: { type: 'string', maxLength: 80 },
          path: { type: 'string', minLength: 1, maxLength: 1000 },
          kind: { type: 'string', enum: ['movies', 'series', 'recordings'] }
        }
      }
    }
  }, async (request, reply) => reply.status(201).send({ root: publicRoot(createRoot(request.body)) }));

  app.patch('/media-roots/:id', {
    schema: {
      body: {
        type: 'object',
        properties: { label: { type: 'string', maxLength: 80 }, enabled: { type: 'boolean' } }
      }
    }
  }, async (request) => ({ root: publicRoot(updateRoot(Number(request.params.id), request.body)) }));

  app.delete('/media-roots/:id', async (request) => {
    deleteRoot(Number(request.params.id));
    return { ok: true };
  });

  /* Scanning reads the folders in place. It never writes to them. */
  app.post('/media-roots/:id/scan', async (request) => {
    const result = scanRoot(Number(request.params.id));
    return { ...result, root: publicRoot(listRoots().find(r => r.id === Number(request.params.id))) };
  });

  app.post('/media-roots/scan', async () => ({ scans: scanAll() }));

  /* -------------------------------------------------------- XMLTV guides -- */
  app.get('/epg-sources', async () => ({ sources: listEpgSources().map(publicEpgSource) }));

  app.post('/epg-sources', {
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          name: { type: 'string', maxLength: 80 },
          url: { type: 'string', minLength: 1, maxLength: 2000 },
          refreshIntervalSeconds: { type: 'integer', minimum: 300, maximum: 2592000 }
        }
      }
    }
  }, async (request, reply) => reply.status(201).send({ source: publicEpgSource(createEpgSource(request.body)) }));

  app.patch('/epg-sources/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 80 },
          url: { type: 'string', maxLength: 2000 },
          enabled: { type: 'boolean' },
          refreshIntervalSeconds: { type: 'integer', minimum: 300, maximum: 2592000 }
        }
      }
    }
  }, async (request) => ({ source: publicEpgSource(updateEpgSource(Number(request.params.id), request.body)) }));

  app.delete('/epg-sources/:id', async (request) => {
    deleteEpgSource(Number(request.params.id));
    return { ok: true };
  });

  app.post('/epg-sources/:id/sync', async (request) => {
    const result = await syncEpgSource(Number(request.params.id));
    return { ...result, source: publicEpgSource(getEpgSource(Number(request.params.id))) };
  });

  /* One refresh pass by hand, for when waiting for the timer is silly. */
  app.post('/refresh', async (request) => runOnce({ log: request.log }));

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
