'use strict';
/**
 * bd-onxyu — per-feature switches that send a teacher to the NIETE app.
 *
 * Contract pinned here:
 *   1. Fifteen switches, one per feature, each an app_settings row named
 *      app_redirect_<feature>. FAIL CLOSED: absent / malformed / failed lookup = off.
 *   2. On → one notice with the Play Store link, in her language; the caller is
 *      told the request was handled.
 *   3. Quiet hour PER TEACHER, shared by every switch: a second redirect inside
 *      60 minutes sends nothing (but is still "handled"); after the hour the
 *      notice goes again.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const mockSend = jest.fn();
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
}));

// A small Supabase stand-in: app_settings answers .in(), user_feature_first_use
// answers eq/eq/maybeSingle and honours upsert on (user_id, feature).
let mockState;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => mockFrom(table),
}));
function mockFrom(table) {
  const filters = {};
  const chain = {
    select: () => chain,
    eq: (c, v) => { filters[c] = v; return chain; },
    in: (c, vals) => {
      mockState.settingsReads += 1;
      if (mockState.settingsError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null });
    },
    maybeSingle: () => {
      if (mockState.firstUseError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      const row = mockState.firstUse.find((r) => Object.entries(filters).every(([c, v]) => r[c] === v));
      return Promise.resolve({ data: row || null, error: null });
    },
    upsert: (row, opts) => {
      mockState.upserts.push({ row, opts });
      const i = mockState.firstUse.findIndex((r) => r.user_id === row.user_id && r.feature === row.feature);
      if (i >= 0) mockState.firstUse[i] = { ...mockState.firstUse[i], ...row };
      else mockState.firstUse.push({ ...row });
      return Promise.resolve({ error: null });
    },
  };
  void table;
  return chain;
}

const { resolveUx } = require('../../bot/shared/config/ux-strings');

const PLAY = 'https://play.google.com/store/apps/details?id=pk.edu.niete';
const T0 = Date.parse('2026-10-01T09:00:00Z');
const MIN = 60 * 1000;
const FROM = '923330000099';

let svc;
beforeEach(() => {
  jest.resetModules();
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], firstUse: [], upserts: [], settingsReads: 0, settingsError: false, firstUseError: false };
  delete process.env.APP_STORE_URL;
  svc = require('../../bot/shared/services/app-redirect.service');
});

const on = (...keys) => { mockState.settings.push(...keys.map((key) => ({ key, value: true }))); };
const ask = (feature, { userId = 'u-1', now = T0, language = 'en' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, now });

describe('the switch registry', () => {
  test('sixteen features (fifteen + menu, bd-fmf24g.35), each keyed app_redirect_<feature>', () => {
    const entries = Object.entries(svc.APP_REDIRECT_FLAGS);
    expect(entries).toHaveLength(16);
    for (const [feature, key] of entries) expect(key).toBe(`app_redirect_${feature}`);
    expect(Object.keys(svc.APP_REDIRECT_FLAGS).sort()).toEqual([
      'ai_coaching', 'assessment_generator', 'attendance', 'classes', 'exam_checker',
      'general_chat', 'homework', 'lesson_plan', 'menu', 'observe', 'presentation', 'quiz',
      'reading_test', 'remark', 'teacher_training', 'video',
    ]);
  });

  test('an unknown feature is a programming error, not a silent off', async () => {
    await expect(ask('lesson_plans')).rejects.toThrow(/unknown feature/);
  });
});

describe('fail closed — off means today\'s behaviour', () => {
  test('no row → not handled, nothing sent, nothing recorded', async () => {
    expect(await ask('lesson_plan')).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockState.upserts).toHaveLength(0);
  });

  test.each([[false], ['false'], ['yes'], [1], [null], [{}]])('value %p → off', async (value) => {
    mockState.settings.push({ key: 'app_redirect_lesson_plan', value });
    expect(await ask('lesson_plan')).toBe(false);
  });

  test.each([[true], ['true'], ['"true"'], [' TRUE ']])('value %p → on', async (value) => {
    mockState.settings.push({ key: 'app_redirect_lesson_plan', value });
    expect(await ask('lesson_plan')).toBe(true);
  });

  test('a failed lookup → off', async () => {
    on('app_redirect_lesson_plan');
    mockState.settingsError = true;
    expect(await ask('lesson_plan')).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('one switch on does not redirect another feature', async () => {
    on('app_redirect_teacher_training');
    expect(await ask('lesson_plan')).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('an unregistered sender (no user id) is never redirected', async () => {
    on('app_redirect_lesson_plan');
    expect(await svc.redirectIfFlagged('lesson_plan', { userId: null, from: FROM, now: T0 })).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('switch on — the notice', () => {
  test('one message, the Play Store link, her language; recorded for the quiet hour', async () => {
    on('app_redirect_teacher_training');
    expect(await ask('teacher_training', { language: 'ur' })).toBe(true);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, body] = mockSend.mock.calls[0];
    expect(to).toBe(FROM);
    expect(body).toBe(resolveUx('appRedirectNotice', { language: 'ur', params: { url: PLAY } }));
    expect(body).toContain(PLAY);

    expect(mockState.upserts).toHaveLength(1);
    const { row, opts } = mockState.upserts[0];
    expect(row).toEqual({
      user_id: 'u-1', feature: 'app_redirect_notice',
      video_shown_at: new Date(T0).toISOString(), intro_shown_count: 1,
    });
    expect(opts).toEqual({ onConflict: 'user_id,feature' });
  });

  test('English copy carries the link too', async () => {
    on('app_redirect_lesson_plan');
    await ask('lesson_plan', { language: 'en' });
    expect(mockSend.mock.calls[0][1]).toBe(resolveUx('appRedirectNotice', { language: 'en', params: { url: PLAY } }));
  });

  test('APP_STORE_URL overrides the link', async () => {
    process.env.APP_STORE_URL = 'https://example.org/app/';
    jest.resetModules();
    svc = require('../../bot/shared/services/app-redirect.service');
    on('app_redirect_lesson_plan');
    await ask('lesson_plan');
    expect(mockSend.mock.calls[0][1]).toContain('https://example.org/app');
  });

  test('a failed send is still handled (no feature runs) but is NOT recorded, so the next ask retries', async () => {
    on('app_redirect_lesson_plan');
    mockSend.mockResolvedValueOnce(false);
    expect(await ask('lesson_plan')).toBe(true);
    expect(mockState.upserts).toHaveLength(0);

    expect(await ask('lesson_plan', { now: T0 + MIN })).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('a send that throws is handled the same way', async () => {
    on('app_redirect_lesson_plan');
    mockSend.mockRejectedValueOnce(new Error('graph down'));
    expect(await ask('lesson_plan')).toBe(true);
    expect(mockState.upserts).toHaveLength(0);
  });
});

describe('the quiet hour — per teacher, across every switch', () => {
  beforeEach(() => on('app_redirect_lesson_plan', 'app_redirect_teacher_training'));

  test('inside the hour: handled, and NOTHING is sent', async () => {
    await ask('lesson_plan');
    expect(await ask('lesson_plan', { now: T0 + 10 * MIN })).toBe(true);
    expect(await ask('lesson_plan', { now: T0 + 59 * MIN })).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('a DIFFERENT feature inside the hour is silent too (one clock per teacher)', async () => {
    await ask('lesson_plan');
    expect(await ask('teacher_training', { now: T0 + 5 * MIN })).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('after the hour the notice goes again, and the clock restarts', async () => {
    await ask('lesson_plan');
    await ask('lesson_plan', { now: T0 + 61 * MIN });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockState.firstUse[0].intro_shown_count).toBe(2);
    expect(mockState.firstUse[0].video_shown_at).toBe(new Date(T0 + 61 * MIN).toISOString());

    await ask('lesson_plan', { now: T0 + 90 * MIN });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('exactly 60 minutes later is past the hour', async () => {
    await ask('lesson_plan');
    await ask('lesson_plan', { now: T0 + 60 * MIN });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('another teacher has her own clock', async () => {
    await ask('lesson_plan', { userId: 'u-1' });
    await ask('lesson_plan', { userId: 'u-2', now: T0 + MIN });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('a clock that cannot be read sends rather than going silent', async () => {
    await ask('lesson_plan');
    mockState.firstUseError = true;
    await ask('lesson_plan', { now: T0 + MIN });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('the intro rows other features keep are not mistaken for the notice', async () => {
    mockState.firstUse.push({ user_id: 'u-1', feature: 'lesson_plan', video_shown_at: new Date(T0).toISOString() });
    await ask('lesson_plan', { now: T0 + MIN });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe('the switches are read together and held briefly', () => {
  test('one app_settings read serves many messages inside the TTL', async () => {
    on('app_redirect_general_chat');
    await ask('general_chat');
    await ask('lesson_plan', { now: T0 + 1000 });
    await ask('quiz', { now: T0 + 2000 });
    expect(mockState.settingsReads).toBe(1);
  });

  test('a flip takes effect once the TTL passes', async () => {
    expect(await ask('lesson_plan')).toBe(false);
    on('app_redirect_lesson_plan');
    expect(await ask('lesson_plan', { now: T0 + svc.FLAG_TTL_MS - 1 })).toBe(false);
    expect(await ask('lesson_plan', { now: T0 + svc.FLAG_TTL_MS })).toBe(true);
  });

  test('a failed read is not cached — the next message retries', async () => {
    on('app_redirect_lesson_plan');
    mockState.settingsError = true;
    expect(await ask('lesson_plan')).toBe(false);
    mockState.settingsError = false;
    expect(await ask('lesson_plan', { now: T0 + 1000 })).toBe(true);
  });
});

describe('the copy fits WhatsApp', () => {
  test.each(['en', 'ur'])('%s body is within the 1,024 code-point cap', (language) => {
    const body = resolveUx('appRedirectNotice', { language, params: { url: PLAY } });
    expect([...body].length).toBeLessThanOrEqual(1024);
    expect(body.split('\n').pop().replace(/[‎‏⁦-⁩]/g, '')).toBe(PLAY);
  });
});
