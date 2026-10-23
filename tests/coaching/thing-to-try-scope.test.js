/**
 * v10 coaching test (bd-v0toag.100.8): a thing to try belongs to one subject and grade.
 *
 * Quratulain's week-1 review found a G2 English ask checked on a G5 lesson. The ask now carries to the
 * plans and recordings of its own subject and grade only, and stays there until a recording shows she
 * did it. scopeOf reads the subject and grade from a lesson id; activeThing finds the ask that is live for
 * a scope in a teacher's sessions, newest first. Pure.
 */
const { scopeOf, activeThing } = require('../../bot/shared/services/coaching/thing-to-try-scope');

describe('scopeOf', () => {
  test.each([
    ['grade_2_english_ch8_seg1', '2:english'],
    ['grade_2_maths_ch8_seg1', '2:maths'],
    ['grade_2_math_ch8_seg3', '2:maths'],
    ['grade_4_urdu_ch3_seg1b', '4:urdu'],
    ['grade_3_general_knowledge_ch11_seg2', '3:general_knowledge'],
    ['grade_5_gk_ch12_seg1', '5:general_knowledge'],
  ])('%s → %s', (id, scope) => {
    expect(scopeOf(id)).toBe(scope);
  });

  test.each([[null], [undefined], [''], ['grade_2'], ['english_ch8_seg1'], ['grade_2_klingon_ch1_seg1'], [42]])(
    'null for %p', (id) => { expect(scopeOf(id)).toBeNull(); },
  );

  test('a different grade or subject is a different scope', () => {
    expect(scopeOf('grade_2_english_ch8_seg1')).not.toBe(scopeOf('grade_5_english_ch8_seg1'));
    expect(scopeOf('grade_2_english_ch8_seg1')).not.toBe(scopeOf('grade_2_urdu_ch8_seg1'));
  });
});

describe('activeThing', () => {
  const T = (lesson_id, text = 'Ask two children to explain.') => ({ move_id: 'm2', lesson_id, text, tag: 'C9' });
  const s = (id, thing) => ({ id, prioritized_action: thing === undefined ? { action: 'x' } : { action: 'x', thing_to_try: thing } });

  test('the newest session whose thing has this scope', () => {
    const rows = [
      s('s4', T('grade_5_english_ch2_seg1', 'G5 ask')),
      s('s3', T('grade_2_urdu_ch2_seg1', 'Urdu ask')),
      s('s2', T('grade_2_english_ch7_seg4', 'G2 English ask')),
      s('s1', T('grade_2_english_ch7_seg1', 'older')),
    ];
    expect(activeThing(rows, '2:english')).toEqual({ sessionId: 's2', thing: rows[2].prioritized_action.thing_to_try });
  });

  test('sessions with no thing to try are passed over', () => {
    const rows = [s('s3'), s('s2', null), s('s1', T('grade_2_english_ch7_seg1'))];
    expect(activeThing(rows, '2:english').sessionId).toBe('s1');
  });

  test('a done marker (no text) in that scope ends the search: no live ask', () => {
    const rows = [s('s2', { lesson_id: 'grade_2_english_ch8_seg1', text: null }), s('s1', T('grade_2_english_ch7_seg1'))];
    expect(activeThing(rows, '2:english')).toBeNull();
  });

  test('null for no scope, no rows, or no match', () => {
    expect(activeThing([s('s1', T('grade_2_english_ch7_seg1'))], null)).toBeNull();
    expect(activeThing(null, '2:english')).toBeNull();
    expect(activeThing([s('s1', T('grade_2_urdu_ch7_seg1'))], '2:english')).toBeNull();
  });
});
