'use strict';
/**
 * bd-uxzi8c (queue #205) — a principal on the principal app asking for an exam paper gets the app's button, only.
 *
 * The operator, 23 Nov: "its all on iab right?" then "yes" to check and move. Prod, 24 Oct–23 Nov (Axiom niete-logs):
 * registered teachers already get the app link for papers (app_redirect_assessment_generator = "teachers"); the
 * WhatsApp Flow still ran for 25 accounts whose role is not teacher (75 papers by PDF in chat), principals among them.
 * The principal app (portal_principal_app, bd-eqkr0n) already opens the teacher app's pages for a principal, the paper
 * maker (/portal/teacher/assessment) included, so this only adds the request to the principal link (2g).
 *
 * So, for a principal the principal app is on for (a list holding her, true or "true"; AND users.role principal):
 *   ONE cta_url message, the teacher app link's own words for papers ("Make a paper in the app." / [Make a paper]),
 *   signed in on the paper maker. No Flow, no "reply 1".
 * Anyone else is untouched: a principal the switch does not name, a coach, an aeo keep today's path.
 *
 * The same harness as principal-app-observe.test.js: the real redirectIfFlagged → sendAppLink path, edges mocked.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: (...a) => mockCta(...a),
}));

const mockRedis = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: async (k) => {
    const v = mockRedis.get(k);
    if (v == null) return null;
    try { return JSON.parse(v); } catch (_) { return v; }
  },
  set: async (k, v) => { mockRedis.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; },
  delete: async (k) => { mockRedis.delete(k); return true; },
}));

let mockState;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (table) => mockFrom(table) }));
function mockFrom(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    in: (_c, vals) => {
      if (mockState.settingsError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null });
    },
    maybeSingle: () => {
      if (table === 'users') {
        if (mockState.usersError) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: mockState.users[filters.id] || null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert: () => Promise.resolve({ error: null }),
  };
  return chain;
}

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';

const row = (role) => ({ id: ME, role, name: 'Test Leader', registration_completed: true, registration_state: 'completed' });

let svc; let link;
beforeEach(() => {
  jest.resetModules();
  mockRedis.clear();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('principal') }, usersError: false, settingsError: false };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en', reason = 'command' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason });
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));

describe('a principal the principal app is on for asks for a paper', () => {
  test.each([
    ['a list holding her', [ME]],
    ['true', true],
    ['"true"', 'true'],
  ])('switch = %s: ONE cta_url, the paper line, [Make a paper], on the paper maker', async (_, value) => {
    set('portal_principal_app', value);
    expect(await ask('assessment_generator')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.body).toBe('Make a paper in the app.');
    expect(opts.buttonText).toBe('Make a paper');
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'assessment_generator' }));
    expect(link.LANDINGS[tokenOf(opts).f]).toBe('/portal/teacher/assessment');
  });

  test('in Urdu: the Urdu line and button', async () => {
    set('portal_principal_app', [ME]);
    expect(await ask('assessment_generator', { language: 'ur' })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('ایپ میں پرچہ بنائیں۔');
    expect(opts.buttonText).toBe('پرچہ بنائیں');
  });

  test.each(['command', 'menu', 'intent', 'voice_intent'])('the same from the %s door', async (reason) => {
    set('portal_principal_app', [ME]);
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator', { reason })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'assessment_generator' }));
  });

  test('nothing is armed for a reply: no Redis key is written', async () => {
    set('portal_principal_app', [ME]);
    expect(await ask('assessment_generator')).toBe(true);
    expect(mockRedis.size).toBe(0);
  });
});

describe('everyone else: today\'s path', () => {
  test.each([
    ['no row', null],
    ['a list without her', [OTHER]],
    ['false', false],
    ['"teachers"', 'teachers'],
  ])('a principal the switch does not name (%s) → nothing sent, the WhatsApp Flow runs', async (_, value) => {
    if (value !== null) set('portal_principal_app', value);
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test.each(['coach', 'aeo'])('a %s on the principal app\'s list → not this link', async (role) => {
    mockState.users[ME] = row(role);
    set('portal_principal_app', [ME]);
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a registered teacher keeps the teacher link, unchanged', async () => {
    mockState.users[ME] = row('teacher');
    set('portal_principal_app', [ME]);
    set('portal_teacher_v2', 'teachers');
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator')).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('Make a paper in the app.');
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ f: 'assessment_generator' }));
  });

  test('a failed users read → today\'s path', async () => {
    set('portal_principal_app', [ME]);
    mockState.usersError = true;
    expect(await ask('assessment_generator')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });
});
