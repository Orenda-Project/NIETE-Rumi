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

test('only the seven app features have a landing; anything else cannot be signed', () => {
  const { signAppLink, LANDINGS } = load();
  expect(LANDINGS).toEqual({
    menu: '/portal/teacher',
    lesson_plan: '/portal/teacher/lessons',
    assessment_generator: '/portal/teacher/assessment',
    ai_coaching: '/portal/teacher/coaching',
    teacher_training: '/portal/teacher/training',
    attendance: '/portal/teacher/attendance',
    classes: '/portal/teacher/classes',
  });
  expect(signAppLink(USER, 'quiz')).toBeNull();
  expect(signAppLink(USER, 'observe')).toBeNull();
  expect(signAppLink('', 'menu')).toBeNull();
});

test('no secret on this deployment: nothing is signed and nothing verifies', () => {
  delete process.env.INTERNAL_API_KEY;
  const { signAppLink, verifyAppLink } = load();
  expect(signAppLink(USER, 'menu')).toBeNull();
  expect(verifyAppLink('abc')).toBeNull();
});
