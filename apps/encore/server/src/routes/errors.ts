import type { FastifyReply } from 'fastify';
import { YtdlpError } from '../yt/ytdlp.js';

/** Map adapter errors to HTTP responses. Returns null if the error isn't one of ours. */
export function sendYtError(reply: FastifyReply, err: unknown): FastifyReply | null {
  if (!(err instanceof YtdlpError)) return null;
  const status = { 'bot-check': 503, unavailable: 404, unplayable: 422, timeout: 504, failed: 502 }[err.kind];
  return reply.code(status).send({ error: err.message, kind: err.kind });
}
