/**
 * Xtream Codes, server-side. The panel's username and password stay in the
 * database and in this file; a client never sees either, and never sees the
 * stream URLs they are baked into.
 */
import { upstreamFailed } from '../lib/errors.js';
import { classify } from './m3u.js';

export function normaliseHost(input) {
  let h = String(input || '').trim().replace(/\/+$/, '');
  if (!h) return '';
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  return h.replace(/\/player_api\.php.*$/i, '').replace(/\/+$/, '');
}

export function apiUrl(host, user, pass, action = '') {
  const base = `${normaliseHost(host)}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  return action ? `${base}&action=${action}` : base;
}

export function streamUrl(host, user, pass, streamId, ext) {
  return `${normaliseHost(host)}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${streamId}.${ext}`;
}

async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': 'Telly-Server/1.0' } });
  } catch (e) {
    throw upstreamFailed(`Could not reach the provider: ${e.message}`);
  }
  if (!res.ok) throw upstreamFailed(`The provider replied ${res.status} ${res.statusText}.`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw upstreamFailed('The provider did not return valid JSON — check the server URL and port.'); }
}

/** Signs in and returns the full live line-up as channel rows. */
export async function loadXtream({ host, username, password }, fetchImpl = fetch) {
  if (!host || !username || !password) throw upstreamFailed('Server, username and password are all needed.');

  const info = await getJson(apiUrl(host, username, password), fetchImpl);
  const userInfo = info && info.user_info;
  if (!userInfo) throw upstreamFailed('That server did not answer like an Xtream panel.');
  if (Number(userInfo.auth) === 0) throw upstreamFailed('The provider rejected those credentials.');
  const status = String(userInfo.status || '');
  if (status && status.toLowerCase() !== 'active') throw upstreamFailed(`The provider says that account is "${status}".`);

  const catName = new Map();
  try {
    const cats = await getJson(apiUrl(host, username, password, 'get_live_categories'), fetchImpl);
    if (Array.isArray(cats)) for (const c of cats) catName.set(String(c.category_id), c.category_name || 'Ungrouped');
  } catch { /* categories are a nicety */ }

  const streams = await getJson(apiUrl(host, username, password, 'get_live_streams'), fetchImpl);
  if (!Array.isArray(streams)) throw upstreamFailed('The provider sent an unexpected channel list.');

  const formats = Array.isArray(userInfo.allowed_output_formats) ? userInfo.allowed_output_formats : [];
  const ext = formats.includes('m3u8') ? 'm3u8' : (formats[0] || 'm3u8');

  const channels = streams.map((s, i) => {
    const group = catName.get(String(s.category_id)) || 'Ungrouped';
    return {
      extId: `xc:${s.stream_id}`,
      number: Number(s.num) || i + 1,
      name: s.name || `Channel ${s.stream_id}`,
      group,
      logo: s.stream_icon || '',
      tvgId: s.epg_channel_id || '',
      url: streamUrl(host, username, password, s.stream_id, ext),
      kind: classify(group)
    };
  });

  return { channels, epgUrl: '', expiresAt: userInfo.exp_date ? new Date(Number(userInfo.exp_date) * 1000).toISOString() : null };
}
