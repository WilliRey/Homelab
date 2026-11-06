import { describe, expect, it } from 'vitest';
import { loginCookie, makeApp } from './helpers.js';

async function client() {
  const { app } = await makeApp();
  const cookie = await loginCookie(app);
  const req = async (method: string, url: string, payload?: object) => {
    const r = await app.inject({ method: method as any, url, headers: { cookie }, payload });
    return { status: r.statusCode, body: r.body ? r.json() : undefined };
  };
  return req;
}
const track = (id: string) => ({ id, title: `T ${id}`, channelName: 'C', durationSec: 100, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, kind: 'song' });

describe('saved', () => {
  it('saves, lists, checks and removes', async () => {
    const req = await client();
    expect((await req('PUT', '/api/library/saved/aaaaaaaaaaa', track('aaaaaaaaaaa'))).status).toBe(200);
    await req('PUT', '/api/library/saved/bbbbbbbbbbb', track('bbbbbbbbbbb'));
    await req('PUT', '/api/library/saved/aaaaaaaaaaa', track('aaaaaaaaaaa')); // idempotent
    const list = (await req('GET', '/api/library/saved')).body.items;
    expect(list.map((i: any) => i.id).sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(list[0].kind).toBe('song');
    expect((await req('GET', '/api/library/saved/aaaaaaaaaaa')).body).toEqual({ saved: true });
    await req('DELETE', '/api/library/saved/aaaaaaaaaaa');
    expect((await req('GET', '/api/library/saved/aaaaaaaaaaa')).body).toEqual({ saved: false });
    expect((await req('PUT', '/api/library/saved/bad', track('bad'))).status).toBe(400);
  });
});

describe('local playlists', () => {
  it('create, rename, add, reorder, remove, delete', async () => {
    const req = await client();
    const { id } = (await req('POST', '/api/playlists', { name: 'Road trip' })).body;
    for (const v of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) await req('POST', `/api/playlists/${id}/items`, track(v));
    expect((await req('PATCH', `/api/playlists/${id}`, { name: 'Drive' })).status).toBe(200);

    const ids = async () => (await req('GET', `/api/playlists/${id}`)).body.items.map((i: any) => i.id);
    expect(await ids()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    await req('PATCH', `/api/playlists/${id}/items`, { from: 2, to: 1 }); // move up
    expect(await ids()).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    await req('PATCH', `/api/playlists/${id}/items`, { from: 0, to: 1 }); // move down
    expect(await ids()).toEqual(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
    await req('DELETE', `/api/playlists/${id}/items/1`);
    expect(await ids()).toEqual(['ccccccccccc', 'bbbbbbbbbbb']);

    const lists = (await req('GET', '/api/playlists')).body.items;
    expect(lists).toMatchObject([{ id, name: 'Drive', count: 2 }]);

    await req('DELETE', `/api/playlists/${id}`);
    expect((await req('GET', `/api/playlists/${id}`)).status).toBe(404);
    expect((await req('GET', '/api/playlists')).body.items).toEqual([]);
  });

  it('validates input', async () => {
    const req = await client();
    expect((await req('POST', '/api/playlists', { name: '' })).status).toBe(400);
    expect((await req('POST', '/api/playlists/999/items', track('aaaaaaaaaaa'))).status).toBe(404);
  });
});

describe('history', () => {
  it('records plays newest first and keeps the last 500', async () => {
    const req = await client();
    for (let i = 0; i < 503; i++) await req('POST', '/api/history', track(`v${String(i).padStart(10, '0')}`));
    const items = (await req('GET', '/api/history')).body.items;
    expect(items).toHaveLength(500);
    expect(items[0].id).toBe('v0000000502');
  });
});

describe('prefetch', () => {
  it('returns 202 immediately', async () => {
    const req = await client();
    expect((await req('POST', '/api/prefetch/dQw4w9WgXcQ')).status).toBe(202);
    expect((await req('POST', '/api/prefetch/nope')).status).toBe(400);
  });
});
