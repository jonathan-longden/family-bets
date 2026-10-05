import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { openDb, nowIso } from '../db/index.js';
import { badRequest, notFound, upstreamFailed } from '../lib/errors.js';

/**
 * XMLTV: download, parse, match, store.
 *
 * Parsed with a scanner rather than a DOM. A national guide is tens of
 * megabytes and a quarter of a million programmes; holding all of that as
 * objects to walk it once is a waste of a PC that is also serving video, and
 * an XML library would be a dependency for one file format. The scanner reads
 * one <programme> element at a time and writes it straight to SQLite.
 *
 * Only what the guide screen shows is kept: channel, window, title, subtitle,
 * description, category, icon.
 */

/* XMLTV times are "20240301203000 +0000", with the offset sometimes missing. */
export function xmltvTime(s) {
  const m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(String(s || ''));
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, off] = m;
  const base = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +(S || 0));
  let shift = 0;
  if (off) {
    const sign = off[0] === '-' ? -1 : 1;
    shift = sign * ((+off.slice(1, 3)) * 60 + (+off.slice(3, 5))) * 60000;
  }
  return new Date(base - shift).toISOString();
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENT[n]);
}

function attr(tag, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return m ? unescapeXml(m[1] !== undefined ? m[1] : m[2]) : '';
}

function child(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? unescapeXml(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function childAttr(xml, name, a) {
  const m = new RegExp(`<${name}\\b([^>]*)/?>`, 'i').exec(xml);
  return m ? attr(m[1], a) : '';
}

/**
 * Walk the document, handing back every <channel> and <programme> element.
 * Written as a generator over a string so the caller can feed it a whole file
 * or, for a very large guide, one chunk at a time.
 */
export function* elements(xml, names = ['channel', 'programme']) {
  const re = new RegExp(`<(${names.join('|')})\\b([^>]*?)(/?)>`, 'gi');
  let m;
  while ((m = re.exec(xml))) {
    const [, name, attrs, selfClosing] = m;
    if (selfClosing) { yield { name, attrs, body: '' }; continue; }
    const close = xml.indexOf(`</${name}>`, re.lastIndex);
    if (close < 0) break;                       // truncated download: stop cleanly
    yield { name, attrs, body: xml.slice(re.lastIndex, close) };
    re.lastIndex = close + name.length + 3;
  }
}

/** Parse a whole XMLTV document into the two lists this schema stores. */
export function parseXmltv(xml) {
  const channels = [], programmes = [];
  for (const el of elements(xml)) {
    if (el.name.toLowerCase() === 'channel') {
      const id = attr(el.attrs, 'id');
      if (!id) continue;
      channels.push({
        tvgId: id,
        displayName: child(el.body, 'display-name'),
        icon: childAttr(el.body, 'icon', 'src')
      });
    } else {
      const tvgId = attr(el.attrs, 'channel');
      const startsAt = xmltvTime(attr(el.attrs, 'start'));
      const endsAt = xmltvTime(attr(el.attrs, 'stop'));
      if (!tvgId || !startsAt || !endsAt) continue;
      programmes.push({
        tvgId, startsAt, endsAt,
        title: child(el.body, 'title'),
        subtitle: child(el.body, 'sub-title'),
        description: child(el.body, 'desc'),
        category: child(el.body, 'category'),
        icon: childAttr(el.body, 'icon', 'src')
      });
    }
  }
  return { channels, programmes };
}

/* ------------------------------------------------------------- EPG sources */

export function createEpgSource({ name, url, refreshIntervalSeconds }) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) throw badRequest('An XMLTV source needs an http(s) address.');
  const now = nowIso();
  const info = openDb().prepare(`INSERT INTO epg_sources (name, url, refresh_interval_seconds, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`)
    .run(String(name || clean).trim(), clean, Number(refreshIntervalSeconds) || 43200, now, now);
  return getEpgSource(Number(info.lastInsertRowid));
}

export function getEpgSource(id) {
  const row = openDb().prepare('SELECT * FROM epg_sources WHERE id = ?').get(id);
  if (!row) throw notFound('No such guide source.');
  return row;
}

export function listEpgSources() {
  return openDb().prepare('SELECT * FROM epg_sources ORDER BY name').all();
}

export function updateEpgSource(id, patch) {
  const row = getEpgSource(id);
  openDb().prepare(`UPDATE epg_sources SET name = ?, url = ?, enabled = ?, refresh_interval_seconds = ?, updated_at = ?
      WHERE id = ?`).run(
    patch.name === undefined ? row.name : String(patch.name).trim(),
    patch.url === undefined ? row.url : String(patch.url).trim(),
    patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0),
    patch.refreshIntervalSeconds === undefined ? row.refresh_interval_seconds : Number(patch.refreshIntervalSeconds),
    nowIso(), id);
  return getEpgSource(id);
}

export function deleteEpgSource(id) {
  getEpgSource(id);
  openDb().prepare('DELETE FROM epg_sources WHERE id = ?').run(id);
}

export function publicEpgSource(s) {
  return {
    id: s.id, name: s.name, url: s.url, enabled: Boolean(s.enabled),
    refreshIntervalSeconds: s.refresh_interval_seconds,
    lastSyncedAt: s.last_synced_at, lastAttemptAt: s.last_attempt_at,
    lastError: s.last_error, failCount: s.fail_count,
    channelCount: s.channel_count, programmeCount: s.programme_count
  };
}

async function download(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { headers: { 'user-agent': 'Telly-Server/1.0' } }); }
  catch (e) { throw upstreamFailed(`Could not reach that guide: ${e.message}`); }
  if (!res.ok) throw upstreamFailed(`The guide server replied ${res.status} ${res.statusText}.`);
  const gz = /\.gz(\?|$)/i.test(url) || /gzip/i.test(res.headers.get('content-encoding') || '');
  if (!gz) return res.text();
  // Node's fetch already decodes content-encoding; a .xml.gz file does not use
  // it, so that one is unpacked here.
  const buf = Buffer.from(await res.arrayBuffer());
  if (!(buf[0] === 0x1f && buf[1] === 0x8b)) return buf.toString('utf8');
  const chunks = [];
  await new Promise((resolve, reject) => {
    Readable.from(buf).pipe(createGunzip())
      .on('data', c => chunks.push(c)).on('end', resolve).on('error', reject);
  });
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch and store one guide. The old programmes are replaced in a transaction,
 * so a reader never sees half a guide; a download that fails leaves the
 * previous one in place and marks the source instead.
 */
export async function syncEpgSource(id, { fetchImpl = fetch, text = null } = {}) {
  const db = openDb();
  const src = getEpgSource(id);
  const at = nowIso();
  db.prepare('UPDATE epg_sources SET last_attempt_at = ? WHERE id = ?').run(at, id);

  let xml;
  try {
    xml = text != null ? text : await download(src.url, fetchImpl);
  } catch (e) {
    db.prepare('UPDATE epg_sources SET last_error = ?, fail_count = fail_count + 1, updated_at = ? WHERE id = ?')
      .run(e.message || String(e), at, id);
    throw e;
  }

  const { channels, programmes } = parseXmltv(xml);
  if (!programmes.length) {
    const msg = 'That guide had no programmes in it.';
    db.prepare('UPDATE epg_sources SET last_error = ?, fail_count = fail_count + 1, updated_at = ? WHERE id = ?')
      .run(msg, at, id);
    throw upstreamFailed(msg);
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM epg_channels WHERE epg_source_id = ?').run(id);
    const ic = db.prepare(`INSERT OR REPLACE INTO epg_channels (epg_source_id, tvg_id, display_name, icon)
        VALUES (?, ?, ?, ?)`);
    for (const c of channels) ic.run(id, c.tvgId, c.displayName, c.icon);

    db.prepare('DELETE FROM epg_programmes WHERE epg_source_id = ?').run(id);
    const ip = db.prepare(`INSERT OR IGNORE INTO epg_programmes
        (epg_source_id, tvg_id, starts_at, ends_at, title, subtitle, description, category, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of programmes) {
      ip.run(id, p.tvgId, p.startsAt, p.endsAt, p.title, p.subtitle, p.description, p.category, p.icon);
    }
    db.prepare(`UPDATE epg_sources SET last_synced_at = ?, last_error = NULL, fail_count = 0,
        channel_count = ?, programme_count = ?, updated_at = ? WHERE id = ?`)
      .run(at, channels.length, programmes.length, at, id);
  });
  tx();

  return { channels: channels.length, programmes: programmes.length, syncedAt: at };
}

/** True when a guide has never been fetched, or its own interval has elapsed. */
export function epgNeedsSync(src, now = Date.now()) {
  if (!src.enabled) return false;
  if (!src.last_synced_at) return true;
  return (now - Date.parse(src.last_synced_at)) / 1000 > src.refresh_interval_seconds;
}

/* ------------------------------------------------------------ the guide -- */

/**
 * How many of a user's channels the guide actually covers. The honest number
 * to show next to a guide source, because tvg-id matching is where guides
 * usually disappoint.
 */
export function coverage(tvgIds) {
  if (!tvgIds.length) return { matched: 0, total: 0 };
  const db = openDb();
  const marks = new Array(tvgIds.length).fill('?').join(',');
  const matched = db.prepare(`SELECT COUNT(DISTINCT tvg_id) n FROM epg_channels WHERE tvg_id IN (${marks})`)
    .get(...tvgIds).n;
  return { matched, total: tvgIds.length };
}

/** Programmes for one channel in a window, oldest first. */
export function programmesFor(tvgId, { from, to, limit = 60 } = {}) {
  if (!tvgId) return [];
  const start = from ? new Date(from).toISOString() : new Date(Date.now() - 3600e3).toISOString();
  const end = to ? new Date(to).toISOString() : new Date(Date.now() + 12 * 3600e3).toISOString();
  return openDb().prepare(`SELECT tvg_id, starts_at, ends_at, title, subtitle, description, category, icon
      FROM epg_programmes
      WHERE tvg_id = ? AND ends_at > ? AND starts_at < ?
      ORDER BY starts_at LIMIT ?`)
    .all(tvgId, start, end, Math.min(Number(limit) || 60, 500))
    .map(publicProgramme);
}

/** What is on now and what is on next, for a set of channels in one query. */
export function nowNext(tvgIds, at = new Date().toISOString()) {
  const out = {};
  if (!tvgIds.length) return out;
  const db = openDb();
  const now = db.prepare(`SELECT * FROM epg_programmes WHERE tvg_id = ? AND starts_at <= ? AND ends_at > ?
      ORDER BY starts_at DESC LIMIT 1`);
  const next = db.prepare(`SELECT * FROM epg_programmes WHERE tvg_id = ? AND starts_at > ?
      ORDER BY starts_at LIMIT 1`);
  for (const id of tvgIds) {
    if (!id) continue;
    const a = now.get(id, at, at);
    const b = next.get(id, at);
    if (a || b) out[id] = { now: a ? publicProgramme(a) : null, next: b ? publicProgramme(b) : null };
  }
  return out;
}

export function publicProgramme(p) {
  return {
    tvgId: p.tvg_id, startsAt: p.starts_at, endsAt: p.ends_at,
    title: p.title, subtitle: p.subtitle, description: p.description,
    category: p.category, icon: p.icon
  };
}
