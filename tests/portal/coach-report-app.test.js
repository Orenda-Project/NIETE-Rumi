/**
 * The coach's debrief report as a page in the coach app (coach reports in the app, phase 1).
 *
 *   dashboard/services/coach-report.service.js   the shaper + the reads/writes behind the page and the Home card
 *   GET  /api/portal/coach/report/:id             her report; another coach's is 403, a missing one 404
 *   POST /api/portal/coach/report/:id/opened      she opened it (Home card, link or Reports)
 *   POST /api/portal/coach/report/:id/seen        she closed the Home card with ✕
 *   GET  /api/portal/coach/reports/ready          what the Home card shows
 *
 * Every route sits behind the coach app v2 chain and then app_settings.coach_reports_app (true, or a list of
 * users.id; absent = off, so a 404 like a route that does not exist).
 *
 * The page says each thing once (the ICT HITL owner's review, 5 Nov): no reflection question, no praise banner
 * repeating "What you did well"; the next focus ends with a ready "Try:" line for its behaviour, or no line at all
 * until that behaviour's line is supplied (never an invented one).
 */
const SVC = require('../../dashboard/services/coach-report.service');
const TRY_LINES = { elicited_if_then: SVC.tryLineFor('elicited_if_then') };

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

const FEEDBACK = {
  praise_line: 'You opened with what really worked: the story and its link to daily life.',
  wins: [{ behaviour: 'Specific praise', evidence: 'the story was told very well' }, { behaviour: 'Real moment', evidence: 'the moment a student answered' }],
  try: { move: 'Let the teacher name the next step in their own words', evidence: 'you gave the step', instead: 'ask first' },
  reflection_question: 'What made you move on before the teacher spoke?',
  focus: 'elicited_if_then',
  focus_why: 'It was missed in most of your recent debriefs.',
  missed: {
    asked_and_waited: 'You asked how it went and answered it yourself.',
    one_improvement_only: 'You raised two changes.',
    elicited_if_then: 'You gave the step yourself.',
    righting_reflex_held: 'You spoke for most of the talk.',
    rehearsed_the_step: 'The talk ended once the plan was agreed.',
  },
  did: {
    opened_with_specific_praise: 'You said the story was told very well.',
    anchored_in_real_moment: 'You named the moment a student answered.',
    moves_not_teacher: 'You talked about the lesson, never the person.',
  },
  rubric: {
    opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: false, one_improvement_only: false,
    moves_not_teacher: true, elicited_if_then: false, righting_reflex_held: false, rehearsed_the_step: false,
    disparaged_teacher: false,
  },
};

const ROW = (over = {}) => ({
  id: ID, observer_user_id: ME, user_id: 'teacher-uuid', created_at: '2026-11-04T06:00:00Z', status: 'completed', debrief_status: 'done',
  feedback: FEEDBACK, feedback_at: '2026-11-04T06:42:00Z', topic: 'Journey to Taif', subject: 'Islamiyat', grade: '5',
  teacher_name: 'Ms. Sadia', delivery_teacher_name: null, sched_teacher_name: null,
  ...over,
});

const q = (rows) => { const f = jest.fn(async () => ({ rows, rowCount: rows.length })); return f; };

describe('the shaper says what the judge said, once, in the rubric order', () => {
  const r = SVC.shapeCoachReport(ROW());

  test('eight marks in the rubric order, names in English and Urdu, the count computed from the booleans', () => {
    expect(r.marks.map((m) => m.key)).toEqual([
      'opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only',
      'moves_not_teacher', 'elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step',
    ]);
    expect(r.done).toBe(3);
    expect(r.total).toBe(8);
    expect(r.marks[0].name.en).toBe('Specific praise');
    expect(r.marks[0].name.ur).toBe('مخصوص تعریف');
    expect(r.respectHeld).toBe(true);
  });

  test('every done behaviour, each with its own line', () => {
    expect(r.did.map((d) => [d.key, d.line])).toEqual([
      ['opened_with_specific_praise', 'You said the story was told very well.'],
      ['anchored_in_real_moment', 'You named the moment a student answered.'],
      ['moves_not_teacher', 'You talked about the lesson, never the person.'],
    ]);
  });

  test('every miss: what happened in THIS debrief, why it matters in both languages, and its module', () => {
    const own = r.missed.find((m) => m.key === 'elicited_if_then');
    expect(own.line).toBe('You gave the step yourself.');
    expect(own.why.en).toMatch(/own words/);
    expect(own.why.ur).toMatch(/اپنے الفاظ/);
    expect(own.module).toBe(6);
    expect(r.missed.map((m) => m.module)).toEqual([3, 4, 6, 7, 8]);
  });

  test('one focus with why this one, its module, and the ready Try line for its behaviour', () => {
    expect(r.focus).toEqual({
      key: 'elicited_if_then', move: FEEDBACK.try.move, why: FEEDBACK.focus_why, module: 6,
      tryLine: TRY_LINES.elicited_if_then,
    });
    expect(TRY_LINES.elicited_if_then.en).toBe('“Next time, what will you do differently? Tell me in your own words.”');
    expect(TRY_LINES.elicited_if_then.ur).toBe('"اگلی بار آپ کیا مختلف کریں گی؟ اپنے الفاظ میں بتائیں۔"');
  });

  test('a focus whose ready line has not been supplied carries none (the page marks the gap, nothing is invented)', () => {
    const fb = { ...FEEDBACK, focus: 'asked_and_waited' };
    expect(SVC.shapeCoachReport(ROW({ feedback: fb })).focus.tryLine).toBeNull();
  });

  test('said once: no reflection question and no praise banner anywhere in the payload', () => {
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/reflection/i);
    expect(json).not.toContain(FEEDBACK.reflection_question);
    expect(json).not.toContain(FEEDBACK.praise_line);
  });

  test('the header: teacher, class and lesson, the time it was ready', () => {
    expect(r.header).toEqual({ teacher: 'Ms. Sadia', grade: '5', subject: 'Islamiyat', topic: 'Journey to Taif', at: '2026-11-04T06:42:00Z' });
  });

  test('a report judged before the judge wrote done lines shows the done behaviours with no line (never a borrowed one)', () => {
    const { did, ...old } = FEEDBACK;
    const shaped = SVC.shapeCoachReport(ROW({ feedback: old }));
    expect(shaped.did.map((d) => d.line)).toEqual([null, null, null]);
  });

  test('a harmful debrief is the concern only: no marks to celebrate', () => {
    const harmful = {
      wins: [], praise_line: null, concern: { what_happened: 'a', why_it_matters: 'b', instead: 'c' },
      rubric: { ...FEEDBACK.rubric, disparaged_teacher: true }, try: { move: 'm' },
    };
    const shaped = SVC.shapeCoachReport(ROW({ feedback: harmful }));
    expect(shaped.harmful).toBe(true);
    expect(shaped.concern).toEqual({ what_happened: 'a', why_it_matters: 'b', instead: 'c' });
    expect(shaped.did).toEqual([]);
    expect(shaped.missed).toEqual([]);
    expect(shaped.focus).toBeNull();
  });
});

describe('only the report\'s own coach reads it', () => {
  test('her own: ok, read by id only', async () => {
    const query = q([ROW()]);
    const out = await SVC.getCoachReport(query, ME, ID);
    expect(out.status).toBe('ok');
    expect(out.report.id).toBe(ID);
    expect(query.mock.calls[0][1]).toEqual([ID]);
  });

  test('another coach: forbidden, and nothing of the report comes back', async () => {
    const out = await SVC.getCoachReport(q([ROW()]), OTHER, ID);
    expect(out).toEqual({ status: 'forbidden' });
  });

  test('no such observation: not_found; a malformed id is never queried', async () => {
    expect(await SVC.getCoachReport(q([]), ME, ID)).toEqual({ status: 'not_found' });
    const query = q([ROW()]);
    expect(await SVC.getCoachReport(query, ME, 'nope')).toEqual({ status: 'not_found' });
    expect(query).not.toHaveBeenCalled();
  });

  test('not coached yet: not_ready', async () => {
    expect(await SVC.getCoachReport(q([ROW({ feedback: null })]), ME, ID)).toEqual({ status: 'not_ready' });
  });

  test('opened / seen are stamped once, only on her own row', async () => {
    const query = q([{ id: ID }]);
    expect(await SVC.markCoachReport(query, ME, ID, 'opened')).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET coach_report_opened_at = now\(\)/);
    expect(sql).toMatch(/observer_user_id = \$2/);
    expect(sql).toMatch(/coach_report_opened_at IS NULL/);
    expect(params).toEqual([ID, ME]);
    await SVC.markCoachReport(query, ME, ID, 'seen');
    expect(query.mock.calls[1][0]).toMatch(/SET coach_report_seen_at = now\(\)/);
    await expect(SVC.markCoachReport(query, ME, ID, 'deleted')).rejects.toThrow();
  });

  // bd-enec2e.5 (7 Nov sandbox e2e): the card showed "12:00" above "12:02" — it listed by when the observation was
  // started but shows when the report was ready. Newest first means by the time it shows.
  test('the Home card lists her ready reports by the time each was ready, newest first', () => {
    const order = SVC.SQL.READY.split(/ORDER BY/i).pop();
    expect(order).toMatch(/COALESCE\(\s*\(c\.analysis_data->'observer_debrief'->>'completed_at'\)::timestamptz,\s*c\.created_at\s*\)\s+DESC/i);
  });
});

// ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────
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

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

async function call(method, path, { params = {}, userId = ME } = {}) {
  const stack = findRoute(loadRoutes(), method, path);
  const gateAt = stack.findIndex((h) => h.name === 'requireCoachV2');
  if (gateAt < 0) throw new Error(`${path} has no requireCoachV2`);
  const names = stack.map((h) => h.name);
  if (!names.includes('requireCoachReports')) throw new Error(`${path} has no requireCoachReports`);
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set() { return this; } };
  const req = { params, query: {}, body: {}, session: { portalUserId: userId }, portalUser: { role: 'coach' }, headers: {}, get: () => undefined };
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const h of stack.slice(gateAt)) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally { quiet.mockRestore(); }
  return { statusCode, payload };
}

describe('the routes', () => {
  beforeEach(() => {
    settings = { portal_coach_v2: true, coach_reports_app: [ME, OTHER] };
    poolQuery = jest.fn(async () => ({ rows: [ROW()], rowCount: 1 }));
  });

  test('her own report: 200 with the shaped report', async () => {
    const { statusCode, payload } = await call('get', '/coach/report/:id', { params: { id: ID } });
    expect(statusCode).toBe(200);
    expect(payload.report.focus.key).toBe('elicited_if_then');
  });

  test('ANY other user gets 403, even with the app and the switch on', async () => {
    const { statusCode, payload } = await call('get', '/coach/report/:id', { params: { id: ID }, userId: OTHER });
    expect(statusCode).toBe(403);
    expect(JSON.stringify(payload)).not.toContain('Ms. Sadia');
  });

  test('the switch off for her: 404 and nothing is read', async () => {
    settings.coach_reports_app = [OTHER];
    const { statusCode } = await call('get', '/coach/report/:id', { params: { id: ID } });
    expect(statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('opened and seen are hers only', async () => {
    poolQuery = jest.fn(async () => ({ rows: [{ id: ID }], rowCount: 1 }));
    expect((await call('post', '/coach/report/:id/opened', { params: { id: ID } })).statusCode).toBe(200);
    expect(poolQuery.mock.calls[0][1]).toEqual([ID, ME]);
    expect((await call('post', '/coach/report/:id/seen', { params: { id: ID } })).statusCode).toBe(200);
  });

  test('the Home card reads her ready reports', async () => {
    poolQuery = jest.fn(async () => ({ rows: [{ id: ID, created_at: '2026-11-04T06:00:00Z', feedback_at: '2026-11-04T06:42:00Z', teacher_name: 'Ms. Sadia', delivery_teacher_name: null, sched_teacher_name: null, subject: 'Islamiyat', grade: '5' }], rowCount: 1 }));
    const { statusCode, payload } = await call('get', '/coach/reports/ready');
    expect(statusCode).toBe(200);
    expect(payload.reports).toEqual([{ kind: 'debrief', id: ID, at: '2026-11-04T06:42:00Z', teacher: 'Ms. Sadia', subject: 'Islamiyat', grade: '5' }]);
    // The ready-debriefs read, wherever it falls: from Friday 16:00 to Monday 16:00 the week row is read first
    // (bd-enec2e.5 — this asserted calls[0] and so failed every weekend).
    const ready = poolQuery.mock.calls.find(([sql]) => /coach_report_seen_at IS NULL/.test(sql) && /LIMIT/.test(sql));
    expect(ready[1]).toEqual([ME]);
  });
});
