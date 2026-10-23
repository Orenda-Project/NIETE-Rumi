'use strict';
/**
 * bd-zcgpkx, then bd-a73p5m — a LEADER's "lesson plan" opens the app, like a teacher's opens the teacher app.
 *
 * bd-zcgpkx (19 Oct): the lesson-plan link went to registered teachers only (app_redirect_lesson_plan = "teachers"); a
 * coach or principal got `why: not_a_teacher` and the WhatsApp catalogue Flow. The operator, 19 Oct: "Send leaders
 * straight into the app, the same as teachers". It landed on Send a lesson plan (the FLN builder).
 *
 * bd-a73p5m (23 Oct): since bd-4joiqz a leader reads every lesson plan in the Lesson Plans tab
 * (/portal/teacher/lessons). The operator: "A coach who types 'lesson plan' on WhatsApp still gets 'Send a lesson
 * plan', not the new tab -- they can get new tab". The link now lands on the tab, and FLN share is no longer asked:
 * the tab does not need it. Inside the tab a leader can send only from a Reading Hour / Numeracy plan's own page
 * ("Send to teacher", shown only with FLN share); the builder at /portal/fln/send is not linked from the tab.
 *
 *   leader_app_lesson_plan:  true (every leader) | "coaches" | a JSON list of users.id (a pilot)
 *                            a missing row, any other value, or a failed read is OFF — today's WhatsApp Flow.
 *   AND users.role is in the leader family (observe-gate LEADER_ROLES: school_leader, supervisor, coach, principal, aeo)
 *   AND they are not an analytics-only account (portal_analytics_only).
 *
 * The token's target is `leader_lessons`, which /go lands on /portal/teacher/lessons. Driven through the real
 * redirectIfFlagged -> sendAppLink path, then the real GET /go router, with only the edges mocked.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const http = require('http');
const express = require('express');
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

// GET /go through the real router (dashboard/routes/app-login.routes.js): where a link actually lands.
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
async function tap(url, { teacherApp = false, coachApp = false } = {}) {
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));
  const sessions = [];
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === ME ? { id: ME, name: 'Leader' } : null),
    isTeacherV2: async () => teacherApp,
    isCoachApp: async () => coachApp,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: url.slice(PORTAL.length) }, (r) => {
      r.resume(); r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location }));
    }).on('error', reject);
  });
  return { ...res, session: sessions[0] };
}

describe('a leader asks for lesson plans with the switch on', () => {
  test.each(['coach', 'principal', 'aeo', 'supervisor', 'school_leader', ' Coach ', 'PRINCIPAL'])(
    'role %p: ONE cta_url message whose link lands on the Lesson Plans tab', async (role) => {
      set('leader_app_lesson_plan', true);
      mockState.users[ME] = row(role);
      expect(await ask()).toBe(true);
      expect(mockCta).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      const [to, opts] = mockCta.mock.calls[0];
      expect(to).toBe(FROM);
      expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'leader_lessons' }));
      expect(mockState.upserts).toBe(0); // no Play Store notice, no quiet hour
    });

  test.each([['"true" (JSON text)', 'true'], ['a list holding them', [OTHER, ME]], ['a list as JSON text', JSON.stringify([ME])]])(
    'leader_app_lesson_plan = %s also covers them', async (_l, value) => {
      set('leader_app_lesson_plan', value);
      expect(await ask()).toBe(true);
      expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('leader_lessons');
    });

  // The plain "open lesson plans" doors.
  test.each(['bare_command', 'chip', 'menu', 'menu_choice'])('plain door %p reaches it', async (reason) => {
    set('leader_app_lesson_plan', true);
    expect(await ask({ reason })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  // bd-l6424d — and the doors where a leader NAMES A TOPIC. Until 23 Oct these kept the WhatsApp catalogue (PR #3069's
  // reason, "the builder has only Reading Hour and Numeracy", stopped holding when the link moved to the tab, which has
  // every plan). Asked whether a coach who names a topic should also get the tab, the operator, 23 Oct 2026: "yes to
  // topic requests too". Typed: the lesson_plan intent (intent), a topic typed after the menu asked for one and the
  // Oxbridge picker's "Generate" tap (lesson_plan_intent). Spoken: voice_intent, and voice_lesson_plan_intent inside the
  // catalogue door. (Sandbox also has the worker's in-flight rescue, cutover_inflight_gamma; this branch has no such
  // rescue, so it is not a door here.)
  test.each(['intent', 'lesson_plan_intent', 'voice_intent', 'voice_lesson_plan_intent'])(
    'topic door %p reaches it', async (reason) => {
      set('leader_app_lesson_plan', true);
      expect(await ask({ reason })).toBe(true);
      expect(mockCta).toHaveBeenCalledTimes(1);
      expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('leader_lessons');
    });

  // `ft_fallback` (the first-touch "Lesson plan" button, first-touch/maker.fallback.js) and `pic_lp_book_page` (a photo
  // of a textbook page, image-message.handler) are in neither list: a covered coach there still gets today's WhatsApp
  // path. Pinned here so adding either is a deliberate change, not a side effect.
  test.each(['command', 'ice_breaker', 'unspecified', 'keyword', 'ft_fallback', 'pic_lp_book_page'])(
    'door %p (not one this switch opens) keeps today\'s path', async (reason) => {
      set('leader_app_lesson_plan', true);
      expect(await ask({ reason })).toBe(false);
      expect(mockCta).not.toHaveBeenCalled();
    });

  test('"coaches" at a topic door: a coach gets the tab, a principal keeps the WhatsApp catalogue', async () => {
    set('leader_app_lesson_plan', 'coaches');
    expect(await ask({ reason: 'intent' })).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('leader_lessons');

    mockCta.mockClear();
    svc._resetForTests();
    mockState.users[ME] = row('principal');
    expect(await ask({ reason: 'intent' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
  });

  test('a topic door asks nothing for a request that is not a lesson plan: general chat at `intent` is never moved', async () => {
    set('leader_app_lesson_plan', true);
    set('app_redirect_general_chat', false);
    expect(await ask({ feature: 'general_chat', reason: 'intent' })).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockState.userReads).toBe(0);
  });

  test('"coaches" covers coaches only: a coach gets the link, a principal keeps the WhatsApp menu', async () => {
    set('leader_app_lesson_plan', 'coaches');
    expect(await ask()).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('leader_lessons');

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

  test('the journey rides the link into the portal session, so the tab\'s page rows join lesson_plan@leader', async () => {
    set('leader_app_lesson_plan', true);
    await ask();
    const { journeyId } = funnel()[0][1];
    const { session } = await tap(mockCta.mock.calls[0][1].url);
    expect(session.appJourney).toEqual(expect.objectContaining({ id: journeyId, feature: 'leader_lessons' }));
    // The tab's address is a lesson-plan page in the funnel (app-journey FEATURE_PREFIXES).
    expect(require('../../bot/shared/services/app-journey').featureOfRoute('/portal/teacher/lessons')).toBe('lesson_plan');
  });
});

describe('GET /go: the link lands on the Lesson Plans tab, wherever the leader is', () => {
  test.each([
    ['on neither app (the classic leader portal)', { teacherApp: false, coachApp: false }],
    ['on the coach app', { teacherApp: false, coachApp: true }],
    ['a principal on the teacher app', { teacherApp: true, coachApp: false }],
  ])('%s → 303 /portal/teacher/lessons, signed in, no-store', async (_l, apps) => {
    set('leader_app_lesson_plan', true);
    await ask();
    const res = await tap(mockCta.mock.calls[0][1].url, apps);
    expect(res.status).toBe(303);
    expect(res.location).toBe('/portal/teacher/lessons');
    expect(res.session).toEqual(expect.objectContaining({ portalUserId: ME, isPortalAuth: true }));
  });

  test('a leader token asks neither app question: the tab decides who reads it', async () => {
    set('leader_app_lesson_plan', true);
    await ask();
    const asked = [];
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush() {}, isEnabled: () => true }));
    const a = express();
    a.use((req, _res, next) => { req.session = { regenerate(cb) { cb(); }, save(cb) { cb(); } }; next(); });
    a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
      findUser: async (id) => (id === ME ? { id: ME, name: 'Leader' } : null),
      isTeacherV2: async () => { asked.push('teacher_app'); return false; },
      isCoachApp: async () => { asked.push('coach_app'); return false; },
    }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    const location = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: mockCta.mock.calls[0][1].url.slice(PORTAL.length) }, (r) => {
        r.resume(); r.on('end', () => resolve(r.headers.location));
      }).on('error', reject);
    });
    expect(location).toBe('/portal/teacher/lessons');
    expect(asked).toEqual([]);
  });

  test('a link sent before this change (fln:send) still lands on Send a lesson plan for its 24 hours', async () => {
    const res = await tap(`${PORTAL}/go/${link.signAppLink(ME, 'fln:send')}`);
    expect(res.location).toBe('/portal/fln/send');
  });

  test.each([['leader_lessonsx'], ['leader_lessons/x'], ['LEADER_LESSONS'], [' leader_lessons']])('%p cannot be signed', (f) => {
    expect(link.signAppLink(ME, f)).toBeNull();
  });
});

describe('FLN share is not asked: the tab does not need it', () => {
  test.each([['no portal_fln_share row', undefined], ['portal_fln_share false', false], ['a list without them', [OTHER]]])(
    '%s: the leader still gets the link to the tab', async (_l, value) => {
      set('leader_app_lesson_plan', true);
      unset('portal_fln_share');
      if (value !== undefined) set('portal_fln_share', value);
      expect(await ask()).toBe(true);
      expect(mockCta).toHaveBeenCalledTimes(1);
      expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('leader_lessons');
    });
});

describe('the words', () => {
  const codePoints = (s) => [...String(s)].length;
  const SIGNED_IN = /sign(ed)?[\s-]*in|لاگ\s*اِ?ن|پہلے سے/i; // as tests/app-redirect/app-link-copy.test.js
  const WORDS = {
    en: { body: 'Read the lesson plans your teachers get.', button: 'Lesson plans' },
    ur: { body: 'وہ لیسن پلان پڑھیں جو آپ کے اساتذہ کو ملتے ہیں۔', button: 'لیسن پلان' },
  };
  // Red team, PR #3579: most plans in the tab (Grades 1-5, 6-12) have no send button for a leader, and an FLN plan's
  // "Send to teacher" shows only with FLN share, which this link no longer asks for. The line must not promise it.
  test.each(['en', 'ur'])('%s: the line promises reading, never sending', async (language) => {
    set('leader_app_lesson_plan', true);
    await ask({ language });
    const { body } = mockCta.mock.calls[0][1];
    expect(body).not.toMatch(/send/i);
    expect(body).not.toMatch(/بھیج/);
  });
  test.each(['en', 'ur'])('%s: the Lesson Plans tab\'s line and button', async (language) => {
    set('leader_app_lesson_plan', true);
    await ask({ language });
    const { body, buttonText } = mockCta.mock.calls[0][1];
    expect(body).toBe(WORDS[language].body);
    expect(buttonText).toBe(WORDS[language].button);
    expect(codePoints(body)).toBeLessThanOrEqual(1024);
  });
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

  test('an analytics-only leader keeps today\'s path (the portal sends them to analytics, not the tab)', async () => {
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
