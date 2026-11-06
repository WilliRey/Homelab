import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { filterShorts } from '../yt/shorts.js';
import { sendYtError } from './errors.js';

export const playlistRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  // YouTube playlists (local playlists live under /api/playlists).
  app.get<{ Params: { id: string } }>('/api/playlist/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return reply.code(400).send({ error: 'invalid playlist id' });
    const next = z.object({ next: z.string().max(100).optional() }).parse(req.query).next;
    try {
      const pl = await deps.yt.getPlaylist(id, next);
      return { ...pl, items: await filterShorts(pl.items, deps.shorts) };
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  });
};
