/**
 * v10 coaching test (bd-v0toag.8, PR3): the thing to try carries its step, so the lesson plan in the teacher
 * app can open at that step's heading. The step is the one of the move it was picked from (the previous
 * lesson's lp_fidelity), through report-card stepOf: Opening, Explanation, We Do, You Do, Check. Anything
 * that cannot be resolved is step null, and the thing still shows.
 */

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const LESSON = 'grade_1_english_ch8_seg6';
const THING = { move_id: 'm4', lesson_id: 'grade_1_english_ch8_seg5', text: '  Ask one child to explain to a neighbour. ', tag: 'hlp_peer_talk' };

const S = () => require('../../dashboard/services/thing-to-try.service');

/** A supabase stand-in: rows per table, filtered by eq; records the tables read. */
function fakeSupabase(tables, { fail = {} } = {}) {
  const read = [];
  return {
    read,
    from(table) {
      read.push(table);
      let rows = [...(tables[table] || [])];
      const done = () => (fail[table] ? { data: null, error: { message: 'boom' } } : null);
      const b = {
        select: () => b,
        eq: (c, v) => { rows = rows.filter((r) => String(r[c]) === String(v)); return b; },
        not: () => b,
        order: () => b,
        limit: async () => done() || { data: rows, error: null },
        maybeSingle: async () => done() || { data: rows[0] || null, error: null },
      };
      return b;
    },
  };
}

function world(group = 'C', over = {}) {
  return {
    app_settings: [{ key: 'ab_v10_enabled', value: 'true' }],
    users: [{ id: TEACHER, school_id: 's1' }],
    niete_coaching_ab_assignment: group ? [{ school_id: 's1', ab_group: group }] : [],
    coaching_sessions: [{
      user_id: TEACHER,
      prioritized_action: { action: 'old', teacher_response: 'yes', thing_to_try: THING },
      lp_fidelity: { status: 'ok', moves: [{ move_id: 'm1', phase: 'warm_up' }, { move_id: 'm4', phase: 'guided' }] },
    }],
    ...over,
  };
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('thingFor: the step', () => {
  const session = (lpFidelity, thing = THING) => ({
    coaching_sessions: [{ user_id: TEACHER, prioritized_action: { thing_to_try: thing }, lp_fidelity: lpFidelity }],
  });
  test.each([
    ['no lp_fidelity on the session', undefined, THING],
    ['the move is not among the graded moves', { moves: [{ move_id: 'm9', phase: 'guided' }] }, THING],
    ['the move has a phase no step carries', { moves: [{ move_id: 'm4', phase: 'homework' }] }, THING],
    ['the move has no phase', { moves: [{ move_id: 'm4' }] }, THING],
    ['moves is not a list', { moves: 'x' }, THING],
    ['the thing to try has no move id', { moves: [{ move_id: 'm4', phase: 'guided' }] }, { ...THING, move_id: null }],
  ])('step null when %s: the thing still shows', async (_l, lpf, thing) => {
    const found = await S().thingFor(fakeSupabase(world('C', session(lpf, thing))), TEACHER, LESSON);
    expect(found.thing.text).toBe('Ask one child to explain to a neighbour.');
    expect(found.thing.step).toBeNull();
  });

  test.each([['warm_up', 1, 'Opening'], ['explain', 2, 'Explanation'], ['independent', 4, 'You Do'], ['exit', 5, 'Check']])(
    'a %s move is step %i (%s)', async (phase, index, name) => {
      const found = await S().thingFor(fakeSupabase(world('D', session({ moves: [{ move_id: 'm4', phase }] }))), TEACHER, LESSON);
      expect(found.thing.step).toEqual({ name, index });
    },
  );

});

describe('thingFor: this plan\'s subject and grade (bd-v0toag.100.8)', () => {
  // bd-v0toag.100.8: the strip shows the ask of this plan's subject and grade only.
  const row = (id, thing) => ({ id, user_id: TEACHER, prioritized_action: { thing_to_try: thing }, lp_fidelity: null });
  test('a newer ask in another subject or grade is passed over for this plan\'s ask', async () => {
    const sb = fakeSupabase(world('C', { coaching_sessions: [
      row('s3', { ...THING, lesson_id: 'grade_1_urdu_ch2_seg1', text: 'Urdu ask', step: null }),
      row('s2', { ...THING, lesson_id: 'grade_3_english_ch2_seg1', text: 'G3 ask', step: null }),
      row('s1', { ...THING, step: { name: 'You Do', index: 4 } }),
    ] }));
    const out = await S().thingFor(sb, TEACHER, LESSON);
    expect(out.thing.text).toBe('Ask one child to explain to a neighbour.');
    expect(out.thing.step).toEqual({ name: 'You Do', index: 4 });
  });

  test('only asks of other subjects or grades: null', async () => {
    const sb = fakeSupabase(world('C', { coaching_sessions: [row('s1', { ...THING, lesson_id: 'grade_2_english_ch8_seg5' })] }));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toBeNull();
  });

  test('a done marker in this subject and grade: null', async () => {
    const sb = fakeSupabase(world('C', { coaching_sessions: [
      row('s2', { move_id: null, lesson_id: 'grade_1_english_ch8_seg5', text: null, tag: null, step: null }),
      row('s1', THING),
    ] }));
    expect(await S().thingFor(sb, TEACHER, LESSON)).toBeNull();
  });

  test.each([[undefined], [null], ['weird']])('no subject and grade in the lesson id (%p): null', async (lessonId) => {
    expect(await S().thingFor(fakeSupabase(world('C')), TEACHER, lessonId)).toBeNull();
  });
});
