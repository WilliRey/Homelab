// Range-capable media proxy to googlevideo.
//
// googlevideo URLs are bound to the IP that resolved them, so every byte goes through
// here. iOS will not play media without correct Range handling: it opens with
// `bytes=0-1`, then issues (and cancels) many range requests while seeking.
import { Readable } from 'node:stream';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { Agent, EnvHttpProxyAgent, request, type Dispatcher } from 'undici';
import type { ResolvedFormat } from '../yt/ytdlp.js';

/** googlevideo throttles or refuses large unbounded ranges; never ask for more than this at once. */
export const CHUNK_BYTES = 10 * 1024 * 1024;

// Honour HTTPS_PROXY when set (dev sandboxes); otherwise a plain keep-alive agent.
const dispatcher: Dispatcher =
  process.env.HTTPS_PROXY || process.env.https_proxy ? new EnvHttpProxyAgent() : new Agent({ keepAliveTimeout: 30_000 });

// ---------------------------------------------------------------------------
// Range parsing (pure)

export type ParsedRange =
  | { kind: 'none' }
  | { kind: 'range'; start: number; end?: number }
  | { kind: 'suffix'; length: number }
  | { kind: 'multi' }
  | { kind: 'invalid' };

export function parseRange(header: string | undefined): ParsedRange {
  if (header === undefined || header.trim() === '') return { kind: 'none' };
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!m) return { kind: 'invalid' };
  const spec = m[1]!.trim();
  if (spec.includes(',')) return { kind: 'multi' };
  const r = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!r) return { kind: 'invalid' };
  const [, a, b] = r;
  if (a === '' && b === '') return { kind: 'invalid' };
  if (a === '') {
    const length = Number(b);
    return length > 0 ? { kind: 'suffix', length } : { kind: 'invalid' };
  }
  const start = Number(a);
  if (b === '') return { kind: 'range', start };
  const end = Number(b);
  if (end < start) return { kind: 'invalid' };
  return { kind: 'range', start, end };
}

/** Clamp a requested range to the 10 MB upstream cap and to the file size when known. */
export function capRange(start: number, end: number | undefined, total: number | undefined): { start: number; end: number } {
  let capped = Math.min(end ?? Number.POSITIVE_INFINITY, start + CHUNK_BYTES - 1);
  if (total !== undefined) capped = Math.min(capped, total - 1);
  return { start, end: capped };
}

/** Parse `bytes start-end/total` (total may be `*`). */
export function parseContentRange(h: string | undefined): { start: number; end: number; total?: number } | null {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(h?.trim() ?? '');
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? undefined : Number(m[3]) };
}

// ---------------------------------------------------------------------------
// Upstream

export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`upstream ${status}`);
  }
}

type Upstream = { status: number; contentRange: ReturnType<typeof parseContentRange>; body: Dispatcher.ResponseData['body'] };

const MAX_REDIRECTS = 3;

async function fetchRange(fmt: ResolvedFormat, start: number, end: number, signal: AbortSignal): Promise<Upstream> {
  // googlevideo load-balances with 302s to other rr*---sn-* hosts; follow them with the
  // same headers and Range (undici's request() doesn't follow redirects by itself).
  let url = fmt.url;
  for (let hop = 0; ; hop++) {
    const res = await request(url, {
      method: 'GET',
      dispatcher,
      signal,
      headers: { ...fmt.headers, range: `bytes=${start}-${end}`, 'accept-encoding': 'identity' },
      headersTimeout: 15_000,
      bodyTimeout: 30_000,
    });
    const loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc && hop < MAX_REDIRECTS) {
      await res.body.dump().catch(() => undefined);
      url = new URL(Array.isArray(loc) ? loc[0]! : loc, url).toString();
      continue;
    }
    const cr = res.headers['content-range'];
    return { status: res.statusCode, contentRange: parseContentRange(Array.isArray(cr) ? cr[0] : cr), body: res.body };
  }
}

export type FormatSource = {
  /** Resolve the format; `fresh` forces yt-dlp to run again. */
  get(fresh: boolean): Promise<ResolvedFormat>;
  label: string;
};

/**
 * Fetch one upstream range. On 403/410 (expired or IP-mismatched URL) re-resolve once
 * and retry; a second failure throws UpstreamError(502).
 */
async function fetchWithRetry(
  src: FormatSource,
  fmt: ResolvedFormat,
  start: number,
  end: number,
  signal: AbortSignal,
  log: FastifyBaseLogger,
): Promise<{ up: Upstream; fmt: ResolvedFormat }> {
  let current = fmt;
  for (let attempt = 0; attempt < 2; attempt++) {
    let up: Upstream;
    try {
      up = await fetchRange(current, start, end, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      log.warn({ stream: src.label, err: String(err), start, end, attempt }, 'upstream request failed');
      throw new UpstreamError(502);
    }
    if (up.status === 200 || up.status === 206) return { up, fmt: current };
    await up.body.dump().catch(() => undefined);
    log.warn({ stream: src.label, status: up.status, start, end, attempt }, 'upstream non-2xx');
    if (up.status === 416) throw new UpstreamError(416);
    if ((up.status === 403 || up.status === 410) && attempt === 0) {
      current = await src.get(true);
      continue;
    }
    throw new UpstreamError(502);
  }
  throw new UpstreamError(502);
}

// ---------------------------------------------------------------------------
// The handler

export async function serveStream(req: FastifyRequest, reply: FastifyReply, src: FormatSource): Promise<FastifyReply> {
  const range = parseRange(req.headers.range);
  if (range.kind === 'multi' || range.kind === 'invalid') {
    return reply.code(416).header('accept-ranges', 'bytes').send();
  }

  // Abort upstream work when the client goes away. iOS opens and cancels many range
  // requests. (The plan names request.raw 'close'; on Node ≥16 that also fires once a
  // request body is consumed, so we watch the response socket instead.)
  const ac = new AbortController();
  const onClose = () => {
    if (!reply.raw.writableFinished) ac.abort();
  };
  reply.raw.on('close', onClose);

  let fmt = await src.get(false);
  let total = fmt.size;

  const baseHeaders = (f: ResolvedFormat) => ({
    'accept-ranges': 'bytes',
    'content-type': f.mime,
    'cache-control': 'no-store',
  });

  try {
    if (range.kind === 'none') {
      // Rare for media elements: stream the whole file as 10 MB upstream chunks.
      const first = await fetchWithRetry(src, fmt, 0, CHUNK_BYTES - 1, ac.signal, req.log);
      fmt = first.fmt;
      total = first.up.contentRange?.total ?? total;
      if (total === undefined) {
        // Upstream ignored Range and sent everything: just relay it.
        return reply.code(200).headers(baseHeaders(fmt)).send(first.up.body);
      }
      const firstEnd = first.up.contentRange?.end ?? Math.min(CHUNK_BYTES, total) - 1;
      const knownTotal = total;
      const body = Readable.from(
        (async function* () {
          for await (const c of first.up.body) yield c as Buffer;
          let pos = firstEnd + 1;
          while (pos < knownTotal) {
            const { start, end } = capRange(pos, undefined, knownTotal);
            const next = await fetchWithRetry(src, fmt, start, end, ac.signal, req.log);
            fmt = next.fmt;
            for await (const c of next.up.body) yield c as Buffer;
            pos = end + 1;
          }
        })(),
      );
      return reply.code(200).headers({ ...baseHeaders(fmt), 'content-length': String(knownTotal) }).send(body);
    }

    let start: number;
    let end: number | undefined;
    if (range.kind === 'suffix') {
      if (total === undefined) {
        const probe = await fetchWithRetry(src, fmt, 0, 0, ac.signal, req.log);
        await probe.up.body.dump().catch(() => undefined);
        fmt = probe.fmt;
        total = probe.up.contentRange?.total;
        if (total === undefined) throw new UpstreamError(502);
      }
      start = Math.max(0, total - range.length);
      end = total - 1;
    } else {
      start = range.start;
      end = range.end;
    }

    if (total !== undefined && start >= total) {
      return reply.code(416).headers({ 'accept-ranges': 'bytes', 'content-range': `bytes */${total}` }).send();
    }

    const capped = capRange(start, end, total);
    const got = await fetchWithRetry(src, fmt, capped.start, capped.end, ac.signal, req.log);
    fmt = got.fmt;
    const cr = got.up.contentRange;
    if (got.up.status === 200 || !cr) {
      // Upstream ignored the Range header; we can't honour a partial request safely.
      await got.up.body.dump().catch(() => undefined);
      throw new UpstreamError(502);
    }
    const realTotal = cr.total ?? total;
    return reply
      .code(206)
      .headers({
        ...baseHeaders(fmt),
        'content-range': `bytes ${cr.start}-${cr.end}/${realTotal ?? '*'}`,
        'content-length': String(cr.end - cr.start + 1),
      })
      .send(got.up.body);
  } catch (err) {
    if (ac.signal.aborted) return reply; // client left; nothing to send
    if (err instanceof UpstreamError) {
      if (err.status === 416) {
        return reply.code(416).headers({ 'accept-ranges': 'bytes', ...(total ? { 'content-range': `bytes */${total}` } : {}) }).send();
      }
      return reply.code(502).send({ error: 'upstream refused the stream' });
    }
    throw err;
  }
}
