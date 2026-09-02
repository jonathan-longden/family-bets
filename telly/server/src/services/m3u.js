/**
 * The M3U parser, moved server-side.
 *
 * This is the same parser the web and Android clients use, edge case for edge
 * case: commas inside quoted attributes and inside channel names, #EXTGRP,
 * #EXTVLCOPT, addresses that are placeholders rather than URIs, duplicate
 * streams within a group, stable channel numbers.
 */
const ATTR = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

function attrs(s) {
  const out = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(s))) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Split an #EXTINF payload into attributes and title without tripping on commas. */
export function splitExtinf(payload) {
  let i = 0;
  while (i < payload.length && /[-\d.]/.test(payload[i])) i++;
  let inQuotes = false;
  for (; i < payload.length; i++) {
    const c = payload[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) break;
  }
  return { attrText: payload.slice(0, i), title: payload.slice(i + 1).trim() };
}

function safeName(url) {
  try { return decodeURIComponent(url.split('?')[0].split('/').pop()) || url; }
  catch { return url; }
}

/**
 * Movies and series are guessed from the group title, the same way the clients
 * do it today, so nothing changes for an existing playlist. When a source
 * carries proper VOD (Xtream does) the loader sets `kind` explicitly instead.
 */
export function classify(group) {
  if (/serie|season|episode|tv ?show/i.test(group)) return 'series';
  if (/movie|film|vod|cinema/i.test(group)) return 'movie';
  return 'live';
}

export function parseM3u(text) {
  const channels = [];
  const seen = new Set();
  let epgUrl = '';
  let pending = null;
  let extgrp = '';

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      const a = attrs(line);
      epgUrl = a['url-tvg'] || a['x-tvg-url'] || '';
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      const { attrText, title } = splitExtinf(line.slice(8));
      const a = attrs(attrText);
      pending = {
        name: title || a['tvg-name'] || 'Unnamed channel',
        tvgId: a['tvg-id'] || '',
        logo: a['tvg-logo'] || '',
        group: a['group-title'] || ''
      };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) { extgrp = line.slice(8).trim(); continue; }
    if (line.startsWith('#')) continue;
    if (!URI.test(line)) { pending = null; extgrp = ''; continue; }

    const meta = pending || { name: safeName(line), tvgId: '', logo: '', group: '' };
    const group = meta.group || extgrp || 'Ungrouped';
    const extId = `${group}|${line}`;
    if (!seen.has(extId)) {
      seen.add(extId);
      channels.push({
        extId,
        number: channels.length + 1,
        name: meta.name,
        group,
        logo: meta.logo,
        tvgId: meta.tvgId,
        url: line,
        kind: classify(group)
      });
    }
    pending = null; extgrp = '';
  }
  return { channels, epgUrl };
}
