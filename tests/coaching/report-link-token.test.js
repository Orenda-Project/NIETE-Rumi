'use strict';
/**
 * v10 coaching test (bd-v0toag.18): the link to one coaching report. It opens that one report,
 * read-only, and lasts (120 days), unlike the 24 h sign-in links. Pure; crypto only, so the portal
 * can require it.
 */
const ENV = { ...process.env };
const S = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
let L;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk/' };
  jest.useFakeTimers().setSystemTime(new Date('2026-10-19T08:00:00Z'));
  L = require('../../bot/shared/services/coaching/report-link-token');
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

test('round trip: the token opens that session for that teacher', () => {
  const t = L.signReportLink({ sessionId: S, userId: U });
  expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  expect(L.verifyReportLink(t)).toEqual({ ok: true, sessionId: S, userId: U });
});

test('lasts 120 days, then expired (not bad)', () => {
  const t = L.signReportLink({ sessionId: S, userId: U });
  jest.setSystemTime(new Date('2027-02-15T07:59:00Z'));
  expect(L.verifyReportLink(t).ok).toBe(true);
  jest.setSystemTime(new Date('2027-02-16T08:00:01Z'));
  expect(L.verifyReportLink(t)).toEqual({ ok: false, reason: 'expired' });
});

test('any changed byte is bad', () => {
  const t = L.signReportLink({ sessionId: S, userId: U });
  const [p, sig] = t.split('.');
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  expect(L.verifyReportLink(`${flip(p)}.${sig}`)).toEqual({ ok: false, reason: 'bad' });
  expect(L.verifyReportLink(`${p}.${flip(sig)}`)).toEqual({ ok: false, reason: 'bad' });
});

test('another environment (Supabase host) or key cannot open it', () => {
  const t = L.signReportLink({ sessionId: S, userId: U });
  process.env.SUPABASE_URL = 'https://other.supabase.co';
  expect(L.verifyReportLink(t).reason).toBe('bad');
  process.env.SUPABASE_URL = 'https://abc.supabase.co';
  process.env.INTERNAL_API_KEY = 'k2';
  expect(L.verifyReportLink(t).reason).toBe('bad');
});

test('a token of another family with the same shape is bad', () => {
  const crypto = require('crypto');
  const b64 = (b) => Buffer.from(b).toString('base64url');
  const payload = b64(JSON.stringify({ k: 't', u: U, s: S, exp: 9999999999 }));
  const sig = crypto.createHmac('sha256', 'k1').update(payload).digest('base64url').slice(0, 22);
  expect(L.verifyReportLink(`${payload}.${sig}`).reason).toBe('bad');
});

test.each([[''], [null], [undefined], ['abc'], ['a.b'], ['x'.repeat(2000)], [42]])('junk %p is bad', (t) => {
  expect(L.verifyReportLink(t)).toEqual({ ok: false, reason: 'bad' });
});

test('no key or no Supabase host: sign null, verify bad', () => {
  const t = L.signReportLink({ sessionId: S, userId: U });
  delete process.env.INTERNAL_API_KEY;
  expect(L.signReportLink({ sessionId: S, userId: U })).toBeNull();
  expect(L.verifyReportLink(t).reason).toBe('bad');
  process.env.INTERNAL_API_KEY = 'k1';
  process.env.SUPABASE_URL = 'not a url';
  expect(L.signReportLink({ sessionId: S, userId: U })).toBeNull();
});

test('ids must be uuids', () => {
  expect(L.signReportLink({ sessionId: 'x', userId: U })).toBeNull();
  expect(L.signReportLink({ sessionId: S, userId: '' })).toBeNull();
  expect(L.signReportLink(null)).toBeNull();
});

test('reportLinkUrl: PORTAL_URL + /cr/<token>; null without PORTAL_URL or key', () => {
  const url = L.reportLinkUrl({ sessionId: S, userId: U });
  expect(url).toMatch(/^https:\/\/portal\.example\.pk\/cr\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  expect(L.verifyReportLink(url.split('/cr/')[1]).ok).toBe(true);
  delete process.env.PORTAL_URL;
  expect(L.reportLinkUrl({ sessionId: S, userId: U })).toBeNull();
  process.env.PORTAL_URL = 'https://p.pk';
  delete process.env.INTERNAL_API_KEY;
  expect(L.reportLinkUrl({ sessionId: S, userId: U })).toBeNull();
});

test('REPORT_PATH is /cr', () => {
  expect(L.REPORT_PATH).toBe('/cr');
});
