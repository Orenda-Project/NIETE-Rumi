'use strict';
/**
 * PLAN_R5 D6 / PLAN_R6 D4 — the type floor for every teacher-facing rendered
 * artefact, and the size it survives at on a phone.
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
 * ROUND 6 raised that floor. The operator read the live pre-send PDF on his
 * phone and said it was "still a bit small… make it a little bigger, without
 * affecting the design". The arithmetic behind him is exact and is what these
 * assertions now encode: both documents print A4 with zero margins, so the page
 * is 794 CSS px wide, and a phone opening it full-width gives it 390 — every
 * glyph is multiplied by 390/794 = 0.4912. An 18px body was 8.8px in his hand.
 * PLAN_R6 D4 moves the floor to body 21 / small 16.5 / label 15.5 (+17%), which
 * is 10.3px in his hand, and puts the class report on the SAME token instead of
 * its own literals.
 *
 * These assertions run the REAL template functions and read the CSS they
 * actually emit, so they fail on the branch that ships. The rasterise-to-390px
 * look is the other half of the gate and lives in scripts/phone_gate_pdf.py.
 */
const renderTeacher = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const renderReport = require('../../bot/shared/templates/video-quiz-report.template');
const { TYPE_FLOOR, TYPE_FLOOR_UR, RTL_TYPE_SCALE } = require('../../bot/shared/templates/niete-brand');
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

/** An A4 page prints 794 CSS px wide and a phone gives it 390. */
const PHONE = 390 / 794;

describe('the floor is one shared token, not a number per template', () => {
  test('niete-brand exports TYPE_FLOOR at the R6 values', () => {
    expect(TYPE_FLOOR).toEqual({ body: 21, small: 16.5, label: 15.5 });
  });

  test('the Urdu bump is one exported constant, not a factor each template retypes', () => {
    expect(RTL_TYPE_SCALE).toBe(1.15);
    expect(TYPE_FLOOR_UR).toEqual({ body: 24.2, small: 19, label: 17.8 });
  });

  test('the body floor survives a phone at over 10px, which 18px did not', () => {
    expect(TYPE_FLOOR.body * PHONE).toBeGreaterThan(10);
    expect(18 * PHONE).toBeLessThan(9);   // what the operator was reading
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

describe('teacher PDF — the reading blocks sit ON the body floor', () => {
  const html = renderTeacher({ ...PDF_BASE, language: 'en', contentLanguage: 'en' });
  test.each([
    ['.taught .sum', 'what she taught'],
    ['.checks li', 'what the quiz checks'],
    ['.stem', 'the question'],
    ['.opt', 'an option the child taps'],
    ['.chosen', 'which moment of the lesson it came from'],
    ['.miss', 'what a wrong option reveals'],
    ['.howto', 'how to send it'],
  ])('%s (%s) is at the body floor', (selector) => {
    const px = sizeOf(html, selector);
    expect(px).not.toBeNull();
    expect(px).toBeGreaterThanOrEqual(TYPE_FLOOR.body);
  });
});

describe('class report — the reading blocks sit ON the body floor', () => {
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

/**
 * R6 D4 — "on the floor" is stronger than "at or above it". A literal that
 * happens to equal 18 today is a number that will not move when the floor
 * does, and that is exactly how the two documents drifted apart before the
 * token existed. So the reading blocks are asserted EQUAL to the token, per
 * script, in both documents.
 */
describe.each([
  ['teacher PDF', (lang) => renderTeacher({ ...PDF_BASE, language: lang, contentLanguage: lang }), {
    body: ['.taught .sum', '.checks li', '.opt', '.chosen', '.miss', '.howto', '.who', '.foot'],
    small: ['.stchip .l', '.pill', '.cmeta', '.opt .tag', '.brand'],
    label: ['.eyebrow', '.label'],
  }],
  ['class report', (lang) => renderReport({ ...REPORT_BASE, language: lang, contentLanguage: lang }), {
    body: ['.mstat', '.slo', '.chose', '.why', '.r-name', '.unfin'],
    small: ['.eyebrow', '.hscore .s', '.stchip .l', '.label', '.try-label', '.r-name .cls', '.foot'],
    label: [],
  }],
])('%s — every reading block reads its size from the shared token', (_doc, build, roles) => {
  const EN = build('en');
  const UR = build('ur');
  Object.entries(roles).forEach(([role, selectors]) => {
    selectors.forEach((selector) => {
      test(`${selector} is TYPE_FLOOR.${role} in English and TYPE_FLOOR_UR.${role} in Urdu`, () => {
        expect(sizeOf(EN, selector)).toBe(TYPE_FLOOR[role]);
        expect(sizeOf(UR, selector)).toBe(TYPE_FLOOR_UR[role]);
      });
    });
  });
});

/**
 * The number the operator actually reported on. Nothing a teacher reads as
 * prose may land under 10px once the A4 page is opened full-width on a phone.
 */
describe.each([
  ['teacher PDF · en', () => renderTeacher({ ...PDF_BASE, language: 'en', contentLanguage: 'en' })],
  ['teacher PDF · ur', () => renderTeacher({ ...PDF_BASE, language: 'ur', contentLanguage: 'ur' })],
  ['teacher PDF · an Urdu name in an English document', () => renderTeacher({ ...PDF_BASE, teacherName: 'رفعت نور', language: 'en', contentLanguage: 'en' })],
  ['class report · en', () => renderReport({ ...REPORT_BASE, language: 'en', contentLanguage: 'en' })],
  ['class report · ur', () => renderReport({ ...REPORT_BASE, language: 'ur', contentLanguage: 'ur' })],
])('%s at 390px', (_name, build) => {
  test('nothing in the document falls under the label floor', () => {
    expect(under(build(), TYPE_FLOOR.label)).toEqual([]);
  });
});
