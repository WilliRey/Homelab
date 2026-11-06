import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAuthGuard } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { openDb, type DB } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

export type AppDeps = {
  config: Config;
  db: DB;
};

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the built SPA lives: /app/public in the image, ../web/dist in a dev checkout. */
function publicDir(config: Config): string | null {
  const candidates = [config.PUBLIC_DIR, path.join(here, '..', 'public'), path.join(here, '..', '..', 'web', 'dist')];
  return candidates.find((p): p is string => !!p && existsSync(path.join(p, 'index.html'))) ?? null;
}

export async function buildApp(deps: AppDeps, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: opts.logger ?? { level: config.LOG_LEVEL },
    trustProxy: true, // behind tailscale serve; rate limiting needs the real client IP
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuthGuard(app, config);

  await app.register(authRoutes(deps));
  await app.register(healthRoutes(deps));

  const root = publicDir(config);
  if (root) {
    await app.register(fastifyStatic, { root, wildcard: false, index: ['index.html'] });
  } else {
    app.log.warn('no built SPA found; only the API is served');
  }

  // SPA fallback: unknown non-API GETs get index.html so client-side routes work on reload.
  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?', 1)[0]!;
    if (root && req.method === 'GET' && !pathname.startsWith('/api/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not found' });
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.DATA_DIR);
  const app = await buildApp({ config, db });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`listening on ${config.PORT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
