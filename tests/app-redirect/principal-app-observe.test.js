'use strict';
/**
 * bd-eqkr0n (queue #203 follow-up) — a principal on the principal app asking to observe gets the app's button, only.
 *
 * The operator, 20 Nov ~14:55: "if principal does a /observe, or just observe, we send the IAB button like we do for
 * others." ~15:00: "For coaches we will keep it like the IAB button with the '1' for whatsapp just in case." 14:50:
 * "we can even ignore the WhatsApp one for Principals."
 *
 * So, for a principal the principal app is on for (app_settings portal_principal_app names her: true, "true" or a list
 * holding her; AND users.role principal: the portal's own rule, dashboard/lib/teacher-app isPrincipalAppUser):
 *   ONE cta_url message, the coach nudge's own words without the "reply 1" line, its [Open in the app] button, signed in
 *   on her Observations page (/portal/teacher/observations: My own lesson, One of my teachers, what she sent). No
 *   "reply 1" offer is armed, so a "1" after it is an ordinary message.
 * Anyone else is untouched: a principal the switch does not name keeps today's WhatsApp /observe, a coach keeps the
 * nudge with its "1", a teacher gets nothing new. A failed read is today's path.
 *
 * Driven through the real redirectIfFlagged → sendAppLink path with only the edges mocked (WhatsApp, Supabase, Redis,
 * logger). main has no coach nudge (and so no "reply 1" offer at all): the two sandbox cases about it are not here.
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

describe('a principal the principal app is on for asks to observe', () => {
  test.each([
    ['a list holding her', [ME]],
    ['true', true],
    ['"true"', 'true'],
  ])('switch = %s: ONE cta_url, the line without "reply 1", [Open in the app], on her Observations page', async (_, value) => {
    set('portal_principal_app', value);
    expect(await ask('observe')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.body).toBe('Take your observation in the app.');
    expect(opts.body).not.toMatch(/\*1\*|WhatsApp/);
    expect(opts.buttonText).toBe('Open in the app');
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'principal_observe' }));
  });

  test('the token lands on the principal app\'s Observations page', () => {
    expect(link.LANDINGS.principal_observe).toBe('/portal/teacher/observations');
  });

  test('in Urdu: the Urdu line (no "1") and the Urdu button, under the 20 code-point cap', async () => {
    set('portal_principal_app', [ME]);
    expect(await ask('observe', { language: 'ur' })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('اپنا مشاہدہ ایپ میں لیں۔');
    expect(opts.body).not.toMatch(/1|۱|واٹس/);
    expect(opts.buttonText).toBe('ایپ میں کھولیں');
    expect([...opts.buttonText].length).toBeLessThanOrEqual(20);
  });

  test.each(['command', 'menu', 'menu_choice'])('the same from the %s door (the menu\'s Observe row too)', async (reason) => {
    set('portal_principal_app', [ME]);
    expect(await ask('observe', { reason })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('a principal\'s case does not matter in her role ("Principal ")', async () => {
    mockState.users[ME] = row('Principal ');
    set('portal_principal_app', [ME]);
    expect(await ask('observe')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('Meta refuses the button: the same line and link go as text', async () => {
    set('portal_principal_app', [ME]);
    mockCta.mockResolvedValue(false);
    expect(await ask('observe')).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toMatch(/^Take your observation in the app\.\nhttps:\/\/portal\.example\.test\/go\//);
  });
});

describe('everyone else: today\'s path', () => {
  test.each([
    ['no row', null],
    ['a list without her', [OTHER]],
    ['false', false],
    ['"teachers"', 'teachers'],
    ['an object', { on: true }],
  ])('a principal the switch does not name (%s) → nothing sent, the WhatsApp /observe runs', async (_, value) => {
    if (value !== null) set('portal_principal_app', value);
    expect(await ask('observe')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test.each(['teacher', 'coach', 'aeo'])('a %s on the principal app\'s list → not this link', async (role) => {
    mockState.users[ME] = row(role);
    set('portal_principal_app', [ME]);
    expect(await ask('observe')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('only observe: a principal\'s /menu is not moved by this switch', async () => {
    set('portal_principal_app', [ME]);
    expect(await ask('menu')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a failed users read → today\'s path', async () => {
    set('portal_principal_app', [ME]);
    mockState.usersError = true;
    expect(await ask('observe')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a failed app_settings read → today\'s path', async () => {
    set('portal_principal_app', [ME]);
    mockState.settingsError = true;
    expect(await ask('observe')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });
});
