import { z } from 'zod';

// Empty strings in .env mean "unset". `docker run --env-file` (unlike Compose) keeps
// inline comments, so a value that is only a comment counts as unset too.
const blank = (v: unknown) => (typeof v === 'string' && /^\s*(#.*)?$/.test(v) ? undefined : v);
const bool = z.preprocess((v) => {
  const b = blank(v);
  if (b === undefined) return undefined;
  return String(b).toLowerCase() === 'true' || b === '1';
}, z.boolean());

const schema = z.object({
  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be 32+ chars (openssl rand -hex 32)'),
  COOKIE_SECURE: bool.default(true),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('/data'),
  PUBLIC_DIR: z.preprocess(blank, z.string().optional()),
  CACHE_MAX_GB: z.coerce.number().positive().default(10),
  FEED_POLL_MINUTES: z.coerce.number().positive().default(60),
  DEFAULT_VIDEO_HEIGHT: z.coerce.number().int().default(480),
  POT_PROVIDER_URL: z.string().default('http://bgutil:4416'),
  YTDLP_COOKIES_FILE: z.preprocess(blank, z.string().optional()),
  LOG_LEVEL: z.string().default('info'),
  // Turns off background jobs (feed poller, yt-dlp updater). Used by tests.
  DISABLE_JOBS: bool.default(false),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}
