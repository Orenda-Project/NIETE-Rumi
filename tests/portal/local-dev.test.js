/**
 * Running the portal API on a laptop against the local database (bd-hnhlgn.1).
 *
 * Two settings made a local run impossible without hacks:
 *  - the pg pool always asked for SSL, which a local Postgres does not speak
 *    ("The server does not support SSL connections");
 *  - the session cookie was always Secure + SameSite=None, so over http://localhost the
 *    browser never stored it: login answered 200, the next request said "Not authenticated".
 *
 * Both now relax ONLY for a local run, and production cannot be flipped by accident:
 *  - SSL is dropped only for a loopback DB host — every remote host keeps it;
 *  - the cookie relaxes only when PORTAL_LOCAL_DEV=1 AND SUPABASE_URL is a loopback URL.
 */
const fs = require('fs');
const path = require('path');
const { isLoopbackHost, dbSsl, sessionCookie } = require('../../dashboard/lib/local-dev');

const PROD_URL = 'https://ihzciabopbttygxxgrkm.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', 'localhost', '::1', 'LOCALHOST', '127.0.0.5'])('%s is loopback', (h) => expect(isLoopbackHost(h)).toBe(true));
  it.each(['aws-0-ap-southeast-1.pooler.supabase.com', 'db.abc.supabase.co', '10.0.0.4', 'localhost.evil.com', '', undefined, null])('%s is not', (h) => expect(isLoopbackHost(h)).toBe(false));
});

describe('dbSsl', () => {
  it('keeps SSL for a remote host, unchanged', () => {
    expect(dbSsl('aws-0-ap-southeast-1.pooler.supabase.com')).toEqual({ rejectUnauthorized: false });
  });
  it('keeps SSL when the host is unset', () => {
    expect(dbSsl(undefined)).toEqual({ rejectUnauthorized: false });
  });
  it('drops SSL for a loopback host', () => {
    expect(dbSsl('127.0.0.1')).toBe(false);
  });
});

describe('sessionCookie', () => {
  const base = { SESSION_COOKIE_SAMESITE: undefined };
  it('production: Secure + SameSite=None, as before', () => {
    expect(sessionCookie({ ...base, SUPABASE_URL: PROD_URL })).toMatchObject({ secure: true, sameSite: 'none', httpOnly: true });
  });
  it('honours SESSION_COOKIE_SAMESITE in production', () => {
    expect(sessionCookie({ SUPABASE_URL: PROD_URL, SESSION_COOKIE_SAMESITE: 'lax' })).toMatchObject({ secure: true, sameSite: 'lax' });
  });
  it('PORTAL_LOCAL_DEV=1 alone does not relax it (remote DB)', () => {
    expect(sessionCookie({ PORTAL_LOCAL_DEV: '1', SUPABASE_URL: PROD_URL })).toMatchObject({ secure: true, sameSite: 'none' });
  });
  it('a loopback SUPABASE_URL alone does not relax it', () => {
    expect(sessionCookie({ SUPABASE_URL: LOCAL_URL })).toMatchObject({ secure: true, sameSite: 'none' });
  });
  it('local dev (flag + loopback DB): not Secure, SameSite=Lax, so http://localhost keeps the session', () => {
    expect(sessionCookie({ PORTAL_LOCAL_DEV: '1', SUPABASE_URL: LOCAL_URL })).toMatchObject({ secure: false, sameSite: 'lax', httpOnly: true });
  });
});

describe('wired in', () => {
  it('the pg pool takes its ssl from dbSsl', () => {
    jest.resetModules();
    let cfg;
    jest.doMock('pg', () => ({ Pool: jest.fn(function Pool(c) { cfg = c; this.on = jest.fn(); this.totalCount = 0; this.idleCount = 0; this.waitingCount = 0; }) }));
    const prev = process.env.SUPABASE_DB_HOST;
    process.env.SUPABASE_DB_HOST = '127.0.0.1';
    jest.useFakeTimers();
    try {
      require('../../dashboard/config/database');
      expect(cfg.ssl).toBe(false);
    } finally {
      jest.useRealTimers();
      if (prev === undefined) delete process.env.SUPABASE_DB_HOST; else process.env.SUPABASE_DB_HOST = prev;
      jest.dontMock('pg');
    }
  });
  it('the session middleware takes its cookie from sessionCookie', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../dashboard/index.js'), 'utf8');
    expect(src).toMatch(/cookie:\s*sessionCookie\(process\.env\)/);
    expect(src).not.toMatch(/secure:\s*true,\s*\/\/ HTTPS only/);
  });
});
