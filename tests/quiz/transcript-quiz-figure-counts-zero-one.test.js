'use strict';
/**
 * A count of ONE and a count of ZERO (vendor SYNC.md §3.23).
 *
 * A grade 1 lesson on the numbers 0 to 4 counts one car and shows zero as an
 * empty circle — those ARE its quantities (subitising 0-5; zero as the empty
 * set). The drawing engine refused any count under 2, so every picture question
 * that lesson naturally produced failed FIGURE_RENDER, on every attempt, and a
 * sandbox quiz on it ended `validator_failed` (24 Sep 2026). Both quiz sources
 * draw through the same engine and the same validator, so this holds for a
 * transcript quiz exactly as for a lesson-plan one.
 *
 * The old floor stood for one real misuse — ONE goat under "which word does
 * this picture match?" — and that is still refused, now where the question is
 * known (FIGURE_NOT_A_COUNT).
 */
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const F = require('./helpers/g1-numbers-urdu-fixture');

const pictograms = (svg) => (String(svg).match(/scale\(/g) || []).length;
const ctx = {
  language: 'ur', subject: 'maths', digest: F.DIGEST, nExpected: 8, lessonSummary: F.SUMMARY, quizId: 'q-test',
};
const figureErrors = (qs) => validate(qs, ctx).errors.filter((e) => /FIGURE_/.test(e));

describe('the engine draws one thing, and zero as an empty tray', () => {
  test('one car is drawn as one car', () => {
    const svg = Figure.renderFigureSvg({ type: 'count_objects', picto: 'car', count: 1 }, 'ur');
    expect(svg).toContain('<svg');
    expect(pictograms(svg)).toBe(1);
  });

  test('zero counters is an empty dashed tray — no pictogram at all', () => {
    const svg = Figure.renderFigureSvg({ type: 'count_objects', picto: 'counter', count: 0 }, 'ur');
    expect(pictograms(svg)).toBe(0);
    expect(svg).toMatch(/stroke-dasharray/);
  });

  test('a compared row of zero sits beside its neighbour as an empty tray, named', () => {
    const svg = Figure.renderFigureSvg({
      type: 'count_objects', rows: [{ picto: 'star', count: 3, label: 'رات' }, { picto: 'star', count: 0, label: 'دن' }],
    }, 'ur');
    expect(pictograms(svg)).toBe(3);
    expect(svg).toMatch(/stroke-dasharray/);
    expect(svg).toContain('دن');
  });

  test('a count that is not a number is not zero — it is refused', () => {
    expect(() => Figure.renderFigureSvg({ type: 'count_objects', picto: 'car' }, 'en')).toThrow(/needs a `count`/);
    expect(() => Figure.renderFigureSvg({ type: 'count_objects', picto: 'car', count: -1 }, 'en')).toThrow(/0 or more/);
  });

  test('an empty ten-frame shows zero; a tally of zero, which draws nothing, is refused', () => {
    const svg = Figure.renderFigureSvg({ type: 'count_frame', count: 0 }, 'en');
    expect((svg.match(/<rect/g) || []).length).toBeGreaterThanOrEqual(10);
    expect(svg).not.toMatch(/<circle/);
    expect(() => Figure.renderFigureSvg({ type: 'count_frame', model: 'tally', count: 0 }, 'en')).toThrow(/empty ten_frame/);
  });
});

describe('the validator: a count of 0 or 1 is fine under "how many?", and only there', () => {
  test('the lesson\'s own questions — one car keyed 1, an empty box keyed 0 — carry no figure complaint', () => {
    expect(figureErrors(F.eight())).toEqual([]);
  });

  test('ONE goat under "which word does this picture match?" is still refused, and says why', () => {
    const qs = F.eight();
    qs[1] = { ...qs[1], question: 'یہ تصویر کس لفظ سے ملتی ہے؟', options: ['بکری', 'گائے', 'بلی'], figure: { type: 'count_objects', picto: 'goat', count: 1 } };
    const errs = figureErrors(qs);
    expect(errs).toEqual([expect.stringMatching(/^q1: FIGURE_NOT_A_COUNT — "goat" is drawn once .*use match$/)]);
  });

  test('an empty tray keyed anything but 0 cannot produce its answer', () => {
    const qs = F.eight();
    qs[4] = { ...qs[4], options: ['2', '0', '1'] };
    expect(figureErrors(qs)).toEqual([expect.stringMatching(/^q4: FIGURE_MISMATCH — the picture cannot produce the answer "2" \(it shows an empty tray/)]);
  });

  test('a word answer under a counting stem is fine (one car, "one car")', () => {
    const qs = F.eight();
    qs[1] = { ...qs[1], options: ['ایک کار', 'دو کاریں', 'کوئی کار نہیں'] };
    expect(figureErrors(qs)).toEqual([]);
  });

  test('the author is told what 0 and 1 are for, and still pointed at match for a word', () => {
    const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const p = Author.buildAuthorPrompt({
      digest: F.DIGEST, transcript: null, language: 'ur', n: 8, gradeBand: '1', lessonPlan: 'x',
    });
    expect(p).toMatch(/a count of 0 as an empty dashed tray/);
    expect(p).toMatch(/One thing, or none, is only ever the answer to HOW MANY/);
    expect(p).toMatch(/To ask which WORD a picture matches, use the match type/);
  });
});

describe('the lesson-plan key check reads every kind of picture as text', () => {
  const KeyCheck = require('../../bot/shared/services/quiz/lp-quiz-key-check.service');
  const q = (figure) => ({ question: 'Which bar shows the fraction?', options: ['P', 'Q', 'R'], correct_index: 0, figure });
  const promptFor = (figure) => KeyCheck.buildKeyCheckPrompt({ sourceBlock: 'LESSON', questions: [q(figure)], indices: [0], language: 'en' });

  test('a count is spelled out, rings and names included', () => {
    const p = promptFor({ type: 'count_objects', picto: 'star', count: 12, group: 4 });
    expect(p).toContain('picture the child answers from: count_objects — 12 × star, ringed in groups of 4');
    expect(promptFor({ type: 'count_objects', rows: [{ picto: 'star', count: 3, label: 'night' }, { picto: 'star', count: 0, label: 'day' }] }))
      .toContain('count_objects — 3 × star «night»; 0 × star (an empty tray) «day»');
  });

  test('any other picture is its spec, shortened, without its type or language', () => {
    const p = promptFor({ type: 'fraction_bar', lang: 'en', bars: [{ parts: 4, shaded: 3, label: 'P' }] });
    expect(p).toContain('picture the child answers from: fraction_bar — {"bars":[{"parts":4,"shaded":3,"label":"P"}]}');
    const long = promptFor({ type: 'flow', steps: Array.from({ length: 30 }, (_, i) => ({ title: `step number ${i}` })) });
    expect(long).toMatch(/picture the child answers from: flow — \{"steps":.{200,}…\n/);
  });

  test('a quiz with no picture is checked exactly as before — no picture line, no picture rule', () => {
    const p = promptFor(null);
    expect(p).not.toContain('picture the child answers from');
    expect(p).not.toContain('A question with a PICTURE');
  });
});
