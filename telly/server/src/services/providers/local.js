import { openDb } from '../../db/index.js';
import { ACCESS, STATUS, PLAYBACK } from './contract.js';

/**
 * This server's own disk, as a provider of the catalogue.
 *
 * Telly already scans media folders into `movies`, `series` and `episodes`,
 * and already plays them through a ticket and a path guard. None of that
 * changes. This adapter reads those rows and offers them to the catalogue as
 * one provider's sources, so the household's own films sit in the same unified
 * list as anything imported, and deduplicate against it: a film you own and a
 * film a service carries become one card with two ways to play it.
 *
 * It is the only adapter that needs no network and asks nobody's permission,
 * which is why it is the one that is on by default.
 */
export default {
  key: 'local',
  name: 'This server\'s media folders',
  baseUrl: '',
  termsUrl: '',
  robotsUrl: '',
  enabledByDefault: true,

  access: {
    method: ACCESS.localFilesystem,
    status: STATUS.available,
    reason: 'Files in the media folders configured on this server. Read in place; ' +
      'never copied, never moved.',
    assessedAt: '2026-10-05'
  },

  capabilities: {
    metadata: true,
    artwork: true,
    /* Direct, through the existing ticket and the existing path guard. A
       container a client cannot open is still remuxed by FFmpeg as before. */
    playback: true,
    playbackType: PLAYBACK.direct
  },

  limits: { requestDelayMs: 0, concurrency: 1, timeoutMs: 0, maxRetries: 0,
            refreshIntervalSeconds: 3600 },

  /**
   * Yields what the last scan found. Rows waiting out the missing-file grace
   * period are left out, because a catalogue entry that cannot be played is
   * worse than one that is absent — they come back on their own when the file
   * does.
   */
  * discover() {
    const db = openDb();

    const films = db.prepare(`SELECT * FROM movies WHERE missing_since IS NULL
        ORDER BY title_key`).all();
    for (const m of films) {
      yield {
        kind: 'movie',
        title: m.title,
        year: m.year,
        description: m.description || '',
        runtimeMinutes: m.duration_ms ? Math.round(m.duration_ms / 60000) : 0,
        genres: splitList(m.genre),
        poster: m.poster ? `/api/v1/art/movie/${m.id}` : '',
        source: {
          contentId: `movie:${m.id}`,
          metadataUrl: '',
          /* No URL: a local source is an id into the existing tables, so the
             path never leaves this process and the guard still runs. */
          playbackUrl: '',
          playbackType: PLAYBACK.direct,
          availability: 'available',
          localKind: 'movie',
          localId: m.id,
          quality: m.height ? `${m.height}p` : ''
        }
      };
    }

    const shows = db.prepare('SELECT * FROM series ORDER BY title_key').all();
    for (const s of shows) {
      const eps = db.prepare(`SELECT * FROM episodes WHERE series_id = ? AND missing_since IS NULL
          ORDER BY season, episode`).all(s.id);
      if (!eps.length) continue;                 // a series is its episodes

      const seasons = new Map();
      for (const e of eps) {
        if (!seasons.has(e.season)) seasons.set(e.season, []);
        seasons.get(e.season).push({
          number: e.episode,
          title: e.title || '',
          description: e.description || '',
          runtimeMinutes: e.duration_ms ? Math.round(e.duration_ms / 60000) : 0,
          source: {
            contentId: `episode:${e.id}`,
            metadataUrl: '',
            playbackUrl: '',
            playbackType: PLAYBACK.direct,
            availability: 'available',
            localKind: 'episode',
            localId: e.id,
            quality: e.height ? `${e.height}p` : ''
          }
        });
      }

      yield {
        kind: 'series',
        title: s.title,
        year: s.year,
        description: s.description || '',
        genres: splitList(s.genre),
        poster: s.poster ? `/api/v1/art/series/${s.id}` : '',
        source: {
          contentId: `series:${s.id}`,
          metadataUrl: '',
          availability: 'available'
        },
        seasons: [...seasons.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([number, episodes]) => ({ number, episodes }))
      };
    }
  }
};

const splitList = (s) => String(s || '').split(/[,/|]/).map(x => x.trim()).filter(Boolean);
