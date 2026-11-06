import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { filterShorts } from '../yt/shorts.js';
import type { VideoItem } from '../yt/types.js';
import { sendYtError } from './errors.js';

// Shorts rule 4: `tab` only accepts videos | playlists. There is no way to ask for Shorts.
const Query = z.object({ tab: z.enum(['videos', 'playlists']).default('videos'), next: z.string().max(100).optional() });

export const channelRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>('/api/channel/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) return reply.code(400).send({ error: 'invalid channel id' });
    const q = Query.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'tab must be videos or playlists' });
    try {
      const { channel, page } = await deps.yt.getChannel(id, q.data.tab, q.data.next);
      const items = q.data.tab === 'videos' ? await filterShorts(page.items as VideoItem[], deps.shorts) : page.items;
      const subscribed = !!deps.db.prepare('SELECT 1 FROM subscriptions WHERE channel_id = ?').get(id);
      return { channel: { ...channel, subscribed }, tab: q.data.tab, items, next: page.next };
    } catch (err) {
      return sendYtError(reply, err) ?? Promise.reject(err);
    }
  });
};
