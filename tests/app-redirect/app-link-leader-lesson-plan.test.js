'use strict';
/**
 * bd-zcgpkx — a LEADER's "lesson plan" opens the app on Send a lesson plan, like a teacher's opens the teacher app.
 *
 * Until now the lesson-plan link went to registered teachers only (app_redirect_lesson_plan = "teachers"); a coach or
 * principal got `why: not_a_teacher` and the WhatsApp catalogue Flow, which has no Reading Hour or Numeracy plans
 * (32 of 482 lesson-plan commands on 19 Oct). The operator, 19 Oct: "Send leaders straight into the app, the same as
 * teachers ... let's do this", accepting that leaders lose the WhatsApp picker.
 *
 *   leader_app_lesson_plan:  true (every leader) | a JSON list of users.id (a pilot)
 *                            a missing row, any other value, or a failed read is OFF — today's WhatsApp Flow.
 *   AND users.role is in the leader family (observe-gate LEADER_ROLES: school_leader, supervisor, coach, principal, aeo)
 *   AND FLN share is on for them (portal_fln_share: true or a list holding them) — the builder 404s without it.
 *
 * The token's target is `fln:send`, which /go lands on /portal/fln/send. Driven through the real
 * redirectIfFlagged -> sendAppLink path with only the edges mocked, as app-link-coach-training.test.js is.
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
    in: (_c, vals) => {
      if (mockState.settingsError) return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: mockState.settings.filter((r) => vals.includes(r.key)), error: null });
    },
    maybeSingle: () => {
      if (table === 'users') {
        mockState.userReads += 1;
        if (mockState.usersError) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: mockState.users[filters.id] || null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert: () => { mockState.upserts += 1; return Promise.resolve({ error: null }); },
  };
  return chain;
}

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923330000099';
const PORTAL = 'https://portal.example.test';
const SUPA = 'https://abcdefgh.supabase.co';
const row = (role) => ({ id: ME, role, name: 'Leader', registration_completed: true, registration_state: 'completed' });

let svc; let link; let logger;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  // Production today: the teacher link is on for every teacher, FLN share is on for everyone.
  mockState = {
    settings: [{ key: 'app_redirect_lesson_plan', value: 'teachers' }, { key: 'portal_fln_share', value: true }],
    users: { [ME]: row('coach') }, usersError: false, settingsError: false, upserts: 0, userReads: 0,
  };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: SUPA };
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
  logger = require('../../bot/shared/utils/logger');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const unset = (key) => { mockState.settings = mockState.settings.filter((r) => r.key !== key); };
const ask = ({ feature = 'lesson_plan', language = 'en', reason = 'bare_command' } = {}) =>
  svc.redirectIfFlagged(feature, { userId: ME, from: FROM, language, reason });
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
const funnel = () => logger.logToFile.mock.calls.filter(([n]) => String(n).startsWith('app_funnel.'));

describe('a leader asks for lesson plans with the switch on', () => {
  test.each(['coach', 'principal', 'aeo', 'supervisor', 'school_leader', ' Coach ', 'PRINCIPAL'])(
    'role %p: ONE cta_url message whose link lands Send a lesson plan', async (role) => {
      set('leader_app_lesson_plan', true);
      mockState.users[ME] = row(role);
      expect(await ask()).toBe(true);
      expect(mockCta).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      const [to, opts] = mockCta.mock.calls[0];
      expect(to).toBe(FROM);
      expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'fln:send' }));
      expect(require('../../bot/shared/services/fln-go-target').flnPathFor('fln:send')).toBe('/portal/fln/send');
      expect(mockState.upserts).toBe(0); // no Play Store notice, no quiet hour
    });

  test.each([['"true" (JSON text)', 'true'], ['a list holding them', [OTHER, ME]], ['a list as JSON text', JSON.stringify([ME])]])(
    'leader_app_lesson_plan = %s also covers them', async (_l, value) => {
      set('leader_app_lesson_plan', value);
      expect(await ask()).toBe(true);
      expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('fln:send');
    });

  // The plain "open lesson plans" doors only. A leader who names a topic keeps today's path: the builder has only
  // Reading Hour and Numeracy, so "photosynthesis, grade 7" would land on a page without it (red team, PR #3069).
  test.each(['bare_command', 'chip', 'menu', 'menu_choice'])('plain door %p reaches it', async (reason) => {
    set('leader_app_lesson_plan', true);
    expect(await ask({ reason })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test.each(['lesson_plan_intent', 'voice_lesson_plan_intent', 'voice_intent', 'cutover_inflight_gamma', 'command'])(
    'door %p (a named topic, or not an open-the-plans door) keeps today\'s path', async (reason) => {
      set('leader_app_lesson_plan', true);
      expect(await ask({ reason })).toBe(false);
      expect(mockCta).not.toHaveBeenCalled();
    });

  test('"coaches" covers coaches only: a coach gets the link, a principal keeps the WhatsApp menu', async () => {
    set('leader_app_lesson_plan', 'coaches');
    expect(await ask()).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('fln:send');

    mockCta.mockClear();
    svc._resetForTests();
    mockState.users[ME] = row('principal');
    expect(await ask()).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('the funnel rows say audience: leader, the request lesson_plan, verdict link — and never the token', async () => {
    set('leader_app_lesson_plan', true);
    await ask();
    const rows = funnel();
    expect(rows.map(([n]) => n)).toEqual(['app_funnel.command', 'app_funnel.link_sent']);
    expect(rows[0][1]).toEqual(expect.objectContaining({ audience: 'leader', feature: 'lesson_plan', verdict: 'link', userId: ME }));
    expect(rows[1][1]).toEqual(expect.objectContaining({ audience: 'leader', feature: 'lesson_plan', via: 'cta_url' }));
    const token = mockCta.mock.calls[0][1].url.split('/go/')[1];
    expect(JSON.stringify(logger.logToFile.mock.calls)).not.toContain(token);
  });
});

describe('the words', () => {
  const codePoints = (s) => [...String(s)].length;
  const SIGNED_IN = /sign(ed)?[\s-]*in|لاگ\s*اِ?ن|پہلے سے/i; // as tests/app-redirect/app-link-copy.test.js
  test.each(['en', 'ur'])('%s: its own line and button, the button within 15 code points (the repo\'s headroom under 20), nothing about signing in', async (language) => {
    set('leader_app_lesson_plan', true);
    await ask({ language });
    const { body, buttonText } = mockCta.mock.calls[0][1];
    expect(body).toBeTruthy();
    expect(buttonText).toBeTruthy();
    expect(codePoints(buttonText)).toBeLessThanOrEqual(15);
    expect(`${body} ${buttonText}`).not.toMatch(SIGNED_IN);
    // Not the teacher's line: a leader is sent to plans for their teachers, not "your lesson plans".
    expect(body).not.toBe(language === 'en' ? 'Open your lesson plans.' : 'اپنے لیسن پلان کھولیں۔');
  });
});

describe('everyone the switch does not cover keeps today\'s path', () => {
  test('no leader_app_lesson_plan row: a coach gets the WhatsApp Flow (not_a_teacher), exactly as before', async () => {
    expect(await ask()).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(funnel()[0][1]).toEqual(expect.objectContaining({ verdict: 'whatsapp', why: 'not_a_teacher' }));
  });

  test.each([['false', false], ['"leaders"', 'leaders'], ['"teachers"', 'teachers'], ['an object', { on: true }], ['a list without them', [OTHER]]])(
    'leader_app_lesson_plan = %s is OFF for them', async (_l, value) => {
      set('leader_app_lesson_plan', value);
      expect(await ask()).toBe(false);
      expect(mockCta).not.toHaveBeenCalled();
    });

  test('FLN share off for them: no link (the builder would refuse them) — the WhatsApp Flow runs', async () => {
    set('leader_app_lesson_plan', true);
    unset('portal_fln_share');
    expect(await ask()).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(logger.logToFile).toHaveBeenCalledWith(expect.stringMatching(/Leader app link: not for this user/), expect.objectContaining({ why: 'fln_share_off' }));
  });

  test('an analytics-only leader keeps today\'s path (the portal sends them to analytics, not the builder)', async () => {
    set('leader_app_lesson_plan', true);
    set('portal_analytics_only', [ME]);
    expect(await ask()).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(logger.logToFile).toHaveBeenCalledWith(expect.stringMatching(/Leader app link: not for this user/), expect.objectContaining({ why: 'analytics_only' }));
  });

  test('a teacher\'s ask with the leader switch on reads the users row once, not twice', async () => {
    set('leader_app_lesson_plan', true);
    set('portal_teacher_v2', 'teachers');
    mockState.users[ME] = row('teacher');
    expect(await ask()).toBe(true);
    expect(mockState.userReads).toBe(1);
  });

  test('a failed switch read: today\'s Flow, never silence', async () => {
    set('leader_app_lesson_plan', true);
    mockState.settingsError = true;
    expect(await ask()).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a failed users read: today\'s Flow', async () => {
    set('leader_app_lesson_plan', true);
    mockState.usersError = true;
    expect(await ask()).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a teacher is untouched: the teacher link, to the teacher app, as before', async () => {
    set('leader_app_lesson_plan', true);
    set('portal_teacher_v2', 'teachers');
    mockState.users[ME] = row('teacher');
    expect(await ask()).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('lesson_plan');
  });

  test('only lesson plans: a leader\'s other requests are not moved by this switch', async () => {
    set('leader_app_lesson_plan', true);
    set('app_redirect_ai_coaching', 'teachers');
    expect(await ask({ feature: 'ai_coaching' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });
});
