// Shorts removal (PLAN.md section 7). Rules, in order:
//  1. Node type  — innertube.ts drops Shorts node types and shelves (helpers below).
//  2. URL        — anything whose endpoint/URL contains /shorts/ is dropped (isShortsUrl).
//  3. Ambiguous  — items ≤ 180 s or of unknown length get `HEAD /shorts/<id>`:
//                  200 = Short, 3xx → /watch = normal. Cached forever in shorts_check.
//                  (Verified live 2026-11-06: Shorts answer 200, normal videos 303 → /watch.)
//  4. Channel pages only request Videos and Playlists tabs (innertube.ts).
//  5. Subscription feed uses the UULF long-form playlist (jobs/feedPoller.ts).
//  6. /api/resolve rejects /shorts/ URLs with 422 (routes/search.ts).
//  7. The UI has no Shorts anywhere.
import type { DB } from '../db/index.js';
import { Semaphore } from './ytdlp.js';
import type { VideoItem } from './types.js';

// ---- Rule 1 -----------------------------------------------------------------

const SHORTS_NODE_TYPES = new Set(['ShortsLockupView', 'ReelItem', 'ReelShelf', 'ReelPlayerOverlay', 'ShortsLockupViewModel']);

export function isShortsNodeType(type: string | undefined): boolean {
  return !!type && SHORTS_NODE_TYPES.has(type);
}

export function isShortsShelfTitle(title: string | undefined): boolean {
  return !!title && /^\s*shorts\s*$/i.test(title);
}

// ---- Rule 2 -----------------------------------------------------------------

export function isShortsUrl(url: string | undefined): boolean {
  return !!url && /(^|[/.])youtube\.com\/shorts\/|^\/shorts\/|\/shorts\//i.test(url);
}

// ---- Rule 3 -----------------------------------------------------------------

export const AMBIGUOUS_MAX_SEC = 180;
const CHECK_TIMEOUT_MS = 3000;

export type ShortsVerdict = 'short' | 'video' | 'unknown';

export type HeadFn = (url: string, signal: AbortSignal) => Promise<{ status: number; location: string | null }>;

const defaultHead: HeadFn = async (url, signal) => {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal });
  return { status: res.status, location: res.headers.get('location') };
};

export function verdictFrom(status: number, location: string | null): ShortsVerdict {
  if (status === 200) return 'short';
  if (status >= 300 && status < 400 && location && /\/watch\?/.test(location)) return 'video';
  return 'unknown'; // consent pages, rate limits, …: keep the item, don't cache
}

export class ShortsChecker {
  private slots = new Semaphore(4);
  private inflight = new Map<string, Promise<ShortsVerdict>>();

  constructor(private readonly db: DB, private readonly head: HeadFn = defaultHead) {}

  needsCheck(item: VideoItem): boolean {
    return item.durationSec === undefined || item.durationSec <= AMBIGUOUS_MAX_SEC;
  }

  cached(id: string): boolean | undefined {
    const row = this.db.prepare('SELECT is_short FROM shorts_check WHERE video_id = ?').get(id) as { is_short: number } | undefined;
    return row ? row.is_short === 1 : undefined;
  }

  async check(id: string): Promise<ShortsVerdict> {
    const hit = this.cached(id);
    if (hit !== undefined) return hit ? 'short' : 'video';
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const p = this.slots
      .use(async () => {
        try {
          const r = await this.head(`https://www.youtube.com/shorts/${id}`, AbortSignal.timeout(CHECK_TIMEOUT_MS));
          return verdictFrom(r.status, r.location);
        } catch {
          return 'unknown' as const; // timeout or network error: keep the item
        }
      })
      .then((v) => {
        if (v !== 'unknown') {
          this.db
            .prepare('INSERT OR REPLACE INTO shorts_check (video_id, is_short, checked_at) VALUES (?, ?, ?)')
            .run(id, v === 'short' ? 1 : 0, Date.now());
        }
        return v;
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  /** Record a verdict learned elsewhere (e.g. a node typed as a Short). */
  remember(id: string, isShort: boolean): void {
    this.db
      .prepare('INSERT OR IGNORE INTO shorts_check (video_id, is_short, checked_at) VALUES (?, ?, ?)')
      .run(id, isShort ? 1 : 0, Date.now());
  }
}

/**
 * Every endpoint that returns VideoItem[] calls this. Songs from YouTube Music skip
 * the HEAD check (`kind: 'song'`): YT Music never returns Shorts.
 */
export async function filterShorts(items: VideoItem[], checker: ShortsChecker): Promise<VideoItem[]> {
  const verdicts = await Promise.all(
    items.map((it) => (it.kind === 'song' || !checker.needsCheck(it) ? Promise.resolve<ShortsVerdict>('video') : checker.check(it.id))),
  );
  return items.filter((_, i) => verdicts[i] !== 'short');
}
