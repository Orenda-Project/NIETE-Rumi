'use strict';
/**
 * The principal's landing view, organised by STEPS (principal-dashboard
 * feedback item 3): "organised by STEPS features and teachers list so the
 * principal can track each teacher's progress feature by feature".
 *
 * STEPS is NIETE's own teacher-evaluation framework (design spec, Hasnat,
 * 2026-07-16), and it feeds each teacher's ACR:
 *   S  Subject knowledge  — observation, FICO section F (teacher_subject_knowledge)
 *   T  Teaching skills    — observation, FICO sections B + C
 *                           (lesson_plan_fidelity + high_leverage_practices)
 *   E  Engagement         — observation, FICO section D (student_engagement)
 *   P  Presence           — the teacher's OWN attendance (teacher_attendance_records)
 *   S  Supervisor remark  — the principal's quarterly remark
 *
 * Decisions encoded here, each for a reason:
 *
 *   · S/T/E come from her LATEST lesson that carries the domain. An older rubric
 *     (lesson_structure / classroom_climate / …) coexists in live data on 15 of
 *     200 sessions; a session without the domain is skipped, never read as 0.
 *   · T pools B and C by POINTS (sum of scores over sum of maxima), not by
 *     averaging two percentages — the sections are different sizes (10 and 12
 *     indicators), and an unweighted mean would overweight the smaller one.
 *   · P is COUNTS, not a band. NIETE has deliberately not defined a single P
 *     score (the teacher:student weighting was left open, #impact-and-policy
 *     2026-08-10), and a band borrowed from the observation scale would call
 *     80% attendance "Excellent". Leave is not absence and is reported apart.
 *   · The remark S is a TO-DO for the principal: done / to do / no open cycle.
 *   · Principals are not rows. She evaluates the teachers; she is not one of them.
 *   · The API may carry the percentage; the UI shows only the band.
 */

const { buildStepsGrid } = require('../../dashboard/services/steps-grid.service');

const T1 = { rumiUserId: 'u1', name: 'Ayesha Bibi', isPrincipal: false, onRumi: true };
const T2 = { rumiUserId: 'u2', name: 'Bushra Khan', isPrincipal: false, onRumi: true };
const PRINCIPAL = { rumiUserId: 'p1', name: 'Atifa Noor', isPrincipal: true, onRumi: true };

const dom = (score, max) => ({ domain_score: score, domain_max: max });
// Every fixture below is a HUMAN Observation unless it says otherwise — only a
// Human Observation rates S/T/E (operator, 2026-09-29).
const ficoSession = (userId, createdAt, { b, c, d, f }, observationType = 'leader_observation') => ({
  user_id: userId,
  created_at: createdAt,
  observation_type: observationType,
  analysis_data: {
    domains: {
      lesson_plan_fidelity: dom(...b),
      high_leverage_practices: dom(...c),
      student_engagement: dom(...d),
      teacher_subject_knowledge: dom(...f),
    },
  },
});

const CYCLE = { id: 'c3', name: 'Third Quarter 2026', starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' };

function grid(over = {}) {
  return buildStepsGrid({
    teachers: [T1, T2, PRINCIPAL],
    sessions: [],
    attendance: [],
    remarks: [],
    cycle: CYCLE,
    ...over,
  });
}

const row = (g, id) => g.teachers.find((t) => t.id === id);

describe('S, T, E — from her latest lesson', () => {
  test('each letter is read off its own FICO section and banded', () => {
    const g = grid({ sessions: [ficoSession('u1', '2026-09-10', { b: [16, 20], c: [12, 24], d: [13, 14], f: [3, 16] })] });
    const r = row(g, 'u1');
    expect(r.s).toEqual({ pct: 18.8, band: 'needs_support' });   // F 3/16
    expect(r.e).toEqual({ pct: 92.9, band: 'excellent' });       // D 13/14
    // T pools B+C by points: (16+12)/(20+24) = 63.6 — NOT mean(80, 50) = 65
    expect(r.t).toEqual({ pct: 63.6, band: 'good' });
  });

  test('the LATEST lesson wins, whatever order the rows arrive in', () => {
    const g = grid({ sessions: [
      ficoSession('u1', '2026-09-20', { b: [20, 20], c: [24, 24], d: [14, 14], f: [16, 16] }),
      ficoSession('u1', '2026-08-01', { b: [0, 20], c: [0, 24], d: [0, 14], f: [0, 16] }),
    ] });
    expect(row(g, 'u1').s.band).toBe('excellent');
    expect(row(g, 'u1').lastObservedAt).toBe('2026-09-20');
  });

  test('a lesson on the OLDER rubric is skipped, never read as a zero', () => {
    const older = { user_id: 'u1', created_at: '2026-09-25', observation_type: 'leader_observation', analysis_data: { domains: { lesson_structure: dom(9, 10) } } };
    const g = grid({ sessions: [older, ficoSession('u1', '2026-09-01', { b: [10, 20], c: [12, 24], d: [7, 14], f: [8, 16] })] });
    expect(row(g, 'u1').s).toEqual({ pct: 50, band: 'average' });
  });

  test('a teacher never observed has no band on any observation letter', () => {
    const r = row(grid(), 'u2');
    expect(r.s).toBeNull();
    expect(r.t).toBeNull();
    expect(r.e).toBeNull();
    expect(r.lastObservedAt).toBeNull();
  });

  test('T survives a lesson that scored only one of its two sections', () => {
    const onlyC = { user_id: 'u1', created_at: '2026-09-01', observation_type: 'leader_observation', analysis_data: { domains: { high_leverage_practices: dom(18, 24) } } };
    expect(row(grid({ sessions: [onlyC] }), 'u1').t).toEqual({ pct: 75, band: 'good' });
  });
});

describe('S, T, E — Human Observations only', () => {
  // STEPS feeds her ACR. A Digital Coach Observation is a lesson she recorded
  // herself: it is counted elsewhere, but it never rates her here.
  test('a Digital Coach Observation never sets S, T or E', () => {
    const digital = ficoSession('u1', '2026-09-20', { b: [20, 20], c: [24, 24], d: [14, 14], f: [16, 16] }, null);
    const r = row(grid({ sessions: [digital] }), 'u1');
    expect(r.s).toBeNull();
    expect(r.t).toBeNull();
    expect(r.e).toBeNull();
    expect(r.lastObservedAt).toBeNull();
  });

  test('a newer Digital Coach Observation does not replace her latest Human one', () => {
    const human = ficoSession('u1', '2026-09-01', { b: [10, 20], c: [12, 24], d: [7, 14], f: [8, 16] });
    const digital = ficoSession('u1', '2026-09-25', { b: [20, 20], c: [24, 24], d: [14, 14], f: [16, 16] }, null);
    const r = row(grid({ sessions: [digital, human] }), 'u1');
    expect(r.s.band).toBe('average');       // 8/16, from the Human Observation
    expect(r.lastObservedAt).toBe('2026-09-01');
  });
});

describe('P — her own presence, as counts', () => {
  test('present / absent / leave are counted; leave is not absence', () => {
    const att = [
      ...Array(18).fill({ teacher_id: 'u1', status: 'present' }),
      ...Array(2).fill({ teacher_id: 'u1', status: 'absent' }),
      { teacher_id: 'u1', status: 'leave' },
    ];
    expect(row(grid({ attendance: att }), 'u1').presence).toEqual({ present: 18, absent: 2, leave: 1, markedDays: 20 });
  });

  test('P carries no band — attendance is not rated on the observation scale', () => {
    const r = row(grid({ attendance: [{ teacher_id: 'u1', status: 'present' }] }), 'u1');
    expect(r.presence.band).toBeUndefined();
  });

  test('nothing marked is zero marked days, not "absent"', () => {
    expect(row(grid(), 'u2').presence).toEqual({ present: 0, absent: 0, leave: 0, markedDays: 0 });
  });
});

describe('S — the remark, as the principal\'s to-do', () => {
  test('a SUBMITTED remark in the open cycle is done; a draft is still to do', () => {
    const g = grid({ remarks: [
      { teacher_id: 'u1', cycle_id: 'c3', submitted_at: '2026-09-12T10:00:00Z' },
      { teacher_id: 'u2', cycle_id: 'c3', submitted_at: null },
    ] });
    expect(row(g, 'u1').remark).toBe('done');
    expect(row(g, 'u2').remark).toBe('todo');
  });

  test('a remark from a PREVIOUS cycle does not count for this one', () => {
    const g = grid({ remarks: [{ teacher_id: 'u1', cycle_id: 'c2', submitted_at: '2026-06-01T00:00:00Z' }] });
    expect(row(g, 'u1').remark).toBe('todo');
  });

  test('with no open cycle there is nothing to do, and the grid says so', () => {
    const g = grid({ cycle: null });
    expect(row(g, 'u1').remark).toBe('no_cycle');
    expect(g.cycle).toBeNull();
  });
});

describe('the school view', () => {
  test('principals are not rows — she evaluates the teachers', () => {
    expect(grid().teachers.map((t) => t.id)).toEqual(['u1', 'u2']);
  });

  test('rows are in name order, so the list is stable between visits', () => {
    const g = grid({ teachers: [T2, T1] });
    expect(g.teachers.map((t) => t.name)).toEqual(['Ayesha Bibi', 'Bushra Khan']);
  });

  test('the summary bands each letter over the teachers who HAVE data', () => {
    const g = grid({ sessions: [
      ficoSession('u1', '2026-09-10', { b: [16, 20], c: [18, 24], d: [14, 14], f: [16, 16] }), // S 100
      // u2 unobserved: must not drag the school's S to 50
    ] });
    expect(g.summary.s).toEqual({ pct: 100, band: 'excellent', teachers: 1, of: 2 });
  });

  test('presence and remarks are summarised as counts', () => {
    const g = grid({
      attendance: [{ teacher_id: 'u1', status: 'present' }, { teacher_id: 'u2', status: 'absent' }],
      remarks: [{ teacher_id: 'u1', cycle_id: 'c3', submitted_at: '2026-09-12T10:00:00Z' }],
    });
    expect(g.summary.presence).toEqual({ present: 1, absent: 1, leave: 0, teachersMarked: 2, of: 2 });
    expect(g.summary.remark).toEqual({ done: 1, todo: 1 });
  });

  test('the open cycle is named, with its closing date', () => {
    expect(grid().cycle).toEqual({ name: 'Third Quarter 2026', endsAt: '2026-10-01T00:00:00Z' });
  });
});
