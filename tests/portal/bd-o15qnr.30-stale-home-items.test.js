/**
 * bd-o15qnr.30 (queue #214) — stale items at the top of the portal Home and on Observe's Needs you.
 *
 * The operator, 21 Nov ~09:20, on his principal account: "there's a Pending Debrief msg. I clicked it and it says Not
 * Available. Figure out why. And then when should this get removed and abandoned?"
 *
 * Why (NIETE prod, read-only probe + Axiom): the Home's Focus card shows the OLDEST waiting observation — a 4 Oct Debrief
 * of a ZZTEST teacher who is no longer at any school. GET /coach/reports lists every observation she made with no patch
 * check; GET /coach/observation/:id serves one only while its teacher is in her patch. So the list offered a row the
 * page refused (two 404s at 03:49Z on 21 Nov).
 *
 * Behind the v6/v7 switch (portal_coach_flow_v2; off = today, byte for byte):
 *   1 a row the observation page would refuse (no teacher, or the teacher is not in her patch) is in NO list —
 *     not Needs you, not the Home's Focus card, not the pending banner, not History — and the route logs it
 *   2 the agreed v7 rule: a Debrief is due 3 school days after the visit, then it leaves Needs you (it stays in History,
 *     and the visit still takes the recording)
 */
const SVC = require('../../dashboard/services/coach-v2.service');
const { PATCH_TEACHERS_SQL, PRINCIPAL_PATCH_SQL } = require('../../dashboard/services/leader-patch.service');

const ME = 'leader-me';
const TODAY = '2026-11-21'; // a Saturday

const patchRow = (rumiUserId, ext, name) => ({
  teacher_ext_id: ext, name, phone: ext, school_ext_id: 'niete:110', role: 'teacher',
  rumi_user_id: rumiUserId, coaching_sessions: 1, observations: 1, training_modules: 0, school_name: 'GB Test High (Rumi QA)',
});
const PATCH = [patchRow('u-kashif', '923990108106', 'Kashif Raza (Test)'), patchRow('u-hira', '923990108105', 'Hira Jabeen (Test)')];

// [id, teacher user id, status, debrief_status, created_at (UTC)]
const session = (id, userId, status, debrief, at) => ({
  id, user_id: userId, created_at: at, status, debrief_status: debrief, audio_url: null, analysis_data: null,
  teacher_name: 'T', teacher_phone: null, sched_teacher_name: null, sched_school_name: null, sched_school_ext_id: null, sched_teacher_ext_id: null,
});

const ROWS = [
  session('form-today', 'u-kashif', 'awaiting_observer_review', 'pending', '2026-11-21T03:49:00Z'),
  // Debrief, visit Thu 19 Nov: due Mon 23 Nov (Sunday is no school day) — still due on Sat 21
  session('debrief-due', 'u-hira', 'observer_review_complete', 'pending', '2026-11-19T05:00:00Z'),
  // Debrief, visit Mon 16 Nov: due Thu 19 Nov — past due on Sat 21
  session('debrief-late', 'u-kashif', 'observer_review_complete', 'pending', '2026-11-16T05:00:00Z'),
  // A Feedback Form from 12 Oct and a Debrief from 4 Oct whose ZZTEST teachers are not in her patch any more
  session('form-gone', 'u-zztest-ayesha', 'awaiting_observer_review', 'pending', '2026-10-12T09:24:54Z'),
  session('debrief-gone', 'u-zztest-bilal', 'observer_review_complete', 'pending', '2026-10-04T13:36:43Z'),
  // Analysing, teacher gone
  session('analysing-gone', 'u-zztest-bilal', 'transcribing', 'pending', '2026-11-20T05:00:00Z'),
  // No teacher at all
  session('no-teacher', null, 'awaiting_observer_review', 'pending', '2026-11-20T06:00:00Z'),
  session('sent-mine', 'u-hira', 'completed', 'done', '2026-11-10T05:00:00Z'),
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

describe('switch OFF (today): every list exactly as before', () => {
  test('getCoachReports lists the rows the page refuses, and old Debriefs', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { role: 'principal' });
    expect(ids(out.waiting)).toEqual(expect.arrayContaining(['form-gone', 'debrief-gone', 'debrief-late', 'no-teacher']));
    expect(out.withheld).toBeUndefined();
  });
  test('getCoachPending reads COACH_SESSIONS only, as before', async () => {
    const q = fake();
    const out = await SVC.getCoachPending(q, ME);
    expect(out.ids).toEqual(expect.arrayContaining(['form-gone', 'debrief-gone']));
    expect(q.calls.map((c) => c.sql)).toEqual([SVC.SQL.COACH_SESSIONS]);
  });
});

describe('switch ON: a row the observation page would refuse is in no list', () => {
  test('Needs you / the Focus card (waiting): only rows whose teacher is in her patch', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { role: 'principal', v7: true, today: TODAY });
    expect(ids(out.waiting)).toEqual(['form-today', 'debrief-due']);
  });
  test('in progress and History drop them too (a History tap would 404 the same way)', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { role: 'principal', v7: true, today: TODAY });
    expect(ids(out.inProgress)).toEqual([]);
    expect(ids(out.all.items)).toEqual(['form-today', 'debrief-due', 'debrief-late', 'sent-mine']);
    expect(out.all.total).toBe(4);
  });
  test('what was held back is named, with why, for the route to log', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { role: 'principal', v7: true, today: TODAY });
    expect(out.withheld).toEqual(expect.arrayContaining([
      { id: 'form-gone', reason: 'teacher_not_in_patch' },
      { id: 'debrief-gone', reason: 'teacher_not_in_patch' },
      { id: 'analysing-gone', reason: 'teacher_not_in_patch' },
      { id: 'no-teacher', reason: 'no_teacher' },
      { id: 'debrief-late', reason: 'debrief_past_due' },
    ]));
    expect(out.withheld).toHaveLength(5);
  });
  test('the patch is read for the reader\'s role (a principal: her own school)', async () => {
    const q = fake();
    await SVC.getCoachReports(q, ME, { role: 'principal', v7: true, today: TODAY });
    expect(q.calls.some((c) => c.sql === PRINCIPAL_PATCH_SQL)).toBe(true);
  });
  test('every row it keeps, the observation page serves (the two rules are one)', async () => {
    const q = fake();
    const out = await SVC.getCoachReports(q, ME, { role: 'principal', v7: true, today: TODAY });
    for (const r of out.all.items) {
      const row = ROWS.find((x) => x.id === r.id);
      const page = await SVC.getCoachObservation(async (sql) => {
        if (sql === SVC.SQL.OBSERVATION_BY_ID) return { rows: [{ ...row, observation_type: 'leader_observation', observer_user_id: ME }] };
        if (sql === PRINCIPAL_PATCH_SQL) return { rows: PATCH };
        return { rows: [] };
      }, ME, r.id, { today: TODAY, role: 'principal' });
      expect([r.id, !!page]).toEqual([r.id, true]);
    }
  });
});

describe('switch ON: the agreed v7 rule — a Debrief leaves Needs you after its due day (3 school days)', () => {
  test('due Mon 23 Nov (visit Thu 19): still waiting on Sat 21; due Thu 19 (visit Mon 16): gone from waiting, kept in History', async () => {
    const out = await SVC.getCoachReports(fake(), ME, { role: 'principal', v7: true, today: TODAY });
    expect(ids(out.waiting)).toContain('debrief-due');
    expect(ids(out.waiting)).not.toContain('debrief-late');
    expect(out.all.items.find((r) => r.id === 'debrief-late')).toMatchObject({ step: 'talk' });
  });
  test('on its due day it is still waiting; the day after, it is not', async () => {
    const rows = [session('d', 'u-kashif', 'observer_review_complete', 'pending', '2026-11-16T05:00:00Z')];
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-19' })).waiting)).toEqual(['d']);
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-20' })).waiting)).toEqual([]);
  });
  test('the visit day is the Pakistan day: 20:00Z on Sun 15 Nov is Mon 16 in Pakistan (due Thu 19)', async () => {
    const rows = [session('d', 'u-kashif', 'observer_review_complete', 'pending', '2026-11-15T20:00:00Z')];
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: '2026-11-19' })).waiting)).toEqual(['d']);
  });
  test('a Feedback Form has no due day yet: an old one in her patch still waits (proposed, not agreed)', async () => {
    const rows = [session('f', 'u-kashif', 'awaiting_observer_review', 'pending', '2026-10-01T05:00:00Z')];
    expect(ids((await SVC.getCoachReports(fake(rows), ME, { v7: true, today: TODAY })).waiting)).toEqual(['f']);
  });
  test('the server\'s due day is the portal\'s (debriefDue.ts): Thu → Mon, Mon → Thu, Sat → Wed', () => {
    expect(SVC.debriefDueDay('2026-11-19')).toBe('2026-11-23');
    expect(SVC.debriefDueDay('2026-11-16')).toBe('2026-11-19');
    expect(SVC.debriefDueDay('2026-11-21')).toBe('2026-11-25');
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../portal/src/portal/coach/flow/debriefDue.ts'), 'utf8');
    expect(Number(/DEBRIEF_SCHOOL_DAYS = (\d+)/.exec(src)[1])).toBe(SVC.DEBRIEF_SCHOOL_DAYS);
  });
});

describe('switch ON: the pending banner and the Home counts agree with Needs you', () => {
  test('getCoachPending: the same waiting rows', async () => {
    const out = await SVC.getCoachPending(fake(), ME, { v7: true, today: TODAY });
    expect(out.ids.sort()).toEqual(['debrief-due', 'form-today']);
    expect(out.waiting).toBe(2);
  });
  test('getCoachHome: counts.waiting and counts.inProgress by the same rule', async () => {
    const out = await SVC.getCoachHome(fake(), ME, { v7: true, today: TODAY });
    expect(out.counts).toMatchObject({ waiting: 2, inProgress: 0 });
  });
});

describe('the routes pass the switch and log what was held back', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  const block = (path) => {
    const at = src.indexOf(`router.get('${path}'`);
    return src.slice(at, src.indexOf('\n});', at));
  };
  test.each(['/coach/reports', '/coach/pending', '/coach/home'])('%s reads portal_coach_flow_v2 for the reader and passes v7', (path) => {
    const b = block(path);
    expect(b).toMatch(/staleRulesOn\(req\)/);
    expect(b).toMatch(/v7/);
  });
  test('/coach/reports and /coach/pending log the held-back rows and never send them', () => {
    for (const path of ['/coach/reports', '/coach/pending']) {
      const b = block(path);
      expect([path, /logWithheld\(/.test(b)]).toEqual([path, true]);
    }
  });
  test('/coach/observation/:id logs a refused open (the tap that cannot open)', () => {
    expect(block('/coach/observation/:id')).toMatch(/coach_observation_not_openable/);
  });
});
