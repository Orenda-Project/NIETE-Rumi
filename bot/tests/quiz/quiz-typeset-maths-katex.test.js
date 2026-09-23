'use strict';
/**
 * bd-mg9c7.159.19 part A — the quiz's maths against the REAL KaTeX.
 *
 * WHY THIS SUITE IS HERE AND NOT UNDER tests/. The root Jest config maps `katex`
 * and its mhchem extension to stubs (tests/jest.config.js: the root job runs
 * before `bot/ npm ci`, so the real package is not installed there). The stub
 * wraps the flattened source in `<span class="katex">` and never throws, which
 * is enough to prove WIRING (tests/quiz/transcript-quiz-typeset-maths.test.js)
 * and useless for the three questions this file asks:
 *
 *   1. does the card actually typeset a fraction (KaTeX's `mfrac`), with
 *      KaTeX's own woff2 faces inlined so Chrome paints the glyphs offline?
 *   2. does the teacher's PDF, the same way?
 *   3. is a malformed expression — one KaTeX itself cannot parse — a
 *      validator fault the retry/rewrite repairs, and not a red error box
 *      printed on a child's card?
 *
 * The bot config uses bot/node_modules, where katex is a real dependency. Run:
 *   cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest tests/quiz/quiz-typeset-maths-katex.test.js
 * (tests/BASELINE.md records the mhchem interop that can fail to LOAD in a root
 * suite; it does not arise here — rich.js loads katex and then mhchem in order.)
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The validator loads the diagram engine, whose molecule type requires openchemlib at module
// scope — an ESM bundle this config does not transform. Nothing here draws a molecule, so the
// root suite's loud stub stands in (it throws if a molecule is ever actually drawn).
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const Card = require('../../shared/services/quiz/transcript-quiz-card');
const renderTeacherHtml = require('../../shared/templates/transcript-quiz-teacher.template');
const { validate } = require('../../shared/services/quiz/transcript-quiz-validator');

const STEM = 'Which fraction is the largest: $\\frac{2}{9}$, $\\frac{1}{6}$ or $\\frac{2}{3}$?';
const OPTS = ['$\\frac{2}{9}$', '$\\frac{1}{6}$', '$\\frac{2}{3}$'];
const UR_STEM = 'ان میں سے سب سے بڑی کسر کون سی ہے: $\\frac{2}{9}$، $\\frac{1}{6}$ یا $\\frac{2}{3}$؟';
const bodyOf = (html) => html.slice(html.indexOf('<body'));
const headOf = (html) => html.slice(0, html.indexOf('<body'));

describe('the card, typeset by the real KaTeX', () => {
  test('every fraction is a KaTeX mfrac — in the stem and in each option — with no error box', () => {
    const html = Card.renderQuestionCardHtml({ stem: STEM, options: OPTS, displayOrder: [1, 2, 0], language: 'en' });
    const body = bodyOf(html);
    expect((body.match(/class="mfrac"/g) || [])).toHaveLength(6);   // three in the stem, one per option
    expect(body).not.toMatch(/katex-error|tex-err/);
    expect(body).not.toMatch(/\\frac|\$/);
  });

  test('KaTeX\'s own faces are inlined, so the render does not depend on a fonts directory', () => {
    const head = headOf(Card.renderQuestionCardHtml({ stem: STEM, options: OPTS, displayOrder: [0, 1, 2], language: 'en' }));
    expect(head).toMatch(/@font-face\{[^}]*font-family:KaTeX_Main;[^}]*src:url\(data:font\/woff2;base64,/);
    expect(head).not.toMatch(/url\(fonts\//);
  });

  test('an Urdu card: the three fractions are typeset inside the right-to-left stem', () => {
    const body = bodyOf(Card.renderQuestionCardHtml({ stem: UR_STEM, options: OPTS, displayOrder: [0, 1, 2], language: 'ur' }));
    const stem = body.slice(body.indexOf('<div class="stem"'), body.indexOf('class="opt"'));
    expect(stem).toMatch(/dir="rtl"/);
    expect((stem.match(/class="mfrac"/g) || [])).toHaveLength(3);
    expect(stem.indexOf('ان میں سے')).toBeLessThan(stem.indexOf('class="mfrac"'));
  });
});

describe('the teacher PDF, typeset by the real KaTeX', () => {
  test('stem and options carry real fractions and KaTeX\'s inlined faces', () => {
    const row = {
      external_id: 'tq:quiz-1:S1:1', question_text: STEM,
      option_a: OPTS[0], option_b: OPTS[1], option_c: OPTS[2], correct_option: 'C',
      media: { display_order: [0, 1, 2] },
    };
    const html = renderTeacherHtml({ topic: 'Fractions', language: 'en', digest: { slos: [] }, questions: [row] });
    expect((bodyOf(html).match(/class="mfrac"/g) || [])).toHaveLength(6);
    expect(headOf(html)).toMatch(/@font-face\{[^}]*font-family:KaTeX_Main;[^}]*src:url\(data:font\/woff2;base64,/);
    expect(bodyOf(html)).not.toMatch(/\\frac|\$/);
  });
});

describe('the validator asks KaTeX itself whether the maths parses', () => {
  const DIGEST = { subject: 'maths', slos: [{ id: 'S1', statement: 'compare fractions', taught_level: 'understand' }] };
  const q = (i, over = {}) => ({
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: which of these is the largest fraction?`,
    options: [`$\\frac{2}{${9 + i}}$`, `$\\frac{1}{${6 + i}}$`, '$\\frac{2}{3}$'],
    correct_index: 2,
    explanation: 'Two thirds is more than half; the others are less than half.',
    selected_because: 'the class compared fractions on the board',
    option_feedback: { correct: 'Yes — two of three equal parts is the most.', wrong: { 0: 'Those parts are smaller.', 1: 'One small part is less.' } },
    ...over,
  });
  const six = (over) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));

  test('a well-formed set passes', () => {
    expect(validate(six({}), { language: 'en', subject: 'maths', digest: DIGEST }).errors).toEqual([]);
  });

  test('a fraction KaTeX cannot parse is a MATH_TEX fault naming the expression', () => {
    const v = validate(six({ options: ['$\\frac{2}{9$', '$\\frac{1}{6}$', '$\\frac{2}{3}$'] }), { language: 'en', subject: 'maths', digest: DIGEST });
    const fault = v.errors.find((e) => /^q0: MATH_TEX\b/.test(e));
    expect(fault).toMatch(/is not valid TeX/);
    expect(fault).toContain('\\frac{2}{9');
  });

  test('an undefined command is caught the same way', () => {
    // required here, not at the top, so the rest of this file still runs (and fails for its own reason) on a base without the module
    const QuizMath = require('../../shared/services/quiz/quiz-math');
    expect(QuizMath.texFaults('$\\fracc{2}{9}$')[0]).toMatch(/is not valid TeX/);
    expect(QuizMath.texFaults('$\\frac{2}{9}$')).toEqual([]);
  });
});
