'use strict';
/**
 * A figure's label may only be a value or a word from the question.
 *
 * Root cause: an author wrote the SHAPE NAME into a fraction_bar's label
 * ("سرکل" — circle — beside a four-part bar drawn for a lesson taught with a
 * roti). Nothing downstream looks at a label, so the child received a bar
 * with a stray word printed next to it. This suite pins `stripStrayLabels`:
 * a label survives only if it is a value the type computes, or a word the
 * question itself uses — a shape name never survives on a bar or a grid,
 * even when the stem happens to use that word.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');

beforeEach(() => jest.clearAllMocks());

describe('stripStrayLabels', () => {
  test('the production spec, verbatim: a shape name on a bar is stripped even with no stem mention', () => {
    const spec = { type: 'fraction_bar', bars: [{ label: 'سرکل', parts: 4, shaded: 1 }] };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, {
      stem: 'ایک کیک کا چوتھائی حصہ کھایا گیا — کتنا حصہ باقی ہے؟',
      options: ['1/4', '3/4', '1/2'],
    });
    expect(cleaned.bars[0].label).toBeUndefined();
    expect(stripped).toEqual([{ key: 'bars[0].label', value: 'سرکل', reason: 'shape_name' }]);

    const svg = Figure.renderFigureSvg(cleaned, 'ur');
    const text = Figure.svgText(svg).join(' ');
    expect(text).not.toMatch(/سرکل/);
    expect(text).not.toMatch(/circle/i);
  });

  test('the shape-name rule beats the in-question rule: the stem itself says روٹی and the label is still stripped', () => {
    const spec = { type: 'fraction_bar', bars: [{ label: 'روٹی', parts: 4, shaded: 1 }] };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, {
      stem: 'ایک روٹی کا چوتھائی حصہ کھایا گیا — کتنا حصہ باقی ہے؟',
      options: ['1/4', '3/4', '1/2'],
    });
    expect(cleaned.bars[0].label).toBeUndefined();
    expect(stripped).toEqual([{ key: 'bars[0].label', value: 'روٹی', reason: 'shape_name' }]);
  });

  test('a fraction value survives', () => {
    const spec = { type: 'fraction_bar', bars: [{ label: '3/4', parts: 4, shaded: 3 }] };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, { stem: 'anything', options: ['a', 'b', 'c'] });
    expect(cleaned.bars[0].label).toBe('3/4');
    expect(stripped).toEqual([]);
  });

  test('a bar labelled with a name the stem uses survives (a bar model of a person\'s money)', () => {
    const spec = { type: 'fraction_bar', bars: [{ label: 'علی', parts: 4, shaded: 3 }] };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, {
      stem: 'علی کے پاس کچھ رقم ہے',
      options: ['1/4', '3/4', '1/2'],
    });
    expect(cleaned.bars[0].label).toBe('علی');
    expect(stripped).toEqual([]);
  });

  test('a label naming neither word in the stem nor the options is stripped', () => {
    const spec = { type: 'fraction_bar', bars: [{ label: 'Total sweets', parts: 4, shaded: 3 }] };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, {
      stem: 'How much of the shape is shaded?',
      options: ['1/4', '3/4', '1/2'],
    });
    expect(cleaned.bars[0].label).toBeUndefined();
    expect(stripped).toEqual([{ key: 'bars[0].label', value: 'Total sweets', reason: 'not_in_question' }]);
  });

  test('out of scope: a numberline\'s point labels are left untouched — this is the grammar of the drawing, not decoration', () => {
    const spec = {
      type: 'numberline',
      from: -5,
      to: 5,
      points: [{ at: -3, label: 'A' }, { at: 1, label: 'B' }, { at: 4, label: 'C' }],
    };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, { stem: 'no mention of A B or C here', options: ['x', 'y', 'z'] });
    expect(cleaned.points).toEqual(spec.points);
    expect(stripped).toEqual([]);
  });

  test('a grid with a deliberately empty legend is not touched by the walker', () => {
    const spec = { type: 'grid', rows: 10, cols: 10, shaded: 25, legend: '' };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, { stem: 'anything', options: ['a', 'b', 'c'] });
    expect(cleaned.legend).toBe('');
    expect(stripped).toEqual([]);
  });

  test('every strip is logged once via logEvent, with type/key/value/reason', () => {
    const spec = { type: 'fraction_bar', bars: [{ label: 'سرکل', parts: 4, shaded: 1 }] };
    Figure.stripStrayLabels(spec, { stem: 'کوئی ذکر نہیں', options: ['1/4', '3/4', '1/2'] });
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.figure_label_stripped', {
      type: 'fraction_bar', key: 'bars[0].label', value: 'سرکل', reason: 'shape_name',
    });
  });
});

describe('stripStrayLabels wired into validate()', () => {
  test('end-to-end: the production spec passes through validate() with its label cleaned, figureStripped recorded, and no new error string', () => {
    const withFigure = {
      question: 'ایک کیک کا چوتھائی حصہ کھایا گیا — کتنا حصہ باقی ہے؟',
      options: ['1/4', '3/4', '1/2'],
      correct_index: 1,
      slo_id: 's1',
      level: 'understand',
      option_feedback: { correct: 'درست', wrong: { '0': 'دوبارہ کوشش کریں', '2': 'دوبارہ کوشش کریں' } },
      figure: { type: 'fraction_bar', bars: [{ label: 'سرکل', parts: 4, shaded: 3 }] },
    };
    const plain = (n) => ({
      question: `سوال نمبر ${n} کا جواب کیا ہے؟`,
      options: ['ا', 'ب', 'ج'],
      correct_index: 0,
      slo_id: 's1',
      level: 'understand',
      option_feedback: { correct: 'درست', wrong: { '1': 'دوبارہ کوشش کریں', '2': 'دوبارہ کوشش کریں' } },
    });
    const result = V.validate(
      [withFigure, plain(1), plain(2), plain(3), plain(4), plain(5)],
      { language: 'ur', subject: 'maths' },
    );
    const q0 = result.questions[0];
    expect(q0.figure.bars[0].label).toBeUndefined();
    expect(q0.figureStripped).toEqual([{ key: 'bars[0].label', value: 'circle', reason: 'shape_name' }]);
    expect(result.errors.filter((e) => /FIGURE/.test(e))).toEqual([]);
    expect(result.errors.some((e) => /سرکل|circle/i.test(e))).toBe(false);
  });
});
