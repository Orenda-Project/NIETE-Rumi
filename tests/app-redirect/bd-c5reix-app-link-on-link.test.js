'use strict';
/**
 * bd-c5reix — the app link, split in two for a caller that has work to do between deciding and sending.
 *
 * The classroom-recording door must SAVE her recording before the link goes, and only when the answer is the link
 * (a teacher on the teacher app). redirectIfFlagged takes an optional `onLink`, called on that branch alone, after the
 * decision and before the send. What it answers can change two things and nothing else:
 *   landing  another teacher-app landing (app-login-link LANDINGS) — the one screen with her recording attached
 *   copy     another pair of catalog keys for the line and the button — "you sent this before"
 * Without onLink nothing changes, for any feature. onLink that throws, or answers nonsense, is today's link.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: (...a) => mockCta(...a),
}));

let mockState;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (table) => mockFrom(table) }));
function mockFrom(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    in: (_c, vals) => Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null }),
    maybeSingle: () => (table === 'users'
      ? Promise.resolve({ data: mockState.users[filters.id] || null, error: null })
      : Promise.resolve({ data: null, error: null })),
    upsert: () => { mockState.upserts += 1; return Promise.resolve({ error: null }); },
  };
  return chain;
}

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FROM = '+92300FIXTURE4';
const PORTAL = 'https://portal.example.test';
const teacher = { id: ME, role: 'teacher', name: 'Ayesha', registration_completed: true, registration_state: 'completed' };

let svc; let link; let logger;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: teacher }, upserts: 0 };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
  logger = require('../../bot/shared/utils/logger');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const coachingForTeachers = () => { set('app_redirect_ai_coaching', 'teachers'); set('portal_teacher_v2', 'teachers'); };
const ask = (args = {}) => svc.redirectIfFlagged('ai_coaching', { userId: ME, from: FROM, language: 'en', reason: 'classroom_audio', ...args });
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));

describe('the link branch calls onLink, after the decision and before the send', () => {
  test('a landing it names is where the link opens; the funnel still names the request (ai_coaching)', async () => {
    coachingForTeachers();
    const seen = [];
    const onLink = jest.fn(async ({ journey }) => { seen.push(['onLink', mockCta.mock.calls.length, journey]); return { landing: 'ai_coaching_recording' }; });
    expect(await ask({ onLink })).toBe(true);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(seen[0][1]).toBe(0); // nothing sent before onLink ran
    expect(seen[0][2]).toEqual(expect.objectContaining({ feature: 'ai_coaching', journeyId: expect.any(String) }));
    const opts = mockCta.mock.calls[0][1];
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'ai_coaching_recording' }));
    expect(link.LANDINGS.ai_coaching_recording).toBe('/portal/teacher/coaching/new?recording=whatsapp');
    expect(opts.body).toBe('Your recording is saved ✅ Tap the button below to complete your Digital Coaching.'); // bd-c5reix.1
    expect(opts.buttonText).toBe('Digital Coaching');
    expect(logger.logToFile).toHaveBeenCalledWith('app_funnel.link_sent', expect.objectContaining({ feature: 'ai_coaching', door: 'classroom_audio' }));
  });

  test('copy it names is the line and the button; the landing stays the feature\'s', async () => {
    coachingForTeachers();
    await ask({ onLink: async () => ({ copy: ['appLinkBodyCoachingRepeat', 'appLinkButtonCoachingRepeat'] }) });
    const opts = mockCta.mock.calls[0][1];
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ f: 'ai_coaching' }));
    expect(opts.body).toMatch(/heard this recording before/);
    expect(opts.buttonText).toBe('Digital Coaching');
  });

  test.each([
    ['answers null', async () => null],
    ['throws', async () => { throw new Error('R2 down'); }],
    ['names a landing that does not exist', async () => ({ landing: 'quiz' })],
    ['names copy that is not a pair of keys', async () => ({ copy: 'appLinkBodyCoachingRepeat' })],
  ])('onLink that %s: today\'s link, unchanged', async (_label, onLink) => {
    coachingForTeachers();
    expect(await ask({ onLink })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ f: 'ai_coaching' }));
    expect(opts.body).toBe('Record your lesson in the app.');
    expect(opts.buttonText).toBe('Record lesson');
  });
});

describe('AC3 — off the link branch, onLink is never called and nothing changes', () => {
  test('not a teacher on the teacher app (a principal): the WhatsApp flow, onLink not called', async () => {
    coachingForTeachers();
    mockState.users[ME] = { ...teacher, role: 'principal' };
    const onLink = jest.fn();
    expect(await ask({ onLink })).toBe(false);
    expect(onLink).not.toHaveBeenCalled();
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('the Play Store notice (switch = true): the notice, onLink not called', async () => {
    set('app_redirect_ai_coaching', true);
    const onLink = jest.fn();
    expect(await ask({ onLink })).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('switch off: not handled, onLink not called', async () => {
    const onLink = jest.fn();
    expect(await ask({ onLink })).toBe(false);
    expect(onLink).not.toHaveBeenCalled();
  });
});
