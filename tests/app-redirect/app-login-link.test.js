'use strict';
/**
 * bd-fmf24g.35 — the one-tap login link a pilot teacher gets in place of a feature on WhatsApp.
 * The token is ENCRYPTED (AES-256-GCM), so the user id never appears in the URL, not even encoded;
 * 24 h; re-tappable (nothing is consumed).
 */
const ENV = { ...process.env };
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  jest.useFakeTimers().setSystemTime(new Date('2026-10-10T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const load = () => require('../../bot/shared/services/app-login-link');

test('sign → verify round-trips the user and the feature', () => {
  const { signAppLink, verifyAppLink } = load();
  const t = signAppLink(USER, 'lesson_plan');
  expect(verifyAppLink(t)).toEqual(expect.objectContaining({ u: USER, f: 'lesson_plan' }));
});

test('the user id is nowhere in the token, in the clear or as plain base64', () => {
  const { signAppLink } = load();
  const t = signAppLink(USER, 'menu');
  expect(t).not.toContain(USER);
  expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain(USER);
  expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
});

test('re-tappable: the same token verifies again 23 h later', () => {
  const { signAppLink, verifyAppLink } = load();
  const t = signAppLink(USER, 'menu');
  expect(verifyAppLink(t)).not.toBeNull();
  jest.setSystemTime(new Date('2026-10-11T08:59:00Z'));
  expect(verifyAppLink(t)).not.toBeNull();
  expect(verifyAppLink(t)).not.toBeNull();
});

test('an expired token (24 h + 1 s) is refused', () => {
  const { signAppLink, verifyAppLink } = load();
  const t = signAppLink(USER, 'menu');
  jest.setSystemTime(new Date('2026-10-11T10:00:01Z'));
  expect(verifyAppLink(t)).toBeNull();
});

test('a tampered token is refused, whichever byte changes', () => {
  const { signAppLink, verifyAppLink } = load();
  const t = signAppLink(USER, 'menu');
  for (const i of [0, 5, 14, Math.floor(t.length / 2), t.length - 1]) {
    const flipped = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
    expect(verifyAppLink(flipped)).toBeNull();
  }
  expect(verifyAppLink(t + 'A')).toBeNull();
  expect(verifyAppLink(t.slice(0, -2))).toBeNull();
});

test('a token minted under another key is refused', () => {
  const { signAppLink } = load();
  const t = signAppLink(USER, 'menu');
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'a-different-key';
  expect(load().verifyAppLink(t)).toBeNull();
});

// The area-scoped portal-link family is not on every branch yet; where it is absent there is nothing to confuse.
const HAS_LINK_FAMILY = (() => { try { require.resolve('../../bot/shared/services/portal-link-token'); return true; } catch (_) { return false; } })();
(HAS_LINK_FAMILY ? test : test.skip)('a token from the portal-link family (or the web quiz) never passes', () => {
  const { verifyAppLink } = load();
  const portal = require('../../bot/shared/services/portal-link-token').signPortalLink(USER, 'training');
  expect(portal).toBeTruthy();
  expect(verifyAppLink(portal)).toBeNull();
});

test('garbage in, null out', () => {
  const { verifyAppLink } = load();
  for (const g of [undefined, null, '', 'nope', 'a.b', 'x'.repeat(5000), 42, {}]) expect(verifyAppLink(g)).toBeNull();
});

test('only the app features have a landing; anything else cannot be signed', () => {
  const { signAppLink, LANDINGS } = load();
  expect(LANDINGS).toEqual({
    menu: '/portal/teacher',
    lesson_plan: '/portal/teacher/lessons',
    assessment_generator: '/portal/teacher/assessment',
    ai_coaching: '/portal/teacher/coaching',
    teacher_training: '/portal/teacher/training',
    attendance: '/portal/teacher/attendance',
    classes: '/portal/teacher/classes',
    ai_coaching_recording: '/portal/teacher/coaching/new?recording=whatsapp', // bd-c5reix, a kept recording's landing
    assessment_topics: '/portal/teacher/assessment/new/class?by=topics', // bd-6clakk Task 9
    assessment_report: '/portal/teacher/assessment/new/class', // bd-pw1ccr.2, the A/B report button
    assessment_topic_nudge: '/portal/teacher/assessment/new/class', // bd-pw1ccr.4.2, the topic-end nudge button
  });
  expect(signAppLink(USER, 'quiz')).toBeNull();
  expect(signAppLink(USER, 'observe')).toBeNull();
  expect(signAppLink('', 'menu')).toBeNull();
});

/*
 * bd-fmf24g.40 — INTERNAL_API_KEY is the SAME on staging and production, so a key derived from it alone let a
 * staging-minted link sign the same users.id into production. The key is bound to the environment's Supabase
 * project (SUPABASE_URL's host), which every bot, worker and portal service of one environment shares and no two
 * environments share.
 */
describe('bd-fmf24g.40 — the key is bound to the environment', () => {
  const STAGING = 'https://rpqkekcfvumypldbejhp.supabase.co';
  const PROD = 'https://ihzciabopbttygxxgrkm.supabase.co';

  test('a token minted on staging is refused by production, though INTERNAL_API_KEY is the same', () => {
    process.env.SUPABASE_URL = STAGING;
    const t = load().signAppLink(USER, 'menu');
    expect(t).toBeTruthy();
    expect(load().verifyAppLink(t)).not.toBeNull(); // staging itself accepts it
    jest.resetModules();
    process.env.SUPABASE_URL = PROD;
    expect(load().verifyAppLink(t)).toBeNull();
  });

  test('and the other way round: a production token does not open staging', () => {
    process.env.SUPABASE_URL = PROD;
    const t = load().signAppLink(USER, 'lesson_plan');
    process.env.SUPABASE_URL = STAGING;
    expect(load().verifyAppLink(t)).toBeNull();
  });

  test('the same environment written differently (case, trailing slash, a path) is the same environment', () => {
    process.env.SUPABASE_URL = PROD;
    const t = load().signAppLink(USER, 'menu');
    for (const spelling of [`${PROD}/`, PROD.toUpperCase().replace('HTTPS', 'https'), `${PROD}/rest/v1`]) {
      process.env.SUPABASE_URL = spelling;
      expect(load().verifyAppLink(t)).toEqual(expect.objectContaining({ u: USER, f: 'menu' }));
    }
  });

  test('no SUPABASE_URL (or one that is not a URL): nothing is signed and nothing verifies', () => {
    process.env.SUPABASE_URL = PROD;
    const t = load().signAppLink(USER, 'menu');
    for (const bad of [undefined, '', 'not a url']) {
      if (bad === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = bad;
      expect(load().signAppLink(USER, 'menu')).toBeNull();
      expect(load().verifyAppLink(t)).toBeNull();
    }
  });

  test('a link minted under the old derivation (INTERNAL_API_KEY alone, label v1) no longer opens anything', () => {
    process.env.SUPABASE_URL = PROD;
    const crypto = require('crypto');
    const oldKey = crypto.createHmac('sha256', process.env.INTERNAL_API_KEY).update('app-login-link-v1').digest();
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', oldKey, iv);
    const plain = Buffer.from(JSON.stringify({ k: 'app', u: USER, f: 'menu', exp: Math.floor(Date.now() / 1000) + 3600 }));
    const old = Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]).toString('base64url');
    expect(load().verifyAppLink(old)).toBeNull();
  });
});

test('no secret on this deployment: nothing is signed and nothing verifies', () => {
  delete process.env.INTERNAL_API_KEY;
  const { signAppLink, verifyAppLink } = load();
  expect(signAppLink(USER, 'menu')).toBeNull();
  expect(verifyAppLink('abc')).toBeNull();
});

test('bd-6clakk Task 9 — the topics link verifies, and the chapter-test link is unchanged', () => {
  const { signAppLink, verifyAppLink, LANDINGS } = load();
  expect(verifyAppLink(signAppLink(USER, 'assessment_topics'))).toEqual(expect.objectContaining({ u: USER, f: 'assessment_topics' }));
  expect(verifyAppLink(signAppLink(USER, 'assessment_generator'))).toEqual(expect.objectContaining({ f: 'assessment_generator' }));
  expect(LANDINGS.assessment_generator).toBe('/portal/teacher/assessment');
  expect(LANDINGS.assessment_topics).toBe('/portal/teacher/assessment/new/class?by=topics');
});
