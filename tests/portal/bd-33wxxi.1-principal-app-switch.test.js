/**
 * bd-33wxxi.1 — the principal app's switch (P0 of the principal portal revamp).
 *
 * `portal_principal_app` (app_settings) puts a PRINCIPAL on the teacher app the teachers already have:
 *
 *   ["<users.id>", …]   on for the principals it names
 *   true / "true"       on for every principal
 *   no row, anything else, a failed read, or no session → OFF (fail-closed, isFlagEnabledForUser's rule)
 *
 * It only ever opens the app for users.role principal: a teacher or a coach on the list is unchanged, so a coach who
 * is also a principal at a school keeps the coach app. When it is on for her, the three teacher-app switches
 * (portal_teacher_v2, portal_teacher_home_card, portal_teacher_home_look) answer ON for her, on /config and on every
 * route they gate. Off (every real principal today), every answer is exactly what it was: /portal/leader as today.
 *
 * The helpers: principalSchoolOf (lib/leader-role.js: is she a principal, and her users.school_id), isPrincipalAppUser
 * and teacherAppOnFor (lib/teacher-app.js).
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const fs = require('fs');
const path = require('path');

const PRINCIPAL = 'p-1';
const OTHER_PRINCIPAL = 'p-2';
const TEACHER = 't-1';
const COACH = 'c-1';
const SCHOOL = 'school-1126';

let settings;
let users;
let usersError;
let settingsError;
let userReads;

/** app_settings rows by key, users rows by id; any other table answers nothing. */
function fakeSupabase() {
  return {
    from(table) {
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_col, val) => { key = val; return chain; },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === 'users') {
            userReads += 1;
            if (usersError) return { data: null, error: { message: 'users down' } };
            return { data: Object.prototype.hasOwnProperty.call(users, key) ? users[key] : null, error: null };
          }
          if (table === 'app_settings') {
            if (settingsError) return { data: null, error: { message: 'settings down' } };
            return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      chain.single = chain.maybeSingle;
      return chain;
    },
    rpc: jest.fn(),
  };
}

function resetData() {
  settings = {};
  users = {
    [PRINCIPAL]: { role: 'principal', school_id: SCHOOL },
    [OTHER_PRINCIPAL]: { role: 'principal', school_id: null },
    [TEACHER]: { role: 'teacher', school_id: SCHOOL },
    [COACH]: { role: 'coach', school_id: SCHOOL },
  };
  usersError = false;
  settingsError = false;
  userReads = 0;
}

beforeEach(resetData);

/* ── the key and the role helper ───────────────────────────────────────── */

describe('portal_principal_app — the key', () => {
  test('the key is portal_principal_app, exported by feature-flags', () => {
    expect(require('../../dashboard/lib/feature-flags').PORTAL_PRINCIPAL_APP_KEY).toBe('portal_principal_app');
  });
});

describe('principalSchoolOf (lib/leader-role.js)', () => {
  const principalSchoolOf = (...a) => require('../../dashboard/lib/leader-role').principalSchoolOf(...a);
  const isPrincipalRole = (...a) => require('../../dashboard/lib/leader-role').isPrincipalRole(...a);

  test('isPrincipalRole: principal (any case, trimmed) only', () => {
    expect(isPrincipalRole('principal')).toBe(true);
    expect(isPrincipalRole(' Principal ')).toBe(true);
    for (const r of ['teacher', 'coach', 'aeo', 'school_leader', '', null, undefined, 3]) {
      expect(isPrincipalRole(r)).toBe(false);
    }
  });

  test('a principal: her school id; a principal with no school: schoolId null', async () => {
    expect(await principalSchoolOf(fakeSupabase(), PRINCIPAL)).toEqual({ schoolId: SCHOOL });
    expect(await principalSchoolOf(fakeSupabase(), OTHER_PRINCIPAL)).toEqual({ schoolId: null });
  });

  test('a teacher, a coach, no row, no user: null', async () => {
    expect(await principalSchoolOf(fakeSupabase(), TEACHER)).toBeNull();
    expect(await principalSchoolOf(fakeSupabase(), COACH)).toBeNull();
    expect(await principalSchoolOf(fakeSupabase(), 'nobody')).toBeNull();
    userReads = 0;
    expect(await principalSchoolOf(fakeSupabase(), null)).toBeNull();
    expect(userReads).toBe(0);
  });

  test('a failed read: null, and with strict it throws', async () => {
    usersError = true;
    expect(await principalSchoolOf(fakeSupabase(), PRINCIPAL)).toBeNull();
    await expect(principalSchoolOf(fakeSupabase(), PRINCIPAL, { strict: true })).rejects.toThrow();
  });
});

/* ── isPrincipalAppUser / teacherAppOnFor ──────────────────────────────── */

describe('isPrincipalAppUser (lib/teacher-app.js)', () => {
  const isPrincipalAppUser = (...a) => require('../../dashboard/lib/teacher-app').isPrincipalAppUser(...a);

  test.each([
    ['a list naming her', [PRINCIPAL], PRINCIPAL, true],
    ['a list naming someone else', [OTHER_PRINCIPAL], PRINCIPAL, false],
    ['true (every principal)', true, PRINCIPAL, true],
    ['"true"', 'true', PRINCIPAL, true],
    ['"teachers" (never a principal)', 'teachers', PRINCIPAL, false],
    ['an object', { users: [PRINCIPAL] }, PRINCIPAL, false],
    ['false', false, PRINCIPAL, false],
    ['a teacher on the list', [TEACHER], TEACHER, false],
    ['a coach on the list (keeps the coach app)', [COACH], COACH, false],
    ['true, for a teacher', true, TEACHER, false],
  ])('%s → %p', async (_label, value, userId, expected) => {
    settings.portal_principal_app = value;
    expect(await isPrincipalAppUser(fakeSupabase(), userId)).toBe(expected);
  });

  test('no row: OFF, and her users row is never read', async () => {
    expect(await isPrincipalAppUser(fakeSupabase(), PRINCIPAL)).toBe(false);
    expect(userReads).toBe(0);
  });

  test('a failed settings read or users read: OFF; strict throws', async () => {
    settings.portal_principal_app = [PRINCIPAL];
    usersError = true;
    expect(await isPrincipalAppUser(fakeSupabase(), PRINCIPAL)).toBe(false);
    await expect(isPrincipalAppUser(fakeSupabase(), PRINCIPAL, { strict: true })).rejects.toThrow();
    usersError = false;
    settingsError = true;
    expect(await isPrincipalAppUser(fakeSupabase(), PRINCIPAL)).toBe(false);
  });

  test('no session user: OFF', async () => {
    settings.portal_principal_app = true;
    expect(await isPrincipalAppUser(fakeSupabase(), null)).toBe(false);
  });
});

describe('teacherAppOnFor (lib/teacher-app.js)', () => {
  const teacherAppOnFor = async (...a) => require('../../dashboard/lib/teacher-app').teacherAppOnFor(...a);
  const flags = require('../../dashboard/lib/feature-flags');
  // The three teacher-app switches, by name (the module's own list is checked in the first test).
  const TEACHER_APP_KEYS = ['portal_teacher_v2', 'portal_teacher_home_card', 'portal_teacher_home_look'];

  test('it answers for the three teacher-app switches only', () => {
    expect([...require('../../dashboard/lib/teacher-app').TEACHER_APP_KEYS].sort()).toEqual([
      flags.PORTAL_TEACHER_HOME_CARD_KEY, flags.PORTAL_TEACHER_HOME_LOOK_KEY, flags.PORTAL_TEACHER_V2_KEY,
    ].sort());
  });

  test('another key is refused (the principal switch opens nothing else)', async () => {
    await expect(teacherAppOnFor(fakeSupabase(), flags.PORTAL_TEACHER_HOME_ORDER_KEY, PRINCIPAL)).rejects.toThrow(/teacher-app/);
    await expect(teacherAppOnFor(fakeSupabase(), flags.PORTAL_COACH_V2_KEY, PRINCIPAL)).rejects.toThrow(/teacher-app/);
  });

  test('the switch absent: every answer is the teacher switch\'s own (teachers on, principal and coach off)', async () => {
    for (const key of TEACHER_APP_KEYS) settings[key] = 'teachers';
    for (const key of TEACHER_APP_KEYS) {
      expect(await teacherAppOnFor(fakeSupabase(), key, TEACHER)).toBe(true);
      expect(await teacherAppOnFor(fakeSupabase(), key, PRINCIPAL)).toBe(false);
      expect(await teacherAppOnFor(fakeSupabase(), key, COACH)).toBe(false);
    }
  });

  test('on for her: all three answer ON for the listed principal, and nobody else changes', async () => {
    for (const key of TEACHER_APP_KEYS) settings[key] = 'teachers';
    settings.portal_principal_app = [PRINCIPAL, COACH];
    for (const key of TEACHER_APP_KEYS) {
      expect(await teacherAppOnFor(fakeSupabase(), key, PRINCIPAL)).toBe(true);
      expect(await teacherAppOnFor(fakeSupabase(), key, OTHER_PRINCIPAL)).toBe(false);
      expect(await teacherAppOnFor(fakeSupabase(), key, COACH)).toBe(false);
      expect(await teacherAppOnFor(fakeSupabase(), key, TEACHER)).toBe(true);
    }
  });

  test('a teacher the switch is ON for never costs a principal read', async () => {
    settings.portal_teacher_v2 = [TEACHER];
    settings.portal_principal_app = [PRINCIPAL];
    userReads = 0;
    expect(await teacherAppOnFor(fakeSupabase(), flags.PORTAL_TEACHER_V2_KEY, TEACHER)).toBe(true);
    expect(userReads).toBe(0);
  });

  test('strict: a principal switch that cannot be read throws', async () => {
    settings.portal_principal_app = [PRINCIPAL];
    usersError = true;
    await expect(teacherAppOnFor(fakeSupabase(), flags.PORTAL_TEACHER_V2_KEY, PRINCIPAL, { strict: true })).rejects.toThrow();
    expect(await teacherAppOnFor(fakeSupabase(), flags.PORTAL_TEACHER_V2_KEY, PRINCIPAL)).toBe(false);
  });
});

/* ── GET /config ────────────────────────────────────────────────────────── */

function findRoute(router, method, p) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === p && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${p}`);
}

async function runStack(stack, req) {
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const h of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

describe('GET /config — the principal app', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({
      generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    // What the three tiers hold today: the teacher app for every TEACHER.
    settings.portal_teacher_v2 = 'teachers';
    settings.portal_teacher_home_card = 'teachers';
    settings.portal_teacher_home_look = 'teachers';
  });
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

  async function getConfig(userId) {
    const routes = require('../../dashboard/routes/portal.routes');
    const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined };
    req.session = userId ? { portalUserId: userId, id: 's' } : {};
    return runStack(findRoute(routes, 'get', '/config'), req);
  }

  test('switch absent: a principal gets today\'s answer — teacher app off, principalApp a real false', async () => {
    const { payload } = await getConfig(PRINCIPAL);
    expect(payload.features).toMatchObject({ teacherV2: false, teacherHomeCard: false, teacherHomeLook: false });
    expect(payload.features).toHaveProperty('principalApp', false);
  });

  test('an UNLISTED principal reads exactly as with no row at all (the old /portal/leader, unchanged)', async () => {
    const before = (await getConfig(PRINCIPAL)).payload;
    settings.portal_principal_app = [OTHER_PRINCIPAL];
    jest.resetModules();
    const after = (await getConfig(PRINCIPAL)).payload;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  test('the LISTED principal: the teacher app, its Home card and look, and features.principalApp', async () => {
    settings.portal_principal_app = [PRINCIPAL];
    const { payload } = await getConfig(PRINCIPAL);
    expect(payload.features).toMatchObject({
      teacherV2: true, teacherHomeCard: true, teacherHomeLook: true, principalApp: true,
      // nothing else opens with it
      coachV2: false, schoolCard: false, coachFullApp: false, teacherHomeOrder: false,
    });
  });

  test('teachers and coaches are unchanged by the switch, even when it lists them', async () => {
    const teacherBefore = (await getConfig(TEACHER)).payload;
    const coachBefore = (await getConfig(COACH)).payload;
    settings.portal_principal_app = [TEACHER, COACH];
    jest.resetModules();
    const teacherAfter = (await getConfig(TEACHER)).payload;
    jest.resetModules();
    const coachAfter = (await getConfig(COACH)).payload;
    expect(teacherAfter).toEqual(teacherBefore);
    expect(coachAfter).toEqual(coachBefore);
    expect(teacherAfter.features.principalApp).toBe(false);
    expect(coachAfter.features.principalApp).toBe(false);
  });

  test('logged out, and the error fallback: principalApp false', async () => {
    settings.portal_principal_app = true;
    expect((await getConfig(null)).payload.features.principalApp).toBe(false);
    const routes = require('../../dashboard/routes/portal.routes');
    const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', ip: '127.0.0.1', headers: {}, get: () => undefined };
    Object.defineProperty(req, 'session', { get() { throw new Error('session store down'); } });
    const { statusCode, payload } = await runStack(findRoute(routes, 'get', '/config'), req);
    expect(statusCode).toBe(200);
    expect(payload.features).toMatchObject({ principalApp: false, teacherV2: false });
  });
});

/* ── the routes the teacher-app switches gate ──────────────────────────── */

describe('a route gated on portal_teacher_v2 (GET /me/notices) follows the principal switch', () => {
  let listNotices;
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    listNotices = jest.fn(async () => ({ items: [] }));
    jest.doMock('../../dashboard/services/teacher-notices.service', () => ({ listNotices, markSeen: jest.fn(), markOpened: jest.fn() }));
    jest.doMock('../../dashboard/config/database', () => ({ query: jest.fn() }));
    jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
    jest.doMock('../../dashboard/lib/portal-auth', () => ({
      requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({ success: false })),
    }));
    settings.portal_teacher_v2 = 'teachers';
  });
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

  async function notices(userId) {
    const router = require('../../dashboard/routes/portal-teacher-notices.routes');
    const req = { session: { portalUserId: userId }, query: {}, params: {}, body: {}, method: 'GET', headers: {}, get: () => undefined };
    return runStack(findRoute(router, 'get', '/me/notices'), req);
  }

  test('switch absent: a principal is 404 (as today), a teacher 200', async () => {
    expect((await notices(PRINCIPAL)).statusCode).toBe(404);
    expect((await notices(TEACHER)).statusCode).toBe(200);
  });

  test('listed: the principal is 200; an unlisted principal is still 404', async () => {
    settings.portal_principal_app = [PRINCIPAL];
    expect((await notices(PRINCIPAL)).statusCode).toBe(200);
    expect((await notices(OTHER_PRINCIPAL)).statusCode).toBe(404);
  });
});

describe('every route gated on a teacher-app switch asks teacherAppOnFor', () => {
  const ROUTES_DIR = path.join(__dirname, '../../dashboard/routes');
  const DIRECT = /isFlagEnabledForUser\(\s*supabase\s*,\s*(PORTAL_TEACHER_V2_KEY|PORTAL_TEACHER_HOME_CARD_KEY|PORTAL_TEACHER_HOME_LOOK_KEY)\b/;

  test('no route reads portal_teacher_v2 / home_card / home_look with isFlagEnabledForUser directly', () => {
    const offenders = fs.readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => DIRECT.test(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('the route files that gate on them load lib/teacher-app', () => {
    for (const f of [
      'portal-teacher-home.routes.js', 'portal-teacher-notices.routes.js', 'portal-teacher-coaching.routes.js',
      'portal-teacher-attendance.routes.js', 'portal-teacher-thing-to-try.routes.js', 'portal-share.routes.js',
      'app-login.routes.js',
    ]) {
      expect(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')).toMatch(/require\('\.\.\/lib\/teacher-app'\)/);
    }
  });
});

/* ── lesson-plan opens: a principal on the principal app is a teacher ──── */

describe('lp-reader readerOf — a principal on the principal app opens as a teacher', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
    jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn() }));
    settings.portal_teacher_v2 = 'teachers';
  });
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

  test('switch absent: a principal is a leader reader (as today)', async () => {
    const { readerOf } = require('../../dashboard/services/lp-reader.service');
    expect(await readerOf(PRINCIPAL)).toEqual({ leader: true, role: 'principal' });
  });

  test('listed: the principal is a teacher reader; an unlisted principal stays a leader', async () => {
    settings.portal_principal_app = [PRINCIPAL];
    const { readerOf } = require('../../dashboard/services/lp-reader.service');
    expect(await readerOf(PRINCIPAL)).toEqual({ leader: false, role: 'principal' });
    expect(await readerOf(OTHER_PRINCIPAL)).toEqual({ leader: true, role: 'principal' });
  });
});
