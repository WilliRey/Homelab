import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Resolver } from '../src/yt/resolver.js';
import type { YtdlpInfo } from '../src/yt/ytdlp.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ytdlp-dQw4w9WgXcQ.json', import.meta.url), 'utf8')) as YtdlpInfo;
const withExpire = (sec: number): YtdlpInfo => ({
  ...fixture,
  formats: fixture.formats!.map((f) => ({ ...f, url: f.url.replace(/expire=\d+/, `expire=${sec}`) })),
});

describe('Resolver', () => {
  it('serves a second request inside the TTL from cache (one spawn)', async () => {
    const fetchInfo = vi.fn(async () => fixture);
    const r = new Resolver({ fetchInfo, now: () => 1_000_000 });
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' });
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' });
    await r.resolve('dQw4w9WgXcQ', { type: 'video', height: 480 });
    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolutions', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchInfo = vi.fn(async () => {
      await gate;
      return fixture;
    });
    const r = new Resolver({ fetchInfo });
    const ps = [r.resolve('dQw4w9WgXcQ', { type: 'audio' }), r.resolve('dQw4w9WgXcQ', { type: 'video', height: 360 })];
    release();
    const [a, v] = await Promise.all(ps);
    expect(a.itag).toBe('140');
    expect(v.itag).toBe('134');
    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });

  it('fresh skips the cache', async () => {
    const fetchInfo = vi.fn(async () => fixture);
    const r = new Resolver({ fetchInfo, now: () => 0 });
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' });
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' }, { fresh: true });
    expect(fetchInfo).toHaveBeenCalledTimes(2);
  });

  it('expires entries at min(expire − 30 min, 5 h)', async () => {
    let now = 0;
    const expireSec = 3600; // URL dies at t=1h → cache until t=30min
    const fetchInfo = vi.fn(async () => withExpire(expireSec));
    const r = new Resolver({ fetchInfo, now: () => now });
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' });
    now = 29 * 60 * 1000;
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' });
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    now = 31 * 60 * 1000;
    await r.resolve('dQw4w9WgXcQ', { type: 'audio' });
    expect(fetchInfo).toHaveBeenCalledTimes(2);

    // Far-future expiry is capped at 5 h.
    now = 0;
    const r2 = new Resolver({ fetchInfo: async () => withExpire(10 ** 9), now: () => now });
    await r2.resolve('dQw4w9WgXcQ', { type: 'audio' });
    now = 5 * 3600 * 1000 - 1;
    expect(r2.has('dQw4w9WgXcQ')).toBe(true);
    now = 5 * 3600 * 1000 + 1;
    expect(r2.has('dQw4w9WgXcQ')).toBe(false);
  });

  it('does not cache failures', async () => {
    const fetchInfo = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(fixture);
    const r = new Resolver({ fetchInfo });
    await expect(r.resolve('dQw4w9WgXcQ', { type: 'audio' })).rejects.toThrow('boom');
    await expect(r.resolve('dQw4w9WgXcQ', { type: 'audio' })).resolves.toMatchObject({ itag: '140' });
  });
});
