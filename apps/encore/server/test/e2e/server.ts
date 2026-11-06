// Server for the web Playwright tests: the real app, with YouTube faked out.
// Search returns fixed tracks; streams are generated AAC tones served through the
// real Range proxy from a local fake "googlevideo".
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.js';
import { openDb } from '../../src/db/index.js';
import { buildApp, type YtApi } from '../../src/index.js';
import { Resolver } from '../../src/yt/resolver.js';
import { ShortsChecker } from '../../src/yt/shorts.js';
import type { VideoItem } from '../../src/yt/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tones = [readFileSync(path.join(here, '../fixtures/media/tone-a.m4a')), readFileSync(path.join(here, '../fixtures/media/tone-b.m4a'))];

const track = (n: number, title: string): VideoItem => {
  const id = `e2etrack${String(n).padStart(3, '0')}`;
  return { id, title, channelId: 'UCe2eeeeeeeeeeeeeeeeeeee', channelName: 'Test Channel', durationSec: 8, thumbnail: '/icons/icon.svg', artwork: '/icons/icon.svg', kind: 'song' };
};
const SEARCH = [track(1, 'First Tone'), track(2, 'Second Tone'), track(3, 'Third Tone')];
const RADIO = [track(4, 'Radio One'), track(5, 'Radio Two'), track(6, 'Radio Three')];

// Fake googlevideo: odd tracks get tone A, even get tone B. Honors Range.
const upstream = createServer((req, res) => {
  const n = Number(/e2etrack(\d+)/.exec(req.url ?? '')?.[1] ?? 1);
  const file = tones[(n + 1) % 2]!;
  const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
  if (!m) {
    res.writeHead(200, { 'content-length': file.length }).end(file);
    return;
  }
  const s = Number(m[1]);
  const e = Math.min(Number(m[2]), file.length - 1);
  res.writeHead(206, { 'content-range': `bytes ${s}-${e}/${file.length}`, 'content-length': e - s + 1 }).end(file.subarray(s, e + 1));
});
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

const yt: YtApi = {
  search: async () => ({ items: SEARCH.map((t) => ({ ...t, kind: 'video' as const, durationSec: 600 })) }),
  searchSongs: async () => ({ items: SEARCH }),
  suggestions: async (q) => [`${q} one`, `${q} two`],
  getVideo: async (id) => ({ ...SEARCH[0]!, id, playable: true, related: [] }),
  getBasicInfo: async () => ({ isLive: false, isUpcoming: false }),
  getChannel: async (id) => ({ channel: { id, name: 'Test Channel' }, page: { items: SEARCH } }),
  getChannelVideos: async () => SEARCH,
  getPlaylist: async (id) => ({ id, title: 'Test Playlist', items: SEARCH }),
  upNext: async () => RADIO,
  resolveUrl: async () => null,
};

const config = loadConfig({
  ...process.env,
  APP_PASSWORD: 'e2e-password',
  SESSION_SECRET: 'e'.repeat(64),
  COOKIE_SECURE: 'false',
  DATA_DIR: '/tmp',
  PUBLIC_DIR: process.env.PUBLIC_DIR ?? path.join(here, '../../../web/dist'),
  DISABLE_JOBS: 'true',
  LOG_LEVEL: 'warn',
  LOGIN_RATE_PER_MIN: '1000',
});
const db = openDb('/tmp', ':memory:');
const resolver = new Resolver({
  fetchInfo: async (id) => ({
    id,
    formats: [{ format_id: '140', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', abr: 32, url: `${upstreamBase}/videoplayback/${id}?expire=${Math.floor(Date.now() / 1000) + 21600}` }],
  }),
});
const app = await buildApp({ config, db, resolver, yt, shorts: new ShortsChecker(db, async () => ({ status: 303, location: '/watch?v=x' })) });
const port = Number(process.env.PORT ?? 3100);
await app.listen({ port, host: '127.0.0.1' });
console.log(`e2e server on ${port}`);
