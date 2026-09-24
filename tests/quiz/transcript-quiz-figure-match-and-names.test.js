'use strict';
/**
 * Two residues of the part-names work.
 *
 * 1. A `match` picture drew its own A, B, C down one column, and its options
 *    are pairings like "A-2": on the card that read "A: A-2", the option letter
 *    beside a handle letter. The engine now takes the handle letters from the
 *    spec (`handleLetters`, default A-D so the lesson-plan lane is unchanged),
 *    and the quiz lane names them P, Q, R, S, carried through the stem, the
 *    options and the feedback like every other lettered part.
 *
 * 2. A bar named with a person's name in Urdu («حرا کی بوتل») under a stem that
 *    wrote the name in English letters ("‏Hira کی بوتل") lost its label: the
 *    label gate keeps a word only when the question uses it, and "حرا" is not
 *    "Hira". The gate now treats the two scripts of one name as the same word
 *    (their consonants agree), so the label stays.
 *
 * Through the real validator and the real engine; only the loggers mocked.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { renderDiagram } = require('../../bot/vendor/lp-v9/diagrams');
const { stripStrayLabels } = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const english = { subject: 'english', grade_band: '1-2', slos: [{ id: 'S1', statement: 'match words to pictures', taught_level: 'understand' }] };
const maths = { subject: 'maths', grade_band: '4', slos: [{ id: 'S1', statement: 'compare fractions', taught_level: 'understand' }] };
const MATCH = { type: 'match', left: [{ picto: 'cat' }, { picto: 'dog' }], right: [{ text: 'dog' }, { text: 'cat' }] };
const drawnHandles = (svg) => [...svg.matchAll(/>([A-Z])</g)].map((m) => m[1]);

describe('the match picture never draws the option letters', () => {
  const q = {
    slo_id: 'S1', level: 'understand', question: 'Match each picture to its word. Which pairing is right for picture A?',
    options: ['A-2', 'B-2', 'A-1'], correct_index: 0,
    explanation: 'Picture A is a cat, and word 2 is "cat".', selected_because: 'the matching game in class',
    distractor_misconceptions: { 1: 'matches B instead', 2: 'reads the first word' },
    option_feedback: { correct: 'Yes — A goes with 2.', wrong: { 1: 'B is the dog.', 2: 'Word 1 is "dog".' } },
    figure: MATCH, figure_role: 'read_off',
  };

  test('the handles, the options, the stem and the feedback all move to P, Q', () => {
    const v = validate([q], { language: 'en', subject: 'english', digest: english, nExpected: 1 });
    const out = v.questions[0];
    expect(out.options).toEqual(['P-2', 'Q-2', 'P-1']);
    expect(out.question).toBe('Match each picture to its word. Which pairing is right for picture P?');
    expect(out.option_feedback).toEqual({ correct: 'Yes — P goes with 2.', wrong: { 1: 'Q is the dog.', 2: 'Word 1 is "dog".' } });
    expect(out.figure.handleLetters).toEqual(['P', 'Q', 'R', 'S']);
    expect(drawnHandles(out.figureSvg)).toEqual(['P', 'Q']);
    expect(v.errors.filter((e) => /^q0: FIGURE_/.test(e))).toEqual([]);
  });

  test('the author is shown P/Q handles and "P-2" pairings, never "A-2"', () => {
    const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const p = Author.buildAuthorPrompt({ digest: { ...english, topic: 'Words' }, excerpts: '…', language: 'en', gradeBand: '1-2' });
    expect(p).toMatch(/draws P\/Q down one side/);
    expect(p).toMatch(/"P-2"/);
    expect(p).not.toMatch(/"A-2"/);
  });

  test('the engine draws A, B by default — the lesson-plan lane is unchanged', () => {
    expect(drawnHandles(renderDiagram({ ...MATCH, lang: 'en' }))).toEqual(['A', 'B']);
    expect(drawnHandles(renderDiagram({ ...MATCH, lang: 'en', handleLetters: ['P', 'Q'] }))).toEqual(['P', 'Q']);
  });
});

describe('one name in two scripts is one word to the label gate', () => {
  // the replay's options were the fractions, so only the stem names the child
  const opts = ['$\\frac{2}{3}$', '$\\frac{3}{5}$', 'دونوں برابر ہیں'];
  test.each([
    ['‏Hira کی بوتل میں 2/3 پانی ہے۔ کس کی بوتل میں زیادہ پانی ہے؟', 'حرا کی بوتل'],
    ['‏Ahmed اور Sara میں سے کس کے پاس زیادہ ہے؟', 'احمد'],
    ['‏Sara کے پاس کتنا حصہ ہے؟', 'سارہ'],
    ['‏Ali کی پٹی میں کتنا حصہ رنگا ہے؟', 'علی'],
  ])('%s keeps the label %s', (stem, label) => {
    const r = stripStrayLabels({ type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label }] }, { stem, options: opts });
    expect(r.stripped).toEqual([]);
    expect(r.spec.bars[0].label).toBe(label);
  });

  test('a name the question does not use is still stripped', () => {
    const r = stripStrayLabels({ type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'زینب' }] }, { stem: '‏Hira کی بوتل میں کتنا پانی ہے؟', options: opts });
    expect(r.stripped.map((s) => s.reason)).toEqual(['not_in_question']);
  });

  test('through the validator: the replay question keeps both bar names', () => {
    const q = {
      slo_id: 'S1', level: 'understand', question: '‏Hira کی بوتل میں $\\frac{2}{3}$ اور دوست کی بوتل میں $\\frac{3}{5}$ پانی ہے۔ کس کی بوتل میں زیادہ پانی ہے؟',
      options: ['$\\frac{2}{3}$', '$\\frac{3}{5}$', 'دونوں برابر ہیں'], correct_index: 0,
      explanation: 'دو تہائی زیادہ ہے۔', selected_because: 'سبق کی مثال',
      distractor_misconceptions: { 1: 'بڑا denominator بڑا سمجھنا', 2: 'صرف numerator دیکھنا' },
      option_feedback: { correct: 'جی ہاں۔', wrong: { 1: 'دوبارہ دیکھیں۔', 2: 'دوبارہ دیکھیں۔' } },
      figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'حرا کی بوتل' }, { parts: 5, shaded: 3, label: 'دوست کی بوتل' }] },
      figure_role: 'model',
    };
    const v = validate([q], { language: 'ur', subject: 'maths', digest: maths, nExpected: 1 });
    expect(v.questions[0].figure.bars.map((b) => b.label)).toEqual(['حرا کی بوتل', 'دوست کی بوتل']);
  });
});
