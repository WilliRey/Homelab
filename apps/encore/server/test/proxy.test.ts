import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHUNK_BYTES, capRange, parseContentRange, parseRange } from '../src/stream/proxy.js';
import { Resolver } from '../src/yt/resolver.js';
import type { YtdlpInfo } from '../src/yt/ytdlp.js';
import { loginCookie, makeApp } from './helpers.js';

describe('parseRange', () => {
  it('parses closed, open and suffix ranges', () => {
    expect(parseRange('bytes=0-1')).toEqual({ kind: 'range', start: 0, end: 1 });
    expect(parseRange('bytes=100-')).toEqual({ kind: 'range', start: 100 });
    expect(parseRange('bytes=-500')).toEqual({ kind: 'suffix', length: 500 });
    expect(parseRange(undefined)).toEqual({ kind: 'none' });
  });
  it('rejects multi-range and garbage', () => {
    expect(parseRange('bytes=0-1,5-6')).toEqual({ kind: 'multi' });
    expect(parseRange('bytes=5-2')).toEqual({ kind: 'invalid' });
    expect(parseRange('items=0-1')).toEqual({ kind: 'invalid' });
    expect(parseRange('bytes=-')).toEqual({ kind: 'invalid' });
  });
});

describe('capRange (10 MB cap)', () => {
  it('caps open ranges at 10 MB', () => {
    expect(capRange(0, undefined, undefined)).toEqual({ start: 0, end: CHUNK_BYTES - 1 });
    expect(capRange(5, undefined, 100 * CHUNK_BYTES)).toEqual({ start: 5, end: 5 + CHUNK_BYTES - 1 });
  });
  it('caps large closed ranges at 10 MB', () => {
    expect(capRange(0, 50 * CHUNK_BYTES, undefined).end).toBe(CHUNK_BYTES - 1);
  });
  it('keeps small ranges and clamps to the file size', () => {
    expect(capRange(0, 1, 1000)).toEqual({ start: 0, end: 1 });
    expect(capRange(900, undefined, 1000)).toEqual({ start: 900, end: 999 });
  });
  it('parses Content-Range', () => {
    expect(parseContentRange('bytes 0-1/3449447')).toEqual({ start: 0, end: 1, total: 3449447 });
    expect(parseContentRange('bytes 0-1/*')).toEqual({ start: 0, end: 1, total: undefined });
  });
});

// ---------------------------------------------------------------------------
// End-to-end through Fastify against a fake googlevideo

const TOTAL = 25 * 1024 * 1024 + 123; // three upstream chunks
const FILE = Buffer.alloc(TOTAL);
for (let i = 0; i < TOTAL; i++) FILE[i] = i % 251;

let upstream: Server;
let base = '';
const seen: string[] = [];
let fail403 = 0; // how many upcoming requests to refuse
let aborted = 0;

function serveRange(req: IncomingMessage, res: import('node:http').ServerResponse) {
  if (req.url?.startsWith('/lb')) {
    // googlevideo-style load-balancer hop
    res.writeHead(302, { location: req.url.replace('/lb', '/videoplayback') }).end();
    return;
  }
  seen.push(req.headers.range ?? '');
  if (fail403 > 0) {
    fail403--;
    res.writeHead(403).end();
    return;
  }
  const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
  if (!m) {
    res.writeHead(200, { 'content-length': TOTAL }).end(FILE);
    return;
  }
  const s = Number(m[1]);
  const e = Math.min(Number(m[2]), TOTAL - 1);
  if (e - s + 1 > CHUNK_BYTES) {
    res.writeHead(403).end(); // googlevideo refuses huge ranges
    return;
  }
  res.writeHead(206, { 'content-range': `bytes ${s}-${e}/${TOTAL}`, 'content-length': e - s + 1 });
  if (req.url?.includes('slow')) {
    res.write(FILE.subarray(s, s + 10));
    res.on('close', () => aborted++);
    return; // never finishes
  }
  res.end(FILE.subarray(s, e + 1));
}

beforeAll(async () => {
  upstream = createServer(serveRange);
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(() => upstream.close());
beforeEach(() => {
  seen.length = 0;
  fail403 = 0;
});

function infoFor(path: string, withSize = true): YtdlpInfo {
  return {
    id: 'dQw4w9WgXcQ',
    formats: [
      {
        format_id: '140', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129,
        url: `${base}/${path}?expire=${Math.floor(Date.now() / 1000) + 6 * 3600}`,
        filesize: withSize ? TOTAL : null, http_headers: { 'User-Agent': 'test' },
      },
    ],
  };
}

async function setup(path = 'videoplayback', withSize = true) {
  let spawns = 0;
  const resolver = new Resolver({ fetchInfo: async () => (spawns++, infoFor(path, withSize)) });
  const { app } = await makeApp({ resolver });
  const cookie = await loginCookie(app);
  return { app, cookie, spawns: () => spawns };
}

describe('stream proxy', () => {
  it('requires a session', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio' })).statusCode).toBe(401);
  });

  it('answers the iOS probe bytes=0-1 with exactly 2 bytes and the true total', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-length']).toBe('2');
    expect(res.headers['content-range']).toBe(`bytes 0-1/${TOTAL}`);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('audio/mp4');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload).toEqual(FILE.subarray(0, 2));
  });

  it('caps an open range at 10 MB upstream and reports a short 206', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=100-' } });
    expect(res.statusCode).toBe(206);
    expect(seen).toEqual([`bytes=100-${100 + CHUNK_BYTES - 1}`]);
    expect(res.headers['content-range']).toBe(`bytes 100-${100 + CHUNK_BYTES - 1}/${TOTAL}`);
    expect(res.rawPayload.length).toBe(CHUNK_BYTES);
    expect(res.rawPayload.equals(FILE.subarray(100, 100 + CHUNK_BYTES))).toBe(true);
  });

  it('serves a mid-file seek (75%)', async () => {
    const { app, cookie } = await setup();
    const start = Math.floor(TOTAL * 0.75);
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: `bytes=${start}-` } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes ${start}-${TOTAL - 1}/${TOTAL}`);
    expect(res.rawPayload.equals(FILE.subarray(start))).toBe(true);
  });

  it('works when yt-dlp did not report a size', async () => {
    const { app, cookie } = await setup('videoplayback', false);
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    expect(res.headers['content-range']).toBe(`bytes 0-1/${TOTAL}`);
  });

  it('streams the whole file as 200 when there is no Range header', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(TOTAL));
    expect(res.rawPayload.equals(FILE)).toBe(true);
    expect(seen.length).toBe(3); // 10 + 10 + 5 MB
  });

  it('rejects multi-range and out-of-bounds with 416', async () => {
    const { app, cookie } = await setup();
    const multi = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1,4-5' } });
    expect(multi.statusCode).toBe(416);
    const oob = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: `bytes=${TOTAL}-` } });
    expect(oob.statusCode).toBe(416);
    expect(oob.headers['content-range']).toBe(`bytes */${TOTAL}`);
  });

  it('re-resolves once on 403 and succeeds', async () => {
    const { app, cookie, spawns } = await setup();
    await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } }); // warm
    fail403 = 1;
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    expect(res.statusCode).toBe(206);
    expect(spawns()).toBe(2);
  });

  it('returns 502 when the retry also fails', async () => {
    const { app, cookie } = await setup();
    fail403 = 2;
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    expect(res.statusCode).toBe(502);
  });

  it('a second request inside the TTL does not resolve again', async () => {
    const { app, cookie, spawns } = await setup();
    await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=2-3' } });
    expect(spawns()).toBe(1);
  });

  it('?fresh=1 forces a new resolution', async () => {
    const { app, cookie, spawns } = await setup();
    await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio?fresh=1', headers: { cookie, range: 'bytes=0-1' } });
    expect(spawns()).toBe(2);
  });

  it('follows googlevideo 302 redirects', async () => {
    const { app, cookie } = await setup('lb');
    const res = await app.inject({ url: '/api/stream/dQw4w9WgXcQ/audio', headers: { cookie, range: 'bytes=0-1' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1/${TOTAL}`);
  });

  it('rejects malformed ids', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ url: '/api/stream/not-an-id/audio', headers: { cookie } })).statusCode).toBe(400);
  });

  it('aborts the upstream fetch when the client disconnects', async () => {
    const { app, cookie } = await setup('slow');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const before = aborted;
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/stream/dQw4w9WgXcQ/audio`, {
      headers: { cookie, range: 'bytes=0-' },
      signal: ac.signal,
    });
    expect(res.status).toBe(206);
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await new Promise((r) => setTimeout(r, 300));
    expect(aborted).toBe(before + 1);
    await app.close();
  });
});
