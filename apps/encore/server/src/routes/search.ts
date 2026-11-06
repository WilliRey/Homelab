import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { filterShorts, isShortsUrl } from '../yt/shorts.js';
import type { ResolvedUrl, VideoItem } from '../yt/types.js';
import { sendYtError } from './errors.js';

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(['songs', 'videos', 'channels', 'playlists']).default('songs'),
  next: z.string().max(100).optional(),
});

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const ID = /^[A-Za-z0-9_-]{11}$/;

/** Parse the common URL shapes locally; anything else (e.g. @handles) goes to the adapter. */
export function parseYouTubeUrl(raw: string): ResolvedUrl | 'shorts' | 'unsupported' | 'lookup' {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return 'unsupported';
  }
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) return 'unsupported';
  if (isShortsUrl(u.pathname) || /^\/shorts\//i.test(u.pathname)) return 'shorts'; // Shorts rule 6
  if (u.hostname.endsWith('youtu.be')) {
    const id = u.pathname.slice(1).split('/')[0] ?? '';
    return ID.test(id) ? { type: 'video', id, playlistId: u.searchParams.get('list') ?? undefined } : 'unsupported';
  }
  const v = u.searchParams.get('v');
  if (u.pathname === '/watch' && v && ID.test(v)) return { type: 'video', id: v, playlistId: u.searchParams.get('list') ?? undefined };
  const live = /^\/(?:live|embed|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
  if (live) return { type: 'video', id: live[1]! };
  const list = u.searchParams.get('list');
  if (u.pathname === '/playlist' && list) return { type: 'playlist', id: list };
  const ch = /^\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(u.pathname);
  if (ch) return { type: 'channel', id: ch[1]! };
  if (/^\/(@[^/]+|c\/[^/]+|user\/[^/]+)/.test(u.pathname)) return 'lookup';
  return 'unsupported';
}

export const searchRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.get('/api/search', async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'q is required' });
    const { q, type, next } = parsed.data;
    try {
      if (type === 'songs') {
        const page = await deps.yt.searchSongs(q, next);
        return { ...page, items: await filterShorts(page.items, deps.shorts) };
      }
      const page = await deps.yt.search(q, type, next);
      if (type === 'videos') return { ...page, items: await filterShorts(page.items as VideoItem[], deps.shorts) };
      return page;
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  });

  app.get('/api/suggest', async (req, reply) => {
    const q = z.object({ q: z.string().trim().max(200).default('') }).parse(req.query).q;
    if (!q) return [];
    try {
      return await deps.yt.suggestions(q);
    } catch (err) {
      req.log.warn({ err: String(err) }, 'suggest failed');
      return []; // suggestions are best-effort
    }
  });

  app.get('/api/resolve', async (req, reply) => {
    const url = z.object({ url: z.string().trim().min(1).max(2000) }).safeParse(req.query);
    if (!url.success) return reply.code(400).send({ error: 'url is required' });
    const local = parseYouTubeUrl(url.data.url);
    if (local === 'shorts') return reply.code(422).send({ error: 'Shorts are disabled' });
    if (local === 'unsupported') return reply.code(400).send({ error: 'not a YouTube link' });
    if (local !== 'lookup') return local;
    try {
      const r = await deps.yt.resolveUrl(url.data.url);
      if (!r) return reply.code(422).send({ error: 'unsupported or Shorts link' });
      return r;
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  });
};
