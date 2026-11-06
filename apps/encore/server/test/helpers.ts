import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { buildApp, type AppDeps } from '../src/index.js';
import { Resolver } from '../src/yt/resolver.js';
import { ShortsChecker, type HeadFn } from '../src/yt/shorts.js';

const notInTests = async (): Promise<never> => {
  throw new Error('no YouTube in tests');
};
export const fakeYt = (): AppDeps['yt'] => ({
  search: notInTests, searchSongs: notInTests, suggestions: notInTests, getVideo: notInTests, getBasicInfo: notInTests,
  getChannel: notInTests, getChannelVideos: notInTests, getPlaylist: notInTests, upNext: notInTests, resolveUrl: notInTests,
});

export const TEST_PASSWORD = 'correct horse battery staple';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    APP_PASSWORD: TEST_PASSWORD,
    SESSION_SECRET: 'x'.repeat(64),
    COOKIE_SECURE: 'true',
    DATA_DIR: '/tmp/encore-test',
    POT_PROVIDER_URL: 'http://127.0.0.1:1',
    DISABLE_JOBS: 'true',
    PUBLIC_DIR: '/nonexistent',
    ...overrides,
  });
}

export async function makeApp(extra: Partial<AppDeps> = {}, opts: { head?: HeadFn } = {}) {
  const config = testConfig();
  const db = openDb(config.DATA_DIR, ':memory:');
  const resolver = new Resolver({ fetchInfo: async () => { throw new Error('no yt-dlp in tests'); } });
  const deps: AppDeps = {
    config, db, resolver, yt: fakeYt(),
    shorts: new ShortsChecker(db, opts.head ?? (async () => ({ status: 303, location: 'https://www.youtube.com/watch?v=x' }))),
    ...extra,
  };
  const app = await buildApp(deps, { logger: false });
  return { app, deps };
}

export async function loginCookie(app: Awaited<ReturnType<typeof makeApp>>['app']): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD } });
  const set = res.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : set;
  if (res.statusCode !== 200 || !first) throw new Error(`login failed: ${res.statusCode}`);
  return first.split(';', 1)[0]!;
}
