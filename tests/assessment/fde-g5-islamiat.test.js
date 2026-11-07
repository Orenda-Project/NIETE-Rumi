/**
 * bd-5jmnfj.39: the FDE Grade 5 Islamiat paper (CAE 2026 model paper, design p95, ToS p84) as data.
 *
 * Nazra is the oral part (40) and every Nazra task is the teacher's to fill: the paper asks the
 * teacher to write the ayat, words, surahs, hadith and dua, and the model writes none of it.
 * Part 2 Q3 (translate a Quranic dua or the durood) is the same: a teacher-filled slot.
 * Generated slots never quote or ask for Quranic, hadith, dua or durood text, and Islamiat
 * has no true/false item anywhere (Amena, 7 Nov 2026). It is held (not offered) until the engine
 * prints teacher-filled slots and a G5 oral sheet.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');

const S = () => Patterns.get('fde_g5_2027').held_subjects.islamiat;
const slots = () => S().sections.flatMap((s) => s.slots);
const total = (sl) => sl.attempt * sl.marks_each;

describe('G5 Islamiat pattern', () => {
  it('is a Grade 5 subject in Urdu: 60 written + 40 oral = 100, ToS R40 / U30 / A30', () => {
    const s = S();
    expect(s).toBeTruthy();
    expect(s.key).toBe('islamiat');
    expect(s.medium).toBe('ur');
    expect(s.total_marks).toBe(60);
    expect(s.oral_marks).toBe(40);
    expect(s.total_marks + s.oral_marks).toBe(100);
    expect(s.tos).toEqual({ Remember: 40, Understand: 30, Apply: 30 });
  });

  it('prints FDE\'s two written parts: objective 20, subjective 40', () => {
    const [A, B] = S().sections;
    expect(S().sections.map((x) => [x.id, x.marks])).toEqual([['A', 20], ['B', 40]]);
    expect(A.slots.map((sl) => [sl.shape, sl.generate, sl.attempt, sl.marks_each])).toEqual([
      ['short', 5, 5, 1], ['mcq', 15, 15, 1],
    ]);
    expect(B.slots.map((sl) => [sl.shape, sl.generate, sl.attempt, sl.marks_each])).toEqual([
      ['teacher_fills', 0, 1, 10], ['short', 8, 5, 4], ['short', 5, 2, 5],
    ]);
    for (const sec of S().sections) expect(sec.slots.reduce((n, sl) => n + total(sl), 0)).toBe(sec.marks);
  });

  it('sets the written part from FDE\'s syllabus only: ch2-3, ch4 u1-2, ch5 u1+3, ch6, ch7 u1', () => {
    expect(S().scope.page_ranges).toBe('15-77, 83-86, 91-110');
  });

  it('is held: built and checked, but no teacher is offered it until the engine prints teacher-filled slots', () => {
    expect(Patterns.isEligible('fde_g5_2027', 5, 'islamiat')).toBe(false);
    expect(S().summary_lines.en.sections).toHaveLength(3);
  });

  it('Part 2 Q3 is the teacher\'s: nothing generated, a note telling the teacher to write the dua or durood', () => {
    const q3 = S().sections[1].slots[0];
    expect(q3.teacher_fills).toBe(true);
    expect(q3.prompt_rule).toBeNull();
    expect(q3.teacher_note_ur).toMatch(/استاد/);
    expect(q3.lines).toBeGreaterThan(0);
  });

  it('Nazra is four teacher-filled oral tasks, 20 + 5 + 10 + 5, none asked of the model', () => {
    const o = S().oral;
    expect(o.tasks.map((t) => [t.id, t.marks])).toEqual([['ayat', 20], ['words', 5], ['by_heart', 10], ['hadith_dua', 5]]);
    expect(o.marks).toBe(40);
    for (const t of o.tasks) {
      expect(t.teacher_fills).toBe(true);
      expect(t.ask).toBeUndefined();
      expect(t.lines).toBeGreaterThan(0);
      expect(t.instruction_ur).toBeTruthy();
      expect(['each', 'criteria', 'bands']).toContain(t.scoring);
    }
  });

  it('every generated slot forbids Quranic, hadith, dua and durood text', () => {
    for (const sl of slots().filter((x) => !x.teacher_fills)) {
      expect({ slot: sl.slot, rule: /never quote/i.test(sl.prompt_rule) && /hadith/i.test(sl.prompt_rule) })
        .toEqual({ slot: sl.slot, rule: true });
    }
  });

  it('has no true/false item anywhere, and every generated slot says so', () => {
    const tf = /true\s*\/?\s*false|درست\s*\/\s*غلط|صحیح\s*\/\s*غلط/i;
    for (const sl of slots()) {
      expect(String(sl.type)).not.toMatch(tf);
      expect(sl.kinds || []).not.toContain('true_false');
      if (!sl.teacher_fills) expect(sl.prompt_rule).toMatch(/no true\/false/i);
    }
  });
});
