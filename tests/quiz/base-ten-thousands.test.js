'use strict';
/**
 * base_ten gets a THOUSANDS place.
 *
 * The place-value mat drew hundreds, tens and ones — and grade 3's place-value
 * lessons are four-digit ("Count up to 9999": 1986 as a big cube, nine flats,
 * eight rods and six unit cubes; "5,263" as 5 thousands, 2 hundreds, 6 tens,
 * 3 ones). The quiz could not draw the number its lesson was about, and the
 * lesson-plan digest told the author to keep a picture to three places.
 *
 * A thousand is drawn the way each model builds one out of ten hundreds:
 *   blocks   a CUBE — ten flats stacked, a 10x10 face with depth;
 *   bundles  ten big bundles tied into one block — a big bundle's face with
 *            depth, its ten layers showing on the top and the side.
 * Its column is headed from the catalog (tqPlaceThousands) like every other
 * place, it sits left of the hundreds in both languages, a zero hundreds under
 * it is an EMPTY column (2014 keeps its hundreds), and the number is never
 * written. The answer check (FIGURE_MISMATCH) and the redundancy check know
 * the new place; the label, overlap and degenerate gates still pass at 9999.
 *
 * Every assertion runs through the quiz lane's own entry points.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { checkOverlaps, renderDiagram } = require('../../bot/vendor/lp-v9/diagrams');
const MANIFEST = require('../../bot/vendor/lp-v9/diagrams/types_manifest.json');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const { renderFigureSvg } = Figure;
const items = (svg, place) => (svg.match(new RegExp(`data-bt="${place}"`, 'g')) || []).length;
const seen = (svg) => Figure.svgText(svg).map((t) => t.trim());
/** The column heads, in the order they are drawn left to right. */
const heads = (svg) => [...svg.matchAll(/<text[^>]*x="([\d.]+)"[^>]*>([^<]+)<\/text>|<foreignObject[^>]*x="([\d.]+)"[\s\S]*?>([^<]+)<\/div>/g)]
  .map((m) => ({ x: Number(m[1] || m[3]), t: (m[2] || m[4]).trim() }))
  .sort((a, b) => a.x - b.x).map((h) => h.t);

describe('the thousands place', () => {
  test.each(['en', 'ur'])('2014 in bundles (%s): two thousands, an EMPTY hundreds column, one ten, four ones', (lang) => {
    const svg = renderFigureSvg({ type: 'base_ten', thousands: 2, hundreds: 0, tens: 1, ones: 4 }, lang);
    expect(items(svg, 'thousand')).toBe(2);
    expect(items(svg, 'hundred')).toBe(0);
    expect(items(svg, 'ten')).toBe(1);
    expect(items(svg, 'one')).toBe(4);
    const text = seen(svg);
    ['tqPlaceThousands', 'tqPlaceHundreds', 'tqPlaceTens', 'tqPlaceOnes'].forEach((k) => {
      expect(text).toContain(resolveUx(k, { language: lang }));
    });
    expect(text.join(' ')).not.toMatch(/\d/);                  // the number is never written
    expect(checkOverlaps(svg)).toEqual([]);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test('the columns run thousands → hundreds → tens → ones, left to right, in Urdu too', () => {
    const order = ['tqPlaceThousands', 'tqPlaceHundreds', 'tqPlaceTens', 'tqPlaceOnes'];
    ['en', 'ur'].forEach((lang) => {
      const svg = renderFigureSvg({ type: 'base_ten', thousands: 1, hundreds: 2, tens: 3, ones: 4 }, lang);
      expect(heads(svg)).toEqual(order.map((k) => resolveUx(k, { language: lang })));
    });
  });

  test('the blocks model draws a thousand as a cube, not as a flat', () => {
    const svg = renderFigureSvg({ type: 'base_ten', model: 'blocks', thousands: 1, hundreds: 9, tens: 8, ones: 6 }, 'en');
    expect(items(svg, 'thousand')).toBe(1);
    expect(items(svg, 'hundred')).toBe(9);
    // a cube shows three faces: the front grid, the top and the side
    const cube = /<g data-bt="thousand">([\s\S]*?)<\/g>/.exec(svg)[1];
    expect((cube.match(/<polygon/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test.each([
    ['bundles', 'en'], ['bundles', 'ur'], ['blocks', 'en'], ['blocks', 'ur'],
  ])('9999 in %s (%s) still clears every figure gate', (model, lang) => {
    const svg = renderFigureSvg({ type: 'base_ten', model, thousands: 9, hundreds: 9, tens: 9, ones: 9 }, lang);
    expect(items(svg, 'thousand')).toBe(9);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test('`places: 4` draws an empty thousands column; a three-digit number has none by default', () => {
    const four = renderFigureSvg({ type: 'base_ten', hundreds: 3, tens: 4, ones: 2, places: 4 }, 'en');
    expect(seen(four)).toContain(resolveUx('tqPlaceThousands', { language: 'en' }));
    expect(items(four, 'thousand')).toBe(0);
    const three = renderFigureSvg({ type: 'base_ten', hundreds: 3, tens: 4, ones: 2 }, 'en');
    expect(seen(three)).not.toContain(resolveUx('tqPlaceThousands', { language: 'en' }));
  });

  test('more than nine thousands is refused with a reason', () => {
    expect(() => renderFigureSvg({ type: 'base_ten', thousands: 10 }, 'en')).toThrow(/thousands/);
    expect(() => renderFigureSvg({ type: 'base_ten', thousands: 9 }, 'en')).not.toThrow();
  });

  test('the engine heads the column on its own too (the lesson-plan lane passes no labels)', () => {
    expect(renderDiagram({ type: 'base_ten', thousands: 1, ones: 1, lang: 'en' })).toContain('Thousands');
    expect(renderDiagram({ type: 'base_ten', thousands: 1, ones: 1, lang: 'ur' })).toContain('ہزار');
  });

  test('the manifest tells the author about the thousands place', () => {
    const entry = MANIFEST.types.find((t) => t.type === 'base_ten');
    expect(entry.optional).toContain('thousands');
    expect(entry.limits.join(' ')).toMatch(/thousands/i);
  });
});

describe('the answer check and the redundancy check know the thousands', () => {
  const spec = { type: 'base_ten', thousands: 2, hundreds: 0, tens: 1, ones: 4 };

  test('2014, 2 (thousands) and 2000 are readable off the mat; 214 and 2104 are not', () => {
    expect(Figure.figureMismatch(spec, ['2014', '214', '2104'], 0)).toBeNull();
    expect(Figure.figureMismatch(spec, ['2', '0', '1'], 0)).toBeNull();
    expect(Figure.figureMismatch(spec, ['2000', '200', '20'], 0)).toBeNull();
    expect(Figure.figureMismatch(spec, ['2014', '214', '2104'], 1)).toMatch(/cannot produce.*2 thousands/);
    expect(Figure.figureMismatch(spec, ['2014', '214', '2104'], 2)).toMatch(/cannot produce/);
  });

  test('a stem that states the thousands and another place makes the picture redundant', () => {
    expect(Figure.figureIsRedundant(spec, '2 thousands and 4 ones make which number?')).toBe(true);
    expect(Figure.figureIsRedundant(spec, 'What number do the blocks show?')).toBe(false);
  });

  test('a four-digit place-value question validates in a maths quiz', () => {
    const DIGEST = { subject: 'maths', grade_band: '3-5', slos: [{ id: 'S1', statement: 'read a 4-digit number', taught_level: 'understand' }] };
    const q0 = {
      slo_id: 'S1', level: 'understand', question: 'What number do the blocks in the picture show?',
      options: ['2014', '214', '2104'], correct_index: 0, explanation: 'Two thousands, no hundreds, one ten and four ones.',
      distractor_misconceptions: { 1: 'left out the empty hundreds', 2: 'swapped hundreds and tens' },
      option_feedback: { correct: 'Yes.', wrong: { 1: 'Count the thousands again.', 2: 'Look at the hundreds column.' } },
      figure: { type: 'base_ten', model: 'blocks', ...spec }, figure_role: 'read_off',
    };
    const text = (i) => ({
      slo_id: 'S1', level: 'recall', question: `Which digit is in the thousands place of ${i}582?`,
      options: [`${i}`, '5', '8'], correct_index: 0, explanation: 'The first digit.',
      distractor_misconceptions: { 1: 'read the hundreds', 2: 'read the tens' },
      option_feedback: { correct: 'Yes.', wrong: { 1: 'That is the hundreds.', 2: 'That is the tens.' } },
    });
    const v = validate([q0, ...[1, 2, 3, 4, 5].map(text)], { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 6 });
    expect(v.errors.filter((e) => /^q0:/.test(e))).toEqual([]);
    expect(v.questions[0].figureSvg).toMatch(/data-bt="thousand"/);
  });
});

describe('the lesson-plan digest no longer holds a four-digit lesson to three places', () => {
  const script = {
    meta: { topic: 'Count up to 9999' },
    iDo: { worked: { diagram: '1986: [cube] / [flat][flat][flat][flat] [flat][flat][flat][flat] [flat] / [rod][rod][rod][rod] [rod][rod][rod][rod] / [dot][dot][dot][dot] [dot][dot]' } },
  };

  test('the worked example is quoted with its thousands', () => {
    expect(LpDigest.carry(script).manipulatives.placeValue.example)
      .toEqual({ thousands: 1, hundreds: 9, tens: 8, ones: 6 });
  });

  test('the author is shown the whole number and is not told to drop a place', () => {
    const block = LpDigest.lessonDrewBlock(script);
    expect(block).toContain('the worked example showed 1 thousands, 9 hundreds, 8 tens and 6 ones');
    expect(block).not.toMatch(/three places|up to hundreds/);
  });
});
