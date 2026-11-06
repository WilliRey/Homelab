import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../index.js';
import { filterShorts } from '../yt/shorts.js';
import { isValidVideoId } from '../yt/ytdlp.js';
import { sendYtError } from './errors.js';

export const musicRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>('/api/music/upnext/:id', async (req, reply) => {
    const { id } = req.params;
    if (!isValidVideoId(id)) return reply.code(400).send({ error: 'invalid video id' });
    try {
      const items = await deps.yt.upNext(id);
      return { items: await filterShorts(items, deps.shorts) };
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  });
};
