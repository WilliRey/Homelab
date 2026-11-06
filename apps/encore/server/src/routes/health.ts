import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../index.js';
import { denoVersion, ytdlpVersion } from '../yt/ytdlp.js';

// Spawning yt-dlp/deno on every Docker healthcheck is wasteful; cache versions briefly.
const VERSION_TTL_MS = 10 * 60 * 1000;
let versions: { at: number; ytdlp: string | null; deno: string | null } | null = null;

export function invalidateVersionCache(): void {
  versions = null;
}

async function getVersions() {
  if (!versions || Date.now() - versions.at > VERSION_TTL_MS) {
    const [ytdlp, deno] = await Promise.all([ytdlpVersion(), denoVersion()]);
    versions = { at: Date.now(), ytdlp, deno };
  }
  return versions;
}

async function potProviderUp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('/ping', baseUrl), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const healthRoutes = (deps: AppDeps): FastifyPluginAsync => async (app) => {
  app.get('/api/health', async () => {
    const [v, pot] = await Promise.all([getVersions(), potProviderUp(deps.config.POT_PROVIDER_URL)]);
    let db: 'ok' | 'error' = 'ok';
    try {
      deps.db.prepare('SELECT 1').get();
    } catch {
      db = 'error';
    }
    return {
      ok: db === 'ok',
      ytdlpVersion: v.ytdlp,
      denoVersion: v.deno,
      potProvider: pot ? 'up' : 'down',
      db,
    };
  });
};
