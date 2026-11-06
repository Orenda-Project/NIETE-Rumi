/**
 * board/fbise-chrome.js: the FBISE board module read by chrome.js as BOARDS.FBISE: exam kinds per grade,
 * header lines in the board's own words (BLUEPRINTS §4-§7, P7-P8), the legend with the pass line, and the
 * term (off-year) header that never claims the board's examination header.
 */
const C = require('../../../bot/shared/services/assessment/patterns/board/chrome');
const F = require('../../../bot/shared/services/assessment/patterns/board/fbise-chrome');

const split = { levels: { K: 30, U: 50, A: 20 }, source: 'policy', status: 'verified' };
function subject(variantId = 'single', extra = {}) {
  return C.makeSubject({
    key: 'maths', source_id: 'x', medium: 'en', name_en: 'Mathematics', name_ur: 'ریاضی', status: 'ship', // ur: needs fluent-Urdu review
    variants: [{
      variant_id: variantId, total_marks: 20, total_time_min: 90, shared_time_min: 70, shared_sections: ['B'], cognitive_split: split,
      scheme_style: 'analytic_points', ...extra,
      sections: [
        { id: 'A', label_en: 'A', marks: 5, time_min: 20, answer_on: 'question_paper', slots: [{ slot: 'A.Q1', label_en: 'Q1', type: 'mcq', printed: 5, marks_each: 1 }] },
        { id: 'B', label_en: 'B', marks: 15, slots: [{ slot: 'B.Q2', label_en: 'Q2', type: 'srq', printed: 5, marks_each: 3 }] },
      ],
    }],
  });
}
const build = (grade, kind, S = subject()) => C.build({ id: `t_${kind}`, grade, board: 'FBISE', exam_kind: kind, subjects: [S] });

test('exam kinds are the four FBISE parts and each belongs to one grade', () => {
  expect(F.EXAM_KINDS).toEqual(['ssc1', 'ssc2', 'hssc1', 'hssc2']);
  expect(C.BOARDS.FBISE).toBe(F);
  expect(F.GRADE_OF).toEqual({ ssc1: 9, ssc2: 10, hssc1: 11, hssc2: 12 });
  expect(() => build(10, 'ssc1')).toThrow(/grade/);
  expect(() => build(9, 'hssc2')).toThrow(/grade/);
});

test('exam name and pattern identity lines', () => {
  expect(build(9, 'ssc1').exam.name_en).toBe('Federal Board SSC-I Examination');
  expect(build(10, 'ssc2').exam.name_en).toBe('Federal Board SSC-II Examination');
  expect(build(11, 'hssc1').exam.name_en).toBe('Federal Board HSSC-I Examination');
  expect(build(12, 'hssc2').exam.name_en).toBe('Federal Board HSSC-II Examination');
  const P = build(9, 'ssc1');
  expect(P.name.en).toBe('FBISE board pattern');
  expect(P.files.en).toMatch(/two PDFs/);
  expect(P.exam.session).toBe(F.SESSION);
});

test('header and exam header carry board, class, subject, time and total', () => {
  const S = build(11, 'hssc1').subjects.maths;
  const h = S.header;
  expect(h.title_en).toBe('Class XI · Mathematics · Federal Board HSSC-I Examination');
  expect(h.time_line_en).toBe('Time Allowed: 1 hr 30 min');
  expect(h.total_line_en).toBe('Total Marks: {t:20}');
  const eh = S.variants[0].exam_header;
  expect(eh.lines_en[0]).toBe('Federal Board HSSC-I Examination');
  expect(eh.lines_en[1]).toBe('Mathematics · Examination Paper');
  expect(eh.lines_en[2]).toBe('Time Allowed: 1 hr 30 min · Total Marks: {t:20}');
  expect(eh.lines_ur[0]).toMatch(/HSSC-I/);
});

test('a 50pct variant prints its label line; a term variant never claims the examination header', () => {
  const v50 = build(9, 'ssc1', subject('50pct', { label_en: '50% MCQs & 50% Descriptive' })).subjects.maths.variants[0];
  expect(v50.exam_header.lines_en).toContain('(50% MCQs & 50% Descriptive)');
  const term = build(9, 'ssc1', subject('term')).subjects.maths;
  expect(term.variants[0].exam_header.lines_en[0]).toBe('Term Examination (FBISE SSC-I pattern)');
  expect(term.header.title_en).toMatch(/Term Examination/);
  expect(term.header.title_en).not.toMatch(/Federal Board/);
});

test('legend: MCQ rule, scheme style line and one FBISE pass line (40%, BLUEPRINTS §4; legendFor gets no exam kind)', () => {
  const ssc = build(9, 'ssc1').subjects.maths.legend;
  expect(ssc.subject).toBe('maths');
  expect(ssc.lines_en.join(' ')).toMatch(/Pass = 40%/);
  expect(ssc.lines_en.join(' ')).toMatch(/one mark per valid point/);
  expect(build(12, 'hssc2').subjects.maths.legend.lines_en.join(' ')).toMatch(/Pass = 40%/);
  expect(ssc.lines_ur.length).toBe(ssc.lines_en.length);
});
