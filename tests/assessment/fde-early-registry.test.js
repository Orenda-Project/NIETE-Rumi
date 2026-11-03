/**
 * The FDE Grade 1 and Grade 2 patterns as data (bd-5jmnfj.4.2).
 *
 * Four subjects each, set from the whole book. The written marks add up to the
 * FDE written total, slot ids are unique across every pattern, the oral part is
 * present exactly where FDE has one and its rubric adds up, and the registry
 * hands the new patterns out to the right grade only.
 *
 * Pure data, no I/O.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');

const SUBJECTS = ['maths', 'english', 'urdu', 'general_knowledge'];
const PICTURE_KINDS = ['dots', 'count', 'shapes', 'clock', 'object', 'scene', 'plant'];

// FDE 2023-24 model papers: written marks and oral marks per subject (null = no oral part).
const EXPECT = {
  fde_g1_2026: {
    grade: 1,
    pages: { maths: 292, english: 166, urdu: 135, general_knowledge: 54 },
    written: { maths: 45, english: 84, urdu: 60, general_knowledge: 50 },
    oral: { maths: 5, english: 16, urdu: 40, general_knowledge: null },
  },
  fde_g2_2026: {
    grade: 2,
    pages: { maths: 300, english: 159, urdu: 134, general_knowledge: 126 },
    written: { maths: 50, english: 80, urdu: 60, general_knowledge: 50 },
    oral: { maths: null, english: 20, urdu: 30, general_knowledge: null },
  },
};

const slotsOf = (S) => S.sections.flatMap((s) => s.slots);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

describe('the registry lists the early patterns', () => {
  test('both ids are registered next to Grade 5', () => {
    expect(Patterns.list()).toEqual(expect.arrayContaining(['fde_g5_2027', 'fde_g1_2026', 'fde_g2_2026']));
  });

  test.each(Object.entries(EXPECT))('%s is for its own grade only', (id, e) => {
    SUBJECTS.forEach((s) => {
      expect(Patterns.isEligible(id, e.grade, s)).toBe(true);
      expect(Patterns.isEligible(id, 5, s)).toBe(false);
    });
    expect(Patterns.isEligible(id, e.grade, 'islamiat')).toBe(false);
    expect(Patterns.isEligible(id, e.grade, 'science')).toBe(false);
    expect(Patterns.isEligible(id, e.grade, 'genk')).toBe(true);
  });

  test('Grade 5 is untouched: still eligible for Grade 5 only', () => {
    expect(Patterns.isEligible('fde_g5_2027', 5, 'maths')).toBe(true);
    expect(Patterns.isEligible('fde_g5_2027', 1, 'maths')).toBe(false);
  });
});

describe.each(Object.entries(EXPECT))('%s', (id, e) => {
  const P = Patterns.get(id);

  test('is an early-profile pattern for its grade', () => {
    expect(P).toBeTruthy();
    expect(P.profile).toBe('early');
    expect(P.grade).toBe(e.grade);
    expect(Object.keys(P.subjects).sort()).toEqual([...SUBJECTS].sort());
    expect(Object.isFrozen(P.subjects.maths.sections[0].slots[0])).toBe(true);
  });

  test.each(SUBJECTS)('%s: slot marks add up to the written total, section by section', (s) => {
    const S = P.subjects[s];
    expect(S.total_marks).toBe(e.written[s]);
    S.sections.forEach((sec) => {
      expect(sum(sec.slots.map((sl) => sl.attempt * sl.marks_each))).toBe(sec.marks);
      expect(sum(Object.values(sec.levels))).toBe(sec.marks);
    });
    expect(sum(S.sections.map((sec) => sec.marks))).toBe(e.written[s]);
    expect(S.header.total_line_en).toBe(`Written Marks: {t:${e.written[s]}}`);
  });

  test.each(SUBJECTS)('%s: the whole book is the scope', (s) => {
    const scope = Patterns.scopeFor(id, s);
    expect(scope.page_ranges).toBe(`1-${e.pages[s]}`);
    expect(scope.label_en).toBe('Whole book');
    Object.values(scope.section_ranges).forEach((r) => expect(r).toBe(`1-${e.pages[s]}`));
  });

  test.each(SUBJECTS)('%s: every slot is complete and in its medium', (s) => {
    const S = P.subjects[s];
    slotsOf(S).forEach((sl) => {
      expect(sl.slot.startsWith(`g${e.grade}.${s}.`)).toBe(true);
      expect(sl.label_ur).toMatch(/^سوال \d+$/);
      expect(sl.prompt_rule).toEqual(expect.any(String));
      expect(sl.type).not.toBe('Rhyming Words');
      if (S.medium === 'ur') expect(sl.instruction_ur).toEqual(expect.any(String));
      else expect(sl.instruction_en).toEqual(expect.any(String));
      if (sl.shape === 'mcq') expect(sl.category).toBe('objective');
      (sl.picture || []).forEach((k) => expect(PICTURE_KINDS).toContain(k));
    });
    if (S.medium === 'ur') S.sections.forEach((sec) => expect(sec.label_ur).toEqual(expect.any(String)));
  });

  test.each(SUBJECTS)('%s: the oral part is there exactly where FDE has one', (s) => {
    const S = P.subjects[s];
    if (e.oral[s] === null) {
      expect(S.oral).toBeNull();
      expect(S.oral_marks).toBe(0);
      expect(S.header.note_en).toBeNull();
      return;
    }
    expect(S.oral.marks).toBe(e.oral[s]);
    expect(S.oral_marks).toBe(e.oral[s]);
    expect(sum(S.oral.tasks.map((t) => t.marks))).toBe(e.oral[s]);
    expect(S.header.note_en).toContain(`= ${e.written[s] + e.oral[s]} marks`);
    expect(new Set(S.oral.tasks.map((t) => t.id)).size).toBe(S.oral.tasks.length);
  });

  test.each(SUBJECTS)('%s: every oral rubric adds up by its own scoring rule', (s) => {
    const oral = P.subjects[s].oral;
    if (!oral) return;
    oral.tasks.forEach((t) => {
      const marks = t.rubric.map((r) => r.marks);
      expect(['each', 'criteria', 'bands']).toContain(t.scoring);
      if (t.scoring === 'each') expect(t.marks % marks[0]).toBe(0);
      if (t.scoring === 'criteria') expect(sum(marks)).toBe(t.marks);
      if (t.scoring === 'bands') expect(Math.max(...marks)).toBe(t.marks);
      t.rubric.forEach((r) => { expect(r.en).toEqual(expect.any(String)); expect(r.ur).toEqual(expect.any(String)); });
      expect(t.ask).toEqual(expect.any(String));
      expect(t.label_ur).toEqual(expect.any(String));
    });
  });

  test.each(SUBJECTS)('%s: the app summary and type list build', (s) => {
    const sum1 = Patterns.summaryFor(id, s);
    expect(sum1.totalMarks).toBe(e.written[s]);
    expect(sum1.youAdd).toBeNull();
    expect(sum1.choices).toEqual([]);
    const types = Patterns.expandTypes(id, s);
    expect(types.length).toBe(slotsOf(P.subjects[s]).length);
    types.forEach((t) => expect(t.slot).toMatch(new RegExp(`^g${e.grade}\\.`)));
  });
});

test('slot ids are unique across every registered pattern', () => {
  const ids = Patterns.list().flatMap((id) => Object.values(Patterns.get(id).subjects).flatMap(slotsOf).map((sl) => sl.slot));
  expect(new Set(ids).size).toBe(ids.length);
});
