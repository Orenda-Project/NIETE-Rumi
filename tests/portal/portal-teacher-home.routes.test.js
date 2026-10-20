/**
 * Teacher Home card — GET /api/portal/me/home and POST /api/portal/me/home/tap (dashboard/routes/portal-teacher-home.routes.js):
 * signed out 401; teacher app off 404 with nothing read; the card switch off 404 {off:true}; on, the the build contract shape;
 * the bot down or off → quizHome null and the card from rungs 2, 4–5 only, still 200; never a 5xx; the tap is 204 and
 * logged, a bad kind 400. The user is ALWAYS the session's.
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
  flags = { portal_teacher_v2: true, portal_teacher_home_card: true, portal_teacher_home_order: false };
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

describe('GET /me/home — guards', () => {
  it('signed out is 401', async () => {
    expect((await home({ userId: null })).status).toBe(401);
  });
  it('teacher app off is 404 and nothing is read', async () => {
    flags.portal_teacher_v2 = false;
    const out = await home();
    expect(out.status).toBe(404);
    expect(out.payload).toEqual({ success: false, error: 'Not found' });
    expect(get).not.toHaveBeenCalled();
    expect(reads).toHaveLength(0);
  });
  it('the card switch off is 404 {success:false, off:true}, the bot not asked', async () => {
    flags.portal_teacher_home_card = false;
    const out = await home();
    expect(out.status).toBe(404);
    expect(out.payload).toEqual({ success: false, off: true });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('GET /me/home — on', () => {
  it('the the build contract shape; asks the bot for the SESSION user in the teacher\'s language; logs home_card.shown', async () => {
    const out = await home();
    expect(out.status).toBe(200);
    expect(out.payload).toEqual({
      success: true,
      now: new Date(NOW).toISOString(),
      order: ['lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes', 'analytics'],
      orderOn: false,
      card: null,
      scores: { coach: null, observation: null },
      quizHome: '/quiz/teacher/tok',
    });
    expect(get).toHaveBeenCalledTimes(1);
    const [url, cfg] = get.mock.calls[0];
    expect(url).toBe('http://bot.test/api/internal/thportal/portal-home');
    expect(cfg.params).toEqual({ uid: TEACHER, lang: 'ur' });
    expect(cfg.headers['x-api-key']).toBe('k');
    expect(cfg.timeout).toBe(8000);
    expect(cfg.validateStatus(503)).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('app_funnel.action', expect.objectContaining({
      action: 'home_card.shown', feature: 'home', kind: 'none', orderOn: false, lang: 'ur',
    }));
  });

  it('the bot\'s class card → card kind class, href = quizHome', async () => {
    get.mockResolvedValue({ status: 200, data: { path: '/quiz/teacher/t2', primary: { kind: 'class', title: 'Plants', played: 2 }, facts: {} } });
    const { payload } = await home();
    expect(payload.card).toEqual({ kind: 'class', title: 'Plants', played: 2, href: '/quiz/teacher/t2' });
    expect(logEvent).toHaveBeenCalledWith('app_funnel.action', expect.objectContaining({ action: 'home_card.shown', kind: 'class' }));
  });

  it('scores: the newest own report and observation, marks/max only when marks is a number', async () => {
    tables.coaching_sessions = (q) => {
      const own = q.filters.some((f) => f[0] === 'is' && f[1] === 'observation_type');
      return own
        ? { data: [{ id: 'c1', created_at: ago(20), scores: { overall_marks: 96, overall_max_marks: 148 }, topic: 'Fractions' }], error: null }
        : { data: [{ id: 'o1', created_at: ago(30), scores: { overall_max_marks: 148 } }], error: null };
    };
    const { payload } = await home();
    expect(payload.scores.coach).toEqual({ marks: 96, max: 148, at: ago(20), id: 'c1' });
    expect(payload.scores.observation).toBeNull();
    // 20 days old: past the report's 7-day window, so no coach card; LPs exist, the bot had none → no card
    expect(payload.card).toBeNull();
  });

  it('the order switch on: ranked from the teacher\'s days; off: fixed and orderOn false', async () => {
    flags.portal_teacher_home_order = true;
    tables.attendance_sessions = { data: [{ created_at: ago(1) }, { created_at: ago(2) }], error: null };
    const { payload } = await home();
    expect(payload.orderOn).toBe(true);
    expect(payload.order[0]).toBe('attendance');
    expect(payload.order).toHaveLength(8);
  });

  it('bot down → quizHome null, card from rungs 2, 4–5 only, still 200', async () => {
    get.mockRejectedValue(new Error('ECONNREFUSED'));
    tables.lesson_plans = (q) => (q.opts && q.opts.head ? { count: 0, data: null, error: null } : { data: [], error: null });
    let out = await home();
    expect(out.status).toBe(200);
    expect(out.payload.quizHome).toBeNull();
    expect(out.payload.card).toEqual({ kind: 'first_plan', title: '', href: '/portal/teacher/lessons' });

    tables.coaching_sessions = (q) => (q.filters.some((f) => f[0] === 'is' && f[1] === 'observation_type')
      ? { data: [], error: null }
      : { data: [{ id: 'o1', created_at: ago(3), scores: { overall_marks: 80, overall_max_marks: 148 } }], error: null });
    get.mockResolvedValue({ status: 503, data: { error: 'mk.error' } });
    out = await home();
    expect(out.status).toBe(200);
    expect(out.payload.quizHome).toBeNull();
    expect(out.payload.card).toMatchObject({ kind: 'observation', score: 80, max: 148, href: '/portal/teacher/observations', id: 'o1' });
  });

  it('the bot says off (switch, role, user) → quizHome null; a class primary on an off answer is ignored', async () => {
    for (const data of [{ off: true }, { off: true, reason: 'role' }, { off: true, reason: 'user', path: '/quiz/teacher/x', primary: { kind: 'class', title: 'x', played: 1 } }]) {
      get.mockResolvedValue({ status: data.reason === 'role' ? 200 : 404, data });
      // eslint-disable-next-line no-await-in-loop
      const { status, payload } = await home();
      expect(status).toBe(200);
      expect(payload.quizHome).toBeNull();
      expect(payload.card).toBeNull();
    }
  });

  it('a coach role: quizHome null, no quiz rungs, even if the bot answered', async () => {
    tables.users = { data: [{ role: 'principal', preferred_language: 'en' }], error: null };
    get.mockResolvedValue({ status: 200, data: { path: '/quiz/teacher/t', primary: { kind: 'class', title: 'x', played: 1 } } });
    const { payload } = await home();
    expect(payload.quizHome).toBeNull();
    expect(payload.card).toBeNull();
  });

  it('every read failing is still a 200 with the fixed order and no card', async () => {
    const boom = () => { throw new Error('db down'); };
    tables = { users: boom, lesson_plans: boom, coaching_sessions: boom };
    get.mockRejectedValue(new Error('down'));
    const { status, payload } = await home();
    expect(status).toBe(200);
    expect(payload).toMatchObject({ success: true, card: null, quizHome: null, scores: { coach: null, observation: null } });
    expect(payload.order).toHaveLength(8);
  });
});

describe('POST /me/home/tap', () => {
  it('a known kind is 204 and logs home_card.tap; the guards hold', async () => {
    for (const kind of ['class', 'coach_report', 'lesson', 'observation', 'first_plan', 'chip_coach', 'chip_obs']) {
      logEvent.mockClear();
      // eslint-disable-next-line no-await-in-loop
      const out = await tap({ body: { kind } });
      expect(out.status).toBe(204);
      expect(logEvent).toHaveBeenCalledWith('app_funnel.action', expect.objectContaining({ action: 'home_card.tap', feature: 'home', kind }));
    }
    expect((await tap({ userId: null, body: { kind: 'class' } })).status).toBe(401);
    flags.portal_teacher_home_card = false;
    expect((await tap({ body: { kind: 'class' } })).payload).toEqual({ success: false, off: true });
  });

  it('an unknown kind (or none) is 400 and nothing is logged', async () => {
    for (const body of [{}, { kind: 'story' }, { kind: 5 }, { kind: 'class<script>' }]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await tap({ body })).status).toBe(400);
    }
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('a throwing logger never turns a tap into an error', async () => {
    logEvent.mockImplementation(() => { throw new Error('axiom down'); });
    expect((await tap({ body: { kind: 'lesson' } })).status).toBe(204);
  });
});
