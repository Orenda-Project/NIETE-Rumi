'use strict';
/**
 * bd-fmf24g.35 — pilot gate: app_redirect_<feature> holding a JSON ARRAY of users.id sends those teachers ONE
 * cta_url message with a one-tap login link (instead of the Play Store notice), and only if they are on the
 * teacher app (portal_teacher_v2). Everyone else, and every feature outside the seven, is untouched.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: (...a) => mockCta(...a),
}));
let mockState;
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => mockFrom() }));
function mockFrom() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: (_c, vals) => Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => { mockState.upserts += 1; return Promise.resolve({ error: null }); },
  };
  return chain;
}

const ENV = { ...process.env };
const PILOT = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
let svc; let link;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], upserts: 0 };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = PILOT, language = 'en' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason: 'test' });
const SEVEN = ['menu', 'lesson_plan', 'assessment_generator', 'ai_coaching', 'teacher_training', 'attendance', 'classes'];

test('menu is the sixteenth switch', () => {
  expect(svc.APP_REDIRECT_FLAGS.menu).toBe('app_redirect_menu');
});

describe.each(SEVEN)('%s', (feature) => {
  test('pilot teacher on the teacher app gets ONE cta_url message with a link that lands on the feature', async () => {
    set(`app_redirect_${feature}`, [PILOT]);
    set('portal_teacher_v2', [PILOT]);
    expect(await ask(feature)).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    const verified = link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
    expect(verified).toEqual(expect.objectContaining({ u: PILOT, f: feature }));
    expect(opts.url).not.toContain(PILOT);
    expect(opts.url).not.toContain(FROM);
    expect(opts.url).not.toContain('play.google.com');
  });

  test('a teacher NOT on the pilot list keeps today\'s flow', async () => {
    set(`app_redirect_${feature}`, [PILOT]);
    set('portal_teacher_v2', true);
    expect(await ask(feature, { userId: OTHER })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('a pilot teacher NOT on the teacher app (no v2) gets no link, keeps the flow', async () => {
    set(`app_redirect_${feature}`, [PILOT]);
    set('portal_teacher_v2', [OTHER]);
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('portal_teacher_v2 absent → no link', async () => {
    set(`app_redirect_${feature}`, [PILOT]);
    expect(await ask(feature)).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a failed cta send falls back to the same link as plain text; if that fails too, the flow runs', async () => {
    set(`app_redirect_${feature}`, [PILOT]);
    set('portal_teacher_v2', true);
    mockCta.mockResolvedValue(false);
    expect(await ask(feature)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
    mockSend.mockResolvedValue(false);
    expect(await ask(feature)).toBe(false);
  });
});

test('no quiet hour: two requests in a row each get a link, nothing is written to user_feature_first_use', async () => {
  set('app_redirect_menu', [PILOT]);
  set('portal_teacher_v2', true);
  expect(await ask('menu')).toBe(true);
  expect(await ask('menu')).toBe(true);
  expect(mockCta).toHaveBeenCalledTimes(2);
  expect(mockState.upserts).toBe(0);
});

test('Urdu teacher: Urdu body and button; button <= 20 code points in both languages, body <= 1024', async () => {
  set('app_redirect_menu', [PILOT]);
  set('portal_teacher_v2', true);
  await ask('menu', { language: 'ur' });
  const ur = mockCta.mock.calls[0][1];
  expect(ur.body).toMatch(/[؀-ۿ]/);
  const { resolveUx } = require('../../bot/shared/config/ux-strings');
  for (const language of ['en', 'ur']) {
    expect([...resolveUx('appLinkButton', { language })].length).toBeLessThanOrEqual(20);
    expect([...resolveUx('appLinkBody', { language })].length).toBeLessThanOrEqual(1024);
  }
});

test('the other nine features are never linked, even with an array', async () => {
  for (const f of ['quiz', 'reading_test', 'homework', 'exam_checker', 'presentation', 'general_chat', 'video', 'remark', 'observe']) {
    set(`app_redirect_${f}`, [PILOT]);
  }
  set('portal_teacher_v2', true);
  for (const f of ['quiz', 'reading_test', 'homework', 'exam_checker', 'presentation', 'general_chat', 'video', 'remark', 'observe']) {
    expect(await ask(f)).toBe(false);
  }
  expect(mockCta).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test('a switch that is plain true still sends today\'s Play Store notice (unchanged)', async () => {
  set('app_redirect_lesson_plan', true);
  expect(await ask('lesson_plan', { userId: OTHER })).toBe(true);
  expect(mockCta).not.toHaveBeenCalled();
  expect(mockSend.mock.calls[0][1]).toContain('play.google.com');
});

test('no signing secret or no portal url: no link, the flow runs', async () => {
  set('app_redirect_menu', [PILOT]);
  set('portal_teacher_v2', true);
  delete process.env.INTERNAL_API_KEY;
  expect(await ask('menu')).toBe(false);
  process.env.INTERNAL_API_KEY = 'k';
  delete process.env.PORTAL_URL;
  jest.resetModules();
  const s2 = require('../../bot/shared/services/app-redirect.service');
  expect(await s2.redirectIfFlagged('menu', { userId: PILOT, from: FROM, language: 'en' })).toBe(false);
  expect(mockCta).not.toHaveBeenCalled();
});
