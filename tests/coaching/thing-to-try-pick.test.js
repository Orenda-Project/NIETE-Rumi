/**
 * v10 coaching test (bd-v0toag.20): the thing to try is picked from the plan moves the grading marked
 * missed, and checked on the next recording.
 *
 * Move ids only mean something inside one lesson, so the check on the next recording (a different lesson)
 * looks at the moves with the same practice tag (practice-tag.js). Runs only while ab_v10_enabled is on,
 * for every group (A and B never see it; it gives the test its comparison). Never throws.
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

const { logEvent } = require('../../bot/shared/utils/structured-logger');
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

describe('checkThing', () => {
  const PRIOR = { move_id: 'm3', lesson_id: 'grade_2_maths_ch4_seg2', text: 'In pairs, solve Q1.', tag: 'C9' };

  test('did: a same-practice move was done (or substituted)', () => {
    for (const verdict of ['executed', 'substituted_equivalent', 'substituted_better']) {
      const lp = graded([row('m1', 'guided', 'In groups, sort the cards.', verdict), row('m2', 'guided', 'Partners read.', 'not_done')]);
      expect(P.checkThing(PRIOR, lp)).toEqual({ outcome: 'did', matched: 2, moveIds: ['m1', 'm2'] });
    }
  });

  test('partly: the best same-practice move was partial', () => {
    const lp = graded([row('m1', 'guided', 'In groups, sort the cards.', 'partial'), row('m2', 'guided', 'Partners read.', 'not_done')]);
    expect(P.checkThing(PRIOR, lp)).toEqual({ outcome: 'partly', matched: 2, moveIds: ['m1', 'm2'] });
  });

  test('not_done: every same-practice move was missed', () => {
    const lp = graded([row('m1', 'guided', 'In groups, sort the cards.', 'not_done')]);
    expect(P.checkThing(PRIOR, lp)).toEqual({ outcome: 'not_done', matched: 1, moveIds: ['m1'] });
  });

  test('no_matching_move: this plan had no move with that practice', () => {
    const lp = graded([row('m1', 'exit', 'Exit ticket.', 'executed')]);
    expect(P.checkThing(PRIOR, lp)).toEqual({ outcome: 'no_matching_move', matched: 0, moveIds: [] });
  });

  test('not_adjudicable moves are left out', () => {
    const lp = graded([row('m1', 'guided', 'In groups, sort the cards.', 'not_adjudicable')]);
    expect(P.checkThing(PRIOR, lp)).toEqual({ outcome: 'no_matching_move', matched: 0, moveIds: [] });
  });

  test('optional moves count too: she may try it anywhere in the lesson', () => {
    const lp = graded([row('m1', 'guided', 'In groups, sort the cards.', 'executed', 'optional_extension')]);
    expect(P.checkThing(PRIOR, lp).outcome).toBe('did');
  });

  test('not_graded when this recording has no grading', () => {
    expect(P.checkThing(PRIOR, { status: 'lp_absent' })).toEqual({ outcome: 'not_graded', matched: 0, moveIds: [] });
    expect(P.checkThing(PRIOR, null)).toEqual({ outcome: 'not_graded', matched: 0, moveIds: [] });
  });

  test('null when there is no prior thing or it has no tag', () => {
    expect(P.checkThing(null, graded(MOVES))).toBeNull();
    expect(P.checkThing({ ...PRIOR, tag: null }, graded(MOVES))).toBeNull();
  });
});

describe('withThingToTry', () => {
  const ACTION = { action: 'Ask two children by name.', language: 'en' };
  const PRIOR_ACTION = { action: 'old', thing_to_try: { move_id: 'm5', lesson_id: 'grade_2_maths_ch4_seg2', text: 'Exit ticket.', tag: 'C3' } };

  function priorSessions(rows, { fail = false } = {}) {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockArms.groupFor.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
  });

  test('switch off: actionData unchanged, nothing read, nothing logged', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(false);
    const out = await P.withThingToTry(input());
    expect(out).toBe(ACTION);
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockArms.groupFor).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('switch on: adds the thing to try and logs it with the group', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(true);
    priorSessions([]);
    const out = await P.withThingToTry(input());
    expect(out).toEqual({ ...ACTION, thing_to_try: { move_id: 'm3', lesson_id: 'grade_2_maths_ch4_seg3', text: 'In pairs, students solve Q1.', tag: 'C9' } });
    expect(ACTION.thing_to_try).toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('coaching.thing_to_try.set', expect.objectContaining({
      userId: 'u1', sessionId: 's2', group: 'C', moveId: 'm3', tag: 'C9',
    }));
    expect(logEvent).not.toHaveBeenCalledWith('coaching.thing_to_try.checked', expect.anything());
  });

  test('checks the last session\'s thing to try against this recording', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(true);
    priorSessions([{ id: 's1', prioritized_action: PRIOR_ACTION }]);
    await P.withThingToTry(input());
    expect(logEvent).toHaveBeenCalledWith('coaching.thing_to_try.checked', {
      userId: 'u1', sessionId: 's2', priorSessionId: 's1', group: 'C',
      moveId: 'm5', setOnLessonId: 'grade_2_maths_ch4_seg2', lessonId: 'grade_2_maths_ch4_seg3',
      tag: 'C3', outcome: 'not_done', matched: 1, moveIds: ['m5'],
    });
  });

  test('group A and teachers outside the draw are checked too, group null when not drawn', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(true);
    mockArms.groupFor.mockResolvedValue(null);
    priorSessions([{ id: 's1', prioritized_action: PRIOR_ACTION }]);
    const out = await P.withThingToTry(input());
    expect(out.thing_to_try).toBeTruthy();
    expect(logEvent).toHaveBeenCalledWith('coaching.thing_to_try.checked', expect.objectContaining({ group: null }));
  });

  test('no actionData: the check still runs and null comes back', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(true);
    priorSessions([{ id: 's1', prioritized_action: PRIOR_ACTION }]);
    expect(await P.withThingToTry(input({ actionData: null }))).toBeNull();
    expect(logEvent).toHaveBeenCalledWith('coaching.thing_to_try.checked', expect.anything());
    expect(logEvent).not.toHaveBeenCalledWith('coaching.thing_to_try.set', expect.anything());
  });

  test('nothing missed: actionData unchanged', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(true);
    priorSessions([]);
    const lpFidelity = graded(MOVES.map((m) => ({ ...m, verdict: 'executed' })));
    expect(await P.withThingToTry(input({ lpFidelity }))).toBe(ACTION);
  });

  test('a failed read of the last session still adds the new thing', async () => {
    mockSwitch.v10Enabled.mockResolvedValue(true);
    priorSessions(null, { fail: true });
    const out = await P.withThingToTry(input());
    expect(out.thing_to_try.move_id).toBe('m3');
  });

  test('never throws: any failure returns actionData unchanged', async () => {
    mockSwitch.v10Enabled.mockRejectedValue(new Error('down'));
    expect(await P.withThingToTry(input())).toBe(ACTION);
    mockSwitch.v10Enabled.mockResolvedValue(true);
    mockSupabase.from.mockImplementation(() => { throw new Error('client down'); });
    mockArms.groupFor.mockRejectedValue(new Error('down'));
    const lpFidelity = { status: 'ok', get moves() { throw new Error('bad grading'); } };
    expect(await P.withThingToTry(input({ lpFidelity }))).toBe(ACTION);
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
