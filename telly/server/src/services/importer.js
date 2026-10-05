import { openDb, nowIso } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ingestMovie, ingestSeries } from './catalogue.js';
import { cacheArtwork } from './artwork.js';
import {
  adapterFor, importable, getProvider, listProviders, providerByKey, NO_INTERFACE, STATUS
} from './providers/index.js';

/**
 * Running an adapter.
 *
 * The adapter knows how to read one provider. Everything that should be the
 * same whoever the provider is lives here: how often a request may be made,
 * how long to wait for it, what to do when it fails, and what the run is
 * recorded as having done.
 *
 * Which means an adapter cannot accidentally be impolite. It asks `ctx` for a
 * page and gets one when the provider's own delay has elapsed.
 */

/* One in-flight run per provider, so two people pressing Refresh do not make
   two passes over the same catalogue. */
const running = new Map();

export function importInFlight(providerId = null) {
  if (providerId != null) {
    const r = running.get(Number(providerId));
    return r ? latestImport(Number(providerId)) : null;
  }
  return [...running.keys()].map(id => latestImport(id)).filter(Boolean);
}

/* ------------------------------------------------------------- the context -- */

/**
 * What an adapter is handed. Every outbound request goes through `get`, which
 * is the only place that touches the network, so the delay, the timeout, the
 * retries and the request count are enforced in one place rather than trusted
 * to each adapter.
 */
function makeContext(provider, adapter, run, { fetchImpl = fetch } = {}) {
  const delay = Math.max(Number(provider.request_delay_ms) || 0, 0);
  const timeout = Math.max(Number(provider.timeout_ms) || 15000, 1000);
  const retries = Math.max(Number(provider.max_retries) || 0, 0);
  const settings = adapter.settings || {};
  let lastAt = 0;
  const bump = (k, by = 1) => { run.stats[k] = (run.stats[k] || 0) + by; };

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const ctx = {
    provider,
    cancelled: false,
    pageLimit: Number(provider.page_limit) || adapter.limits?.pageLimit || 0,
    concurrency: Math.max(Number(provider.concurrency) || 1, 1),
    setting: (key, fallback) => (settings[key] !== undefined ? settings[key] : fallback),
    log: (msg) => { run.notes.push(String(msg).slice(0, 200)); },

    /** One request, no sooner than the provider's delay allows. */
    async get(url, opts = {}) {
      const since = Date.now() - lastAt;
      if (delay && since < delay) await wait(delay - since);

      let attempt = 0;
      for (;;) {
        lastAt = Date.now();
        bump('requests_made');
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeout);
        try {
          const res = await fetchImpl(url, {
            ...opts,
            signal: ac.signal,
            headers: {
              /* Saying who is calling is the polite minimum, and it is the
                 opposite of pretending to be a browser. */
              'user-agent': 'Telly/1.0 (personal media catalogue; +https://github.com/jonathan-longden/family-bets)',
              accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
              ...(opts.headers || {})
            }
          });

          /* A provider saying "slow down" is an instruction, not an error to
             retry through. Retry-After is honoured as given. */
          if (res.status === 429 || res.status === 503) {
            const after = Number(res.headers.get('retry-after'));
            const backoff = Number.isFinite(after) && after > 0
              ? after * 1000
              : Math.min(delay * Math.pow(2, attempt + 1) || 2000, 60000);
            if (attempt++ >= retries) {
              const e = new Error(`${provider.name} asked for a slower pace (${res.status}).`);
              e.retryAfterMs = backoff;
              throw e;
            }
            ctx.log(`${res.status} from ${provider.name}; waiting ${Math.round(backoff / 1000)}s`);
            await wait(backoff);
            continue;
          }

          if (res.status === 403 || res.status === 401) {
            /* Not something to try again differently. If a provider refuses an
               identified client, that is its answer. */
            const e = new Error(`${provider.name} refused the request (${res.status}). ` +
              'Telly will not retry this another way.');
            e.fatal = true;
            throw e;
          }

          if (!res.ok) throw new Error(`${provider.name} answered ${res.status} for ${short(url)}`);
          return res;
        } catch (e) {
          clearTimeout(timer);
          if (e.fatal || attempt++ >= retries) throw e;
          const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
          await wait(backoff);
        } finally {
          clearTimeout(timer);
        }
      }
    },

    async getJson(url, opts) {
      const res = await ctx.get(url, opts);
      return res.json();
    },

    /** Bounded concurrency, for an adapter with many small detail calls. */
    async map(items, fn) {
      const out = [];
      const queue = [...items];
      const workers = Array.from({ length: Math.min(ctx.concurrency, queue.length || 1) }, async () => {
        while (queue.length && !ctx.cancelled) {
          const item = queue.shift();
          try { out.push(await fn(item)); }
          catch (e) { bump('errors'); ctx.log(e.message); }
        }
      });
      await Promise.all(workers);
      return out.filter(x => x != null);
    }
  };
  return ctx;
}

const short = (u) => String(u).slice(0, 120);

/* ----------------------------------------------------------------- the run -- */

function startRun(providerId) {
  const at = nowIso();
  const info = openDb().prepare(
    `INSERT INTO provider_imports (provider_id, status, started_at) VALUES (?, 'running', ?)`)
    .run(providerId, at);
  return Number(info.lastInsertRowid);
}

const FIGURES = ['movies_discovered', 'series_discovered', 'episodes_discovered', 'new_items',
  'updated_items', 'duplicates_merged', 'review_queued', 'unmatched_items', 'errors',
  'requests_made'];

function saveRun(runId, stats) {
  const sets = FIGURES.map(f => `${f} = ?`).join(', ');
  openDb().prepare(`UPDATE provider_imports SET ${sets} WHERE id = ?`)
    .run(...FIGURES.map(f => Number(stats[f]) || 0), runId);
}

function finishRun(runId, status, message, stats) {
  saveRun(runId, stats);
  openDb().prepare('UPDATE provider_imports SET status = ?, finished_at = ?, message = ? WHERE id = ?')
    .run(status, nowIso(), String(message || '').slice(0, 500), runId);
}

/**
 * Import one provider.
 *
 * A provider that may not be imported from is not an error and does not fail:
 * the run is recorded as `skipped` with the reason, so the import log says
 * plainly why there is nothing from Tubi rather than looking like a fault.
 */
export async function runImport(providerId, { fetchImpl = fetch, log = null } = {}) {
  const provider = getProvider(providerId);
  const adapter = adapterFor(provider);

  if (!importable(adapter)) {
    const runId = startRun(provider.id);
    finishRun(runId, 'skipped', adapter.access.reason || NO_INTERFACE, {});
    openDb().prepare('UPDATE providers SET last_attempt_at = ? WHERE id = ?')
      .run(nowIso(), provider.id);
    return { provider: provider.key, skipped: true,
             reason: adapter.access.reason || NO_INTERFACE, run: getImport(runId) };
  }
  if (!provider.enabled) {
    const runId = startRun(provider.id);
    finishRun(runId, 'skipped', 'This provider is switched off.', {});
    return { provider: provider.key, skipped: true, reason: 'This provider is switched off.',
             run: getImport(runId) };
  }

  if (running.has(provider.id)) return running.get(provider.id);

  const runId = startRun(provider.id);
  const run = { stats: {}, notes: [] };
  const ctx = makeContext(provider, adapter, run, { fetchImpl });

  const promise = (async () => {
    openDb().prepare('UPDATE providers SET last_attempt_at = ? WHERE id = ?').run(nowIso(), provider.id);
    try {
      let since = Date.now();
      for await (const work of adapter.discover(ctx)) {
        try {
          if (work.kind === 'movie') {
            run.stats.movies_discovered = (run.stats.movies_discovered || 0) + 1;
            const got = ingestMovie(provider.id, work, run.stats);
            await cacheArtwork(provider, work, { movieId: got.movieId, ctx });
          } else if (work.kind === 'series') {
            run.stats.series_discovered = (run.stats.series_discovered || 0) + 1;
            const got = ingestSeries(provider.id, work, run.stats);
            run.stats.episodes_discovered = (run.stats.episodes_discovered || 0) + got.episodes;
            await cacheArtwork(provider, work, { seriesId: got.seriesId, ctx });
          } else {
            run.stats.unmatched_items = (run.stats.unmatched_items || 0) + 1;
          }
        } catch (e) {
          /* One bad record does not end an import of four thousand. */
          run.stats.errors = (run.stats.errors || 0) + 1;
          if (log) log.warn(`${provider.name}: ${e.message}`);
        }
        /* Figures are written as they go, so the settings screen can watch. */
        if (Date.now() - since > 1000) { saveRun(runId, run.stats); since = Date.now(); }
      }

      openDb().prepare(
        'UPDATE providers SET last_sync_at = ?, fail_count = 0, last_error = \'\' WHERE id = ?')
        .run(nowIso(), provider.id);
      finishRun(runId, 'done', run.notes.slice(-3).join(' · '), run.stats);
    } catch (e) {
      openDb().prepare(
        'UPDATE providers SET fail_count = fail_count + 1, last_error = ? WHERE id = ?')
        .run(String(e.message || e).slice(0, 500), provider.id);
      finishRun(runId, 'failed', e.message, run.stats);
      if (log) log.warn(`${provider.name} import failed: ${e.message}`);
    } finally {
      running.delete(provider.id);
    }
    return { provider: provider.key, run: getImport(runId) };
  })();

  running.set(provider.id, promise);
  return promise;
}

/**
 * Publish what the scanner found to the catalogue.
 *
 * This is the step whose absence made the whole feature invisible: the scanner
 * writes `movies`, `series` and `episodes`, but Movies and Series read the
 * *catalogue*, and nothing joined the two. Pressing "Scan Movies" filled the
 * first and left the second empty, so the library stayed blank however many
 * files were on disk.
 *
 * So every scan ends here. It is the local adapter's ordinary import — no
 * special path, no second code route — which means a file on disk reaches the
 * catalogue by exactly the same road a provider's title does, and
 * deduplicates against it.
 *
 * It never throws: a scan that found the files has done its job, and a
 * catalogue that could not be updated is worth a line in the log rather than
 * a failed scan.
 */
export async function syncLocalProvider({ log = null } = {}) {
  const provider = providerByKey('local');
  if (!provider) return null;
  if (!provider.enabled) {
    if (log) log.info('The media folders are not published to the catalogue: that provider is off.');
    return null;
  }
  try {
    return await runImport(provider.id, { log });
  } catch (e) {
    if (log) log.warn(`Scan finished, but the catalogue was not updated: ${e.message}`);
    return null;
  }
}

/** Every provider that is on and due, or every provider that is on. */
export async function runAllImports({ fetchImpl = fetch, log = null, dueOnly = false } = {}) {
  const out = [];
  for (const p of listProviders()) {
    if (dueOnly && !dueForImport(p)) continue;
    if (!dueOnly && !p.enabled) continue;
    out.push(await runImport(p.id, { fetchImpl, log }));
  }
  return out;
}

/** Due when it is on, importable, and its own interval has elapsed. */
export function dueForImport(provider, now = Date.now()) {
  if (!provider.enabled || provider.status !== STATUS.available) return false;
  const every = Number(provider.refresh_interval_seconds) || 0;
  if (every <= 0) return false;

  /* A failing provider waits longer each time, from its last attempt, so a
     service having a bad day is not asked three hundred times. */
  if (provider.fail_count > 0 && provider.last_attempt_at) {
    const wait = Math.min(15 * 60 * Math.pow(2, Math.min(provider.fail_count - 1, 6)), 24 * 3600);
    return (now - Date.parse(provider.last_attempt_at)) / 1000 >= wait;
  }
  if (!provider.last_sync_at) return true;
  return (now - Date.parse(provider.last_sync_at)) / 1000 >= every;
}

/* ------------------------------------------------------------ the log ------ */

export function imports({ providerId = null, limit = 20, offset = 0 } = {}) {
  const db = openDb();
  const where = [], args = [];
  if (providerId != null) { where.push('i.provider_id = ?'); args.push(Number(providerId)); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM provider_imports i ${clause}`).get(...args).n;
  const rows = db.prepare(`SELECT i.*, p.key AS provider_key, p.name AS provider_name
      FROM provider_imports i JOIN providers p ON p.id = i.provider_id ${clause}
      ORDER BY i.started_at DESC, i.id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Number(limit) || 20, 200), Number(offset) || 0);
  return { total, items: rows.map(publicImport) };
}

export function getImport(id) {
  const row = openDb().prepare(`SELECT i.*, p.key AS provider_key, p.name AS provider_name
      FROM provider_imports i JOIN providers p ON p.id = i.provider_id WHERE i.id = ?`).get(Number(id));
  if (!row) throw notFound('No such import.');
  return publicImport(row);
}

export function latestImport(providerId) {
  const row = openDb().prepare(`SELECT i.*, p.key AS provider_key, p.name AS provider_name
      FROM provider_imports i JOIN providers p ON p.id = i.provider_id
      WHERE i.provider_id = ? ORDER BY i.started_at DESC, i.id DESC LIMIT 1`).get(Number(providerId));
  return row ? publicImport(row) : null;
}

/** Exactly the figures the brief asks to see, named as it names them. */
export function publicImport(i) {
  return {
    id: i.id,
    providerKey: i.provider_key,
    provider: i.provider_name,
    status: i.status,
    startedAt: i.started_at,
    finishedAt: i.finished_at,
    lastUpdate: i.finished_at || i.started_at,
    moviesDiscovered: i.movies_discovered,
    seriesDiscovered: i.series_discovered,
    episodesDiscovered: i.episodes_discovered,
    newItems: i.new_items,
    updatedItems: i.updated_items,
    duplicatesMerged: i.duplicates_merged,
    reviewQueued: i.review_queued,
    unmatchedItems: i.unmatched_items,
    errors: i.errors,
    requestsMade: i.requests_made,
    message: i.message
  };
}

export function assertKind(kind) {
  if (!['movie', 'series', 'episode'].includes(kind)) throw badRequest('Not a kind of work.');
  return kind;
}
