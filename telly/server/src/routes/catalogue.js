import { createReadStream } from 'node:fs';
import path from 'node:path';
import {
  movies, movie, publicMovie, seriesList, oneSeries, publicSeries, episodesOf,
  recordings, artworkPath
} from '../services/media.js';
import { facets, searchAll, tvgIdsFor } from '../services/library.js';
import { favourites } from '../services/profile.js';
import { nowNext, programmesFor, coverage } from '../services/xmltv.js';
import { notFound } from '../lib/errors.js';

/**
 * The catalogue the clients read: the personal library beside the IPTV
 * channels, under the same authentication and in the same JSON shapes.
 *
 * Channels are entitled per user, because they come from a source somebody
 * was assigned. The personal library is the server's own disk — one household,
 * one shelf — so it is offered to anyone signed in, and gated by the sections
 * an account is allowed rather than by source assignment.
 */
const pageQuery = {
  type: 'object',
  properties: {
    search: { type: 'string', maxLength: 100 },
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    offset: { type: 'integer', minimum: 0 }
  }
};

export default async function catalogueRoutes(app) {
  app.addHook('preHandler', app.authenticate);

  /* ------------------------------------------------------------- movies -- */
  app.get('/movies', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...pageQuery.properties,
          year: { type: 'integer' },
          genre: { type: 'string', maxLength: 60 }
        }
      }
    }
  }, async (request) => movies(request.query));

  app.get('/movies/:id', async (request) => publicMovie(movie(Number(request.params.id))));

  /* ------------------------------------------------------------- series -- */
  app.get('/series', { schema: { querystring: pageQuery } }, async (request) => seriesList(request.query));

  app.get('/series/:id', async (request) => {
    const row = oneSeries(Number(request.params.id));
    return publicSeries(row, {
      episodeCount: row.episode_count,
      seasonCount: row.season_count,
      seasons: seasonsOf(Number(request.params.id))
    });
  });

  app.get('/series/:id/episodes', {
    schema: { querystring: { type: 'object', properties: { season: { type: 'integer', minimum: 0 } } } }
  }, async (request) => ({
    episodes: episodesOf(Number(request.params.id), { season: request.query.season })
  }));

  /* --------------------------------------------------------- recordings -- */
  app.get('/recordings', { schema: { querystring: pageQuery } }, async (request) => recordings(request.query));

  /* ------------------------------------------------------------- search -- */
  app.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: { q: { type: 'string', minLength: 2, maxLength: 100 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
      }
    }
  }, async (request) => {
    const found = searchAll(request.auth.user.id, request.query.q, { limit: request.query.limit });
    return {
      query: request.query.q,
      channels: found.channels,
      movies: found.movies.map(publicMovie),
      series: found.series.map(s => publicSeries(s)),
      recordings: found.recordings.map(r => ({
        id: r.id, kind: 'recording', title: r.title, channel: r.channel_name,
        recordedAt: r.recorded_at, playback: `/api/v1/stream/media/recording/${r.id}`
      }))
    };
  });

  /* -------------------------------------------------------- the shelves -- */
  app.get('/countries', async (request) => ({ countries: facets(request.auth.user.id, 'country') }));
  app.get('/languages', async (request) => ({ languages: facets(request.auth.user.id, 'language') }));

  /* ---------------------------------------------------------- favourites -- */
  // The brief's own spelling of the endpoint. /me/favourites, which the
  // clients already use, is the same list.
  app.get('/favourites', async (request) => ({ channels: favourites(request.auth.user.id) }));

  /* ---------------------------------------------------------------- EPG -- */
  /**
   * Two shapes, because the guide is read two ways: "what is on now across
   * the line-up" for the channel list, and "this channel, this evening" for
   * the guide screen.
   */
  app.get('/epg', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tvgId: { type: 'string', maxLength: 200 },
          from: { type: 'string', maxLength: 40 },
          to: { type: 'string', maxLength: 40 },
          limit: { type: 'integer', minimum: 1, maximum: 500 }
        }
      }
    }
  }, async (request) => {
    const { tvgId, from, to, limit } = request.query;
    if (tvgId) return { tvgId, programmes: programmesFor(tvgId, { from, to, limit }) };
    const ids = tvgIdsFor(request.auth.user.id);
    return { nowNext: nowNext(ids), coverage: coverage(ids) };
  });

  /* ------------------------------------------------------------ artwork -- */
  /**
   * A poster from the server's disk, by id. This is why the catalogue stores
   * a path and the API does not return one: the client asks for
   * /art/movie/12 and never learns where the file is.
   */
  app.get('/art/:kind/:id', async (request, reply) => {
    const kind = String(request.params.kind);
    if (!['movie', 'series'].includes(kind)) throw notFound('No artwork for that.');
    const file = artworkPath(kind, Number(request.params.id));
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    reply.header('content-type', mime);
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(createReadStream(file));
  });
}

function seasonsOf(seriesId) {
  const all = episodesOf(seriesId);
  const counts = new Map();
  for (const e of all) counts.set(e.season, (counts.get(e.season) || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([season, episodes]) => ({ season, episodes }));
}
