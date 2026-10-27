/**
 * The portal Home's "Quizzes" tile (D3 of the keyword-entry review, 27 Oct 2026): GET /api/portal/me/home answers
 * `quizTile: true` ONLY when app_settings `portal_teacher_home_quiz_tile` is on for the SESSION user (true, "teachers",
 * or a list naming them; default OFF) AND there is a quiz home to open (`quizHome`: the bot answered, not a coach). Off,
 * or no quiz home: the answer is today's, byte for byte (no key). A tap on the tile is the logged kind `quiz_tile`.
 * Today the quiz home is reachable from the Home only through the ONE card, and only on a day its rung is class or lesson.
 */
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
let get; let flags; let tables; let logEvent; let reads;

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

describe('the Quizzes tile switch ON for the session user', () => {
  beforeEach(() => { flags.portal_teacher_home_quiz_tile = true; });

  it('a quiz home to open → quizTile: true, everything else today\'s', async () => {
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({ ...TODAY, quizTile: true });
  });

  it('the switch is asked for the SESSION user', async () => {
    const asked = [];
    jest.doMock('../../dashboard/lib/feature-flags', () => ({
      PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2', PORTAL_TEACHER_HOME_CARD_KEY: 'portal_teacher_home_card',
      PORTAL_TEACHER_HOME_ORDER_KEY: 'portal_teacher_home_order', PORTAL_SELF_OBSERVATION_KEY: 'portal_self_observation',
      PORTAL_TEACHER_HOME_QUIZ_TILE_KEY: 'portal_teacher_home_quiz_tile',
      isFlagEnabledForUser: async (_sb, key, userId) => { asked.push([key, userId]); return !!userId && flags[key] === true; },
    }));
    await home();
    expect(asked).toContainEqual(['portal_teacher_home_quiz_tile', TEACHER]);
  });

  it('the bot down (no quiz home) → no tile', async () => {
    get.mockRejectedValue(new Error('down'));
    const { payload } = await home();
    expect(payload.quizHome).toBeNull();
    expect(payload).not.toHaveProperty('quizTile');
  });

  it('the bot says off → no tile', async () => {
    get.mockResolvedValue({ status: 200, data: { off: true, reason: 'role' } });
    const { payload } = await home();
    expect(payload).not.toHaveProperty('quizTile');
  });

  it('a coach (quizHome null even when the bot answers) → no tile', async () => {
    tables.users = { data: [{ role: 'coach', preferred_language: 'en' }], error: null };
    const { payload } = await home();
    expect(payload.quizHome).toBeNull();
    expect(payload).not.toHaveProperty('quizTile');
  });

  it('the tap on the tile is a known kind: 204, logged as quiz_tile', async () => {
    const out = await tap({ body: { kind: 'quiz_tile' } });
    expect(out.status).toBe(204);
    expect(logEvent).toHaveBeenCalledWith('app_funnel.action', expect.objectContaining({ action: 'home_card.tap', feature: 'home', kind: 'quiz_tile' }));
  });
});

describe('the Quizzes tile switch OFF (absent): today, byte for byte', () => {
  it('no quizTile key', async () => {
    const out = await home();
    expect(out.payload).toEqual(TODAY);
  });

  it('a switch read that throws is OFF and never a 5xx', async () => {
    jest.doMock('../../dashboard/lib/feature-flags', () => ({
      PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2', PORTAL_TEACHER_HOME_CARD_KEY: 'portal_teacher_home_card',
      PORTAL_TEACHER_HOME_ORDER_KEY: 'portal_teacher_home_order', PORTAL_SELF_OBSERVATION_KEY: 'portal_self_observation',
      PORTAL_TEACHER_HOME_QUIZ_TILE_KEY: 'portal_teacher_home_quiz_tile',
      isFlagEnabledForUser: async (_sb, key, userId) => {
        if (key === 'portal_teacher_home_quiz_tile') throw new Error('settings down');
        return !!userId && flags[key] === true;
      },
    }));
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.payload).toEqual(TODAY);
  });
});
