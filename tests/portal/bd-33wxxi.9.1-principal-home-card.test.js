/**
 * bd-33wxxi.9.1 — the principal app v2 Home (#78, option C): a principal on the principal app (portal_principal_app names
 * her) never gets the "Make your first lesson plan" card (pickCard's rung 5, first_plan). Her other rungs stay. A teacher
 * with no plans still gets it, and a principal the switch does not name never reaches /me/home at all (404, unchanged).
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const Order = require('../../dashboard/services/teacher-home-order.service');

const USER = '0d8e7c1a-5b2f-4f3e-8a61-7c9d2e4b1a30';
const NOW = Date.parse('2026-11-10T09:00:00.000Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
let flags; let tables; let role;

function fakeSupabase() {
  return {
    from(table) {
      const q = { table, filters: [], opts: null };
      const answer = () => {
        const f = tables[table];
        if (!f) return { data: [], error: null };
        return typeof f === 'function' ? f(q) : f;
      };
      const chain = {
        select(_c, opts) { q.opts = opts || null; return chain; },
        eq(c, v) { q.filters.push(['eq', c, v]); return chain; },
        is(c, v) { q.filters.push(['is', c, v]); return chain; },
        not() { return chain; },
        in() { return chain; },
        gte() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        maybeSingle() { return Promise.resolve().then(answer).then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] || null) : r.data })); },
        then(res, rej) { return Promise.resolve().then(answer).then(res, rej); },
      };
      return chain;
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  role = 'principal';
  // The teacher-app switches hold "teachers" (never a principal); the principal app names this user.
  flags = { portal_teacher_v2: false, portal_teacher_home_card: false, portal_teacher_home_look: false, portal_principal_app: true, portal_self_observation: true };
  tables = {
    users: () => ({ data: [{ role, preferred_language: 'en', school_id: 's1' }], error: null }),
    // no lesson plans ever: rung 5's condition
    lesson_plans: (q) => (q.opts && q.opts.head ? { count: 0, data: null, error: null } : { data: [], error: null }),
    coaching_sessions: { data: [], error: null },
  };
  jest.doMock('axios', () => ({ get: jest.fn().mockResolvedValue({ status: 200, data: { off: true } }) }));
  jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn() }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_TEACHER_HOME_CARD_KEY: 'portal_teacher_home_card',
    PORTAL_TEACHER_HOME_LOOK_KEY: 'portal_teacher_home_look',
    PORTAL_TEACHER_HOME_ORDER_KEY: 'portal_teacher_home_order',
    PORTAL_SELF_OBSERVATION_KEY: 'portal_self_observation',
    PORTAL_TEACHER_HOME_QUIZ_TILE_KEY: 'portal_teacher_home_quiz_tile',
    PORTAL_PRINCIPAL_APP_KEY: 'portal_principal_app',
    isFlagEnabledForUser: async (_sb, key, userId) => !!userId && flags[key] === true,
  }));
  process.env.MAIN_BOT_URL = 'http://bot.test'; process.env.INTERNAL_API_KEY = 'k';
});
afterEach(() => { jest.restoreAllMocks(); });

async function home() {
  const router = require('../../dashboard/routes/portal-teacher-home.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/me/home' && l.route.methods.get);
  const req = { session: { portalUserId: USER }, body: {} };
  let status = 200; let payload;
  const res = {
    status(c) { status = c; return this; },
    json(b) { payload = b; return this; },
    end() { return this; },
  };
  for (const s of layer.route.stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { status, payload };
}

describe('pickCard: the first-plan rung can be left out', () => {
  it('firstPlan false: no first_plan card for no plans ever; the default keeps it', () => {
    expect(Order.pickCard({ bot: null, lpCount: 0, now: NOW })).toEqual({ kind: 'first_plan', title: '', href: '/portal/teacher/lessons' });
    expect(Order.pickCard({ bot: null, lpCount: 0, isCoach: true, firstPlan: false, now: NOW })).toBeNull();
  });
  it('firstPlan false leaves the other rungs: an observation of 3 days still makes the observation card', () => {
    const observation = { id: 'o1', created_at: ago(3), analysis_data: { scores: { overall_marks: 80, overall_max_marks: 148 } } };
    expect(Order.pickCard({ bot: null, observation, lpCount: 0, isCoach: true, firstPlan: false, now: NOW }))
      .toMatchObject({ kind: 'observation', id: 'o1' });
  });
});

describe('GET /me/home for a principal on the principal app', () => {
  it('no plans ever: no first_plan card (card null)', async () => {
    const { status, payload } = await home();
    expect(status).toBe(200);
    expect(payload.card).toBeNull();
  });
  it('a teacher with no plans keeps the first_plan card', async () => {
    role = 'teacher';
    flags.portal_teacher_v2 = true; flags.portal_teacher_home_card = true; flags.portal_principal_app = false;
    const { payload } = await home();
    expect(payload.card).toEqual({ kind: 'first_plan', title: '', href: '/portal/teacher/lessons' });
  });
  it('a principal the switch does not name: 404, as before', async () => {
    flags.portal_principal_app = false;
    expect((await home()).status).toBe(404);
  });
});
