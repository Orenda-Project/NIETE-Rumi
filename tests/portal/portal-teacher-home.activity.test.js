'use strict';
/**
 * Home's "Last 30 days" block: GET /api/portal/me/home carries `activity` ONLY when portal_teacher_home_activity is on
 * for the session teacher AND the activity store (Redis only, dashboard/services/teacher-activity-store.js) holds a
 * value for her with at least one number above 0. Off, a miss, a failed read or all zeros: no `activity` key, the answer
 * is today's byte for byte. The block never reads the database: the store is the only source, and with the switch on
 * the route makes exactly the reads it made before. Taps on the block are logged kinds (ids only).
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
let get; let flags; let tables; let logEvent; let reads; let stored; let storeCalls;

/** A PostgREST-ish chain: records filters, answers from `tables[table](query)`. */
function fakeSupabase() {
  return {
    from(table) {
      const q = { table, filters: [], select: null, opts: null };
      reads.push(q);
      const answer = () => {
        const f = tables[table];
        if (!f) return { data: [], error: null };
        return typeof f === 'function' ? f(q) : f;
      };
      const chain = {
        select(col, opts) { q.select = col; q.opts = opts || null; return chain; },
        eq(c, v) { q.filters.push(['eq', c, v]); return chain; },
        is(c, v) { q.filters.push(['is', c, v]); return chain; },
        not(c, op, v) { q.filters.push(['not', c, op, v]); return chain; },
        in(c, v) { q.filters.push(['in', c, v]); return chain; },
        gte(c, v) { q.filters.push(['gte', c, v]); return chain; },
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
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  reads = [];
  flags = { portal_teacher_v2: true, portal_teacher_home_card: true, portal_teacher_home_order: false, portal_self_observation: true };
  tables = {
    users: { data: [{ role: 'teacher', preferred_language: 'ur' }], error: null },
    lesson_plans: (q) => (q.opts && q.opts.head ? { count: 3, data: null, error: null } : { data: [], error: null }),
    coaching_sessions: { data: [], error: null },
  };
  get = jest.fn().mockResolvedValue({ status: 200, data: { path: '/quiz/teacher/tok', primary: { kind: 'none' }, facts: {} } });
  logEvent = jest.fn();
  jest.doMock('axios', () => ({ get }));
  jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_TEACHER_HOME_CARD_KEY: 'portal_teacher_home_card',
    PORTAL_TEACHER_HOME_ORDER_KEY: 'portal_teacher_home_order',
    PORTAL_SELF_OBSERVATION_KEY: 'portal_self_observation',
    PORTAL_TEACHER_HOME_QUIZ_TILE_KEY: 'portal_teacher_home_quiz_tile',
    isFlagEnabledForUser: async (_sb, key, userId) => !!userId && flags[key] === true,
  }));
  stored = null;
  storeCalls = [];
  jest.doMock('../../dashboard/services/teacher-activity-store', () => ({
    readTeacherActivity: async (id) => {
      storeCalls.push(id);
      if (stored instanceof Error) throw stored;
      return stored;
    },
  }));
  process.env.MAIN_BOT_URL = 'http://bot.test'; process.env.INTERNAL_API_KEY = 'k';
});
afterEach(() => { jest.restoreAllMocks(); });

async function call(method, path, { userId = TEACHER, body = {} } = {}) {
  const router = require('../../dashboard/routes/portal-teacher-home.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method} ${path}`);
  const req = { session: userId ? { portalUserId: userId } : null, body };
  let status = 200; let payload; let ended = false;
  const res = {
    status(c) { status = c; return this; },
    json(b) { payload = b; ended = true; return this; },
    end() { ended = true; return this; },
    sendStatus(c) { status = c; ended = true; return this; },
  };
  for (const s of layer.route.stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await s.handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  // let any after-response logging settle
  await new Promise((r) => setImmediate(r));
  return { status, payload, ended };
}
const home = (o) => call('get', '/me/home', o);
const tap = (o) => call('post', '/me/home/tap', o);



const TODAY = {
  success: true,
  now: new Date(NOW).toISOString(),
  order: ['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics'],
  orderOn: false,
  card: null,
  scores: { coach: null, observation: null },
  quizHome: '/quiz/teacher/tok',
};

const STORED = {
  updated_at: '2026-10-20T09:30:00.000Z',
  slot: 'day',
  tiles: {
    plans_opened: { now: 14, prev: 9 },
    taught: { now: 3, prev: 1 },
    coached: { now: 2, prev: 2 },
    quizzes: { now: 4, prev: 0 },
    exams: { now: 1, prev: 0 },
  },
  trend: [
    { indicator_id: 'D3', indicator_name: 'Checks for understanding', framework: 'fico17-v6', points: [
      { session_id: 's1', at: ago(40), band: 'below_average' },
      { session_id: 's2', at: ago(20), band: 'average' },
      { session_id: 's3', at: ago(5), band: 'good' },
    ] },
  ],
  tip: { session_id: 's3', text: 'Ask two children to explain', at: ago(5) },
  journey: [{ kind: 'plan_opened', at: ago(1), ref_id: 'k5:1', meta: {} }],
  furthest_step: 'taught',
  grade_band: 'k5',
};

const ACTIVITY = {
  updatedAt: '2026-10-20T09:30:00.000Z',
  slot: 'day',
  tiles: {
    opened: { now: 14, prev: 9 },
    taught: { now: 3, prev: 1 },
    coached: { now: 2, prev: 2 },
    quizzes: { now: 4, prev: 0 },
    papers: { now: 1, prev: 0 },
  },
  trend: [{ indicator: 'Checks for understanding', from: 'average', to: 'good' }],
  tip: { sessionId: 's3', text: 'Ask two children to explain' },
};

describe('switch ON for her', () => {
  beforeEach(() => { flags.portal_teacher_home_activity = true; });

  it('a stored value → `activity`, shaped for Home (no journey, no ids but the report\'s), the rest today\'s', async () => {
    stored = STORED;
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({ ...TODAY, activity: ACTIVITY });
    expect(storeCalls).toEqual([TEACHER]);
  });

  it('the store is the only source: the same database reads as with the switch off', async () => {
    stored = STORED;
    // warm first (the principal-app gate caches her role after its first read), then off, then on
    await home();
    flags.portal_teacher_home_activity = false;
    reads = [];
    await home();
    const off = reads.map((q) => q.table).sort();
    flags.portal_teacher_home_activity = true;
    reads = [];
    const { payload } = await home();
    expect(payload.activity).toEqual(ACTIVITY);
    expect(reads.map((q) => q.table).sort()).toEqual(off);
  });

  it('the store answers null (Redis down, no key, stale) → no activity key', async () => {
    stored = null;
    const out = await home();
    expect(out.payload).toEqual(TODAY);
  });

  it('the store throws → no activity key, never a 5xx', async () => {
    stored = new Error('redis down');
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.payload).toEqual(TODAY);
  });

  it('every number 0 → no activity key (the no-numbers state)', async () => {
    const zero = { now: 0, prev: 0 };
    stored = { ...STORED, tiles: { plans_opened: zero, taught: zero, coached: zero, quizzes: zero, exams: zero } };
    const out = await home();
    expect(out.payload).toEqual(TODAY);
  });

  it('no trend and no tip → [] and null', async () => {
    stored = { ...STORED, trend: [], tip: null };
    const { payload } = await home();
    expect(payload.activity.trend).toEqual([]);
    expect(payload.activity.tip).toBeNull();
  });
});

describe('switch OFF (absent): today, byte for byte, and the store is never asked', () => {
  it('no activity key', async () => {
    stored = STORED;
    const out = await home();
    expect(out.payload).toEqual(TODAY);
    expect(storeCalls).toEqual([]);
  });

  it('a switch read that throws is OFF', async () => {
    stored = STORED;
    jest.doMock('../../dashboard/lib/lp-app-switches', () => ({
      isTeacherHomeActivityOn: async () => { throw new Error('settings down'); },
    }));
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.payload).toEqual(TODAY);
    expect(storeCalls).toEqual([]);
  });
});

describe('taps on the block', () => {
  it.each(['act_opened', 'act_taught', 'act_coached', 'act_quiz_papers', 'act_trend', 'act_tip', 'journey'])('%s → 204, logged', async (kind) => {
    const out = await tap({ body: { kind } });
    expect(out.status).toBe(204);
    expect(logEvent).toHaveBeenCalledWith('app_funnel.action', expect.objectContaining({ action: 'home_card.tap', kind }));
  });
});
