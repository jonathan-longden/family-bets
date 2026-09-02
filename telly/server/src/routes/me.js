import { environmentFor } from './auth.js';
import { listDevices, revokeDevice } from '../services/devices.js';
import { favourites, addFavourite, removeFavourite, recent, markWatched, settings, putSettings } from '../services/profile.js';

/** Everything about the signed-in user. Scoped to request.auth throughout. */
export default async function meRoutes(app) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => environmentFor(request.auth.user));

  app.get('/devices', async (request) => ({ devices: listDevices(request.auth.user.id) }));

  app.delete('/devices/:id', async (request) => {
    revokeDevice(request.auth.user.id, Number(request.params.id));
    return { ok: true };
  });

  app.get('/favourites', async (request) => ({ channels: favourites(request.auth.user.id) }));

  app.put('/favourites/:channelId', async (request) => {
    addFavourite(request.auth.user.id, Number(request.params.channelId));
    return { ok: true };
  });

  app.delete('/favourites/:channelId', async (request) => {
    removeFavourite(request.auth.user.id, Number(request.params.channelId));
    return { ok: true };
  });

  app.get('/recent', async (request) => ({ channels: recent(request.auth.user.id, request.query.limit) }));

  app.post('/recent/:channelId', {
    schema: { body: { type: 'object', properties: { positionMs: { type: 'integer', minimum: 0 } } } }
  }, async (request) => {
    markWatched(request.auth.user.id, Number(request.params.channelId), request.body?.positionMs || 0);
    return { ok: true };
  });

  app.get('/settings', async (request) => ({ settings: settings(request.auth.user.id) }));

  app.put('/settings', {
    schema: { body: { type: 'object', additionalProperties: true } }
  }, async (request) => ({ settings: putSettings(request.auth.user.id, request.body) }));
}
