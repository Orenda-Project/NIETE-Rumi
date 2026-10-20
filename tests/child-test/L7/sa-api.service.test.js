/**
 * The coach's Learning assessment (self-administered battery) — the bot side.
 *
 * The coach picks a school, not an observe visit: with no visit the draw is named by the day key
 * (draw/visit-key.js). What is pinned here:
 *   - the coach's schools, today's observe visit first
 *   - a school that is not this coach's is refused before the draw runs
 *   - the list a coach sees carries no roll number, no student id, and a father's name only for a namesake
 *   - present opens one app-channel session on the same visit, marked as a self-administered one
 */

const SVC = '../../../bot/shared/services/child-test/app/sa-api.service';

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const VISIT = '33333333-3333-4333-8333-333333333333';
const SCHOOL = '44444444-4444-4444-8444-444444444444';
const SCHOOL_B = '77777777-7777-4777-8777-777777777777';
const SCHOOL_X = '88888888-8888-4888-8888-888888888888';
const DRAW = '66666666-6666-4666-8666-666666666666';
const ALT = '99999999-9999-4999-8999-999999999999';
const DAY_KEY = `day:${COACH}:${SCHOOL_B}:2026-10-02`;

function fakeSupabase(tables) {
  return {
    from(table) {
      const filters = [];
      let limitN = null;
      const chain = {
        select: () => chain,
        eq: (c, v) => { filters.push((r) => r[c] === v); return chain; },
        gte: (c, v) => { filters.push((r) => String(r[c]) >= String(v)); return chain; },
        in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return chain; },
        order: () => chain,
        limit: (n) => { limitN = n; return chain; },
        then: (resolve) => {
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          if (limitN != null) rows = rows.slice(0, limitN);
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

const child = (over = {}) => ({
  drawId: DRAW, studentId: 's1', classId: 'c1', grade: 3, section: 'A', shift: 'morning',
  classLabel: 'Grade 3 - A', classLabelUr: 'جماعت 3 - A', classShort: '3A',
  teacherName: 'Sana Testwala', teacherUserId: 't1',
  displayName: 'Ayan Testwala', displayNameUrdu: 'ایان ٹیسٹ والا', fatherName: 'Bilal Testwala', fatherNameUrdu: null,
  namesakes: 1, fatherTellsApart: false, role: 'new', form: 'A', status: 'listed', attempts: 0, childNo: 1,
  ...over,
});

function makeDeps(over = {}) {
  const store = {
    createSession: jest.fn(async ({ drawId, coachUserId, visitId, visitKey, channel }) => ({
      ok: true, created: true,
      session: { id: 'new-session', draw_id: drawId, coach_user_id: coachUserId, visit_id: visitId || null, visit_key: visitKey || null, channel },
    })),
    getSessionByDraw: jest.fn(async () => ({ ok: true, session: null })),
    listSessionsForVisit: jest.fn(async () => ({ ok: true, sessions: [{ id: 'done-session', draw_id: DRAW, status: 'completed' }] })),
    recordTiming: jest.fn(async () => ({ ok: true })),
  };
  const draw = {
    resolveVisitSchool: jest.fn(async () => ({ ok: true, schoolId: SCHOOL })),
    todaysList: jest.fn(async () => ({
      ok: true, cycleId: 'ICT-2026-Q4', grade: 3, gradeFallback: false, reused: false,
      children: [child()],
      alternates: [child({ drawId: ALT, displayName: 'Zoya Testwala', displayNameUrdu: null, childNo: 6, namesakes: 2, fatherName: 'Omar Testwala' })],
    })),
    markOutcome: jest.fn(async () => ({ ok: true, list: { ok: true, grade: 3, children: [child({ drawId: ALT })], alternates: [] } })),
  };
  const supabase = fakeSupabase({
    observation_field_forms: [
      { id: VISIT, observer_user_id: COACH, created_at: '2026-10-02T05:00:00Z', visit_context: { school_ext_id: 'niete:123' }, answers: { lp_ref: { grade: 5 } } },
      { id: 'old-visit', observer_user_id: COACH, created_at: '2026-09-01T05:00:00Z', visit_context: {}, answers: {} },
      { id: 'their-visit', observer_user_id: OTHER, created_at: '2026-10-02T05:00:00Z', visit_context: {}, answers: {} },
    ],
    leader_schools: [
      { leader_user_id: COACH, school_id: SCHOOL_B, school_name: 'Bhara Kahu School' },
      { leader_user_id: COACH, school_id: SCHOOL, school_name: 'Zeta School' },
      { leader_user_id: COACH, school_id: SCHOOL_B, school_name: 'Bhara Kahu School' },
      { leader_user_id: COACH, school_id: null, school_name: 'Unmatched' },
      { leader_user_id: OTHER, school_id: SCHOOL_X, school_name: 'Not Mine' },
    ],
    schools: [{ id: SCHOOL, name: 'Zeta School' }, { id: SCHOOL_B, name: 'Bhara Kahu School' }],
  });
  return {
    store, draw, supabase,
    now: () => new Date('2026-10-02T09:00:00Z'),
    enabled: () => true,
    log: jest.fn(),
    logError: jest.fn(),
    ...over,
  };
}

let Svc;
beforeEach(() => {
  jest.resetModules();
  Svc = require(SVC);
});

describe('the gate', () => {
  test('off → disabled, nothing read', async () => {
    const deps = makeDeps({ enabled: () => false });
    expect(await Svc.listSchools({ userId: COACH }, deps)).toEqual({ status: 'disabled' });
    expect(deps.draw.todaysList).not.toHaveBeenCalled();
  });
});

describe('listSchools', () => {
  test("today's observe visit first, then the coach's schools by name, each once", async () => {
    const res = await Svc.listSchools({ userId: COACH }, makeDeps());
    expect(res.status).toBe('ok');
    expect(res.schools).toEqual([
      { schoolId: SCHOOL, name: 'Zeta School', visitId: VISIT, observedGrade: 5, visitToday: true },
      { schoolId: SCHOOL_B, name: 'Bhara Kahu School', visitId: null, observedGrade: null, visitToday: false },
    ]);
  });
});

describe('dayList', () => {
  test('no visit → the day key for this coach, school and Pakistan date', async () => {
    const deps = makeDeps();
    const res = await Svc.dayList({ userId: COACH, schoolId: SCHOOL_B }, deps);
    expect(res.status).toBe('ok');
    expect(deps.draw.todaysList).toHaveBeenCalledWith(expect.objectContaining({ coachUserId: COACH, schoolId: SCHOOL_B, visitKey: DAY_KEY }));
    expect(deps.draw.todaysList.mock.calls[0][0].visitId).toBeUndefined();
    expect(deps.store.listSessionsForVisit).toHaveBeenCalledWith(DAY_KEY);
    expect(res.list.visit).toEqual({ visitId: null, visitKey: DAY_KEY });
  });

  test('a child is name · class · teacher — no roll number, no student id, father only for a namesake', async () => {
    const res = await Svc.dayList({ userId: COACH, schoolId: SCHOOL_B }, makeDeps());
    const [c] = res.list.children;
    expect(c).toEqual({
      drawId: DRAW, name: 'Ayan Testwala', nameUr: 'ایان ٹیسٹ والا', firstName: 'Ayan', firstNameUr: 'ایان',
      grade: 3, section: 'A', classLabel: 'Grade 3 - A', classLabelUr: 'جماعت 3 - A', teacherName: 'Sana Testwala',
      status: 'listed', childNo: 1, role: 'new', namesake: false, sessionId: 'done-session', sessionStatus: 'completed',
    });
    const [alt] = res.list.alternates;
    expect(alt.namesake).toBe(true);
    expect(alt.fatherName).toBe('Omar Testwala');
    expect(alt.sessionId).toBeUndefined();
    expect(JSON.stringify(res.list)).not.toMatch(/studentId|rollNumber|roll_number/);
  });

  test("a school that is not this coach's is refused before the draw runs", async () => {
    const deps = makeDeps();
    expect(await Svc.dayList({ userId: COACH, schoolId: SCHOOL_X }, deps)).toEqual({ status: 'not_found' });
    expect(deps.draw.todaysList).not.toHaveBeenCalled();
  });

  test("today's observe visit names the visit and gives the grade", async () => {
    const deps = makeDeps();
    const res = await Svc.dayList({ userId: COACH, schoolId: SCHOOL, visitId: VISIT }, deps);
    expect(res.status).toBe('ok');
    expect(deps.draw.todaysList).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL, visitId: VISIT, observedGrade: 5 }));
    expect(deps.draw.todaysList.mock.calls[0][0].visitKey).toBeUndefined();
    expect(res.list.visit).toEqual({ visitId: VISIT, visitKey: null });
  });

  test("another coach's visit is not found", async () => {
    const deps = makeDeps();
    expect(await Svc.dayList({ userId: COACH, schoolId: SCHOOL, visitId: 'their-visit' }, deps)).toEqual({ status: 'not_found' });
    expect(deps.draw.todaysList).not.toHaveBeenCalled();
  });

  test('a draw refusal is passed on as invalid with its reason', async () => {
    const deps = makeDeps();
    deps.draw.todaysList.mockResolvedValueOnce({ ok: false, reason: 'no_class_list' });
    expect(await Svc.dayList({ userId: COACH, schoolId: SCHOOL_B }, deps)).toEqual({ status: 'invalid', reason: 'no_class_list' });
  });
});

describe('dayOutcome', () => {
  test('present → one app-channel session on the day key, marked self-administered', async () => {
    const deps = makeDeps();
    const res = await Svc.dayOutcome({ userId: COACH, schoolId: SCHOOL_B, drawId: DRAW, outcome: 'present' }, deps);
    expect(res).toEqual(expect.objectContaining({ status: 'ok', sessionId: 'new-session' }));
    expect(deps.draw.markOutcome).toHaveBeenCalledWith(expect.objectContaining({ drawId: DRAW, outcome: 'present', visitKey: DAY_KEY }));
    expect(deps.store.createSession).toHaveBeenCalledWith(expect.objectContaining({
      drawId: DRAW, coachUserId: COACH, visitKey: DAY_KEY, channel: 'app', itemBankVersion: Svc.SA_MARK,
    }));
    expect(deps.store.recordTiming).toHaveBeenCalledWith('new-session', 'sa.started', expect.any(Date));
  });

  test('absent → the new list, the alternate moved up, shaped like dayList', async () => {
    const deps = makeDeps();
    const res = await Svc.dayOutcome({ userId: COACH, schoolId: SCHOOL_B, drawId: DRAW, outcome: 'absent', note: 'ill' }, deps);
    expect(res.status).toBe('ok');
    expect(res.sessionId).toBeUndefined();
    expect(res.list.children[0].drawId).toBe(ALT);
    expect(JSON.stringify(res.list)).not.toMatch(/studentId/);
    expect(deps.store.createSession).not.toHaveBeenCalled();
  });

  test('present twice → the same session, not a second one', async () => {
    const deps = makeDeps();
    deps.draw.markOutcome.mockResolvedValueOnce({ ok: false, reason: 'already_marked' });
    deps.store.getSessionByDraw.mockResolvedValueOnce({ ok: true, session: { id: 'first', coach_user_id: COACH } });
    const res = await Svc.dayOutcome({ userId: COACH, schoolId: SCHOOL_B, drawId: DRAW, outcome: 'present' }, deps);
    expect(res).toEqual({ status: 'ok', sessionId: 'first', list: null });
    expect(deps.store.createSession).not.toHaveBeenCalled();
  });

  test('a bad outcome or a school that is not theirs is refused', async () => {
    const deps = makeDeps();
    expect(await Svc.dayOutcome({ userId: COACH, schoolId: SCHOOL_B, drawId: DRAW, outcome: 'gone' }, deps)).toEqual({ status: 'invalid', reason: 'bad_outcome' });
    expect(await Svc.dayOutcome({ userId: COACH, schoolId: SCHOOL_X, drawId: DRAW, outcome: 'absent' }, deps)).toEqual({ status: 'not_found' });
    expect(deps.draw.markOutcome).not.toHaveBeenCalled();
  });
});
