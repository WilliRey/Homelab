import { describe, expect, it } from 'vitest';
import { createSessionToken, passwordMatches, verifySessionToken } from '../src/auth.js';
import { loginCookie, makeApp, TEST_PASSWORD } from './helpers.js';

describe('session tokens', () => {
  const secret = 's'.repeat(64);
  it('round-trips', () => {
    expect(verifySessionToken(createSessionToken(secret), secret)).not.toBeNull();
  });
  it('rejects tampering, wrong secret, and expiry', () => {
    const t = createSessionToken(secret);
    expect(verifySessionToken(t.slice(0, -2) + 'AA', secret)).toBeNull();
    expect(verifySessionToken(t, 'o'.repeat(64))).toBeNull();
    expect(verifySessionToken(createSessionToken(secret, 0), secret)).toBeNull();
    expect(verifySessionToken('garbage', secret)).toBeNull();
  });
  it('compares passwords', () => {
    expect(passwordMatches('a', 'a')).toBe(true);
    expect(passwordMatches('a', 'ab')).toBe(false);
  });
});

describe('auth routes', () => {
  it('returns 401 for protected routes without a cookie', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=x' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login sets a secure, httpOnly, 180-day cookie that unlocks the API', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(200);
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/^encore_session=/);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Max-Age=15552000/);

    const cookie = await loginCookie(app);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ authed: true });
  });

  it('rate-limits login to 5/min', async () => {
    const { app } = await makeApp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' } })).statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it('health is public', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: 'ok', potProvider: 'down' });
  });
});

describe('config', () => {
  it('treats empty and comment-only values as unset', async () => {
    const { testConfig } = await import('./helpers.js');
    expect(testConfig({ YTDLP_COOKIES_FILE: '' }).YTDLP_COOKIES_FILE).toBeUndefined();
    expect(testConfig({ YTDLP_COOKIES_FILE: '   # optional' }).YTDLP_COOKIES_FILE).toBeUndefined();
    expect(testConfig({ YTDLP_COOKIES_FILE: '/data/cookies.txt' }).YTDLP_COOKIES_FILE).toBe('/data/cookies.txt');
  });
});
