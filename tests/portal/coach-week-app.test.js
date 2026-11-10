/**
 * Coach reports in the app, phase 3 — the coach's weekly report behind the coach app (services/coach-week.service.js).
 *
 *   GET  /coach/week/:monday           her week (Monday 00:00 – Friday 16:00 PKT), only once it is ready (Friday 16:00)
 *   POST /coach/week/:monday/opened    she opened it      } one teacher_nudges row per coach per week
 *   POST /coach/week/:monday/seen      she closed its card } (kind coach_weekly_report): the first writer wins
 *   GET  /coach/reports/ready          carries the week as a second kind of card row from Friday 16:00
 * Her own only: the session user is the coach; nothing else is read. Behind coach_reports_app like the debrief report.
 */
const SVC = require('../../dashboard/services/coach-week.service');

const ME = '11111111-1111-4111-8111-111111111111';
const at = (date, hourPkt = 10) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();
const KEYS = ['opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only',
  'moves_not_teacher', 'elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step'];
const rub = (doneKeys) => { const r = { disparaged_teacher: false }; for (const k of KEYS) r[k] = doneKeys.includes(k); return r; };
const row = (id, iso, doneKeys) => ({ id, created_at: iso, feedback_at: iso, rubric: rub(doneKeys) });

const ROWS = [
  row('a', at('2026-11-03'), ['opened_with_specific_praise', 'moves_not_teacher', 'asked_and_waited']),
  row('b', at('2026-11-04'), ['opened_with_specific_praise', 'moves_not_teacher']),
  row('c', at('2026-11-06', 17), ['opened_with_specific_praise']), // after Friday 16:00: next week
  row('d', at('2026-10-28'), ['opened_with_specific_praise', 'moves_not_teacher']),
];
const FRIDAY_5PM = new Date(at('2026-11-06', 17));

function fakeQuery({ rows = ROWS, nudge = null } = {}) {
  const q = jest.fn(async (sql) => {
    if (sql === SVC.SQL.DEBRIEFS) return { rows, rowCount: rows.length };
    if (sql === SVC.SQL.NUDGE) return { rows: nudge ? [nudge] : [], rowCount: nudge ? 1 : 0 };
    if (sql === SVC.SQL.MARK) return { rows: [{ id: 'n1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return q;
}

describe('her week', () => {
  test('the week she asks for, from her own debriefs, placed by the week rule; words in both languages', async () => {
    const q = fakeQuery();
    const out = await SVC.getCoachWeek(q, ME, '2026-11-02', FRIDAY_5PM);
    expect(out.status).toBe('ok');
    const w = out.week;
    expect(w).toMatchObject({ monday: '2026-11-02', friday: '2026-11-06', target: 12, complete: 2, debriefs: 2, small: true });
    expect(w.focus.key).toBe('anchored_in_real_moment');
    expect(w.focus.name.en).toBe('Real moment');
    expect(w.focus.name.ur).toBeTruthy();
    expect(w.focus.steps.en).toHaveLength(4);
    expect(w.focus.steps.ur).toHaveLength(4);
    // The ICT HITL owner approved the steps (operator, 10 Nov): no longer marked as drafts.
    expect(w.focus.steps.reviewed).toBe(true);
    expect(w.table).toHaveLength(8);
    expect(w.table[0].name.en).toBe('Specific praise');
    expect(q.mock.calls[0][1][0]).toBe(ME);
  });

  test('not ready before Friday 16:00, and only a real Monday', async () => {
    expect(await SVC.getCoachWeek(fakeQuery(), ME, '2026-11-02', new Date(at('2026-11-06', 15)))).toEqual({ status: 'not_ready' });
    expect(await SVC.getCoachWeek(fakeQuery(), ME, '2026-11-03', FRIDAY_5PM)).toEqual({ status: 'not_found' });
    expect(await SVC.getCoachWeek(fakeQuery(), ME, 'nope', FRIDAY_5PM)).toEqual({ status: 'not_found' });
  });

  test('a week with no debrief at all says so, never an invented one', async () => {
    const out = await SVC.getCoachWeek(fakeQuery({ rows: [] }), ME, '2026-11-02', FRIDAY_5PM);
    expect(out.week).toMatchObject({ debriefs: 0, complete: 0, focus: null });
  });

  test('opened / seen: one teacher_nudges row per coach per week, the first writer wins', async () => {
    const q = fakeQuery();
    expect(await SVC.markCoachWeek(q, ME, '2026-11-02', 'opened', FRIDAY_5PM)).toBe(true);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO teacher_nudges/);
    expect(sql).toMatch(/'coach_weekly_report'/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, nudge_date, kind\) DO UPDATE/);
    expect(sql).toMatch(/COALESCE\(teacher_nudges\.answered_at/);
    expect(params).toEqual([ME, '2026-11-02', 'opened']);
    await expect(SVC.markCoachWeek(q, ME, '2026-11-02', 'deleted', FRIDAY_5PM)).rejects.toThrow();
    expect(await SVC.markCoachWeek(q, ME, '2026-11-03', 'opened', FRIDAY_5PM)).toBe(false);
  });
});

describe('the Home card row', () => {
  test('from Friday 16:00: the week, with its debrief count, until she opens or closes it', async () => {
    const out = await SVC.readyCoachWeek(fakeQuery(), ME, FRIDAY_5PM);
    expect(out).toEqual({ kind: 'week', id: '2026-11-02', monday: '2026-11-02', friday: '2026-11-06', at: '2026-11-06T11:00:00.000Z', debriefs: 2 });
  });

  test('opened or closed: no card', async () => {
    expect(await SVC.readyCoachWeek(fakeQuery({ nudge: { answered_at: at('2026-11-06', 16.5), choice: 'opened' } }), ME, FRIDAY_5PM)).toBeNull();
  });

  test('no debrief that week: no card', async () => {
    expect(await SVC.readyCoachWeek(fakeQuery({ rows: [] }), ME, FRIDAY_5PM)).toBeNull();
  });

  test('after Monday 16:00 the card is gone (the report stays reachable from the debrief pages)', async () => {
    expect(await SVC.readyCoachWeek(fakeQuery(), ME, new Date(at('2026-11-09', 16.5)))).toBeNull();
  });
});

// ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the week routes', () => {
  let settings;
  let poolQuery;
  function makeChain(table) {
    let key = null;
    const chain = {
      select: () => chain, eq: (_c, v) => { key = v; return chain; }, in: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => (table === 'app_settings'
        ? { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null }
        : { data: null, error: null }),
    };
    chain.single = chain.maybeSingle;
    return chain;
  }
  function loadRoutes() {
    jest.resetModules();
    jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
    jest.doMock('../../dashboard/config/database', () => ({ query: (...a) => poolQuery(...a) }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    return require('../../dashboard/routes/portal.routes');
  }
  async function call(method, path, params = {}) {
    const router = loadRoutes();
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const stack = layer.route.stack.map((s) => s.handle);
    expect(stack.map((h) => h.name)).toEqual(expect.arrayContaining(['requireCoachV2', 'requireCoachReports']));
    let statusCode = 200; let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
    const req = { params, query: {}, body: {}, session: { portalUserId: ME }, portalUser: { role: 'coach' }, headers: {}, get: () => undefined };
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const h of stack.slice(stack.findIndex((h) => h.name === 'requireCoachV2'))) {
        let next = false;
        // eslint-disable-next-line no-await-in-loop
        await h(req, res, () => { next = true; });
        if (!next) break;
      }
    } finally { quiet.mockRestore(); }
    return { statusCode, payload };
  }
  beforeEach(() => { settings = { portal_coach_v2: true, coach_reports_app: [ME] }; poolQuery = fakeQuery(); });

  test('GET a ready week: 200; a week not ready yet: 409; not a Monday: 404', async () => {
    expect((await call('get', '/coach/week/:monday', { monday: '2026-10-26' })).statusCode).toBe(200);
    expect((await call('get', '/coach/week/:monday', { monday: '2099-01-05' })).statusCode).toBe(409);
    expect((await call('get', '/coach/week/:monday', { monday: '2026-10-27' })).statusCode).toBe(404);
  });

  test('the switch off for her: 404 and nothing read', async () => {
    settings.coach_reports_app = [];
    expect((await call('get', '/coach/week/:monday', { monday: '2026-10-26' })).statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('opened / seen write her own row', async () => {
    expect((await call('post', '/coach/week/:monday/opened', { monday: '2026-10-26' })).statusCode).toBe(200);
    expect(poolQuery.mock.calls.find((c) => c[0] === SVC.SQL.MARK)[1]).toEqual([ME, '2026-10-26', 'opened']);
  });
});
