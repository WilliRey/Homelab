import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { serveStream } from '../stream/proxy.js';
import type { StreamKind } from '../yt/resolver.js';
import { isValidVideoId } from '../yt/ytdlp.js';
import { sendYtError } from './errors.js';

const Params = z.object({ id: z.string() });
const Query = z.object({
  h: z.coerce.number().int().optional(),
  fresh: z.string().optional(),
});
const ALLOWED_HEIGHTS = [360, 480, 720];

export const streamRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  const handle = (type: 'audio' | 'video') => async (req: any, reply: any) => {
    const { id } = Params.parse(req.params);
    if (!isValidVideoId(id)) return reply.code(400).send({ error: 'invalid video id' });
    const q = Query.parse(req.query);
    const height = ALLOWED_HEIGHTS.includes(q.h ?? -1) ? q.h! : deps.config.DEFAULT_VIDEO_HEIGHT;
    const kind: StreamKind = type === 'audio' ? { type: 'audio' } : { type: 'video', height };

    // ?fresh=1: the client's retry after a playback error. Re-resolve, skipping the cache.
    let forceFresh = q.fresh === '1';
    try {
      return await serveStream(req, reply, {
        label: `${id}:${type}`,
        get: async (fresh) => {
          const f = fresh || forceFresh;
          forceFresh = false;
          return deps.resolver.resolve(id, kind, { fresh: f });
        },
      });
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  };

  app.get('/api/stream/:id/audio', handle('audio'));
  app.get('/api/stream/:id/video', handle('video'));
};
