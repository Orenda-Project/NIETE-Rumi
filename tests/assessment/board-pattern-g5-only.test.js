/**
 * The FDE board paper is Grade 5 only (Amena, 6 Nov 2026).
 *
 * The Grade 1-2 and Grade 3-4 FDE patterns sat behind the same board-pattern door and
 * carried Grade 5's name, so teachers of Grades 1-4 were offered a "board paper" that
 * no board sets. They are no longer offered. Their files stay registered so a paper
 * already made on one still prints and edits.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');

describe('board pattern: Grade 5 only', () => {
  test('only Grade 5 is offered the door', () => {
    expect(Patterns.offeredGrades()).toEqual([5]);
  });

  test('Grade 5 is still offered', () => {
    expect(Patterns.isOffered('fde_g5_2027')).toBe(true);
  });

  test.each(['fde_g1_2026', 'fde_g2_2026', 'fde_g3_2026', 'fde_g4_2026', 'nope', null])('%s is not offered', (id) => {
    expect(Patterns.isOffered(id)).toBe(false);
  });

  test('a paper already made on a Grade 1-4 pattern still finds its pattern', () => {
    for (const id of ['fde_g1_2026', 'fde_g2_2026', 'fde_g3_2026', 'fde_g4_2026']) {
      expect(Patterns.get(id)).not.toBeNull();
    }
    expect(Patterns.subjectOf('fde_g3_2026', 'maths')).not.toBeNull();
  });
});
