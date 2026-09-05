'use strict';
/**
 * The author prompt's FIGURE contract.
 *
 * The allowlist and the minimal specs are generated from the diagram engine's
 * own manifest at require time — a hand-copied list drifts the day a type
 * changes its required fields, and the model would then be taught a shape the
 * validator rejects on every attempt.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const DIGEST = {
  topic: 'Fractions', subject: 'maths', grade_band: '3-5',
  slos: [{ id: 'S1', statement: 'name a fraction', taught_level: 'recall' }],
};
const prompt = (over = {}) => buildAuthorPrompt({
  digest: DIGEST, excerpts: '…', language: 'ur', n: 8, gradeBand: '3-5', ...over,
});

describe('the figure contract', () => {
  test('offers an optional figure and a figure_role with the two allowed values', () => {
    const p = prompt();
    expect(p).toContain('"figure"');
    expect(p).toContain('"figure_role"');
    expect(p).toContain('read_off');
    expect(p).toContain('count_compare');
  });

  test('carries the allowlist and every minimal spec generated from the manifest', () => {
    const p = prompt();
    expect(p).toContain(Figure.minimalSpecBlock());
    Figure.ALLOWED_TYPES.forEach((t) => expect(p).toContain(`"type":"${t}"`));
    ['mindmap', 'molecule', 'illustrative', 'panels', 'dna_helix', 'labelled_figure']
      .forEach((t) => expect(p).not.toContain(`"type":"${t}"`));
  });

  test('states WHEN a figure is allowed — reading something off a picture, or 1-5 counting', () => {
    const p = prompt();
    expect(p).toMatch(/READ[^\n]*off (a|the) picture/i);
    ['a position', 'a shaded part', 'a shape', 'a plotted point', 'a circuit', 'a sequence of steps']
      .forEach((clue) => expect(p).toContain(clue));
    expect(p).toMatch(/grade 1[–-]5[^\n]*count/i);
    expect(p).toMatch(/count|compar/i);
  });

  test('states WHEN a figure is banned — definitions and word recall', () => {
    expect(prompt()).toMatch(/WHEN a figure is wrong[^\n]*definition[^\n]*recall/i);
  });

  test('bans the answer from the picture, caps the share at half, and pins the script rules', () => {
    const p = prompt();
    expect(p).toMatch(/figure must NOT contain the answer/i);
    expect(p).toMatch(/at most half/i);
    expect(p).toMatch(/numerals|formulae/i);
    expect(p).toMatch(/left-to-right|LTR/);
  });

  test('a stem that promises a picture must carry one, in both languages', () => {
    const p = prompt();
    expect(p).toContain('in the picture');
    expect(p).toContain('تصویر میں');
  });
});

describe('nothing already asked for is lost', () => {
  const KEEP = [
    'NEVER refer to options by letter',
    'distractor_misconceptions',
    'option_feedback',
    'Question 1 must be the easiest',
    'Exactly 3 options',
    'RELIGIOUS CONTENT',
    'STYLE RULES FOR URDU',
    'LESSON DIGEST:',
  ];
  test.each(KEEP)('still says %s', (needle) => {
    expect(prompt()).toContain(needle);
  });

  test('the retry still quotes the validator back, figure errors included', () => {
    const p = prompt({ previousErrors: ['q2: FIGURE_LEAK the picture names the answer'] });
    expect(p).toContain('FIGURE_LEAK the picture names the answer');
  });
});

describe('the author is TOLD to draw when the lesson is drawable (calibration after the corpus run showed 0 figures in 40 quizzes)', () => {
  const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
  const digest = { topic: 'Types of fractions', subject: 'maths', grade_band: '3-5', slos: [{ id: 'S1', statement: 'x', taught_level: 'recall', evidence_quote: 'q' }] };
  const prompt = buildAuthorPrompt({ digest, excerpts: '', language: 'ur', n: 8, gradeBand: '3-5' });
  test('maths/science lessons are required to carry at least one picture question', () => {
    expect(prompt).toMatch(/at least ONE picture question/i);
  });
  test('three worked examples show a figure spec next to its stem and options', () => {
    expect(prompt).toMatch(/WORKED EXAMPLES/);
    expect(prompt).toMatch(/"type":"fraction_bar"/);
    expect(prompt).toMatch(/"type":"numberline"/);
    expect(prompt).toMatch(/"type":"grid"/);
  });
  test('the JSON skeleton shows a question WITH a figure, not only null', () => {
    expect(prompt).toMatch(/"figure":\s*\{\s*"type"/);
  });
});

describe('calibration round 2 — the prompt names the two misuses the corpus produced', () => {
  const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
  const prompt = buildAuthorPrompt({ digest: { subject: 'maths', slos: [] }, excerpts: '', language: 'en', n: 8, gradeBand: '3-5' });
  test('never a scene of real things', () => { expect(prompt).toMatch(/never draw a scene/i); });
  test('a jump arc must not land on the answer', () => { expect(prompt).toMatch(/arc[^\n]*land[^\n]*answer/i); });
});
