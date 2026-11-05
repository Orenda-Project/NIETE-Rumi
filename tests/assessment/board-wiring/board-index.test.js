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

describe('patterns/board summaryFor + grades (bd-5jmnfj.38.25.1)', () => {
  test('grades lists 9-12 ascending', () => {
    expect(Board.grades()).toEqual([9, 10, 11, 12]);
  });

  test('summaryFor is the FDE summary shape, built from the subject', () => {
    const s = Board.summaryFor('fbise_ssc1_2027', 'Physics');
    const S = Board.subjectOf('fbise_ssc1_2027', 'physics');
    expect(Object.keys(s).sort()).toEqual(Object.keys(Patterns.summaryFor('fde_g5_2027', 'maths')).sort());
    expect(s.id).toBe('fbise_ssc1_2027');
    expect(s.name).toEqual({ en: 'FBISE board pattern', ur: 'FBISE بورڈ pattern' });
    expect(s.totalMarks).toBe(S.total_marks);
    expect(s.totalTime).toEqual({ en: S.total_time_en, ur: S.total_time_ur });
    const gen = S.sections.flatMap((x) => x.slots).reduce((n, x) => n + x.generate, 0);
    expect(s.generateTotal).toBe(gen);
    expect(s.holds.en).toBe(`3 sections · ${S.total_marks} marks · ${S.total_time_en} · ${gen} questions`);
    expect(s.holds.ur).toBe(`3 حصے · ${S.total_marks} نمبر · ${S.total_time_ur} · ${gen} سوال`);
    expect(s.sections).toEqual([
      { id: 'A', en: S.summary_lines.en.sections[0], ur: S.summary_lines.ur.sections[0] },
      { id: 'B', en: S.summary_lines.en.sections[1], ur: S.summary_lines.ur.sections[1] },
      { id: 'C', en: S.summary_lines.en.sections[2], ur: S.summary_lines.ur.sections[2] },
    ]);
    expect(s.choice).toEqual({ en: S.summary_lines.en.choice, ur: S.summary_lines.ur.choice });
    expect(s.youAdd).toBeNull();
    expect(s.scope).toEqual({
      en: S.scope.line_en, ur: S.scope.line_ur, label: { en: 'Chosen chapters', ur: 'منتخب ابواب' },
      chapters: [], displayChapters: [], excluded: [], topicsOnly: [], held: [], unitRanges: [],
    });
    expect(s.files).toEqual(Board.get('fbise_ssc1_2027').files);
    expect(s.waitHint).toEqual(Board.get('fbise_ssc1_2027').wait_hint);
  });

  test('choices lists only the slots that print more than are attempted', () => {
    const S = Board.subjectOf('fbise_hssc2_2027', 'english');
    const want = S.sections.flatMap((x) => x.slots).filter((x) => x.attempt < x.generate);
    const s = Board.summaryFor('fbise_hssc2_2027', 'english');
    expect(s.choices).toEqual(want.map((x) => ({
      slot: x.slot, label_en: x.label_en, label_ur: x.label_ur, generate: x.generate, attempt: x.attempt, marks_each: x.marks_each,
    })));
    expect(s.choices.length).toBeGreaterThan(0);
  });

  test('null for an unknown id or a subject it does not set', () => {
    expect(Board.summaryFor('nope', 'physics')).toBeNull();
    expect(Board.summaryFor('fbise_ssc1_2027', 'art')).toBeNull();
  });
});

test('list is every board id', () => {
  expect(Board.list().sort()).toEqual(Object.keys(IDS).sort());
});
