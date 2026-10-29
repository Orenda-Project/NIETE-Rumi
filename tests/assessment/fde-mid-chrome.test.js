/**
 * The Grade 3-4 mid-pattern builders (bd-5jmnfj.33.1): the word-problem count on a slot,
 * the chapter-driven scope, the totals, and no `profile` key so the scoped path is taken.
 */

const C = require('../../bot/shared/services/assessment/patterns/mid/chrome');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const slot = (o = {}) => ({ slot: 'maths.A.Q1', label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5, marks_each: 1, prompt_rule: 'r', ...o });
const section = (o = {}) => ({ id: 'A', label_en: 'A', levels: { Remember: 5 }, slots: [slot(), slot({ slot: 'maths.A.Q2', label_en: 'Q2.', shape: 'short', generate: 4, attempt: 3, marks_each: 2, word_problems: 2 })], ...o });
const subject = (o = {}) => C.makeSubject({
  grade: 3, key: 'maths', medium: 'en', name_en: 'Mathematics', name_ur: 'ریاضی',
  tos: { Remember: 20, Understand: 30, Apply: 50 }, sections: [section()], ...o,
});
const pattern = (o = {}) => C.build({ id: 'fde_g3_x', grade: 3, subjects: [subject()], ...o });

test('GRADE_WORD names grades 3 and 4 only', () => {
  expect(C.GRADE_WORD).toEqual({ 3: { en: 'Grade III', ur: 'جماعت سوم' }, 4: { en: 'Grade IV', ur: 'جماعت چہارم' } });
});

test('a slot carries word_problems, default 0, and refuses more than it generates', () => {
  expect(C.makeSlot(slot()).word_problems).toBe(0);
  const s = C.makeSlot(slot({ shape: 'short', generate: 4, word_problems: 3 }));
  expect(s.word_problems).toBe(3);
  expect(s.generate).toBe(4);
  expect(s.category).toBe('subjective');
  expect(() => C.makeSlot(slot({ generate: 2, word_problems: 3 }))).toThrow(/word_problems/);
});

test('a section keeps word_problems and its marks add attempt x marks_each', () => {
  const s = C.makeSection(section());
  expect(s.slots.map((x) => x.word_problems)).toEqual([0, 2]);
  expect(s.marks).toBe(5 + 3 * 2);
  expect(s.marks_en).toBe('Total Marks: {t:11}');
});

test('a subject is in Grade 5 shape with grade, g5_rules false and no oral', () => {
  const S = subject({ sections: [section(), section({ id: 'B', slots: [slot({ slot: 'maths.B.Q1' })] })] });
  expect(S.grade).toBe(3);
  expect(S.g5_rules).toBe(false);
  expect(S.oral).toBeNull();
  expect(S.oral_marks).toBe(0);
  expect(S.total_marks).toBe(11 + 5);
  expect(S.total_time_en).toBe('as the school sets');
  expect(S.total_time_ur).toBe('اسکول کے مطابق');
  expect(S.word_problem_cap).toBeNull();
  expect(S.legend).toEqual(expect.objectContaining({ subject: 'maths' }));
  expect(S.legend.lines_en.join(' ')).not.toMatch(/oral/i);
  expect(S.summary_lines.en.choice).toBe('');
  expect(S.summary_lines.en.sections).toEqual(['11 · A', '5 · A']);
  expect(S.before_exam).toBeDefined();
  expect(S.supplies).toBeDefined();
});

test('the header names the grade and subject, prints no time and a total line', () => {
  const h = subject({ grade: 4 }).header;
  expect(h.title_en).toBe('Grade IV · Mathematics · End-of-chapter paper (FDE pattern)');
  expect(h.title_ur).toContain('جماعت چہارم');
  expect(h.time_line_en).toBe('');
  expect(h.time_line_ur).toBe('');
  expect(h.total_line_en).toBe('Total Marks: {t:11}');
  expect(h.total_line_ur).toBe('کل نمبر: {t:11}');
  expect(h.note_en).toBeNull();
  expect(h.note_ur).toBeNull();
  expect(h.covers_partial_en).toBe('Covers {units}.');
  expect(h.covers_partial_ur).toBe('احاطہ: {units}۔');
});

test('the scope is chapter-driven, never fixed pages', () => {
  const sc = subject().scope;
  expect(sc).toEqual({
    page_ranges: '', chapter_numbers: [], display_chapters: [], excluded: [], topics_only: [], held: [], unit_ranges: [],
    label_en: 'Chosen chapter', label_ur: 'منتخب باب',
    line_en: 'The chapter or pages the teacher chose.', line_ur: 'استاد کے منتخب کردہ باب یا صفحات۔',
  });
});

test('scopeFor computes on an empty page_ranges without crashing (same steps as patterns/index.js scopeFor)', () => {
  const S = subject();
  // scopeFor: per section, parseRanges(scope.page_ranges) for every 'scope' slot, then formatRanges of the union.
  const ranges = S.sections[0].slots.flatMap(() => Patterns.parseRanges(S.scope.page_ranges));
  expect(ranges).toEqual([]);
  expect(S.sections.flatMap((sec) => sec.slots).every((s) => s.section_pages === 'scope')).toBe(true);
});

test('tos is required: undefined throws, null is allowed, a bad split throws', () => {
  expect(() => subject({ tos: undefined })).toThrow(/tos/);
  expect(subject({ tos: null }).tos).toBeNull();
  expect(() => subject({ tos: { Remember: 20, Understand: 30, Apply: 40 } })).toThrow(/100/);
  expect(() => subject({ tos: { Remember: 100 } })).toThrow(/tos/);
});

test('word_problem_cap is stored as given', () => {
  expect(subject({ word_problem_cap: { items: 4, marks: 8 } }).word_problem_cap).toEqual({ items: 4, marks: 8 });
});

test('build has no profile key, the FDE exam name and the Grade 5 chrome', () => {
  const P = pattern();
  expect(P).not.toHaveProperty('profile');
  expect(P.id).toBe('fde_g3_x');
  expect(P.grade).toBe(3);
  expect(P.exam).toEqual({ name_en: 'FDE Grade III end-of-chapter paper (2023-24 model-paper pattern)', session: '2026-27' });
  expect(P.total_time).toBeNull();
  ['you_add', 'files', 'name', 'wait_hint'].forEach((k) => expect(P).toHaveProperty(k));
  expect(Object.keys(P.subjects)).toEqual(['maths']);
});

test('grades 3 and 4 build; 1, 2 and 5 throw a clear error', () => {
  expect(pattern({ grade: 4 }).exam.name_en).toContain('Grade IV');
  [1, 2, 5].forEach((g) => {
    expect(() => pattern({ grade: g })).toThrow(/grade 3 or 4/i);
    expect(() => subject({ grade: g })).toThrow(/grade 3 or 4/i);
  });
});

test('the pattern is deep-frozen', () => {
  const P = pattern();
  expect(Object.isFrozen(P)).toBe(true);
  expect(Object.isFrozen(P.subjects.maths.sections[0].slots[0])).toBe(true);
  expect(Object.isFrozen(P.subjects.maths.scope.held)).toBe(true);
});
