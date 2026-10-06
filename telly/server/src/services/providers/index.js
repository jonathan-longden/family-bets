import { openDb, nowIso } from '../../db/index.js';
import { notFound, notImportable } from '../../lib/errors.js';

/**
 * The provider system.
 *
 * Every service Telly can import a catalogue from is one adapter in this
 * directory, registered here. An adapter is independent: it knows how to read
 * one provider and nothing else, and it declares — as data, before any code
 * runs — what that provider permits.
 *
 * There is deliberately no shared scraper. An adapter that cannot import
 * through a documented, permitted interface does not get a different way in;
 * it reports why, and stays switched off.
 */

/* The vocabulary lives in contract.js, which imports nothing — so an adapter
   never depends on this file, and this file can safely import every adapter.
   Re-exported here so callers have one place to import from. */
export { ACCESS, STATUS, PLAYBACK, NO_INTERFACE, PLAYABLE_TYPES, importable } from './contract.js';
import { ACCESS, STATUS, PLAYBACK, NO_INTERFACE, importable } from './contract.js';

/* ------------------------------------------------------------- registry --- */

import localAdapter from './local.js';
import xtreamAdapter from './xtream.js';
import archiveAdapter from './archive.js';
import tubiAdapter from './tubi.js';
import rokuAdapter from './roku.js';
import fawesomeAdapter from './fawesome.js';
import xumoAdapter from './xumo.js';
import movyAdapter from './movy.js';

/**
 * Adding a provider later is this list plus one file. Nothing else in the
 * server knows the name of any provider.
 */
export const ADAPTERS = [
  localAdapter,
  xtreamAdapter,
  archiveAdapter,
  tubiAdapter,
  rokuAdapter,
  fawesomeAdapter,
  xumoAdapter,
  movyAdapter
];

export const byKey = (key) => ADAPTERS.find(a => a.key === key) || null;

export function adapterFor(provider) {
  const a = byKey(provider.key);
  if (!a) throw notFound(`No adapter for provider "${provider.key}".`);
  return a;
}

/* ------------------------------------------------------ the provider rows --
 *
 * The adapters are the source of truth for what a provider *is* and what it
 * permits; the database row carries the operator's own settings — enabled,
 * the refresh interval, the politeness figures — and the history.
 *
 * So this is run on every boot: a new adapter appears, and an assessment that
 * has changed is written through, without touching the switch the operator
 * set or the import history.
 */
export function ensureProviders() {
  const db = openDb();
  const at = nowIso();
  const out = [];

  for (const a of ADAPTERS) {
    const row = db.prepare('SELECT * FROM providers WHERE key = ?').get(a.key);
    const limits = a.limits || {};
    if (!row) {
      db.prepare(`INSERT INTO providers
          (key, name, base_url, terms_url, robots_url, enabled, access_method, status,
           status_reason, status_checked_at, supports_metadata, supports_artwork,
           supports_playback, playback_type, request_delay_ms, concurrency, timeout_ms,
           max_retries, page_limit, refresh_interval_seconds, builtin, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
        .run(a.key, a.name, a.baseUrl || '', a.termsUrl || '', a.robotsUrl || '',
             a.enabledByDefault ? 1 : 0,
             a.access.method, a.access.status, a.access.reason || '', a.access.assessedAt || at,
             a.capabilities.metadata ? 1 : 0, a.capabilities.artwork ? 1 : 0,
             a.capabilities.playback ? 1 : 0, a.capabilities.playbackType || PLAYBACK.webOnly,
             limits.requestDelayMs ?? 500, limits.concurrency ?? 2, limits.timeoutMs ?? 15000,
             limits.maxRetries ?? 3, limits.pageLimit ?? 0,
             limits.refreshIntervalSeconds ?? 86400, at, at);
    } else {
      /* The assessment belongs to the adapter, so it is written through. The
         switch, the interval and the history belong to the operator, so they
         are not. */
      db.prepare(`UPDATE providers SET
            name = ?, base_url = ?, terms_url = ?, robots_url = ?,
            access_method = ?, status = ?, status_reason = ?, status_checked_at = ?,
            supports_metadata = ?, supports_artwork = ?, supports_playback = ?,
            playback_type = ?, updated_at = ?
          WHERE id = ?`)
        .run(a.name, a.baseUrl || '', a.termsUrl || '', a.robotsUrl || '',
             a.access.method, a.access.status, a.access.reason || '', a.access.assessedAt || at,
             a.capabilities.metadata ? 1 : 0, a.capabilities.artwork ? 1 : 0,
             a.capabilities.playback ? 1 : 0, a.capabilities.playbackType || PLAYBACK.webOnly,
             at, row.id);
      /* A provider that may not be imported from cannot be left switched on by
         an older database or a hand-edited row. */
      if (a.access.status !== STATUS.available && row.enabled) {
        db.prepare('UPDATE providers SET enabled = 0, updated_at = ? WHERE id = ?').run(at, row.id);
      }
    }
    out.push(db.prepare('SELECT * FROM providers WHERE key = ?').get(a.key));
  }
  return out;
}

export function listProviders() {
  return openDb().prepare('SELECT * FROM providers ORDER BY name').all();
}

export function getProvider(id) {
  const row = openDb().prepare('SELECT * FROM providers WHERE id = ?').get(id);
  if (!row) throw notFound('No such provider.');
  return row;
}

export function providerByKey(key) {
  return openDb().prepare('SELECT * FROM providers WHERE key = ?').get(key) || null;
}

/**
 * The operator's switch. A provider with no permitted interface cannot be
 * turned on — the refusal names the reason rather than failing quietly, so
 * nobody is left wondering why nothing imported.
 */
export function setProviderEnabled(id, enabled) {
  const row = getProvider(id);
  const a = adapterFor(row);
  if (enabled && !importable(a)) {
    throw notImportable(a.access.reason || NO_INTERFACE, {
      provider: row.name,
      status: a.access.status,
      accessMethod: a.access.method,
      recheck: a.access.recheck || []
    });
  }
  openDb().prepare('UPDATE providers SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, nowIso(), id);
  return getProvider(id);
}

export function updateProvider(id, patch = {}) {
  getProvider(id);
  const cols = {
    refresh_interval_seconds: patch.refreshIntervalSeconds,
    request_delay_ms: patch.requestDelayMs,
    concurrency: patch.concurrency,
    timeout_ms: patch.timeoutMs,
    max_retries: patch.maxRetries,
    page_limit: patch.pageLimit
  };
  const sets = [], args = [];
  for (const [col, val] of Object.entries(cols)) {
    if (val == null) continue;
    sets.push(`${col} = ?`); args.push(Number(val));
  }
  if (sets.length) {
    openDb().prepare(`UPDATE providers SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...args, nowIso(), id);
  }
  return getProvider(id);
}

/** What the settings screen shows for one provider. */
export function publicProvider(p, extra = {}) {
  const a = byKey(p.key);
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    baseUrl: p.base_url,
    termsUrl: p.terms_url,
    enabled: Boolean(p.enabled),
    /* Both of the brief's axes, so the UI never has to work one out from the
       other: the switch, and what the provider actually permits. */
    state: p.enabled ? 'enabled' : 'disabled',
    status: p.status,
    statusReason: p.status_reason,
    statusCheckedAt: p.status_checked_at,
    accessMethod: p.access_method,
    importable: a ? importable(a) : false,
    supports: {
      metadata: Boolean(p.supports_metadata),
      artwork: Boolean(p.supports_artwork),
      playback: Boolean(p.supports_playback),
      playbackType: p.playback_type
    },
    limits: {
      requestDelayMs: p.request_delay_ms,
      concurrency: p.concurrency,
      timeoutMs: p.timeout_ms,
      maxRetries: p.max_retries,
      pageLimit: p.page_limit,
      refreshIntervalSeconds: p.refresh_interval_seconds
    },
    lastSyncAt: p.last_sync_at,
    lastAttemptAt: p.last_attempt_at,
    lastError: p.last_error,
    failCount: p.fail_count,
    ...extra
  };
}
