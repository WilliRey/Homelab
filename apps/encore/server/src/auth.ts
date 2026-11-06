import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

export const SESSION_COOKIE = 'encore_session';
const SESSION_DAYS = 180;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** Routes reachable without a session. Everything else under /api/ needs one. */
const PUBLIC_API = new Set(['/api/auth/login', '/api/health']);

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function passwordMatches(given: string, expected: string): boolean {
  // Digests are fixed-length, so timingSafeEqual never throws and length doesn't leak.
  return timingSafeEqual(sha256(given), sha256(expected));
}

type Session = { iat: number; exp: number };

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + SESSION_MS } satisfies Session)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(payload, secret), 'base64url');
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    if (typeof s.exp !== 'number' || s.exp < now) return null;
    return s;
  } catch {
    return null;
  }
}

export function isAuthed(req: FastifyRequest, config: Config): boolean {
  return verifySessionToken(req.cookies[SESSION_COOKIE], config.SESSION_SECRET) !== null;
}

/** Guard: every /api/* route except login and health requires a valid session. */
export function registerAuthGuard(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const pathname = req.url.split('?', 1)[0]!;
    if (!pathname.startsWith('/api/') || PUBLIC_API.has(pathname)) return;
    if (!isAuthed(req, config)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
}

export function setSessionCookie(reply: FastifyReply, config: Config): void {
  reply.setCookie(SESSION_COOKIE, createSessionToken(config.SESSION_SECRET), {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/' });
}
