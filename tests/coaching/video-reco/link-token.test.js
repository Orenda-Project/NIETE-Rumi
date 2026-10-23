'use strict';
/**
 * bd-gzfdu9 (VIDREC): the link to one recommended training clip, /v/<token>. Same scheme as the /cr report link
 * (report-link-token.js) under its OWN label and kind, so a report token never opens a clip and a clip token never
 * opens a report. Pure; crypto only, so the portal can require it.
 */
const ENV = { ...process.env };
const R = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const U = '60530046-7ac3-4ea3-a976-b43c37c23213';
let L;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk/' };
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T08:00:00Z'));
  L = require('../../../bot/shared/services/coaching/video-reco/link-token');
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

test('round trip: the token opens that recommendation for that teacher', () => {
  const t = L.signVideoLink({ recommendationId: R, userId: U });
  expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  expect(L.verifyVideoLink(t)).toEqual({ ok: true, recommendationId: R, userId: U, surface: 'wa' });
});

test('the surface the link was minted for rides in the token (r-ab EVENTS_SCHEMA §2): wa | cr | portal; anything else is wa', () => {
  for (const surface of ['wa', 'cr', 'portal']) {
    expect(L.verifyVideoLink(L.signVideoLink({ recommendationId: R, userId: U, surface })).surface).toBe(surface);
  }
  expect(L.verifyVideoLink(L.signVideoLink({ recommendationId: R, userId: U, surface: 'x' })).surface).toBe('wa');
});

test('the payload is kind vr and carries ids only (no name, no phone)', () => {
  const t = L.signVideoLink({ recommendationId: R, userId: U });
  const p = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8'));
  expect(Object.keys(p).sort()).toEqual(['exp', 'k', 'r', 's', 'u']);
  expect(p.k).toBe('vr');
});

test('lasts 120 days, then expired (not bad)', () => {
  const t = L.signVideoLink({ recommendationId: R, userId: U });
  jest.setSystemTime(new Date('2027-02-17T07:59:00Z'));
  expect(L.verifyVideoLink(t).ok).toBe(true);
  jest.setSystemTime(new Date('2027-02-17T08:00:01Z'));
  expect(L.verifyVideoLink(t)).toEqual({ ok: false, reason: 'expired' });
});

test('any changed byte is bad', () => {
  const t = L.signVideoLink({ recommendationId: R, userId: U });
  const [p, sig] = t.split('.');
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  expect(L.verifyVideoLink(`${flip(p)}.${sig}`)).toEqual({ ok: false, reason: 'bad' });
  expect(L.verifyVideoLink(`${p}.${flip(sig)}`)).toEqual({ ok: false, reason: 'bad' });
});

test('kind vr is not kind cr: a /cr report token never opens a clip, and the reverse', () => {
  const cr = require('../../../bot/shared/services/coaching/report-link-token');
  const reportToken = cr.signReportLink({ sessionId: R, userId: U });
  expect(L.verifyVideoLink(reportToken)).toEqual({ ok: false, reason: 'bad' });
  const clipToken = L.signVideoLink({ recommendationId: R, userId: U });
  expect(cr.verifyReportLink(clipToken)).toEqual({ ok: false, reason: 'bad' });
});

test('another environment (Supabase host) or key cannot open it', () => {
  const t = L.signVideoLink({ recommendationId: R, userId: U });
  process.env.SUPABASE_URL = 'https://other.supabase.co';
  expect(L.verifyVideoLink(t).reason).toBe('bad');
  process.env.SUPABASE_URL = 'https://abc.supabase.co';
  process.env.INTERNAL_API_KEY = 'k2';
  expect(L.verifyVideoLink(t).reason).toBe('bad');
});

test.each([[''], [null], [undefined], ['abc'], ['a.b'], ['x'.repeat(2000)], [42]])('junk %p is bad', (t) => {
  expect(L.verifyVideoLink(t)).toEqual({ ok: false, reason: 'bad' });
});

test('no key, no host or bad ids → no token, and the url is null', () => {
  expect(L.signVideoLink({ recommendationId: 'nope', userId: U })).toBeNull();
  process.env.INTERNAL_API_KEY = '';
  expect(L.signVideoLink({ recommendationId: R, userId: U })).toBeNull();
  expect(L.videoLinkUrl({ recommendationId: R, userId: U })).toBeNull();
});

test('videoLinkUrl is PORTAL_URL/v/<token>; no PORTAL_URL → null', () => {
  const url = L.videoLinkUrl({ recommendationId: R, userId: U });
  expect(url).toMatch(/^https:\/\/portal\.example\.pk\/v\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  process.env.PORTAL_URL = '';
  expect(L.videoLinkUrl({ recommendationId: R, userId: U })).toBeNull();
});
