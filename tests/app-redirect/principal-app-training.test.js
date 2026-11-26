'use strict';
/**
 * bd-l82vfe (queue #296) — a principal on the principal app asking to open training gets the app's button, only.
 *
 * Slack #region-gb, 26 Nov: a GB user sent /training and got the WhatsApp Training Flow, which then showed WhatsApp's
 * "Something went wrong". The operator, 13:49: "/training should go for the IAB flow, not the WhatsApp."
 * Prod, 27 Oct-26 Nov (Axiom niete-logs app_funnel.command, feature teacher_training): every registered teacher already
 * gets the app link (app_redirect_teacher_training = "teachers"); the Flow still ran for 21 accounts whose role is not
 * teacher, and 18 of them are principals (14 in Gilgit-Baltistan), test accounts aside. The teacher link asks for
 * users.role teacher; the principal link (2g) answered observe and papers only.
 *
 * The principal app (portal_principal_app, true on prod since 25 Nov) already opens the teacher app's pages, and its
 * own Home Training tile opens /portal/teacher/training (principal/HomeV6.tsx). So /training lands there too.
 *
 * For a principal the principal app is on for (a list holding her, true or "true"; AND users.role principal):
 *   ONE cta_url message, the teacher link's own words for training ("Open your training." / [Training]), signed in on
 *   the teacher Training page. Only from the doors that mean "open training" (typed /training, the chip, the menu row,
 *   the training entry), the same doors the coach's /training link takes. /certificates and the module exam and
 *   capstone buttons keep their WhatsApp behaviour.
 * Anyone else is untouched: a principal the switch does not name, a coach, an aeo keep today's path.
 *
 * The same harness as principal-app-assessment.test.js: the real redirectIfFlagged -> sendAppLink path, edges mocked.
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

let svc; let link; let mockLog;
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
  mockLog = require('../../bot/shared/utils/logger').logToFile;
  mockLog.mockClear();
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en', reason = 'command' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason });
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
// The prod rows on 26 Nov: the teacher link is on for "teachers", the principal app for every principal.
const prodRows = (principalApp = true) => {
  set('portal_principal_app', principalApp);
  set('portal_teacher_v2', 'teachers');
  set('app_redirect_teacher_training', 'teachers');
  set('coach_app_training', 'coaches');
  set('portal_coach_v2', true);
};

describe('a principal the principal app is on for asks to open training', () => {
  test.each([
    ['a list holding her', [ME]],
    ['true', true],
    ['"true"', 'true'],
  ])('switch = %s: ONE cta_url, the training line, [Training], on the teacher Training page', async (_, value) => {
    prodRows(value);
    expect(await ask('teacher_training')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.body).toBe('Open your training.');
    expect(opts.buttonText).toBe('Training');
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'teacher_training' }));
    expect(link.LANDINGS[tokenOf(opts).f]).toBe('/portal/teacher/training');
  });

  test('in Urdu: the Urdu line and button', async () => {
    prodRows();
    expect(await ask('teacher_training', { language: 'ur' })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('اپنی ٹریننگ کھولیں۔');
    expect(opts.buttonText).toBe('ٹریننگ');
  });

  test.each(['command', 'chip', 'menu', 'training_door'])('the same from the %s door', async (reason) => {
    prodRows();
    expect(await ask('teacher_training', { reason })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'teacher_training' }));
  });

  test('the funnel says link, audience leader, for the request she made', async () => {
    prodRows();
    await ask('teacher_training');
    const rows = mockLog.mock.calls.filter(([name]) => String(name).startsWith('app_funnel.'));
    expect(rows[0][1]).toEqual(expect.objectContaining({ event: 'app_funnel.command', feature: 'teacher_training', verdict: 'link', audience: 'leader', userId: ME }));
    expect(rows.map(([name]) => name)).not.toContain('app_funnel.link_failed');
  });
});

describe('everyone and everything else: today\'s path', () => {
  test.each(['certificates_command', 'module_exam_button', 'capstone_button', 'unspecified'])(
    'a principal from the %s door → no link (those are not "open training")', async (reason) => {
      prodRows();
      expect(await ask('teacher_training', { reason })).toBe(false);
      expect(mockCta).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['no row', null],
    ['a list without her', [OTHER]],
    ['false', false],
    ['"teachers"', 'teachers'],
  ])('a principal the switch does not name (%s) → nothing sent, the WhatsApp Flow runs', async (_, value) => {
    if (value !== null) set('portal_principal_app', value);
    set('portal_teacher_v2', 'teachers');
    set('app_redirect_teacher_training', 'teachers');
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test.each(['aeo', 'school_leader', 'unregistered'])('a %s on the principal app\'s list → not this link', async (role) => {
    mockState.users[ME] = row(role);
    prodRows([ME]);
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a coach keeps the coach Training Library link, unchanged', async () => {
    mockState.users[ME] = row('coach');
    prodRows([ME]);
    expect(await ask('teacher_training')).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length))).toEqual(expect.objectContaining({ f: 'coach_training' }));
  });

  test('a registered teacher keeps the teacher link, unchanged', async () => {
    mockState.users[ME] = row('teacher');
    prodRows([ME]);
    expect(await ask('teacher_training')).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('Open your training.');
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ f: 'teacher_training' }));
    const rows = mockLog.mock.calls.filter(([name]) => name === 'app_funnel.command');
    expect(rows[0][1]).toEqual(expect.objectContaining({ audience: 'teacher' }));
  });

  test('a failed users read → today\'s path', async () => {
    prodRows([ME]);
    mockState.usersError = true;
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('the principal paper and observe links are unchanged by the door list', async () => {
    prodRows();
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator', { reason: 'intent' })).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'assessment_generator' }));
    mockCta.mockClear();
    expect(await ask('observe', { reason: 'unspecified' })).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'principal_observe' }));
  });
});
