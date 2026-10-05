import {
  movies, movie, publicMovie, movieSources, seriesList, oneSeries, publicSeries,
  seasonsOf, episodesOf, episode, publicEpisode, episodeSources, seriesSources,
  search, facets, preferredSource, catalogueCounts
} from '../services/catalogue.js';
import { playableMedia } from '../services/media.js';
import { decide, sendDirect, sendTranscoded, MIME } from '../services/playback.js';
import { readTicket } from '../lib/tickets.js';
import { paging } from './catalogue.js';
import { badRequest, forbidden, notFound, upstreamFailed } from '../lib/errors.js';
import { openDb } from '../db/index.js';

/**
 * The unversioned paths, which are the ones people actually type.
 *
 * `/api/v1/...` is the long-lived contract and is unchanged. These are the
 * short forms — `/api/movies`, `/api/series/3/episodes`,
 * `/api/movies/12/stream` — mounted at `/api` and pointing at the **catalogue**,
 * because "the movie library" is what somebody means when they ask for
 * /api/movies.
 *
 * Worth saying plainly which table each serves, because there are two and
 * confusing them is what made the library look empty:
 *
 *   /api/movies            the catalogue — what Movies shows
 *   /api/v1/movies         the raw scan of this server's own disk
 *
 * They hold the same films once a scan has published, which it now does on
 * its own. The catalogue is the one to read: it is deduplicated and it carries
 * every provider that has a title.
 */

const listQuery = {
  type: 'object',
  properties: {
    search: { type: 'string', maxLength: 120 },
    provider: { type: 'string', maxLength: 40 },
    genre: { type: 'string', maxLength: 60 },
    country: { type: 'string', maxLength: 60 },
    language: { type: 'string', maxLength: 60 },
    year: { type: 'integer', minimum: 1870, maximum: 2100 },
    minRating: { type: 'number', minimum: 0, maximum: 10 },
    playable: { type: 'boolean' },
    sort: { type: 'string', enum: ['title', 'year', 'rating', 'added', 'updated'] },
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    offset: { type: 'integer', minimum: 0 }
  }
};

const paged = (result, q) => {
  const { limit, offset, page } = paging(q);
  return { ...result, page, limit, offset,
           pages: Math.max(Math.ceil((result.total || 0) / limit), 1) };
};

/**
 * Streaming by id, with no path anywhere in the request.
 *
 * A `<video>` element cannot send an Authorization header, which is why
 * playback normally goes through a short-lived ticket. So both are accepted: a
 * ticket for a player, or a bearer token for anything that can hold one (the
 * Android app, curl, a test). Either way the client sends an id and the server
 * finds the file.
 */
async function streamByCatalogueId(app, request, reply, kind) {
  const id = Number(request.params.id);
  /* 404 before anything else: a bad id must not reach the filesystem. */
  const work = kind === 'movie' ? movie(id) : episode(id);
  const source = preferredSource(kind, id);
  if (!source) {
    throw notFound(`Nothing can play that ${kind}. No provider offers a stream for it.`);
  }
  if (!source.local) {
    /* A provider's own stream is theirs to serve, and proxying a film through
       this server would be both slow and a redistribution. */
    return reply.redirect(302, source.url);
  }

  const ticket = readTicket(request.query.ticket);
  if (ticket) {
    if (ticket.resource !== `${source.localKind}-${source.localId}`) {
      throw forbidden('That playback link is for something else.');
    }
    const device = openDb().prepare('SELECT revoked_at FROM devices WHERE id = ? AND user_id = ?')
      .get(ticket.deviceId, ticket.userId);
    if (!device || device.revoked_at) throw forbidden('This device has been removed from the account.');
  } else {
    /* No ticket: then a token, verified the ordinary way. */
    await app.authenticate(request, reply);
    if (reply.sent) return reply;
  }

  const item = playableMedia(source.localKind, source.localId);
  const capability = request.query.capability === 'native' ? 'native' : 'browser';
  const plan = decide(item.container, { capability });
  if (plan.mode === 'direct') {
    return sendDirect(item.path, reply, request.headers.range, plan.mime || MIME[item.container]);
  }
  if (plan.mode === 'remux') {
    return sendTranscoded(item.path, reply, { encode: request.query.encode === '1' });
  }
  throw upstreamFailed(plan.reason || 'That file cannot be played by this server.');
}

export default async function compatRoutes(app) {
  /* Open, so a browser can ask whether the server is there before signing in.
     It says nothing a stranger could not learn by connecting. */
  app.get('/health', async () => ({
    ok: true,
    service: 'telly',
    api: 'v1',
    catalogue: catalogueCounts()
  }));

  /* Streaming carries its own authentication, per the handler above, so it is
     registered before the hook that would demand a header a player cannot
     send. */
  app.get('/movies/:id/stream', async (request, reply) =>
    streamByCatalogueId(app, request, reply, 'movie'));
  app.get('/episodes/:id/stream', async (request, reply) =>
    streamByCatalogueId(app, request, reply, 'episode'));

  /* Everything else needs an account. */
  app.register(async (scope) => {
    scope.addHook('preHandler', app.authenticate);

    scope.get('/movies', { schema: { querystring: listQuery } }, async (request) =>
      paged(movies({ ...request.query, ...paging(request.query) }), request.query));

    scope.get('/movies/:id', async (request) => {
      const id = Number(request.params.id);
      return publicMovie(movie(id), {
        sources: movieSources(id),
        preferred: preferredSource('movie', id),
        stream: `/api/movies/${id}/stream`
      });
    });

    scope.get('/series', { schema: { querystring: listQuery } }, async (request) =>
      paged(seriesList({ ...request.query, ...paging(request.query) }), request.query));

    scope.get('/series/:id', async (request) => {
      const id = Number(request.params.id);
      return publicSeries(oneSeries(id), {
        sources: seriesSources(id),
        seasons: seasonsOf(id)
      });
    });

    scope.get('/series/:id/seasons', async (request) =>
      ({ seasons: seasonsOf(Number(request.params.id)) }));

    scope.get('/series/:id/episodes', {
      schema: { querystring: { type: 'object', properties: { season: { type: 'integer', minimum: 0 } } } }
    }, async (request) => ({
      episodes: episodesOf(Number(request.params.id), { season: request.query.season })
        .map(e => ({ ...e, stream: `/api/episodes/${e.id}/stream` }))
    }));

    scope.get('/episodes/:id', async (request) => {
      const id = Number(request.params.id);
      return publicEpisode(episode(id), {
        sources: episodeSources(id),
        preferred: preferredSource('episode', id),
        stream: `/api/episodes/${id}/stream`
      });
    });

    scope.get('/search', {
      schema: {
        querystring: {
          type: 'object', required: ['q'],
          properties: { q: { type: 'string', minLength: 2, maxLength: 120 },
                        limit: { type: 'integer', minimum: 1, maximum: 100 } }
        }
      }
    }, async (request) => search(request.query.q, { limit: request.query.limit }));

    scope.get('/facets', {
      schema: { querystring: { type: 'object',
        properties: { kind: { type: 'string', enum: ['movie', 'series'] } } } }
    }, async (request) => facets(request.query.kind || 'movie'));

    scope.get('/counts', async () => catalogueCounts());
  });
}
