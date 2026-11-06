// One test group per Shorts rule (PLAN.md section 7).
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/index.js';
import { parseYouTubeUrl } from '../src/routes/search.js';
import { normalizeNodes } from '../src/yt/innertube.js';
import { filterShorts, isShortsUrl, ShortsChecker, verdictFrom, type HeadFn } from '../src/yt/shorts.js';
import type { VideoItem } from '../src/yt/types.js';
import { fakeYt, loginCookie, makeApp } from './helpers.js';

const video = (id: string, extra: object = {}) => ({
  type: 'Video', video_id: id, title: `t-${id}`, duration: { seconds: 600 },
  author: { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Chan' }, endpoint: { metadata: { url: `/watch?v=${id}` } }, ...extra,
});
const lockup = (id: string, content_type: string, url = `/watch?v=${id}`) => ({
  type: 'LockupView', content_id: id, content_type, metadata: { title: `t-${id}` }, duration: { seconds: 300 },
  renderer_context: { command_context: { on_tap: { metadata: { url } } } },
});
const item = (id: string, durationSec?: number, kind: VideoItem['kind'] = 'video'): VideoItem => ({ id, title: id, durationSec, thumbnail: '', kind });

describe('rule 1: node type', () => {
  it('keeps regular video nodes and drops Shorts node types', () => {
    const out = normalizeNodes([
      video('aaaaaaaaaaa'),
      { ...video('bbbbbbbbbbb'), type: 'CompactVideo' },
      lockup('ccccccccccc', 'VIDEO'),
      { type: 'ShortsLockupView', on_tap_endpoint: { payload: { videoId: 'ddddddddddd' } } },
      { type: 'ReelItem', id: 'eeeeeeeeeee', title: 'reel' },
      lockup('fffffffffff', 'SHORT'),
    ]);
    expect(out.videos.map((v) => v.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  });

  it('drops ReelShelf and any shelf titled "Shorts", but walks other shelves', () => {
    const out = normalizeNodes([
      { type: 'ReelShelf', items: [video('ggggggggggg')] },
      { type: 'Shelf', title: 'Shorts', contents: [video('hhhhhhhhhhh')] },
      { type: 'GridShelfView', contents: [{ type: 'ShortsLockupView' }, { type: 'ShortsLockupView' }] },
      { type: 'Shelf', title: 'Latest from Chan', contents: [video('iiiiiiiiiii')] },
    ]);
    expect(out.videos.map((v) => v.id)).toEqual(['iiiiiiiiiii']);
  });
});

describe('rule 2: URL', () => {
  it('detects /shorts/ URLs', () => {
    expect(isShortsUrl('/shorts/abcdefghijk')).toBe(true);
    expect(isShortsUrl('https://www.youtube.com/shorts/abcdefghijk')).toBe(true);
    expect(isShortsUrl('/watch?v=abcdefghijk')).toBe(false);
  });
  it('drops nodes whose endpoint points at /shorts/', () => {
    const out = normalizeNodes([
      video('jjjjjjjjjjj', { endpoint: { metadata: { url: '/shorts/jjjjjjjjjjj' } } }),
      lockup('kkkkkkkkkkk', 'VIDEO', '/shorts/kkkkkkkkkkk'),
      video('lllllllllll'),
    ]);
    expect(out.videos.map((v) => v.id)).toEqual(['lllllllllll']);
  });
});

describe('rule 3: HEAD /shorts/<id> for ambiguous items', () => {
  const headFor = (shorts: Set<string>): HeadFn =>
    vi.fn(async (url: string) => {
      const id = url.split('/').pop()!;
      return shorts.has(id) ? { status: 200, location: null } : { status: 303, location: `https://www.youtube.com/watch?v=${id}` };
    });

  it('maps responses to verdicts', () => {
    expect(verdictFrom(200, null)).toBe('short');
    expect(verdictFrom(303, 'https://www.youtube.com/watch?v=x')).toBe('video');
    expect(verdictFrom(302, 'https://consent.youtube.com/m?continue=…')).toBe('unknown');
    expect(verdictFrom(429, null)).toBe('unknown');
  });

  it('drops Shorts among items ≤ 180 s or of unknown length, and skips the check for long ones', async () => {
    const head = headFor(new Set(['short000001', 'short000002']));
    const checker = new ShortsChecker(openDb('/tmp', ':memory:'), head);
    const kept = await filterShorts(
      [item('short000001', 30), item('short000002'), item('normal00001', 120), item('long0000001', 900)],
      checker,
    );
    expect(kept.map((i) => i.id)).toEqual(['normal00001', 'long0000001']);
    expect(head).toHaveBeenCalledTimes(3); // long video never checked
  });

  it('caches answers forever in shorts_check', async () => {
    const db = openDb('/tmp', ':memory:');
    const head = headFor(new Set(['short000001']));
    const c1 = new ShortsChecker(db, head);
    await filterShorts([item('short000001', 20), item('normal00001', 20)], c1);
    const c2 = new ShortsChecker(db, head); // fresh checker, same DB
    const kept = await filterShorts([item('short000001', 20), item('normal00001', 20)], c2);
    expect(kept.map((i) => i.id)).toEqual(['normal00001']);
    expect(head).toHaveBeenCalledTimes(2);
  });

  it('keeps items when the check times out or fails, without caching', async () => {
    const db = openDb('/tmp', ':memory:');
    const head: HeadFn = async () => {
      throw new DOMException('timeout', 'TimeoutError');
    };
    const kept = await filterShorts([item('unknown0001', 10)], new ShortsChecker(db, head));
    expect(kept).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM shorts_check').get()).toEqual({ n: 0 });
  });

  it('runs at most 4 checks at once', async () => {
    let active = 0;
    let peak = 0;
    const head: HeadFn = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { status: 303, location: 'https://www.youtube.com/watch?v=x' };
    };
    const items = Array.from({ length: 12 }, (_, i) => item(`vid${String(i).padStart(8, '0')}`, 60));
    await filterShorts(items, new ShortsChecker(openDb('/tmp', ':memory:'), head));
    expect(peak).toBe(4);
  });

  it('skips the check for YouTube Music songs', async () => {
    const head = vi.fn(headFor(new Set()));
    await filterShorts([item('song0000001', 60, 'song')], new ShortsChecker(openDb('/tmp', ':memory:'), head));
    expect(head).not.toHaveBeenCalled();
  });
});

describe('rule 4: channel pages only use Videos and Playlists tabs', () => {
  it('rejects any other tab and passes videos by default', async () => {
    const yt = fakeYt();
    const getChannel = vi.fn(async () => ({ channel: { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'C' }, page: { items: [] } }));
    yt.getChannel = getChannel as any;
    const { app } = await makeApp({ yt });
    const cookie = await loginCookie(app);
    const id = 'UCaaaaaaaaaaaaaaaaaaaaaa';
    expect((await app.inject({ url: `/api/channel/${id}?tab=shorts`, headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/channel/${id}?tab=live`, headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/channel/${id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/channel/${id}?tab=playlists`, headers: { cookie } })).statusCode).toBe(200);
    expect(getChannel.mock.calls.map((c: any[]) => c[1])).toEqual(['videos', 'playlists']);
  });
});

// Rule 5 (subscription feed via UULF) is tested in feed.test.ts with the feed poller (Phase 5).

describe('rule 6: /api/resolve rejects Shorts URLs', () => {
  it('parses links locally', () => {
    expect(parseYouTubeUrl('https://youtube.com/shorts/abcdefghijk')).toBe('shorts');
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/abcdefghijk?feature=share')).toBe('shorts');
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1')).toEqual({ type: 'video', id: 'dQw4w9WgXcQ' });
    expect(parseYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM')).toEqual({ type: 'video', id: 'dQw4w9WgXcQ', playlistId: 'RDAMVM' });
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')).toEqual({ type: 'playlist', id: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI' });
    expect(parseYouTubeUrl('https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw')).toEqual({ type: 'channel', id: 'UCuAXFkgsw1L7xaCfnd5JJOw' });
    expect(parseYouTubeUrl('https://www.youtube.com/@RickAstleyYT')).toBe('lookup');
    expect(parseYouTubeUrl('https://evil.example/watch?v=dQw4w9WgXcQ')).toBe('unsupported');
  });

  it('returns 422 for /shorts/ links', async () => {
    const { app } = await makeApp();
    const cookie = await loginCookie(app);
    const res = await app.inject({ url: '/api/resolve?url=' + encodeURIComponent('https://youtube.com/shorts/abcdefghijk'), headers: { cookie } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Shorts are disabled' });
  });

  it('returns 422 when a handle-style link resolves to a Short', async () => {
    const yt = fakeYt();
    yt.resolveUrl = async () => null;
    const { app } = await makeApp({ yt });
    const cookie = await loginCookie(app);
    const res = await app.inject({ url: '/api/resolve?url=' + encodeURIComponent('https://www.youtube.com/@someone'), headers: { cookie } });
    expect(res.statusCode).toBe(422);
  });
});

describe('every VideoItem endpoint applies filterShorts', () => {
  const shortsHead: HeadFn = async (url) =>
    url.endsWith('short000001') ? { status: 200, location: null } : { status: 303, location: 'https://www.youtube.com/watch?v=x' };
  const items = [item('short000001', 40), item('normal00001', 40)];

  it.each([
    ['/api/search?q=x&type=videos', (yt: any) => (yt.search = async () => ({ items }))],
    ['/api/search?q=x&type=songs', (yt: any) => (yt.searchSongs = async () => ({ items }))],
    ['/api/video/normal00001', (yt: any) => (yt.getVideo = async () => ({ ...item('normal00001', 400), playable: true, related: items }))],
    ['/api/channel/UCaaaaaaaaaaaaaaaaaaaaaa', (yt: any) => (yt.getChannel = async () => ({ channel: { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'C' }, page: { items } }))],
    ['/api/playlist/PLxxxxxxxxxxxx', (yt: any) => (yt.getPlaylist = async () => ({ id: 'PLxxxxxxxxxxxx', title: 'p', items }))],
    ['/api/music/upnext/normal00001', (yt: any) => (yt.upNext = async () => items)],
  ])('%s', async (url, patch) => {
    const yt = fakeYt();
    patch(yt);
    const { app } = await makeApp({ yt }, { head: shortsHead });
    const cookie = await loginCookie(app);
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const list: VideoItem[] = body.items ?? body.related;
    expect(list.map((i) => i.id)).toEqual(['normal00001']);
  });
});
