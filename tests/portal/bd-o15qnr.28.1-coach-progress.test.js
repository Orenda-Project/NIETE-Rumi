/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's canvas LOCK round, "My progress" B) — the coach's own progress, read-only:
 *
 *   GET /api/portal/coach/progress    the session coach's: this week's complete observations against 12, the Key Focus
 *                                      Area (debriefs that included it of the last 10, the goal at 6 of 10), her 8
 *                                      behaviours over the last 10 debriefs (n of 10), Respect held in every one, the 3
 *                                      most recent observations (the debrief's behaviours seen / 8 once there is one,
 *                                      else where the visit stands), and her weekly reports (ready weeks with a debrief).
 *
 * The rows are the ones the week service reads (coach-week.service SQL.DEBRIEFS: coaching_sessions.analysis_data
 * .observer_debrief.feedback.rubric), the counts the bot's coach-week.js rule. Counts only (the operator, 20 Nov 15:04:
 * "Just the debrief scores" are a %). Nothing is written. The coach is ALWAYS the session user, never an id sent in.
 * Coaches only: coach app (portal_coach_v2) + (coach_reports_app OR portal_coach_flow_v2); principals get 404. The weekly
 * reports list only for a coach whose week page opens (coach_reports_app, the week route's own gate); else null.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';

const KEYS = ['opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only',
  'moves_not_teacher', 'elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step'];
/** A PKT wall-clock time as ISO. */
const at = (date, hourPkt = 10) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();
const NOW = new Date(at('2026-11-19', 12)); // Thursday noon: this week is 16 Nov; the latest ready week is 9 Nov

// Ten debriefs, newest first (d0 … d9), and which behaviours each had (the judge's booleans).
const WHEN = [at('2026-11-19', 9), at('2026-11-17'), at('2026-11-16'), at('2026-11-13', 11), at('2026-11-12'), at('2026-11-11'),
  at('2026-11-09'), at('2026-11-04'), at('2026-11-02'), at('2026-10-27')];
const HAD = {
  opened_with_specific_praise: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  anchored_in_real_moment: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  asked_and_waited: [0, 2, 3, 5],
  one_improvement_only: [0, 1, 2],
  moves_not_teacher: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  elicited_if_then: [1, 4],
  righting_reflex_held: [0, 1, 2, 3, 4],
  rehearsed_the_step: [],
};
const rubricOf = (i) => {
  const r = { disparaged_teacher: false };
  for (const k of KEYS) r[k] = HAD[k].includes(i);
  return r;
};
const DEBRIEF_ROWS = WHEN.map((iso, i) => ({ id: `d${i}`, created_at: iso, feedback_at: iso, rubric: rubricOf(i) }));

const rub = (n) => { const r = { disparaged_teacher: false, moves_not_teacher: true }; KEYS.filter((k) => k !== 'moves_not_teacher').forEach((k, i) => { r[k] = i < n - 1; }); return r; };
const RECENT_ROWS = [
  { id: 'cs-3', created_at: at('2026-11-19', 9), status: 'observer_review_complete', debrief_status: 'done', delivery_status: null,
    rubric: rub(3), teacher_name: null, delivery_teacher_name: null, sched_teacher_name: 'Lubna Arif' },
  { id: 'cs-2', created_at: at('2026-11-18', 9), status: 'observer_review_complete', debrief_status: 'done', delivery_status: 'sent',
    rubric: rub(5), teacher_name: 'Ambreen Gul', delivery_teacher_name: null, sched_teacher_name: null },
  { id: 'cs-1', created_at: at('2026-11-16', 9), status: 'observer_review_complete', debrief_status: 'pending', delivery_status: null,
    rubric: null, teacher_name: null, delivery_teacher_name: 'Rabia Nawaz', sched_teacher_name: null },
];

let SVC;
let WEEK_SQL;
function fakeQuery({ debriefs = DEBRIEF_ROWS, recent = RECENT_ROWS } = {}) {
  return jest.fn(async (sql) => {
    if (sql === WEEK_SQL.DEBRIEFS) return { rows: debriefs, rowCount: debriefs.length };
    if (sql === SVC.SQL.RECENT) return { rows: recent, rowCount: recent.length };
    return { rows: [], rowCount: 0 };
  });
}

describe('the service: her progress, from her own rows', () => {
  beforeEach(() => {
    jest.resetModules();
    SVC = require('../../dashboard/services/coach-progress.service');
    WEEK_SQL = require('../../dashboard/services/coach-week.service').SQL;
  });

  test('reads the week service\'s own debrief rows and her 3 most recent observations, hers only, and writes nothing', async () => {
    const q = fakeQuery();
    await SVC.getCoachProgress(q, ME, { weeks: true, now: NOW });
    const sqls = q.mock.calls.map((c) => c[0]);
    expect(sqls).toContain(WEEK_SQL.DEBRIEFS);
    expect(sqls).toContain(SVC.SQL.RECENT);
    for (const [sql, params] of q.mock.calls) {
      expect(sql.trim()).toMatch(/^SELECT/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      expect(params[0]).toBe(ME);
    }
    expect(SVC.SQL.RECENT).toMatch(/c\.observer_user_id = \$1/);
    expect(SVC.SQL.RECENT).toMatch(/observation_type = 'leader_observation'/);
    expect(SVC.SQL.RECENT).toMatch(/LIMIT 3/);
    // analysis_data is never pulled whole (Class R)
    expect(SVC.SQL.RECENT).not.toMatch(/c\.analysis_data\s*(,|AS|\n\s*FROM)/);
  });

  test('this week: complete observations against 12, counts never percentages', async () => {
    const out = await SVC.getCoachProgress(fakeQuery(), ME, { weeks: true, now: NOW });
    expect(out.week).toEqual({ monday: '2026-11-16', friday: '2026-11-20', complete: 3, target: 12 });
    expect(JSON.stringify(out)).not.toMatch(/percent|pct|avg|average|star/i);
  });

  test('the Key Focus Area: the week rule\'s focus, debriefs that included it of the last 10, the goal at 6 of 10', async () => {
    const out = await SVC.getCoachProgress(fakeQuery(), ME, { weeks: true, now: NOW });
    expect(out.focus).toEqual({
      key: 'asked_and_waited',
      name: { en: 'Asked & waited', ur: expect.any(String) },
      last10: { done: 4, of: 10 },
      doneAt: 6,
      window: 10,
    });
    expect(out.focus.name.ur).toBeTruthy();
  });

  test('her 8 behaviours over the last 10 debriefs: seen in n of 10, most seen first (ties in module order); exactly 8', async () => {
    const out = await SVC.getCoachProgress(fakeQuery(), ME, { weeks: true, now: NOW });
    expect(out.window).toBe(10);
    expect(out.behaviours.map((b) => [b.key, b.done, b.of])).toEqual([
      ['opened_with_specific_praise', 10, 10], ['moves_not_teacher', 10, 10], ['anchored_in_real_moment', 9, 10],
      ['righting_reflex_held', 5, 10], ['asked_and_waited', 4, 10], ['one_improvement_only', 3, 10],
      ['elicited_if_then', 2, 10], ['rehearsed_the_step', 0, 10],
    ]);
    expect(out.behaviours[0].name).toEqual({ en: 'Specific praise', ur: expect.any(String) });
    // Respect held is the must-pass check, not one of the 8: its own flag
    expect(out.behaviours.map((b) => b.key)).not.toContain('disparaged_teacher');
    expect(out.respectAll).toBe(true);
  });

  test('only the newest 10 debriefs count, with fewer all of them', async () => {
    const older = [...DEBRIEF_ROWS, { id: 'old', created_at: at('2026-10-20'), feedback_at: at('2026-10-20'), rubric: rubricOf(99) }];
    const out = await SVC.getCoachProgress(fakeQuery({ debriefs: older }), ME, { weeks: true, now: NOW });
    expect(out.behaviours.find((b) => b.key === 'opened_with_specific_praise')).toMatchObject({ done: 10, of: 10 });
    const few = await SVC.getCoachProgress(fakeQuery({ debriefs: DEBRIEF_ROWS.slice(0, 4) }), ME, { weeks: true, now: NOW });
    expect(few.window).toBe(4);
    expect(few.behaviours.find((b) => b.key === 'asked_and_waited')).toMatchObject({ done: 3, of: 4 });
  });

  test('Respect not held in one of them: no respectAll', async () => {
    const rows = DEBRIEF_ROWS.map((r, i) => (i === 3 ? { ...r, rubric: { ...r.rubric, disparaged_teacher: true } } : r));
    const out = await SVC.getCoachProgress(fakeQuery({ debriefs: rows }), ME, { weeks: true, now: NOW });
    expect(out.respectAll).toBe(false);
  });

  test('the 3 most recent observations: the teacher, the day, where it stands, and the debrief\'s behaviours seen once there is one', async () => {
    const out = await SVC.getCoachProgress(fakeQuery(), ME, { weeks: true, now: NOW });
    expect(out.observations).toEqual([
      { id: 'cs-3', at: at('2026-11-19', 9), teacher: 'Lubna Arif', step: 'report', debrief: { done: 3, total: 8 } },
      { id: 'cs-2', at: at('2026-11-18', 9), teacher: 'Ambreen Gul', step: 'sent', debrief: { done: 5, total: 8 } },
      { id: 'cs-1', at: at('2026-11-16', 9), teacher: 'Rabia Nawaz', step: 'talk', debrief: null },
    ]);
  });

  test('a harmful debrief has no behaviours-seen score (the report shows the concern only)', async () => {
    const harmful = [{ ...RECENT_ROWS[0], rubric: { ...rub(3), disparaged_teacher: true } }];
    const out = await SVC.getCoachProgress(fakeQuery({ recent: harmful }), ME, { weeks: true, now: NOW });
    expect(out.observations[0].debrief).toBeNull();
  });

  test('her weekly reports: ready weeks with a debrief, newest first, counts against 12; this week is not ready yet', async () => {
    const out = await SVC.getCoachProgress(fakeQuery(), ME, { weeks: true, now: NOW });
    expect(out.weeks).toEqual([
      { monday: '2026-11-09', friday: '2026-11-13', complete: 4, target: 12 },
      { monday: '2026-11-02', friday: '2026-11-06', complete: 2, target: 12 },
      { monday: '2026-10-26', friday: '2026-10-30', complete: 1, target: 12 },
    ]);
  });

  test('a full read (the week service\'s limit) may have cut the oldest week short: that week is left out, never undercounted', async () => {
    const rows = [];
    for (const monday of ['2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19']) {
      for (let i = 0; i < 20; i += 1) {
        const iso = new Date(Date.parse(at(monday, 9)) + i * 3600 * 1000).toISOString();
        rows.push({ id: `${monday}-${i}`, created_at: iso, feedback_at: iso, rubric: rubricOf(0) });
      }
    }
    rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    expect(rows).toHaveLength(SVC.DEBRIEF_LIMIT);
    const out = await SVC.getCoachProgress(fakeQuery({ debriefs: rows }), ME, { weeks: true, now: NOW });
    expect(out.weeks.map((w) => [w.monday, w.complete])).toEqual([['2026-11-09', 20], ['2026-11-02', 20], ['2026-10-26', 20]]);
  });

  test('weeks off (her week page does not open): null, not an empty list', async () => {
    const out = await SVC.getCoachProgress(fakeQuery(), ME, { weeks: false, now: NOW });
    expect(out.weeks).toBeNull();
  });

  test('no debriefs yet: zero this week, no focus, no behaviours; never an invented number', async () => {
    const out = await SVC.getCoachProgress(fakeQuery({ debriefs: [], recent: [] }), ME, { weeks: true, now: NOW });
    expect(out).toMatchObject({ week: { complete: 0, target: 12 }, focus: null, behaviours: [], window: 0, respectAll: false, observations: [], weeks: [] });
  });

  test('no coach: nothing read', async () => {
    const q = fakeQuery();
    expect(await SVC.getCoachProgress(q, null, { weeks: true, now: NOW })).toBeNull();
    expect(q).not.toHaveBeenCalled();
  });
});

// ── the route ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('GET /coach/progress — coaches only, the session user only', () => {
  const USERS = {
    [ME]: { id: ME, role: 'coach', school_id: 'school-1', phone_number: '923000000001' },
    [PRINCIPAL]: { id: PRINCIPAL, role: 'principal', school_id: 'school-1126', phone_number: '923000000002' },
  };
  let settings;
  let poolQuery;

  function fakeSupabase() {
    return {
      from(table) {
        let key = null;
        const chain = {
          select: () => chain, eq: (_c, v) => { key = v; return chain; }, is: () => chain, in: () => chain, order: () => chain, limit: () => chain,
          maybeSingle: async () => {
            if (table === 'users') return { data: Object.prototype.hasOwnProperty.call(USERS, key) ? USERS[key] : null, error: null };
            if (table === 'app_settings') return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
            return { data: null, error: null };
          },
        };
        chain.single = chain.maybeSingle;
        return chain;
      },
      rpc: jest.fn(async () => ({ data: null, error: null })),
    };
  }

  beforeEach(() => {
    settings = {};
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
    jest.doMock('../../dashboard/config/database', () => ({ query: (...a) => poolQuery(...a) }));
    jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    SVC = require('../../dashboard/services/coach-progress.service');
    WEEK_SQL = require('../../dashboard/services/coach-week.service').SQL;
    poolQuery = fakeQuery();
  });
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

  async function get(userId, extra = {}) {
    const routes = require('../../dashboard/routes/portal.routes');
    const layer = routes.stack.find((l) => l.route && l.route.path === '/coach/progress' && l.route.methods.get);
    if (!layer) throw new Error('no GET /coach/progress');
    const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/coach/progress', ip: '127.0.0.1', headers: {}, get: () => undefined,
      session: { portalUserId: userId, id: 's' }, ...extra };
    let statusCode = 200;
    let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
    for (const h of layer.route.stack.map((x) => x.handle)) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
    return { statusCode, payload };
  }

  test('a coach on the coach app and coach_reports_app: her progress, with her weekly reports', async () => {
    settings = { portal_coach_v2: [ME], coach_reports_app: [ME] };
    const out = await get(ME);
    expect(out.statusCode).toBe(200);
    expect(out.payload.success).toBe(true);
    expect(out.payload.progress.week).toMatchObject({ target: 12 });
    expect(Array.isArray(out.payload.progress.weeks)).toBe(true);
  });

  test('a coach on the coach app whom the v6/v7 switch names, without coach_reports_app: her progress, no weekly reports', async () => {
    settings = { portal_coach_v2: [ME], portal_coach_flow_v2: [ME] };
    const out = await get(ME);
    expect(out.statusCode).toBe(200);
    expect(out.payload.progress.weeks).toBeNull();
  });

  test('the session decides whose: an id in the query or params is ignored', async () => {
    settings = { portal_coach_v2: [ME], coach_reports_app: [ME] };
    await get(ME, { query: { coach: OTHER, userId: OTHER, id: OTHER }, params: { id: OTHER } });
    expect(poolQuery).toHaveBeenCalled();
    for (const [, params] of poolQuery.mock.calls) expect(params[0]).toBe(ME);
  });

  test('a coach on neither switch, or not on the coach app: 404 and nothing read', async () => {
    settings = { portal_coach_v2: [ME] };
    expect((await get(ME)).statusCode).toBe(404);
    settings = { portal_coach_flow_v2: [ME], coach_reports_app: [ME] };
    jest.resetModules();
    expect((await get(ME)).statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('a principal gets 404 even on every switch (no weekly report, no My progress for principals)', async () => {
    settings = { portal_coach_v2: [PRINCIPAL], coach_reports_app: [PRINCIPAL], portal_coach_flow_v2: [PRINCIPAL], portal_principal_app: [PRINCIPAL] };
    expect((await get(PRINCIPAL)).statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('no other method on the address (read-only)', () => {
    const routes = require('../../dashboard/routes/portal.routes');
    const methods = routes.stack.filter((l) => l.route && l.route.path === '/coach/progress').flatMap((l) => Object.keys(l.route.methods));
    expect(methods).toEqual(['get']);
  });
});
