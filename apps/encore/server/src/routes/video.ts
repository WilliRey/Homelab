import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../index.js';
import { filterShorts } from '../yt/shorts.js';
import { isValidVideoId } from '../yt/ytdlp.js';
import { sendYtError } from './errors.js';

export const videoRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>('/api/video/:id', async (req, reply) => {
    const { id } = req.params;
    if (!isValidVideoId(id)) return reply.code(400).send({ error: 'invalid video id' });
    try {
      const v = await deps.yt.getVideo(id);
      // A video that is itself a Short is never served.
      if (v.durationSec !== undefined && deps.shorts.needsCheck(v) && (await deps.shorts.check(id)) === 'short') {
        return reply.code(422).send({ error: 'Shorts are disabled' });
      }
      return { ...v, related: await filterShorts(v.related, deps.shorts) };
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  });
};
