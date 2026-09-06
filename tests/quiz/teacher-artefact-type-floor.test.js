'use strict';
/**
 * PLAN_R5 D6 — the type floor for every teacher-facing rendered artefact.
 *
 * Operator, item 11: "The pre-send teacher PDF and the completion report both
 * must be at an appropriate enough size that the teacher can read them easily.
 * See what the phone floor was in 6-12 LPs… this is a rule for all teacher
 * facing artefacts in this build."
 *
 * That floor is the lesson plans' own, and it is not negotiable per document:
 * body 18px at an A4 794px page width, small/caption type 14px, and nothing at
 * all under 13.5px. One shared token (`TYPE_FLOOR` in niete-brand.js) so the
 * PDF, the report and anything added later cannot drift into three different
 * ideas of "readable".
 *
 * These assertions run the REAL template functions and read the CSS they
 * actually emit, so they fail on the branch that ships. The rasterise-to-390px
 * look is the other half of the gate and lives in scripts/phone_gate_pdf.py.
 */
const renderTeacher = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const renderReport = require('../../bot/shared/templates/video-quiz-report.template');
const { TYPE_FLOOR } = require('../../bot/shared/templates/niete-brand');
const { under, sizeOf } = require('./helpers/type-floor');

const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'Fractions', subject: 'maths', grade_band: '3-5',
  slos: [{ id: 'S1', statement: 'write a half as a fraction', taught_level: 'recall' },
         { id: 'S2', statement: 'spot equal parts', taught_level: 'understand' }],
};
const Q = (n) => ({
  external_id: `tq:q-1:S1:${n}`, question_text: `Question ${n}: what fraction is shaded?`,
  option_a: 'one half', option_b: 'one third', option_c: 'one quarter', correct_option: 'A',
  explanation: 'Two equal parts, one shaded.', sort_order: n - 1,
  media: { selected_because: 'when you cut the roti in two on the board' },
  distractor_misconceptions: { B: 'counted three parts', C: 'counted four parts' },
  option_feedback: { correct: 'Right — one of two.', wrong: { 1: 'Not three.', 2: 'Not four.' } },
});
const PDF_BASE = {
  topic: 'Fractions', teacherName: 'Rifat Noor', date: '5 Sep 2026',
  link: 'https://example.test/q', digest: DIGEST, questions: [Q(1), Q(2)],
  lessonSummary: 'You started with half a roti and drew equal parts on the board.',
};
const REPORT_BASE = {
  topic: 'Fractions', teacherName: 'Razia', started: 12, finished: 11, average: 68,
  students: [{ student_name: 'Ayesha', student_class: '6', correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75 }],
  hardest: [{ question_text: 'Which is an insect?', wrong: 8, total: 11, top_wrong_text: 'spider', correct_text: 'bee', explanation: 'A bee has six legs.', misconception: 'A spider has eight legs.', slo: 'tell an insect from a spider' }],
  unfinished: ['Sana'], generatedAt: '5 Sep 2026',
  guidance: { muddled: 'They think anything small counts as an insect.', board: 'Draw a spider and a bee side by side and count legs together.', check: 'A grasshopper has six legs — is it an insect?' },
};

describe('the floor is one shared token, not a number per template', () => {
  test('niete-brand exports TYPE_FLOOR at the lesson-plan values', () => {
    expect(TYPE_FLOOR).toEqual({ body: 18, small: 14, label: 13.5 });
  });
});

describe.each([
  ['teacher PDF · en', () => renderTeacher({ ...PDF_BASE, language: 'en', contentLanguage: 'en' })],
  ['teacher PDF · ur', () => renderTeacher({ ...PDF_BASE, language: 'ur', contentLanguage: 'ur' })],
  ['class report · en', () => renderReport({ ...REPORT_BASE, language: 'en', contentLanguage: 'en' })],
  ['class report · ur', () => renderReport({ ...REPORT_BASE, language: 'ur', contentLanguage: 'ur' })],
])('%s', (_name, build) => {
  test('no type anywhere in the document falls under the 13.5px hard floor', () => {
    expect(under(build(), TYPE_FLOOR.label)).toEqual([]);
  });
});

describe('teacher PDF — the reading blocks sit at the 18px body floor', () => {
  const html = renderTeacher({ ...PDF_BASE, language: 'en', contentLanguage: 'en' });
  test.each([
    ['.taught .sum', 'what she taught'],
    ['.checks li', 'what the quiz checks'],
    ['.stem', 'the question'],
    ['.opt', 'an option the child taps'],
    ['.chosen', 'which moment of the lesson it came from'],
    ['.miss', 'what a wrong option reveals'],
    ['.howto', 'how to send it'],
  ])('%s (%s) is at or above the body floor', (selector) => {
    const px = sizeOf(html, selector);
    expect(px).not.toBeNull();
    expect(px).toBeGreaterThanOrEqual(TYPE_FLOOR.body);
  });
});

describe('class report — the reading blocks sit at the 18px body floor', () => {
  const html = renderReport({ ...REPORT_BASE, language: 'en', contentLanguage: 'en' });
  test.each([
    ['.m-q', 'the missed question'],
    ['.mstat', 'how many got it wrong'],
    ['.chose', 'what most of them chose'],
    ['.why', 'why that answer is wrong'],
    ['.r-name', 'a child’s name'],
    ['.r-score', 'a child’s score'],
    ['.unfin', 'who has not finished'],
    ['.try-text', 'the reteach guidance she acts on'],
  ])('%s (%s) is at or above the body floor', (selector) => {
    const px = sizeOf(html, selector);
    expect(px).not.toBeNull();
    expect(px).toBeGreaterThanOrEqual(TYPE_FLOOR.body);
  });
});
