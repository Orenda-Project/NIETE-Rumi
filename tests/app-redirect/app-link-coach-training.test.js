'use strict';
/**
 * bd-s42dye.3 — a coach's /training opens the coach app's Training Library, behind its own switch.
 *
 * The coach app link (bd-fmf24g.52) covered /menu and /observe, both behind `coach_app_link`. /training is a third
 * request with its OWN switch, `coach_app_training`, so turning it on never moves /menu or /observe and the other way
 * round. The operator, 2026-10-17: "Teachers already have one switch per slash command ... Coaches get the same
 * per-feature model. Only /training goes to the app for coaches."
 *
 *   coach_app_training:  true (every coach) | "coaches" (every users.role = coach) | a JSON list of users.id
 *                        a missing row, any other value, or a failed read is OFF — today's WhatsApp Flow.
 *   AND the coach is on the coach app (portal_coach_v2: true or a list holding them), AND users.role is coach.
 *
 * The token (feature coach_training) lands /portal/coach/training; /go sends a coach who is off the coach app to the
 * legacy dashboard. Driven through the real redirectIfFlagged -> sendAppLink path with only the edges mocked.
 */
const http = require('http');
const express = require('express');

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
const row = (role, extra = {}) => ({ id: ME, role, name: 'Hataf', registration_completed: true, registration_state: 'completed', ...extra });

let svc; let link; let logger;
beforeEach(() => {
  jest.resetModules();
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  mockState = { settings: [], users: { [ME]: row('coach') }, usersError: false, settingsError: false, userReads: 0, upserts: 0 };
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: SUPA };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
  logger = require('../../bot/shared/utils/logger');
});
afterAll(() => { process.env = ENV; });

const set = (key, value) => mockState.settings.push({ key, value });
const ask = (feature, { userId = ME, language = 'en', reason = 'command' } = {}) =>
  svc.redirectIfFlagged(feature, { userId, from: FROM, language, reason });
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
const funnel = () => logger.logToFile.mock.calls.filter(([n]) => String(n).startsWith('app_funnel.'));

describe('a coach asks /training with the switch on', () => {
  test.each([
    ['true', () => set('coach_app_training', true)],
    ['"true" (JSON text)', () => set('coach_app_training', 'true')],
    ['"coaches"', () => set('coach_app_training', 'coaches')],
    ['a list holding them', () => set('coach_app_training', [OTHER, ME])],
    ['a list written as JSON text', () => set('coach_app_training', JSON.stringify([ME]))],
  ])('coach_app_training = %s: ONE cta_url message whose link lands /portal/coach/training', async (_l, on) => {
    on();
    set('portal_coach_v2', [ME]);
    expect(await ask('teacher_training')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'coach_training' }));
    expect(link.COACH_LANDINGS.coach_training).toBe('/portal/coach/training');
    expect(opts.url).not.toContain('play.google.com');
    expect(mockState.upserts).toBe(0); // no quiet hour, no Play Store notice
  });

  test('portal_coach_v2 = true (every coach) counts as on the coach app', async () => {
    set('coach_app_training', true);
    set('portal_coach_v2', true);
    expect(await ask('teacher_training')).toBe(true);
    expect(tokenOf(mockCta.mock.calls[0][1]).f).toBe('coach_training');
  });

  test('a coach role written loosely (" Coach ") is still a coach', async () => {
    set('coach_app_training', 'coaches');
    set('portal_coach_v2', [ME]);
    mockState.users[ME] = row(' Coach ');
    expect(await ask('teacher_training')).toBe(true);
  });

  test.each(['command', 'chip', 'menu', 'training_door'])('door "%s" reaches it', async (reason) => {
    set('coach_app_training', true);
    set('portal_coach_v2', [ME]);
    expect(await ask('teacher_training', { reason })).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
  });

  test('the funnel rows carry audience: coach and the request the coach made (teacher_training)', async () => {
    set('coach_app_training', true);
    set('portal_coach_v2', [ME]);
    await ask('teacher_training');
    const rows = funnel();
    expect(rows.map(([n]) => n)).toEqual(['app_funnel.command', 'app_funnel.link_sent']);
    expect(rows[0][1]).toEqual(expect.objectContaining({ audience: 'coach', feature: 'teacher_training', verdict: 'link', userId: ME }));
    expect(rows[1][1]).toEqual(expect.objectContaining({ feature: 'teacher_training', via: 'cta_url' }));
    expect(JSON.stringify(logger.logToFile.mock.calls)).not.toContain(opsToken());
  });
  function opsToken() { return mockCta.mock.calls[0][1].url.split('/go/')[1]; }

  test('a failed button falls back to the same line + link as plain text; if that fails too, the Flow runs', async () => {
    set('coach_app_training', true);
    set('portal_coach_v2', [ME]);
    mockCta.mockResolvedValue(false);
    expect(await ask('teacher_training')).toBe(true);
    expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
    mockSend.mockResolvedValue(false);
    expect(await ask('teacher_training')).toBe(false);
  });
});

describe('the Flow stays: switch off, unreadable, or the coach is not on the coach app', () => {
  const COACH_APP = () => set('portal_coach_v2', [ME]);
  test.each([
    ['no coach_app_training row', () => { COACH_APP(); }],
    ['false', () => { COACH_APP(); set('coach_app_training', false); }],
    ['"false"', () => { COACH_APP(); set('coach_app_training', 'false'); }],
    ['"teachers" (that is the teacher word)', () => { COACH_APP(); set('coach_app_training', 'teachers'); }],
    ['garbage text', () => { COACH_APP(); set('coach_app_training', 'nope'); }],
    ['a number', () => { COACH_APP(); set('coach_app_training', 1); }],
    ['an object', () => { COACH_APP(); set('coach_app_training', { [ME]: true }); }],
    ['null', () => { COACH_APP(); set('coach_app_training', null); }],
    ['a list without them', () => { COACH_APP(); set('coach_app_training', [OTHER]); }],
    ['an empty list', () => { COACH_APP(); set('coach_app_training', []); }],
    ['switch on but no portal_coach_v2 row', () => { set('coach_app_training', true); }],
    ['switch on but portal_coach_v2 a list without them', () => { set('coach_app_training', true); set('portal_coach_v2', [OTHER]); }],
    ['switch on but portal_coach_v2 = false', () => { set('coach_app_training', true); set('portal_coach_v2', false); }],
    ['switch on but portal_coach_v2 = "teachers" (never a coach)', () => { set('coach_app_training', true); set('portal_coach_v2', 'teachers'); }],
    ['switch on but portal_coach_v2 = "coaches" (not a value it takes)', () => { set('coach_app_training', true); set('portal_coach_v2', 'coaches'); }],
  ])('%s: not handled, nothing sent', async (_l, setup) => {
    setup();
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockState.upserts).toBe(0);
  });

  test('the app_settings read fails: OFF', async () => {
    set('coach_app_training', true); set('portal_coach_v2', [ME]);
    mockState.settingsError = true;
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('no users row, or the users read fails: OFF', async () => {
    set('coach_app_training', true); set('portal_coach_v2', [ME]);
    delete mockState.users[ME];
    expect(await ask('teacher_training')).toBe(false);
    mockState.users[ME] = row('coach');
    mockState.usersError = true;
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test.each([
    ['a principal', 'principal'], ['an aeo', 'aeo'], ['a school leader', 'school_leader'],
    ['unregistered', 'unregistered'], ['no role', null],
  ])('%s on a "true" switch gets no coach link', async (_l, role) => {
    set('coach_app_training', true); set('portal_coach_v2', true);
    mockState.users[ME] = row(role);
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('a coach_app_training list without them costs no users read', async () => {
    set('coach_app_training', [OTHER]); set('portal_coach_v2', [ME]);
    await ask('teacher_training');
    expect(mockState.userReads).toBe(0);
  });

  test('doors that are not "send me into training" keep the Flow: /certificates, exam and capstone buttons', async () => {
    set('coach_app_training', true); set('portal_coach_v2', [ME]);
    for (const reason of ['certificates_command', 'module_exam_button', 'capstone_button']) {
      expect(await ask('teacher_training', { reason })).toBe(false);
    }
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('nobody else moves', () => {
  test('a teacher with coach_app_training true: the teacher path is still app_redirect_teacher_training alone', async () => {
    set('coach_app_training', true); set('portal_coach_v2', true);
    mockState.users[ME] = row('teacher');
    // switch for teachers off: today's Flow
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    // switch for teachers on ("teachers" + teacher app): the TEACHER link, teacher landing
    set('app_redirect_teacher_training', 'teachers'); set('portal_teacher_v2', 'teachers');
    svc._resetForTests();
    expect(await ask('teacher_training')).toBe(true);
    const t = tokenOf(mockCta.mock.calls[0][1]);
    expect(t).toEqual(expect.objectContaining({ u: ME, f: 'teacher_training' }));
    expect(link.LANDINGS[t.f]).toBe('/portal/teacher/training');
    expect(funnel()[0][1].audience).toBe('teacher');
  });

  test('a coach with the switch off and app_redirect_teacher_training = true gets exactly today\'s Play Store notice', async () => {
    set('app_redirect_teacher_training', true); set('portal_coach_v2', [ME]);
    expect(await ask('teacher_training')).toBe(true);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend.mock.calls[0][1]).toContain('play.google.com');
  });

  test('/observe and /menu for a coach are unchanged with coach_app_training on and coach_app_link empty', async () => {
    set('coach_app_training', true); set('portal_coach_v2', [ME]); set('coach_app_link', []);
    expect(await ask('observe')).toBe(false);
    expect(await ask('menu')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('/observe and /menu still ride coach_app_link alone, and coach_app_link does NOT turn /training on', async () => {
    set('portal_coach_v2', [ME]); set('coach_app_link', [ME]);
    expect(await ask('teacher_training')).toBe(false);
    expect(mockCta).not.toHaveBeenCalled();
    expect(await ask('observe')).toBe(true);
    expect(await ask('menu')).toBe(true);
    expect(mockCta.mock.calls.map(([, o]) => tokenOf(o).f)).toEqual(['coach_observe', 'coach_menu']);
  });

  test('coach_app_link = "coaches" / true is still OFF for /observe (only a list), even with the training switch on', async () => {
    set('portal_coach_v2', [ME]); set('coach_app_training', 'coaches'); set('coach_app_link', 'coaches');
    expect(await ask('observe')).toBe(false);
    expect(await ask('menu')).toBe(false);
  });

  test('every other feature for a coach with the training switch on is today\'s path', async () => {
    set('coach_app_training', true); set('portal_coach_v2', [ME]);
    for (const f of Object.keys(svc.APP_REDIRECT_FLAGS).filter((k) => k !== 'teacher_training')) {
      expect(await ask(f)).toBe(false);
    }
    expect(mockCta).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('general_chat (asked on every open message) never reads the users row, even with the training switch on', async () => {
    set('coach_app_training', 'coaches'); set('portal_coach_v2', [ME]);
    await ask('general_chat');
    expect(mockState.userReads).toBe(0);
  });

  test('the switch is its own key, never an app_redirect_* key (a rollback reads it as nothing)', () => {
    expect(Object.values(svc.APP_REDIRECT_FLAGS)).not.toContain('coach_app_training');
  });
});

/* (g) the copy: the Training Library's words, en + ur, button <= 20 code points, one line. */
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');
const codePoints = (s) => [...s].length;
describe.each([
  ['en', 'Open the Training Library.', 'Open library'],
  ['ur', 'ٹریننگ لائبریری کھولیں۔', 'لائبریری کھولیں'],
])('copy in %s', (language, body, button) => {
  test('its own line and button, within the WhatsApp caps', async () => {
    set('coach_app_training', true); set('portal_coach_v2', [ME]);
    expect(await ask('teacher_training', { language })).toBe(true);
    const opts = mockCta.mock.calls[0][1];
    expect(shown(opts.body)).toBe(body);
    expect(shown(opts.buttonText)).toBe(button);
    expect(codePoints(opts.buttonText)).toBeLessThanOrEqual(20);
    expect(codePoints(opts.body)).toBeLessThanOrEqual(1024);
    expect(opts.body.split('\n')).toHaveLength(1);
    expect(opts.body).not.toMatch(/sign(ed)?[\s-]*in|لاگ\s*اِ?ن/i);
  });
});

test('the teacher\'s /training words are untouched', async () => {
  set('app_redirect_teacher_training', 'teachers'); set('portal_teacher_v2', 'teachers');
  mockState.users[ME] = row('teacher');
  await ask('teacher_training');
  expect(mockCta.mock.calls[0][1]).toEqual(expect.objectContaining({ body: 'Open your training.', buttonText: 'Training' }));
});

describe('the token', () => {
  test('coach_training signs and verifies; the other coach and teacher landings are unchanged', () => {
    const t = link.signAppLink(ME, 'coach_training');
    expect(link.verifyAppLink(t)).toEqual(expect.objectContaining({ u: ME, f: 'coach_training' }));
    expect(link.COACH_LANDINGS).toEqual({
      coach_menu: '/portal/coach', coach_observe: '/portal/coach/observe', coach_training: '/portal/coach/training',
    });
    expect(link.LANDINGS.teacher_training).toBe('/portal/teacher/training');
  });
});

/* (f) /go/:token — the route that lands it. */
describe('GET /go/:token for coach_training', () => {
  let servers = []; let sessions;
  beforeEach(() => { sessions = []; });
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app({ coachApp, teacherV2 = false }) {
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent() {}, flush() {}, isEnabled: () => true }));
    const a = express();
    a.use((req, _res, next) => {
      const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
      req.session = s; sessions.push(s); next();
    });
    a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
      findUser: async (id) => (id === ME ? { id: ME, name: 'Hataf' } : null),
      isTeacherV2: async () => teacherV2,
      isCoachApp: async () => { if (coachApp instanceof Error) throw coachApp; return coachApp; },
    }));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const get = (srv, path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
    }).on('error', reject);
  });
  const tok = () => link.signAppLink(ME, 'coach_training');

  test('a coach on the coach app lands /portal/coach/training, signed in to the whole app', async () => {
    const res = await get(await app({ coachApp: true }), `/go/${tok()}`);
    expect(res).toEqual({ status: 303, location: '/portal/coach/training' });
    expect(sessions[0]).toEqual(expect.objectContaining({ portalUserId: ME, isPortalAuth: true }));
    expect(sessions[0].portalScope).toBeUndefined();
  });

  test('a coach no longer on the coach app lands the legacy dashboard, even on the teacher app', async () => {
    const res = await get(await app({ coachApp: false, teacherV2: true }), `/go/${tok()}`);
    expect(res).toEqual({ status: 303, location: '/portal/dashboard' });
  });

  test('the coach-app check throws: the legacy dashboard (fail closed)', async () => {
    const res = await get(await app({ coachApp: new Error('db down') }), `/go/${tok()}`);
    expect(res).toEqual({ status: 303, location: '/portal/dashboard' });
  });
});
