// ADAPTER: the only module that spawns yt-dlp (and its JS runtime, Deno).
// Everything else gets normalized ResolvedFormat objects.
import { spawn } from 'node:child_process';

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const isValidVideoId = (id: string): boolean => VIDEO_ID_RE.test(id);

const RESOLVE_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT = 3; // i5-6500T: each resolution burns 1–4 s of CPU in Deno
const BOT_CHECK_TEXT = "Sign in to confirm you're not a bot";

// ---------------------------------------------------------------------------
// Process helpers

export type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Spawn with an argument array (never a shell string). Kills the process after `timeoutMs`. */
export function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Simple counting semaphore. */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const ytdlpSlots = new Semaphore(MAX_CONCURRENT);

export async function ytdlpVersion(): Promise<string | null> {
  const r = await run('yt-dlp', ['--version'], 10_000);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function denoVersion(): Promise<string | null> {
  const r = await run('deno', ['--version'], 10_000);
  if (r.code !== 0) return null;
  return /deno (\S+)/.exec(r.stdout)?.[1] ?? r.stdout.split('\n')[0]!.trim();
}

// ---------------------------------------------------------------------------
// Status surfaced in /api/health

export const ytdlpStatus = {
  /** Epoch ms of the last "not a bot" challenge, or null. */
  lastBotCheckAt: null as number | null,
  lastError: null as string | null,
  lastSuccessAt: null as number | null,
  spawns: 0,
};

// ---------------------------------------------------------------------------
// Types

/** The subset of `yt-dlp -J` output we read. */
export type YtdlpFormat = {
  format_id: string;
  url: string;
  protocol?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  abr?: number | null;
  tbr?: number | null;
  height?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  http_headers?: Record<string, string>;
};

export type YtdlpInfo = {
  id: string;
  title?: string;
  duration?: number;
  channel?: string;
  channel_id?: string;
  live_status?: string;
  formats?: YtdlpFormat[];
};

export type ResolvedFormat = {
  url: string;
  headers: Record<string, string>;
  /** Content length in bytes when yt-dlp knows it. */
  size?: number;
  mime: 'audio/mp4' | 'video/mp4';
  /** Epoch ms when googlevideo stops honouring the URL. */
  expiresAt: number;
  itag: string;
  height?: number;
  abr?: number;
};

export type ErrorKind = 'bot-check' | 'unavailable' | 'unplayable' | 'timeout' | 'failed';

export class YtdlpError extends Error {
  constructor(readonly kind: ErrorKind, message: string) {
    super(message);
    this.name = 'YtdlpError';
  }
}

// ---------------------------------------------------------------------------
// Format selection (pure; unit-tested against a saved fixture)

const DEFAULT_TTL_MS = 5 * 60 * 60 * 1000;

export function expiryOf(url: string, now = Date.now()): number {
  try {
    const exp = Number(new URL(url).searchParams.get('expire'));
    if (Number.isFinite(exp) && exp > 0) return exp * 1000;
  } catch {
    /* fall through */
  }
  return now + DEFAULT_TTL_MS;
}

function toResolved(f: YtdlpFormat, mime: ResolvedFormat['mime']): ResolvedFormat {
  const size = f.filesize ?? f.filesize_approx ?? undefined;
  return {
    url: f.url,
    headers: f.http_headers ?? {},
    size: size && size > 0 ? Math.round(size) : undefined,
    mime,
    expiresAt: expiryOf(f.url),
    itag: f.format_id,
    height: f.height ?? undefined,
    abr: f.abr ?? undefined,
  };
}

const httpsOnly = (info: YtdlpInfo) => (info.formats ?? []).filter((f) => f.protocol === 'https' && !!f.url);

/** Highest-bitrate AAC (mp4a) audio-only format, usually itag 140. */
export function selectAudio(info: YtdlpInfo): ResolvedFormat | null {
  const candidates = httpsOnly(info).filter((f) => f.vcodec === 'none' && (f.acodec ?? '').startsWith('mp4a'));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));
  return toResolved(candidates[0]!, 'audio/mp4');
}

/** Video-only H.264 (avc1): highest height ≤ h, else the lowest available. */
export function selectVideo(info: YtdlpInfo, h: number): ResolvedFormat | null {
  const candidates = httpsOnly(info).filter(
    (f) => f.acodec === 'none' && (f.vcodec ?? '').startsWith('avc1') && typeof f.height === 'number',
  );
  if (!candidates.length) return null;
  const under = candidates.filter((f) => f.height! <= h).sort((a, b) => b.height! - a.height! || (b.tbr ?? 0) - (a.tbr ?? 0));
  if (under.length) return toResolved(under[0]!, 'video/mp4');
  candidates.sort((a, b) => a.height! - b.height!);
  return toResolved(candidates[0]!, 'video/mp4');
}

// ---------------------------------------------------------------------------
// Spawning

export type FetchInfoOptions = { potProviderUrl: string; cookiesFile?: string };

export function buildArgs(id: string, opts: FetchInfoOptions): string[] {
  const args = [
    '-J',
    '--no-playlist',
    '--no-warnings',
    '--extractor-args',
    `youtubepot-bgutilhttp:base_url=${opts.potProviderUrl}`,
  ];
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile);
  args.push('--', `https://www.youtube.com/watch?v=${id}`);
  return args;
}

export function classifyFailure(stderr: string, timedOut: boolean): YtdlpError {
  if (timedOut) return new YtdlpError('timeout', `yt-dlp timed out after ${RESOLVE_TIMEOUT_MS / 1000}s`);
  const line = stderr.split('\n').find((l) => l.includes('ERROR')) ?? stderr.trim().split('\n').pop() ?? 'yt-dlp failed';
  if (stderr.includes(BOT_CHECK_TEXT)) return new YtdlpError('bot-check', line);
  if (/Video unavailable|Private video|has been removed|This video is not available/i.test(stderr)) {
    return new YtdlpError('unavailable', line);
  }
  if (/live event will begin|Premieres in|is_upcoming/i.test(stderr)) return new YtdlpError('unplayable', line);
  return new YtdlpError('failed', line);
}

/** Run `yt-dlp -J` for one video. At most 3 run at once; each is killed after 30 s. */
export async function fetchInfo(id: string, opts: FetchInfoOptions): Promise<YtdlpInfo> {
  if (!isValidVideoId(id)) throw new YtdlpError('failed', 'invalid video id');
  return ytdlpSlots.use(async () => {
    ytdlpStatus.spawns++;
    const r = await run('yt-dlp', buildArgs(id, opts), RESOLVE_TIMEOUT_MS);
    if (r.code !== 0) {
      const err = classifyFailure(r.stderr, r.timedOut);
      if (err.kind === 'bot-check') ytdlpStatus.lastBotCheckAt = Date.now();
      ytdlpStatus.lastError = err.message;
      throw err;
    }
    try {
      const info = JSON.parse(r.stdout) as YtdlpInfo;
      ytdlpStatus.lastSuccessAt = Date.now();
      return info;
    } catch {
      throw new YtdlpError('failed', 'yt-dlp printed invalid JSON');
    }
  });
}
