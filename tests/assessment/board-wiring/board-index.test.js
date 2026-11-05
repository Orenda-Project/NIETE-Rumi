/**
 * The G6-12 board-pattern lookup (bd-5jmnfj.38.24). Kept apart from patterns/index.js so nothing that lists
 * the FDE patterns (the Flow, browse, the FDE renderer) ever sees a board pattern before the surfaces lane.
 */
const Board = require('../../../bot/shared/services/assessment/patterns/board');
const Patterns = require('../../../bot/shared/services/assessment/patterns');

const IDS = { fbise_ssc1_2027: 9, fbise_ssc2_2027: 10, fbise_hssc1_2027: 11, fbise_hssc2_2027: 12 };

describe('patterns/board lookup', () => {
  test('gets each FBISE pattern by id, with its grade and board profile', () => {
    for (const [id, grade] of Object.entries(IDS)) {
      const def = Board.get(id);
      expect(def.id).toBe(id);
      expect(def.grade).toBe(grade);
      expect(def.profile).toBe('board');
    }
  });

  test('an unknown or FDE id is not a board pattern', () => {
    expect(Board.get('fde_g5_2027')).toBeNull();
    expect(Board.get('nope')).toBeNull();
    expect(Board.get(undefined)).toBeNull();
    expect(Board.isBoard('fde_g5_2027')).toBe(false);
    expect(Board.isBoard('fbise_ssc1_2027')).toBe(true);
  });

  test('eligible only for its own grade and a subject it sets', () => {
    expect(Board.isEligible('fbise_ssc1_2027', 9, 'physics')).toBe(true);
    expect(Board.isEligible('fbise_ssc1_2027', '9', 'Physics')).toBe(true);
    expect(Board.isEligible('fbise_ssc1_2027', 10, 'physics')).toBe(false);
    expect(Board.isEligible('fbise_ssc1_2027', 9, 'art')).toBe(false);
    expect(Board.isEligible('fbise_hssc1_2027', 11, 'pakistan_studies_ur')).toBe(false);
    expect(Board.isEligible('nope', 9, 'physics')).toBe(false);
  });

  test('subjectOf returns the subject entry or null', () => {
    expect(Board.subjectOf('fbise_ssc2_2027', 'maths')).toBe(Board.get('fbise_ssc2_2027').subjects.maths);
    expect(Board.subjectOf('fbise_ssc2_2027', 'art')).toBeNull();
  });

  test('the main registry still lists no board pattern', () => {
    expect(Patterns.list().some((p) => Board.isBoard(p.id))).toBe(false);
    for (const id of Object.keys(IDS)) expect(Patterns.get(id)).toBeFalsy();
  });
});
