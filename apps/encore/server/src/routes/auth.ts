import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, isAuthed, passwordMatches, setSessionCookie } from '../auth.js';
import type { AppDeps } from '../index.js';

const LoginBody = z.object({ password: z.string().min(1).max(1024) });

export const authRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  const { config } = deps;

  app.post('/api/auth/login', {
    config: { rateLimit: { max: config.LOGIN_RATE_PER_MIN, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success || !passwordMatches(body.data.password, config.APP_PASSWORD)) {
      return reply.code(401).send({ error: 'wrong password' });
    }
    setSessionCookie(reply, config);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  // The guard already rejected unauthenticated requests; reaching here means logged in.
  app.get('/api/auth/me', async (req) => ({ authed: isAuthed(req, config) }));
};
