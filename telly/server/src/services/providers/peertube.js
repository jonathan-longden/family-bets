import { ACCESS, STATUS, PLAYBACK } from './contract.js';
import { openDb } from '../../db/index.js';
import {
  searchUrl, videoUrl, admissible, movieWork, sourceSettings, instanceAllowed, instanceOf
} from '../peertube.js';

/**
 * PeerTube, as a catalogue provider.
 *
 * The adapter's whole job is to walk the instances an operator has added and
 * hand the importer the videos that pass. Everything about whether a video
 * may be taken lives in services/peertube.js, which touches neither the
 * network nor the database; this file is the plumbing between that policy and
 * the import framework every other provider already uses.
 *
 * It yields only films. A PeerTube channel is not a television series —
 * mapping one onto seasons and episodes would be inventing structure the
 * instance never claimed — so series are left alone until there is a real
 * reason to add them.
 *
 * Two requests per candidate: one search page, and one full record for each
 * video that survives the cheap checks. The full record is where the files
 * are, and the files are what decides playability, so there is no way to
 * avoid it for a video that is otherwise acceptable. There is every way to
 * avoid it for one that is not, which is why the order of the checks matters.
 */

export default {
  key: 'peertube',
  name: 'PeerTube',
  baseUrl: 'https://joinpeertube.org/',
  termsUrl: 'https://joinpeertube.org/faq',
  robotsUrl: '',
  enabledByDefault: false,     // an operator adds an instance before this does anything

  access: {
    method: ACCESS.officialApi,
    status: STATUS.available,
    reason: 'Documented public REST API on instances Telly has an allowlist for, ' +
      'over videos whose uploaders have licensed them openly. Only CC0, CC BY and ' +
      'CC BY-SA are imported.',
    assessedAt: '2026-10-07',
    recheck: ['An instance changing its API access rules or its licence reporting.']
  },

  capabilities: {
    metadata: true,
    artwork: true,
    /* A public HLS manifest or a public MP4 on the instance that published
       it. The player opens it; this server never sees the video. */
    playback: true,
    playbackType: PLAYBACK.hls
  },

  /* Instances are volunteers' servers, often one machine. Slower than the
     Archive, which is a charity with a datacentre. */
  limits: {
    requestDelayMs: 1500,
    concurrency: 1,
    timeoutMs: 20000,
    maxRetries: 2,
    pageLimit: 4,
    refreshIntervalSeconds: 7 * 24 * 60 * 60
  },

  settings: {},

  /**
   * Every enabled instance, every configured search, one page at a time.
   */
  async * discover(ctx) {
    const sources = peertubeSources();
    if (!sources.length) {
      ctx.log('No PeerTube instances have been added. Add one in Settings → IPTV sources.');
      return;
    }

    for (const src of sources) {
      if (ctx.cancelled) return;

      /* The allowlist, checked again here rather than only when the source
         was created. A list that is enforced once is not enforced: an
         operator may tighten it, and a source added under the old list must
         stop being read the moment it does. */
      if (!instanceAllowed(src.url)) {
        ctx.skip('instance');
        ctx.log(`${src.name}: ${instanceOf(src.url) || 'that host'} is not on Telly's allowlist, skipped.`);
        continue;
      }

      ctx.count('instances_checked');
      try { yield* this.instance(ctx, src); }
      catch (e) { ctx.log(`${src.name}: ${e.message}`); }
    }
  },

  /** One instance: its searches, its pages, its videos. */
  async * instance(ctx, src) {
    const cfg = sourceSettings(src);
    /* No search terms means "whatever this instance has", which for a small
       curated instance is the sensible default and for a large one is what
       the duration floor is there to survive. */
    const searches = cfg.searches.length ? cfg.searches : [''];
    const pages = Math.min(cfg.maxPages, Number(ctx.pageLimit) || cfg.maxPages);
    const seen = new Set();

    for (const term of searches) {
      for (let page = 0; page < pages; page++) {
        if (ctx.cancelled) return;

        const url = searchUrl(src.url, {
          search: term,
          durationMin: cfg.minDuration,
          durationMax: cfg.maxDuration,
          licenceOneOf: cfg.licences,
          /* The API ANDs these, and what Telly wants is "HLS or a web video",
             which it cannot ask for. So the server is constrained only when
             HLS is genuinely the only acceptable answer — because it was
             required, or because web video was ruled out — and the OR is
             done here, on the way back, where it can be. */
          hasHLSFiles: cfg.requireHls || !cfg.webVideoAccepted,
          count: cfg.pageSize,
          start: page * cfg.pageSize
        });

        ctx.count('queries_run');
        const body = await ctx.getJson(url);
        const rows = (body && Array.isArray(body.data)) ? body.data : [];
        if (!rows.length) break;

        for (const row of rows) {
          if (ctx.cancelled) return;
          ctx.count('videos_discovered');

          const uuid = String((row && row.uuid) || '');
          /* The same video answering two different searches is one video. */
          if (!uuid || seen.has(uuid)) { ctx.skip('duplicate'); continue; }
          seen.add(uuid);

          const work = await this.one(ctx, src, cfg, row);
          if (work) yield work;
        }

        if (rows.length < cfg.pageSize) break;          // that was the last page
      }
    }
  },

  /**
   * One search result: judged on what the search gave, then on the full
   * record if it is still a candidate.
   */
  async one(ctx, src, cfg, row) {
    const opts = {
      baseUrl: src.url,
      licences: cfg.licences,
      minDuration: cfg.minDuration,
      maxDuration: cfg.maxDuration,
      requireHls: cfg.requireHls,
      webVideoAccepted: cfg.webVideoAccepted
    };

    /* The cheap pass, on the search row. A search result carries no files, so
       `unplayable` here means only "not yet known" — everything else is a
       real verdict and saves a request. */
    const first = admissible(row, opts);
    if (!first.ok && first.reason !== 'unplayable') {
      ctx.skip(first.reason);
      return null;
    }

    /* The full record, which is the only place the files are. */
    let full = null;
    try { full = await ctx.getJson(videoUrl(src.url, row.uuid)); }
    catch (e) {
      ctx.skip('other');
      ctx.log(`${row.name || row.uuid}: ${e.message}`);
      return null;
    }

    /* Judged again, in full. The search row and the record can disagree —
       a search index may be stale about a licence — and when they do, the
       record is the one that counts. */
    const verdict = admissible(full, opts);
    if (!verdict.ok) {
      ctx.skip(verdict.reason);
      return null;
    }

    return movieWork(src.url, src, full, verdict);
  }
};

/** The instances to read: enabled, and with somewhere to read from. */
export function peertubeSources() {
  return openDb().prepare(`SELECT * FROM sources
      WHERE kind = 'peertube' AND enabled = 1 AND url <> '' ORDER BY id`).all();
}
