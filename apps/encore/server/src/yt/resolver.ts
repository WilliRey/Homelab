// Resolution cache in front of the yt-dlp adapter.
//
// One `yt-dlp -J` returns every format, so we cache the parsed info once per video
// and derive `<id>:audio` / `<id>:video:<h>` selections from it. Entries live for
// min(expire − 30 min, 5 h). Concurrent requests for the same id share one spawn.
import type { FastifyBaseLogger } from 'fastify';
import { selectAudio, selectVideo, YtdlpError, type ResolvedFormat, type YtdlpInfo } from './ytdlp.js';

const MAX_TTL_MS = 5 * 60 * 60 * 1000;
const EXPIRY_MARGIN_MS = 30 * 60 * 1000;

export type StreamKind = { type: 'audio' } | { type: 'video'; height: number };

export const cacheKey = (id: string, kind: StreamKind) =>
  kind.type === 'audio' ? `${id}:audio` : `${id}:video:${kind.height}`;

type Entry = { info: YtdlpInfo; expiresAt: number };

export type ResolverOptions = {
  fetchInfo: (id: string) => Promise<YtdlpInfo>;
  log?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  now?: () => number;
};

export class Resolver {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry>>();
  private readonly now: () => number;

  constructor(private opts: ResolverOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Resolve the stream URL for a video. `fresh` skips (and replaces) the cache. */
  async resolve(id: string, kind: StreamKind, opts: { fresh?: boolean } = {}): Promise<ResolvedFormat> {
    if (opts.fresh) this.invalidate(id);
    const entry = await this.entry(id);
    const fmt = kind.type === 'audio' ? selectAudio(entry.info) : selectVideo(entry.info, kind.height);
    if (!fmt) {
      const live = entry.info.live_status && entry.info.live_status !== 'not_live' && entry.info.live_status !== 'was_live';
      throw new YtdlpError('unplayable', live ? `video is ${entry.info.live_status}` : `no ${kind.type} format available`);
    }
    return fmt;
  }

  setLogger(log: NonNullable<ResolverOptions['log']>): void {
    this.opts.log = log;
  }

  /** Basic info for a resolved video (title, duration…), if cached. */
  peek(id: string): YtdlpInfo | undefined {
    const e = this.cache.get(id);
    return e && e.expiresAt > this.now() ? e.info : undefined;
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }

  has(id: string): boolean {
    return this.peek(id) !== undefined;
  }

  private entry(id: string): Promise<Entry> {
    const hit = this.cache.get(id);
    if (hit && hit.expiresAt > this.now()) return Promise.resolve(hit);

    const pending = this.inflight.get(id);
    if (pending) return pending;

    const started = this.now();
    const p = this.opts
      .fetchInfo(id)
      .then((info) => {
        const entry: Entry = { info, expiresAt: this.ttlFor(info) };
        this.cache.set(id, entry);
        const audio = selectAudio(info);
        this.opts.log?.info(
          { id, ms: this.now() - started, audioItag: audio?.itag, abr: audio?.abr },
          'resolved',
        );
        return entry;
      })
      .catch((err: unknown) => {
        this.opts.log?.warn({ id, ms: this.now() - started, err: String(err) }, 'resolve failed');
        throw err;
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private ttlFor(info: YtdlpInfo): number {
    const now = this.now();
    const fmt = selectAudio(info) ?? selectVideo(info, 720);
    const byExpiry = fmt ? fmt.expiresAt - EXPIRY_MARGIN_MS : now + MAX_TTL_MS;
    return Math.min(byExpiry, now + MAX_TTL_MS);
  }
}
