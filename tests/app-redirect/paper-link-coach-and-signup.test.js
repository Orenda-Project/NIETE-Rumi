'use strict';
/**
 * bd-uxzi8c.1 (queue #205) — coaches and unfinished sign-ups asking for an exam paper get ONE app link, not the
 * WhatsApp Flow + PDF. The operator, 23 Nov: "YES, also move coaches and unfinished sign-ups".
 *
 * Prod, 24 Oct–23 Nov (Axiom niete-logs): the chat paper path still ran for `not_a_teacher` (28 people) and
 * `not_registered` (62) — about 5 WhatsApp messages a paper against 1 for the link.
 *
 * Two NEW switches, each OFF unless set, so merging changes nothing until one is flipped:
 *   leader_app_assessment         a leader (observe-gate LEADER_ROLES) → the app's paper maker (/portal/assessment, the
 *                                 page the leader family opens; target `leader_assessment`). true | "coaches" | a list.
 *                                 The same rules as leader_app_lesson_plan, its own key: neither moves the other.
 *   assessment_app_unregistered   a teacher with no name yet (registration-status isRegistered false) → the teacher
 *                                 app's paper maker, as a registered teacher. true | a list. Only when the teacher
 *                                 switch already says "teachers" and she is on the teacher app; papers only.
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

const row = (role, extra = {}) => ({ id: ME, role, name: 'Test Person', registration_completed: true, registration_state: 'completed', ...extra });
const unfinished = () => row('teacher', { name: null, registration_completed: false, registration_state: 'unregistered' });

let svc; let link;
beforeEach(() => {
  jest.resetModules();
  mockRedis.clear();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('coach') }, usersError: false, settingsError: false };
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

describe('a coach asks for a paper', () => {
  test.each([
    ['a list holding them', [ME]],
    ['true', true],
    ['"true"', 'true'],
    ['"coaches"', 'coaches'],
  ])('leader_app_assessment = %s: ONE cta_url, the paper words, on the app\'s paper maker', async (_, value) => {
    set('leader_app_assessment', value);
    expect(await ask('assessment_generator')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.body).toBe('Make a paper in the app.');
    expect(opts.buttonText).toBe('Make a paper');
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'leader_assessment' }));
    expect(link.leaderPathFor('leader_assessment')).toBe('/portal/assessment');
  });

  test.each(['command', 'menu', 'intent', 'voice_intent'])('the same from the %s door', async (reason) => {
    set('leader_app_assessment', 'coaches');
    expect(await ask('assessment_generator', { reason })).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'leader_assessment' }));
  });

  test('in Urdu: the Urdu line and button', async () => {
    set('leader_app_assessment', [ME]);
    expect(await ask('assessment_generator', { language: 'ur' })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('ایپ میں پرچہ بنائیں۔');
    expect(opts.buttonText).toBe('پرچہ بنائیں');
  });

  test('an aeo: true moves them, "coaches" does not', async () => {
    mockState.users[ME] = row('aeo');
    set('leader_app_assessment', 'coaches');
    expect(await ask('assessment_generator')).toBe(false);
    mockState.settings = [];
    jest.resetModules();
    svc = require('../../bot/shared/services/app-redirect.service');
    set('leader_app_assessment', true);
    expect(await ask('assessment_generator')).toBe(true);
  });
});

describe('coaches: everything else stays as today', () => {
  test.each([
    ['no row', null],
    ['a list without them', [OTHER]],
    ['false', false],
    ['"teachers"', 'teachers'],
  ])('leader_app_assessment %s → nothing sent, the Flow runs', async (_, value) => {
    if (value !== null) set('leader_app_assessment', value);
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('the lesson-plan switch does not move papers', async () => {
    set('leader_app_lesson_plan', true);
    expect(await ask('assessment_generator')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('the paper switch does not move lesson plans', async () => {
    set('leader_app_assessment', true);
    expect(await ask('lesson_plan', { reason: 'bare_command' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('an analytics-only coach → the Flow runs', async () => {
    set('leader_app_assessment', true);
    set('portal_analytics_only', [ME]);
    expect(await ask('assessment_generator')).toBe(false);
  });

  test('a failed users read → the Flow runs', async () => {
    set('leader_app_assessment', true);
    mockState.usersError = true;
    expect(await ask('assessment_generator')).toBe(false);
  });

  test('a registered teacher is not a leader: the teacher link, unchanged', async () => {
    mockState.users[ME] = row('teacher');
    set('leader_app_assessment', true);
    set('portal_teacher_v2', 'teachers');
    set('app_redirect_assessment_generator', 'teachers');
    expect(await ask('assessment_generator')).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'assessment_generator' }));
  });

  test('a principal on the principal app keeps the principal link', async () => {
    mockState.users[ME] = row('principal');
    set('leader_app_assessment', true);
    set('portal_principal_app', [ME]);
    expect(await ask('assessment_generator')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(tokenOf(mockCta.mock.calls[0][1])).toEqual(expect.objectContaining({ f: 'assessment_generator' }));
  });
});

describe('a teacher who has not finished signing up asks for a paper', () => {
  const teacherSwitches = () => {
    set('app_redirect_assessment_generator', 'teachers');
    set('portal_teacher_v2', 'teachers');
  };

  test.each([
    ['true', true],
    ['"true"', 'true'],
    ['a list holding her', [ME]],
  ])('assessment_app_unregistered = %s: ONE cta_url on the teacher paper maker', async (_, value) => {
    mockState.users[ME] = unfinished();
    teacherSwitches();
    set('assessment_app_unregistered', value);
    expect(await ask('assessment_generator')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    const opts = mockCta.mock.calls[0][1];
    expect(opts.body).toBe('Make a paper in the app.');
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'assessment_generator' }));
    expect(link.LANDINGS.assessment_generator).toBe('/portal/teacher/assessment');
  });

  test.each([
    ['no row', null],
    ['false', false],
    ['"teachers"', 'teachers'],
    ['a list without her', [OTHER]],
  ])('assessment_app_unregistered %s → the Flow runs, as today', async (_, value) => {
    mockState.users[ME] = unfinished();
    teacherSwitches();
    if (value !== null) set('assessment_app_unregistered', value);
    expect(await ask('assessment_generator')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('only papers: her lesson-plan request keeps the Flow', async () => {
    mockState.users[ME] = unfinished();
    set('app_redirect_lesson_plan', 'teachers');
    set('portal_teacher_v2', 'teachers');
    set('assessment_app_unregistered', true);
    expect(await ask('lesson_plan', { reason: 'bare_command' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('it rides the teacher switch: off there → the Flow runs', async () => {
    mockState.users[ME] = unfinished();
    set('portal_teacher_v2', 'teachers');
    set('assessment_app_unregistered', true);
    expect(await ask('assessment_generator')).toBe(false);
  });

  test('not on the teacher app → the Flow runs', async () => {
    mockState.users[ME] = unfinished();
    set('app_redirect_assessment_generator', 'teachers');
    set('assessment_app_unregistered', true);
    expect(await ask('assessment_generator')).toBe(false);
  });

  test('a role that is not teacher is not moved by it', async () => {
    mockState.users[ME] = row('student', { name: null, registration_completed: false });
    teacherSwitches();
    set('assessment_app_unregistered', true);
    expect(await ask('assessment_generator')).toBe(false);
  });
});
