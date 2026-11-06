import type { FastifyReply } from 'fastify';
import { YtError } from '../yt/types.js';

const STATUS = { 'bot-check': 503, unavailable: 404, unplayable: 422, timeout: 504, 'rate-limited': 503, failed: 502 } as const;

/** Map adapter errors to HTTP responses. Returns null if the error isn't one of ours. */
export function sendYtError(reply: FastifyReply, err: unknown): FastifyReply | null {
  if (!(err instanceof YtError)) return null;
  return reply.code(STATUS[err.kind]).send({ error: err.message, kind: err.kind });
}
