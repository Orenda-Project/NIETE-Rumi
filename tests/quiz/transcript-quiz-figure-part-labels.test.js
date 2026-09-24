'use strict';
/**
 * A figure never names its parts with the card's option letters, and its part
 * names are big enough to read on a phone.
 *
 * Staging (a grade 5 science quiz): "Which symbol represents a battery?" over a
 * circuit whose components were labelled A, B and C, with the options A / C / B
 * after the display shuffle. The card showed marker A beside the text "A",
 * marker B beside "C", marker C beside "B"; the right component (B) was the
 * button C. The same shape comes from the fraction recipe "which bar shows
 * 2/3?" over bars A/B/C, where the card can read "A: bar C". And the letters
 * were a few pixels high: on the phone about 7px.
 *
 * So the validator renames single-letter part labels A-D before anything reads
 * the question, everywhere the question uses them: the picture, the stem, the
 * options, the explanation, the feedback and the teacher's notes. The WhatsApp
 * text, the card and the PDF are all drawn from that one question, so they
 * agree. Parts of a picture that already shows numbers (bars, number lines,
 * shapes, circuits) become P, Q, R, S; the others become 1, 2, 3, 4.
 *
 * Through the real validator and the real renderer; only the loggers mocked.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { renderFigureSvg, FIG_BOX, PNG_WIDTH } = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const { requiredBox } = require('../../bot/vendor/lp-v9/diagrams/lib/svg');

const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const maths = (band = '4') => ({ subject: 'maths', grade_band: band, slos: [{ id: 'S1', statement: 'read fractions', taught_level: 'understand' }] });
const science = { subject: 'science', grade_band: '5', slos: [{ id: 'S1', statement: 'circuit symbols', taught_level: 'understand' }] };
const LETTER = /(^|[^\p{L}\p{N}])[A-D]([^\p{L}\p{N}]|$)/u;

function which(over = {}) {
  return {
    slo_id: 'S1', level: 'understand', question: `Which bar shows ${F(2, 3)}?`,
    options: ['Bar C', 'Bar A', 'Bar B'], correct_index: 1,
    explanation: 'Bar A has 2 of its 3 equal parts shaded; bars B and C do not.',
    selected_because: 'the bars drawn to compare fractions',
    distractor_misconceptions: { 0: 'picks bar C, one part shaded', 2: 'matches the 2 shaded parts of bar B' },
    option_feedback: { correct: 'Yes — bar A shows two thirds.', wrong: { 0: 'Bar C has 1 of 4 shaded.', 2: 'Bar B has 2 of 5 shaded.' } },
    figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'A' }, { parts: 5, shaded: 2, label: 'B' }, { parts: 4, shaded: 1, label: 'C' }] },
    figure_role: 'read_off',
    ...over,
  };
}
const one = (q, ctx) => validate([q], { nExpected: 1, ...ctx });
const q0 = (v) => v.questions[0];
const childText = (q) => [q.question, ...q.options, q.explanation, q.option_feedback.correct, ...Object.values(q.option_feedback.wrong)].join(' | ');

describe('the option letters never name a part of the picture', () => {
  test('bars A, B, C become P, Q, R in the picture, the options and every text', () => {
    const v = one(which(), { language: 'en', subject: 'maths', digest: maths() });
    const q = q0(v);
    expect(q.figure.bars.map((b) => b.label)).toEqual(['P', 'Q', 'R']);
    expect(q.options).toEqual(['Bar R', 'Bar P', 'Bar Q']);
    expect(q.explanation).toBe('Bar P has 2 of its 3 equal parts shaded; bars Q and R do not.');
    expect(q.option_feedback).toEqual({ correct: 'Yes — bar P shows two thirds.', wrong: { 0: 'Bar R has 1 of 4 shaded.', 2: 'Bar Q has 2 of 5 shaded.' } });
    expect(q.distractor_misconceptions).toEqual({ 0: 'picks bar R, one part shaded', 2: 'matches the 2 shaded parts of bar Q' });
    expect(childText(q)).not.toMatch(LETTER);
    expect(v.errors.filter((e) => /^q0: (FIGURE_|duplicate)/.test(e))).toEqual([]);
  });

  test('an Urdu question with bare-letter options and «پٹی A» in its feedback', () => {
    const ur = which({
      question: `تصویر میں کون سی پٹی ${F(2, 3)} دکھاتی ہے؟`, options: ['C', 'A', 'B'],
      explanation: 'پٹی A کے 3 میں سے 2 حصے رنگے ہوئے ہیں۔',
      selected_because: 'سبق کی پٹیاں',
      distractor_misconceptions: { 0: 'ایک حصہ دیکھنا', 2: 'صرف رنگے حصے گننا' },
      option_feedback: { correct: 'جی ہاں، پٹی A۔', wrong: { 0: 'پٹی C میں 4 میں سے 1 حصہ رنگا ہے۔', 2: 'B میں 5 میں سے 2 حصے رنگے ہیں۔' } },
    });
    const q = q0(one(ur, { language: 'ur', subject: 'maths', digest: maths() }));
    expect(q.options).toEqual(['R', 'P', 'Q']);
    expect(q.option_feedback.correct).toBe('جی ہاں، پٹی P۔');
    expect(childText(q)).not.toMatch(LETTER);
  });

  test('a circuit (the staging case) and a number line use P, Q, R too', () => {
    const circuit = one({
      ...which(), question: 'Which symbol represents a battery in a circuit diagram?', options: ['A', 'C', 'B'], correct_index: 2,
      explanation: 'B is the battery: a long and a short line.', option_feedback: { correct: 'Yes, B.', wrong: { 0: 'A is a resistor.', 1: 'C is a lamp.' } },
      distractor_misconceptions: { 0: 'resistor', 1: 'lamp' },
      figure: { type: 'circuit', layout: 'series', cells: [{ kind: 'resistor', label: 'A' }, { kind: 'battery', label: 'B' }, { kind: 'lamp', label: 'C' }] },
    }, { language: 'en', subject: 'science', digest: science });
    expect(q0(circuit).figure.cells.map((c) => c.label)).toEqual(['P', 'Q', 'R']);
    expect(q0(circuit).options).toEqual(['P', 'R', 'Q']);
    expect(q0(circuit).explanation).toBe('Q is the battery: a long and a short line.');

    const line = q0(one({
      ...which(), question: 'Which point is at 7?', options: ['A', 'B', 'C'], correct_index: 0,
      explanation: 'A sits on 7.', option_feedback: { correct: 'Yes.', wrong: { 1: 'B is at 3.', 2: 'C is at 9.' } },
      figure: { type: 'numberline', from: 0, to: 10, step: 1, points: [{ at: 7, label: 'A' }, { at: 3, label: 'B' }, { at: 9, label: 'C' }] },
    }, { language: 'en', subject: 'maths', digest: maths() }));
    expect(line.figure.points.map((p) => p.label)).toEqual(['P', 'Q', 'R']);
    expect(line.options).toEqual(['P', 'Q', 'R']);
  });

  test('parts of a picture without numbers become 1, 2, 3', () => {
    const q = q0(one({
      ...which(), question: 'Which ribbon is longer?', options: ['A', 'B', 'they are equal'], correct_index: 1,
      explanation: 'Ribbon B reaches further.', option_feedback: { correct: 'Yes.', wrong: { 0: 'A is shorter.', 2: 'Look at the ends.' } },
      distractor_misconceptions: { 0: 'reads the first ribbon', 2: 'thinks they match' },
      figure: { type: 'compare_size', model: 'length', items: [{ label: 'A', size: 5 }, { label: 'B', size: 8 }] },
    }, { language: 'en', subject: 'maths', digest: maths('1-2') }));
    expect(q.figure.items.map((it) => it.label)).toEqual(['1', '2']);
    expect(q.options).toEqual(['1', '2', 'they are equal']);
    expect(q.explanation).toBe('Ribbon 2 reaches further.');
  });

  test('an English article is not a label, and a picture without letter labels is left exactly as it is', () => {
    const q = q0(one(which({ explanation: 'A bar split into 3 parts with 2 shaded is bar A.' }), { language: 'en', subject: 'maths', digest: maths() }));
    expect(q.explanation).toBe('A bar split into 3 parts with 2 shaded is bar P.');
    const plain = which({ question: 'What fraction of the bar is shaded?', options: [F(2, 3), F(1, 3), F(3, 2)], correct_index: 0, figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2 }] }, explanation: 'Two of three parts.', option_feedback: { correct: 'Yes.', wrong: { 1: 'That is the white part.', 2: 'Upside down.' } }, distractor_misconceptions: { 1: 'x', 2: 'y' } });
    expect(q0(one(plain, { language: 'en', subject: 'maths', digest: maths() })).figure).toEqual(plain.figure);
  });
});

describe('the stored row, the picture and the card all carry the new names', () => {
  test('toRows and the drawn figure agree with the options', () => {
    const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
    const v = one(which(), { language: 'en', subject: 'maths', digest: maths() });
    const [row] = Gen.toRows('q-1', v.questions, { rng: () => 0.5, figureUrls: { 0: 'https://r2/q0.png' } });
    expect([row.option_a, row.option_b, row.option_c].sort()).toEqual(['Bar P', 'Bar Q', 'Bar R']);
    expect(row.media.figure.bars.map((b) => b.label)).toEqual(['P', 'Q', 'R']);
    const svg = v.questions[0].figureSvg;
    expect(svg).toMatch(/>P</);
    expect(svg).not.toMatch(/>[ABC]</);
  });
});

describe('part names are big enough to read on the phone', () => {
  // The child sees the 1080px picture at about 360 CSS px. Measured on the
  // quiz canvas, the smallest label, scaled to the phone.
  const phonePx = (svg) => {
    const { vbW, vbH, minFont } = requiredBox(svg);
    return (minFont * Math.min(FIG_BOX.w / vbW, FIG_BOX.h / vbH) * 360) / PNG_WIDTH;
  };

  test('three named bars: at least 12px (was 7.7)', () => {
    expect(phonePx(renderFigureSvg(which().figure, 'en'))).toBeGreaterThanOrEqual(12);
  });

  test('a three-part circuit: at least 10px (was 6.9)', () => {
    expect(phonePx(renderFigureSvg({ type: 'circuit', layout: 'series', cells: [{ kind: 'battery', label: 'P' }, { kind: 'resistor', label: 'Q' }, { kind: 'lamp', label: 'R' }] }, 'en')))
      .toBeGreaterThanOrEqual(10);
  });
});
