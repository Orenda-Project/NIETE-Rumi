'use strict';
/**
 * COLUMN SUMS against the REAL KaTeX (the root suite stubs it; see
 * quiz-typeset-maths-katex.test.js for why this suite lives under bot/).
 *
 * The questions only real KaTeX can answer:
 *   1. is the textbook form a valid expression — no MATH_TEX fault, no red
 *      KaTeX error box on a child's card?
 *   2. does the card typeset it as an array (KaTeX's `mtable`), on its own
 *      line, in English AND in Urdu — never as TeX source?
 *   3. does the teacher's PDF, the same way?
 *
 *   cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest tests/quiz/quiz-column-sum-katex.test.js
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const Card = require('../../shared/services/quiz/transcript-quiz-card');
const renderTeacherHtml = require('../../shared/templates/transcript-quiz-teacher.template');
const { texFaults, mathCss } = require('../../shared/services/quiz/quiz-math');

const SUB = '$\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{array}$';
const STEM_EN = `Subtract: ${SUB}`;
const STEM_UR = `تفریق کریں: ${SUB}`;
const OPTS = ['315', '325', '589'];
const bodyOf = (html) => html.slice(html.indexOf('<body'));

describe('the textbook column sum is valid TeX', () => {
  test('no MATH_TEX fault with the real parser, in either language', () => {
    expect(texFaults(STEM_EN)).toEqual([]);
    expect(texFaults(STEM_UR)).toEqual([]);
  });

  test('a broken one is caught before it reaches a card', () => {
    expect(texFaults('$\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{arra}$').length).toBeGreaterThan(0);
  });
});

describe.each([['en', STEM_EN], ['ur', STEM_UR]])('the %s card', (language, stem) => {
  const html = Card.renderQuestionCardHtml({
    stem, options: OPTS, displayOrder: [0, 1, 2], language, questionNumber: 1, total: 8,
  });
  const body = bodyOf(html);

  test('typesets the sum as an array on its own centred line', () => {
    expect(body).toMatch(/class="qm qm-col"/);
    expect(body).toMatch(/class="mtable"/);
    expect(body).toMatch(/hline|class="hline"|border-top/);
    expect(html).toMatch(/\.qm-col\{display:block;text-align:center/);
  });

  test('carries no TeX source and no KaTeX error', () => {
    expect(body).not.toMatch(/\\begin|\\hline|\$/);
    expect(body).not.toMatch(/katex-error/);
  });
});

describe('the teacher PDF', () => {
  const html = renderTeacherHtml({
    topic: 'Subtract 3-digit numbers', teacherName: '', grade: '3', date: '24 Sep 2026', link: 'https://wa.me/0',
    digest: { subject: 'maths', slos: [{ id: 'S1', statement: 'subtract 3-digit numbers', taught_level: 'apply' }] },
    questions: [{
      question_text: STEM_EN, option_a: OPTS[0], option_b: OPTS[1], option_c: OPTS[2], correct_option: 'A',
      external_id: 'tq:x:S1:1', media: { display_order: [0, 1, 2] }, difficulty_level: 3,
    }],
    lessonSummary: 'Today’s lesson plans column subtraction with regrouping.', language: 'en', contentLanguage: 'en',
  });

  test('typesets the same sum, with the column styles on the page', () => {
    const body = bodyOf(html);
    expect(body).toMatch(/class="qm qm-col"/);
    expect(body).toMatch(/class="mtable"/);
    expect(body).not.toMatch(/\\begin|katex-error/);
    expect(mathCss()).toMatch(/\.qm-col\{/);
  });
});
