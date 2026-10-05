import { createReadStream } from 'node:fs';
import {
  movies, movie, publicMovie, movieSources, seriesList, oneSeries, publicSeries,
  seasonsOf, episodesOf, episode, publicEpisode, episodeSources, seriesSources,
  search, facets, preferredSource, catalogueCounts
} from '../services/catalogue.js';
import { cachedArtworkPath } from '../services/artwork.js';
import { paging } from './catalogue.js';

/**
 * The unified catalogue, as clients read it.
 *
 * One route per thing a screen needs, and never a provider in the identity of
 * anything: /catalogue/movies returns one Inception with a list of who has it,
 * which is the whole point of the layer.
 */

const listQuery = {
  type: 'object',
  properties: {
    search: { type: 'string', maxLength: 120 },
    provider: { type: 'string', maxLength: 40 },
    genre: { type: 'string', maxLength: 60 },
    country: { type: 'string', maxLength: 60 },
    language: { type: 'string', maxLength: 60 },
    keyword: { type: 'string', maxLength: 60 },
    year: { type: 'integer', minimum: 1870, maximum: 2100 },
    yearFrom: { type: 'integer', minimum: 1870, maximum: 2100 },
    yearTo: { type: 'integer', minimum: 1870, maximum: 2100 },
    minRating: { type: 'number', minimum: 0, maximum: 10 },
    ageRating: { type: 'string', maxLength: 20 },
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

export default async function unifiedCatalogueRoutes(app) {
  app.addHook('preHandler', app.authenticate);

  /* --------------------------------------------------------------- films -- */
  app.get('/catalogue/movies', { schema: { querystring: listQuery } }, async (request) =>
    paged(movies({ ...request.query, ...paging(request.query) }), request.query));

  app.get('/catalogue/movies/:id', async (request) => {
    const id = Number(request.params.id);
    return publicMovie(movie(id), {
      sources: movieSources(id),
      /* What Play should use, worked out here so every client agrees. */
      preferred: preferredSource('movie', id)
    });
  });

  /* -------------------------------------------------------------- series -- */
  app.get('/catalogue/series', { schema: { querystring: listQuery } }, async (request) =>
    paged(seriesList({ ...request.query, ...paging(request.query) }), request.query));

  app.get('/catalogue/series/:id', async (request) => {
    const id = Number(request.params.id);
    return publicSeries(oneSeries(id), {
      sources: seriesSources(id),
      seasons: seasonsOf(id)
    });
  });

  app.get('/catalogue/series/:id/seasons', async (request) =>
    ({ seasons: seasonsOf(Number(request.params.id)) }));

  app.get('/catalogue/series/:id/episodes', {
    schema: { querystring: { type: 'object', properties: { season: { type: 'integer', minimum: 0 } } } }
  }, async (request) => ({
    episodes: episodesOf(Number(request.params.id), { season: request.query.season })
  }));

  app.get('/catalogue/episodes/:id', async (request) => {
    const id = Number(request.params.id);
    return publicEpisode(episode(id), {
      sources: episodeSources(id),
      preferred: preferredSource('episode', id)
    });
  });

  /* -------------------------------------------------------------- search -- */
  /* One query over the canonical rows, not a fan-out to five services. */
  app.get('/catalogue/search', {
    schema: {
      querystring: {
        type: 'object', required: ['q'],
        properties: { q: { type: 'string', minLength: 2, maxLength: 120 },
                      limit: { type: 'integer', minimum: 1, maximum: 100 } }
      }
    }
  }, async (request) => search(request.query.q, { limit: request.query.limit }));

  /* -------------------------------------------------- what to filter by --- */
  app.get('/catalogue/facets', {
    schema: { querystring: { type: 'object',
      properties: { kind: { type: 'string', enum: ['movie', 'series'] } } } }
  }, async (request) => facets(request.query.kind || 'movie'));

  app.get('/catalogue/counts', async () => catalogueCounts());

  /* ------------------------------------------------------------- artwork -- */
  /**
   * A cached poster, by the cache's own id. The URL the provider published is
   * also returned on the work, so a client may use either; this one is served
   * from the copy, so a provider is not asked for the same picture by every
   * device in the house.
   */
  app.get('/catalogue/art/:id', async (request, reply) => {
    const { file, contentType } = cachedArtworkPath(request.params.id);
    reply.header('content-type', contentType);
    reply.header('cache-control', 'private, max-age=604800');
    return reply.send(createReadStream(file));
  });
}
