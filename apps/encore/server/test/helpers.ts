import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { buildApp, type AppDeps } from '../src/index.js';

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

export async function makeApp(extra: Partial<AppDeps> = {}) {
  const config = testConfig();
  const db = openDb(config.DATA_DIR, ':memory:');
  const deps = { config, db, ...extra } as AppDeps;
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
