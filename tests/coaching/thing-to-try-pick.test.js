/**
 * v10 coaching test (bd-v0toag.20): the thing to try is picked from the plan moves the grading marked
 * missed, and checked on the next recording.
 *
 * bd-v0toag.100.8: an ask belongs to its subject and grade, and stays until a recording of that subject
 * and grade shows she did it; the check judges the ask's own text against the recording
 * (thing-to-try-judge.js). Runs only while ab_v10_enabled is on, for every group (A and B never see it;
 * it gives the test its comparison). Never throws.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockSwitch = { v10Enabled: jest.fn() };
jest.mock('../../bot/shared/services/coaching/ab-v10-switch', () => ({
  v10Enabled: (...a) => mockSwitch.v10Enabled(...a),
}));
const mockArms = { groupFor: jest.fn() };
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({
  groupFor: (...a) => mockArms.groupFor(...a),
}));
const mockJudge = { judgeThing: jest.fn() };
jest.mock('../../bot/shared/services/coaching/thing-to-try-judge', () => ({
  judgeThing: (...a) => mockJudge.judgeThing(...a),
}));

const P = require('../../bot/shared/services/coaching/thing-to-try-pick');

const row = (move_id, phase, text, verdict, bucket = 'must_happen') => ({ move_id, phase, text, verdict, bucket });
const graded = (moves, extra = {}) => ({ status: 'ok', lesson_id: 'grade_2_maths_ch4_seg3', moves, ...extra });

const MOVES = [
  row('m1', 'warm_up', 'Read three numbers fast.', 'executed'),
  row('m2', 'explain', 'Model the sum on the board.', 'partial'),
  row('m3', 'guided', 'In pairs, students solve Q1.', 'not_done'),
  row('m4', 'homework', 'Copy the sums at home.', 'not_done'),
  row('m5', 'exit', 'Exit ticket: one sum.', 'not_done'),
];

describe('pickThingToTry', () => {
  test('the first must_happen move marked not_done that has a tag', () => {
    expect(P.pickThingToTry(graded(MOVES))).toEqual({
      move_id: 'm3', lesson_id: 'grade_2_maths_ch4_seg3', text: 'In pairs, students solve Q1.', tag: 'C9',
      step: { name: 'We Do', index: 3 },
    });
  });

  test('a partial move when nothing was missed outright', () => {
    const moves = MOVES.map((m) => (m.verdict === 'not_done' ? { ...m, verdict: 'executed' } : m));
    expect(P.pickThingToTry(graded(moves))).toMatchObject({ move_id: 'm2', tag: 'C8' });
  });

  test('skips moves with no tag (homework) and moves outside must_happen', () => {
    const moves = [
      row('m1', 'homework', 'Copy the sums.', 'not_done'),
      row('m2', 'guided', 'In groups, sort the cards.', 'not_done', 'optional_extension'),
      row('m3', 'exit', 'Exit ticket.', 'not_done'),
    ];
    expect(P.pickThingToTry(graded(moves))).toMatchObject({ move_id: 'm3', tag: 'C3' });
  });

  test('a move with no bucket counts as must_happen (the scorer default)', () => {
    const moves = [{ move_id: 'm1', phase: 'exit', text: 'Exit ticket.', verdict: 'not_done' }];
    expect(P.pickThingToTry(graded(moves))).toMatchObject({ move_id: 'm1' });
  });

  test('trims the text', () => {
    const moves = [row('m1', 'exit', '  Exit ticket.  ', 'not_done')];
    expect(P.pickThingToTry(graded(moves)).text).toBe('Exit ticket.');
  });

  test.each([
    ['everything done', graded(MOVES.map((m) => ({ ...m, verdict: 'executed' })))],
    ['not graded', { status: 'fidelity_unavailable' }],
    ['no moves', graded([])],
    ['moves not an array', graded(null)],
    ['a missed move with no text', graded([row('m1', 'exit', '  ', 'not_done')])],
    ['null', null],
  ])('%s: null', (_label, lp) => {
    expect(P.pickThingToTry(lp)).toBeNull();
  });
});

describe('withThingToTry (bd-v0toag.100.8: same subject and grade, stays till done, the ask judged)', () => {
  const ACTION = { action: 'Ask two children by name.', language: 'en' };
  const OLD = { move_id: 'm5', lesson_id: 'grade_2_maths_ch4_seg2', text: 'Exit ticket.', tag: 'C3', step: { name: 'Check', index: 5 } };
  const NEW = {
    move_id: 'm3', lesson_id: 'grade_2_maths_ch4_seg3', text: 'In pairs, students solve Q1.', tag: 'C9',
    step: { name: 'We Do', index: 3 },
  };
  const s = (id, thing, lp_fidelity) => ({ id, prioritized_action: { action: 'old', thing_to_try: thing }, lp_fidelity });

  let P;
  let logEvent;
  function sessions(rows, { fail = false } = {}) {
    mockSupabase.from.mockImplementation(() => {
      const c = {
        select: () => c, eq: () => c, neq: () => c, not: () => c, order: () => c,
        limit: async () => (fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }),
      };
      return c;
    });
  }
  const input = (over = {}) => ({
    userId: 'u1', coachingSessionId: 's2', lpFidelity: graded(MOVES), actionData: ACTION, ...over,
  });
  const checked = () => logEvent.mock.calls.filter(([e]) => e === 'coaching.thing_to_try.checked').map(([, d]) => d);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    P = require('../../bot/shared/services/coaching/thing-to-try-pick');
    ({ logEvent } = require('../../bot/shared/utils/structured-logger'));
    mockArms.groupFor.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
    mockSwitch.v10Enabled.mockResolvedValue(true);
    mockJudge.judgeThing.mockResolvedValue({ outcome: 'not_done', moveId: 'm5', evidence: null, why: 'No exit ticket.' });
  });

  test('switch off: actionData unchanged, nothing read, nothing judged, nothing logged', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(false);
    expect(await P.withThingToTry(input())).toBe(ACTION);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockJudge.judgeThing).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('no live ask in this subject and grade: a new one is picked, with its step, and nothing judged', async () => {
    sessions([s('s1', { ...OLD, lesson_id: 'grade_5_maths_ch4_seg2' }), s('s0', { ...OLD, lesson_id: 'grade_2_english_ch4_seg2' })]);
    const out = await P.withThingToTry(input());
    expect(out).toEqual({ ...ACTION, thing_to_try: NEW });
    expect(ACTION.thing_to_try).toBeUndefined();
    expect(mockJudge.judgeThing).not.toHaveBeenCalled();
    expect(checked()).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith('coaching.thing_to_try.set', expect.objectContaining({
      userId: 'u1', sessionId: 's2', group: 'C', moveId: 'm3', tag: 'C9', carried: false,
    }));
  });

  test('a live ask not done yet is carried forward unchanged, and the check logs the judge\'s call', async () => {
    sessions([s('s1', OLD)]);
    const out = await P.withThingToTry(input());
    expect(out.thing_to_try).toEqual(OLD);
    expect(mockJudge.judgeThing).toHaveBeenCalledWith({ thing: OLD, lpFidelity: graded(MOVES), sessionId: 's2' });
    expect(checked()).toEqual([{
      userId: 'u1', sessionId: 's2', priorSessionId: 's1', group: 'C',
      moveId: 'm5', setOnLessonId: 'grade_2_maths_ch4_seg2', lessonId: 'grade_2_maths_ch4_seg3',
      tag: 'C3', outcome: 'not_done', judgedMoveId: 'm5', moveIds: ['m5'], evidence: null, why: 'No exit ticket.', carried: true,
    }]);
  });

  test.each(['partly', 'couldnt_tell', 'not_graded'])('%s: the ask stays', async (outcome) => {
    sessions([s('s1', OLD)]);
    mockJudge.judgeThing.mockResolvedValue({ outcome, moveId: null, evidence: null, why: null });
    expect((await P.withThingToTry(input())).thing_to_try).toEqual(OLD);
    expect(checked()[0]).toMatchObject({ outcome, carried: true, moveIds: [] });
  });

  test('did: a new ask is picked from this recording', async () => {
    sessions([s('s1', OLD)]);
    mockJudge.judgeThing.mockResolvedValue({ outcome: 'did', moveId: 'm5', evidence: 'exit ticket now', why: 'She did it.' });
    expect((await P.withThingToTry(input())).thing_to_try).toEqual(NEW);
    expect(checked()[0]).toMatchObject({ outcome: 'did', carried: false, evidence: 'exit ticket now' });
  });

  test('did, and nothing missed today: a done marker is stored so the old ask is not found again', async () => {
    sessions([s('s1', OLD)]);
    mockJudge.judgeThing.mockResolvedValue({ outcome: 'did', moveId: 'm5', evidence: null, why: null });
    const lpFidelity = graded(MOVES.map((m) => ({ ...m, verdict: 'executed' })));
    expect((await P.withThingToTry(input({ lpFidelity }))).thing_to_try).toEqual({
      move_id: null, lesson_id: 'grade_2_maths_ch4_seg3', text: null, tag: null, step: null,
    });
  });

  test('a carried ask set before this fix gets the step of its move from the session it was set on', async () => {
    const { step, ...bare } = OLD;
    sessions([s('s1', bare, { status: 'ok', moves: [{ move_id: 'm5', phase: 'exit' }] })]);
    expect((await P.withThingToTry(input())).thing_to_try).toEqual(OLD);
  });

  test('the slim image and the stored card resolve once: one read, one judgement, one check', async () => {
    sessions([s('s1', OLD)]);
    const a = await P.resolveThing({ userId: 'u1', coachingSessionId: 's2', lpFidelity: graded(MOVES) });
    await P.withThingToTry(input());
    expect(a.thing).toEqual(OLD);
    expect(mockJudge.judgeThing).toHaveBeenCalledTimes(1);
    expect(checked()).toHaveLength(1);
  });

  test('group null for a teacher outside the draw; they are checked too', async () => {
    mockArms.groupFor.mockResolvedValue(null);
    sessions([s('s1', OLD)]);
    await P.withThingToTry(input());
    expect(checked()[0]).toMatchObject({ group: null });
  });

  test('no actionData: the check still runs and null comes back', async () => {
    sessions([s('s1', OLD)]);
    expect(await P.withThingToTry(input({ actionData: null }))).toBeNull();
    expect(checked()).toHaveLength(1);
  });

  test('nothing missed and no live ask: actionData unchanged', async () => {
    sessions([]);
    const lpFidelity = graded(MOVES.map((m) => ({ ...m, verdict: 'executed' })));
    expect(await P.withThingToTry(input({ lpFidelity }))).toBe(ACTION);
  });

  test('a failed read of the earlier sessions still adds the new thing', async () => {
    sessions(null, { fail: true });
    expect((await P.withThingToTry(input())).thing_to_try).toEqual(NEW);
  });

  test('never throws: any failure returns actionData unchanged', async () => {
    mockSwitch.v10Enabled.mockRejectedValue(new Error('down'));
    expect(await P.withThingToTry(input())).toBe(ACTION);
    mockSwitch.v10Enabled.mockResolvedValue(true);
    mockSupabase.from.mockImplementation(() => { throw new Error('client down'); });
    mockArms.groupFor.mockRejectedValue(new Error('down'));
    const lpFidelity = { status: 'ok', lesson_id: 'grade_2_maths_ch4_seg3', get moves() { throw new Error('bad grading'); } };
    expect(await P.withThingToTry(input({ coachingSessionId: 's9', lpFidelity }))).toBe(ACTION);
  });
});

describe('wiring', () => {
  test('report-generator stores the result on prioritized_action', () => {
    const src = require('fs').readFileSync(
      require.resolve('../../bot/shared/services/coaching/report-generator.service.js'), 'utf8');
    const call = src.indexOf('withThingToTry(');
    const write = src.indexOf('.update({ prioritized_action: actionData })');
    expect(call).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(call);
  });
});
