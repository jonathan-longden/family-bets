import { categories, channels } from '../services/library.js';
import { sourcesForUser, syncSource, needsSync } from '../services/sources.js';

/** The catalogue, always filtered to what this user is entitled to. */
export default async function libraryRoutes(app) {
  app.addHook('preHandler', app.authenticate);

  app.get('/playlists', async (request) => ({
    playlists: sourcesForUser(request.auth.user.id).map(s => ({
      id: s.id, name: s.name, kind: s.kind, channelCount: s.channel_count, lastSyncedAt: s.last_synced_at
    }))
  }));

  app.get('/categories', {
    schema: { querystring: { type: 'object', properties: { kind: { type: 'string', enum: ['live', 'movie', 'series'] } } } }
  }, async (request) => ({ categories: categories(request.auth.user.id, request.query.kind || 'live') }));

  app.get('/channels', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['live', 'movie', 'series'] },
          group: { type: 'string', maxLength: 200 },
          search: { type: 'string', maxLength: 100 },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
          offset: { type: 'integer', minimum: 0 }
        }
      }
    }
  }, async (request) => channels(request.auth.user.id, {
    kind: request.query.kind || 'live',
    group: request.query.group,
    search: request.query.search,
    limit: request.query.limit,
    offset: request.query.offset
  }));

  /** Pull the newest line-up from the provider, if the cache has gone stale. */
  app.post('/playlists/:id/refresh', async (request) => {
    const id = Number(request.params.id);
    const mine = sourcesForUser(request.auth.user.id).find(s => s.id === id);
    if (!mine) return { refreshed: false, reason: 'not_assigned' };
    if (!needsSync(mine) && request.auth.user.role !== 'admin') {
      return { refreshed: false, reason: 'still_fresh', lastSyncedAt: mine.last_synced_at };
    }
    const result = await syncSource(id);
    return { refreshed: true, ...result };
  });
}
