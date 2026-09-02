import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Each test file gets its own database and secret, so nothing leaks between them. */
export function isolate() {
  const dir = mkdtempSync(path.join(tmpdir(), 'telly-test-'));
  process.env.TELLY_DATA_DIR = dir;
  process.env.TELLY_DB = path.join(dir, 'test.db');
  process.env.TELLY_SECRET = 'test-secret-not-for-production';
  // Most suites sign in far more often than a person would; rate limiting has
  // a suite of its own where the low limits are the point.
  process.env.TELLY_RL_LOGIN = process.env.TELLY_RL_LOGIN || '1000';
  process.env.TELLY_RL_API = process.env.TELLY_RL_API || '100000';
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const DEVICE = { key: 'device-key-0000001', name: 'Living Room TV', platform: 'androidtv' };

export async function login(app, username, password, device = DEVICE) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password, device } });
}

export function auth(token) {
  return { authorization: `Bearer ${token}` };
}

/** A playlist with the shapes real ones have, served without touching a network. */
export const SAMPLE_M3U = `#EXTM3U url-tvg="http://example.org/epg.xml"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://logo/1.png" group-title="UK | Entertainment",BBC One HD
http://provider.example/live/secretuser/secretpass/1.m3u8
#EXTINF:-1 group-title="UK | Sport",Sky Sports Main Event, Live
http://provider.example/live/secretuser/secretpass/2.m3u8
#EXTINF:-1 group-title="Movies | Premiere",Casablanca
http://provider.example/vod/secretuser/secretpass/3.mp4
#EXTINF:-1 group-title="Japan",NHK BSP4K
[NO PUBLIC STREAM]
`;
