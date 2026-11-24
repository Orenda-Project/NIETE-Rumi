/**
 * bd-f5a245 (queue #245; #244's finding 10) — a visit whose analysis stopped is hers to act on, so it is listed.
 *
 * Before: GET /coach/reports dropped every `failed` row (DEAD_STATUSES), so a visit whose analysis failed was in no list
 * (Needs you, In progress, History); only its visit page reached it, and that said "Done". GET /coach/observation/:id
 * called it `analysing` (coach-v2 stepOf had no stopped step) while the bot's /leader/observe called it `stopped`.
 * The operator, 24 Nov ~06:25: "3 ok with your recom" (list them in Needs you, one state, the visit stops saying Done).
 *
 * The rules pinned here:
 *   one state       coach-v2 stepOf says `stopped` for failed / cancelled / abandoned, as the bot's observeStep does, so
 *                   every endpoint names it the same (the one-step-model test holds the rest of the map)
 *   switch ON       (portal_coach_flow_v2, fail-closed) a failed or abandoned visit is in Needs you with step `stopped`,
 *                   never In progress, and in History; a cancelled one stays out (she cancelled it). It leaves Needs you
 *                   like a late debrief (3 school days after the visit) or once she has observed that teacher again; it
 *                   stays in History either way. The banner and the Home counts follow Needs you.
 *                   The visit page (/coach/visit/:id) carries its observation's step, so a stopped one is not "Done".
 *   switch OFF      every list exactly as before: failed rows in none.
 */
const SVC = require('../../dashboard/services/coach-v2.service');
const { stepOfRow } = require('../../bot/shared/services/observe/portal-observe-step');
const { PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'coach-me';
const TODAY = '2026-11-24'; // a Tuesday

const patchRow = (rumiUserId, ext, name) => ({
  teacher_ext_id: ext, name, phone: ext, school_ext_id: 'niete:110', role: 'teacher',
  rumi_user_id: rumiUserId, coaching_sessions: 1, observations: 1, training_modules: 0, school_name: 'FLN QA School (synthetic)',
});
const PATCH = [
  patchRow('u-g1', '929998100001', 'FLN QA Teacher EN G1'),
  patchRow('u-g3', '929998100003', 'FLN QA Teacher EN G3'),
  patchRow('u-g7', '929998100007', 'FLN QA Teacher EN G7'),
];

const session = (id, userId, status, debrief, at) => ({
  id, user_id: userId, created_at: at, status, debrief_status: debrief, audio_url: null, analysis_data: null,
  teacher_name: 'T', teacher_phone: null, sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null,
});

const ROWS = [
  // Today's G1 visit: the analysis failed (sandbox: "403 Key limit exceeded")
  session('failed-today', 'u-g1', 'failed', 'pending', '2026-11-24T03:30:00Z'),
  // A G3 visit the system abandoned yesterday
  session('abandoned-mon', 'u-g3', 'abandoned', 'pending', '2026-11-23T05:00:00Z'),
  // She cancelled this one herself
  session('cancelled-today', 'u-g7', 'cancelled', 'pending', '2026-11-24T04:00:00Z'),
  // Failed Wed 18 Nov: due Sat 21 (3 school days), past it on Tue 24
  session('failed-old', 'u-g7', 'failed', 'pending', '2026-11-18T05:00:00Z'),
  // A form waiting on her, and one being analysed
  session('form', 'u-g7', 'awaiting_observer_review', 'pending', '2026-11-24T02:00:00Z'),
  session('analysing', 'u-g7', 'analyzing', 'pending', '2026-11-24T05:00:00Z'),
];

function fake(rows = ROWS, patch = PATCH) {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === SVC.SQL.COACH_SESSIONS) return { rows };
    if (sql === PATCH_TEACHERS_SQL || sql === PRINCIPAL_PATCH_SQL) return { rows: patch };
    return { rows: [] };
  };
  q.calls = calls;
  return q;
}
const ids = (list) => list.map((r) => r.id);

describe('one state: coach-v2 names a stopped observation as the bot does', () => {
  test.each(['failed', 'cancelled', 'abandoned'])('%s → stopped (the bot says stopped too)', (status) => {
    expect(stepOfRow({ status }).step).toBe('stopped');
    expect(SVC.stepOf({ status, debrief_status: 'pending' })).toBe('stopped');
  });

  test('GET /coach/observation/:id of a failed visit says stopped (it said analysing), and names the school', async () => {
    const row = {
      id: 'failed-today', created_at: '2026-11-24T03:30:00Z', status: 'failed', debrief_status: 'pending',
      observation_type: 'leader_observation', user_id: 'u-g1', observer_user_id: ME, audio_url: null,
      scores: null, summary: null, delivery: null, framework: null, obs612: null,
    };
    const out = await SVC.getCoachObservation(async (sql) => {
      if (sql === SVC.SQL.OBSERVATION_BY_ID) return { rows: [row] };
      if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
      return { rows: [] };
    }, ME, 'failed-today', { today: TODAY });
    expect(out.step).toBe('stopped');
    // "Upload recording" books the same teacher at the same school (New visit's ?school=&teacher=)
    expect(out.teacher).toMatchObject({ teacherExtId: '929998100001', schoolExtId: 'niete:110' });
    // not one she cancelled: the page says "Analysis stopped" (a cancelled one keeps "Observation stopped")
    expect(out.cancelled).toBe(false);
  });

  test('a visit she cancelled is stopped too, and says it was cancelled', async () => {
    const row = {
      id: 'c', created_at: '2026-11-24T03:30:00Z', status: 'cancelled', debrief_status: 'pending',
      observation_type: 'leader_observation', user_id: 'u-g1', observer_user_id: ME, audio_url: null,
      scores: null, summary: null, delivery: null, framework: null, obs612: null,
    };
    const out = await SVC.getCoachObservation(async (sql) => {
      if (sql === SVC.SQL.OBSERVATION_BY_ID) return { rows: [row] };
      if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
      return { rows: [] };
    }, ME, 'c', { today: TODAY });
    expect(out).toMatchObject({ step: 'stopped', cancelled: true });
  });
});

describe('switch OFF: every list exactly as before (no failed row anywhere)', () => {
  test('getCoachReports', async () => {
    const out = await SVC.getCoachReports(fake(), ME, {});
    const every = [...ids(out.waiting), ...ids(out.inProgress), ...ids(out.all.items)];
    expect(every).not.toContain('failed-today');
    expect(every).not.toContain('failed-old');
    expect(every).not.toContain('cancelled-today');
    expect(ids(out.waiting)).toEqual(['form']);
  });
  test('getCoachPending and getCoachHome', async () => {
    expect((await SVC.getCoachPending(fake(), ME)).ids).toEqual(['form']);
    expect((await SVC.getCoachHome(fake(), ME, { today: TODAY })).counts.waiting).toBe(1);
  });
});

describe('switch ON: a stopped analysis is hers to act on', () => {
  const on = (rows) => SVC.getCoachReports(fake(rows), ME, { v7: true, today: TODAY });

  test('Needs you lists the failed and the abandoned visit, step stopped; never the cancelled one', async () => {
    const out = await on();
    expect(ids(out.waiting).sort()).toEqual(['abandoned-mon', 'failed-today', 'form']);
    expect(out.waiting.find((r) => r.id === 'failed-today')).toMatchObject({ step: 'stopped', stage: 'stopped' });
  });

  test('never In progress (nothing is working on it); In progress keeps what is', async () => {
    const out = await on();
    expect(ids(out.inProgress)).toEqual(['analysing']);
  });

  test('History lists it, step stopped; a cancelled one stays out', async () => {
    const out = await on();
    expect(ids(out.all.items)).toEqual(expect.arrayContaining(['failed-today', 'abandoned-mon', 'failed-old']));
    expect(ids(out.all.items)).not.toContain('cancelled-today');
    expect(out.all.items.find((r) => r.id === 'failed-old')).toMatchObject({ step: 'stopped' });
  });

  test('3 school days after the visit it leaves Needs you (like a late debrief), and History keeps it', async () => {
    const out = await on();
    expect(ids(out.waiting)).not.toContain('failed-old');
    expect(out.withheld).toEqual(expect.arrayContaining([{ id: 'failed-old', reason: 'stopped_past_due' }]));
    const rows = [session('f', 'u-g1', 'failed', 'pending', '2026-11-18T05:00:00Z')]; // Wed 18 → due Sat 21
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-21' })).waiting)).toEqual(['f']);
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-23' })).waiting)).toEqual([]);
  });

  test('once she observes that teacher again it leaves Needs you (the new visit is the one to follow)', async () => {
    const rows = [
      session('failed-first', 'u-g1', 'failed', 'pending', '2026-11-24T03:30:00Z'),
      session('again', 'u-g1', 'transcribing', 'pending', '2026-11-24T05:10:00Z'),
    ];
    const out = await on(rows);
    expect(ids(out.waiting)).toEqual([]);
    expect(ids(out.inProgress)).toEqual(['again']);
    expect(out.withheld).toEqual([{ id: 'failed-first', reason: 'stopped_redone' }]);
    expect(ids(out.all.items).sort()).toEqual(['again', 'failed-first']);
  });

  test('a later CANCELLED visit of that teacher is not "observed again": the stopped one still needs her', async () => {
    const rows = [
      session('failed-first', 'u-g1', 'failed', 'pending', '2026-11-24T03:30:00Z'),
      session('gave-up', 'u-g1', 'cancelled', 'pending', '2026-11-24T05:10:00Z'),
    ];
    expect(ids((await on(rows)).waiting)).toEqual(['failed-first']);
  });

  test('a stopped visit of a teacher no longer in her patch is held back like any other row', async () => {
    const rows = [session('gone', 'u-left', 'failed', 'pending', '2026-11-24T03:30:00Z')];
    const out = await on(rows);
    expect(ids(out.waiting)).toEqual([]);
    expect(out.withheld).toEqual([{ id: 'gone', reason: 'teacher_not_in_patch' }]);
  });

  test('the principal reads the same rule for her own observations', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { v7: true, today: TODAY, role: 'principal' });
    expect(ids(out.waiting)).toContain('failed-today');
  });

  test('the pending banner and the Home\'s waiting count agree with Needs you', async () => {
    const pending = await SVC.getCoachPending(fake(), ME, { v7: true, today: TODAY });
    expect(pending.ids.sort()).toEqual(['abandoned-mon', 'failed-today', 'form']);
    const home = await SVC.getCoachHome(fake(), ME, { v7: true, today: TODAY });
    expect(home.counts).toMatchObject({ waiting: 3, inProgress: 1 });
  });
});

describe('the visit page knows its observation\'s step (a stopped one is not "Done")', () => {
  const visitRow = {
    id: 'v-1', leader_user_id: ME, teacher_name: 'FLN QA Teacher EN G1', school_name: 'FLN QA School (synthetic)',
    school_ext_id: 'niete:110', teacher_ext_id: '929998100001', scheduled_for: '2026-11-24', scheduled_slot: '08:30',
    status: 'done', session_id: 'failed-today',
  };
  const fakeVisit = (sessionRow) => {
    const calls = [];
    const q = async (sql, params) => {
      calls.push(sql);
      if (sql === SVC.SQL.SCHEDULE_BY_ID) return { rows: [visitRow] };
      if (sql === SVC.SQL.VISIT_SESSION) return { rows: sessionRow ? [sessionRow] : [] };
      if (sql === PATCH_TEACHERS_SQL) return { rows: PATCH };
      return { rows: [] };
    };
    q.calls = calls;
    return q;
  };

  test('switch ON: a done visit whose analysis failed carries step stopped', async () => {
    const out = await SVC.getCoachVisit(fakeVisit({ id: 'failed-today', status: 'failed', debrief_status: 'pending', analysis_data: null }), ME, 'v-1', { today: TODAY, v7: true });
    expect(out.visit).toMatchObject({ status: 'done', sessionId: 'failed-today', sessionStep: 'stopped' });
  });

  test('switch ON: a done visit at the form carries draft; a visit with no observation carries null', async () => {
    const out = await SVC.getCoachVisit(fakeVisit({ id: 'failed-today', status: 'awaiting_observer_review', debrief_status: 'pending', analysis_data: null }), ME, 'v-1', { today: TODAY, v7: true });
    expect(out.visit.sessionStep).toBe('draft');
    const none = await SVC.getCoachVisit(fakeVisit(null), ME, 'v-1', { today: TODAY, v7: true });
    expect(none.visit.sessionStep).toBeNull();
  });

  test('switch OFF: as before — no step, no extra read', async () => {
    const q = fakeVisit({ id: 'failed-today', status: 'failed', debrief_status: 'pending', analysis_data: null });
    const out = await SVC.getCoachVisit(q, ME, 'v-1', { today: TODAY });
    expect(out.visit).not.toHaveProperty('sessionStep');
    expect(q.calls).not.toContain(SVC.SQL.VISIT_SESSION);
  });

  test('the route passes the switch', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
    const at = src.indexOf("router.get('/coach/visit/:id'");
    const block = src.slice(at, src.indexOf('\n});', at));
    expect(block).toMatch(/staleRulesOn\(req\)/);
    expect(block).toMatch(/v7/);
  });
});
