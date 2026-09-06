'use strict';
/**
 * Transcript quiz figures — THE EARLY-YEARS TYPES of round 5.
 *
 * Before this round the drawable roster was the 6-12 lesson-plan one — atom,
 * cell, circuit, chem_equation, geometry, graph, … — and a grade-1 phonics or
 * counting lesson had nothing at all. The operator: "the computation of
 * pictures can come in handy at any stage — fill in the blanks, or phonics
 * questions, or spelling questions, or questions where an image of a cat is
 * shown and then c _ t is written in big alphabets".
 *
 * Eight new engine types plus a vendored pictogram set answer that. Every
 * assertion here runs through the QUIZ LANE's own entry point
 * (`renderFigureSvg`), not through the engine directly, so a green run proves
 * the vendored engine, the allowlist, the per-type defaults and the phone
 * font scale are all wired — the thing a source-grep can never prove.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { checkOverlaps } = require('../../bot/vendor/lp-v9/diagrams');
const MANIFEST = require('../../bot/vendor/lp-v9/diagrams/types_manifest.json');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');
const Pictograms = require('../../bot/vendor/lp-v9/diagrams/lib/pictogram');

const { renderFigureSvg, canonicalType, ALLOWED_TYPES, minimalSpecBlock, PHONE_FONT_SCALE } = Figure;

const EARLY_YEARS = [
  'word_blank', 'count_objects', 'count_frame', 'clock', 'pattern', 'match', 'money', 'compare_size',
];

/** Every string the child actually sees in the drawing, lowercased. */
const seen = (svg) => Figure.svgText(svg).join(' | ').toLowerCase();

describe('the early-years types are on the quiz allowlist', () => {
  test.each(EARLY_YEARS)('%s is allowed and canonical', (type) => {
    expect(ALLOWED_TYPES).toContain(type);
    expect(canonicalType(type)).toBe(type);
  });

  test('each one has a manifest entry whose minimal spec renders through the quiz lane', () => {
    EARLY_YEARS.forEach((type) => {
      const entry = MANIFEST.types.find((t) => t.type === type);
      expect(entry).toBeTruthy();
      expect(entry.for).toEqual(expect.any(String));
      expect(entry.limits.length).toBeGreaterThan(0);
      const svg = renderFigureSvg(entry.minimal_spec, 'en');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(checkOverlaps(svg)).toEqual([]);
    });
  });

  test('the author prompt block names every one of them, generated from the manifest', () => {
    const block = minimalSpecBlock();
    EARLY_YEARS.forEach((type) => expect(block).toContain(`- ${type} — `));
  });

  test('each one carries a phone font scale', () => {
    EARLY_YEARS.forEach((type) => expect(typeof PHONE_FONT_SCALE[type]).toBe('number'));
  });
});

describe('word_blank', () => {
  test('draws the word with the blank letter missing and never prints it', () => {
    const svg = renderFigureSvg({ type: 'word_blank', word: 'cat', blanks: [1], picto: 'cat' }, 'en');
    expect(seen(svg)).toContain('c _ t');
    expect(seen(svg)).not.toContain('cat');
  });

  test('an URDU word is drawn as separate letter tiles, never as a joined word with an underscore', () => {
    // Nastaliq joins: printing کتاب with a "_" for the ا reshapes the letters
    // either side, so the child is shown a word that is not the word.
    const svg = renderFigureSvg({ type: 'word_blank', word: 'کتاب', blanks: [2], picto: 'book' }, 'ur');
    const texts = Figure.svgText(svg).map((t) => t.trim()).filter(Boolean);
    expect(texts.sort()).toEqual(['ب', 'ت', 'ک']); // the ا is the gap, and nothing is joined
    expect(texts.join('')).not.toContain('_');
    expect(checkOverlaps(svg)).toEqual([]);
  });

  test('a combining mark rides with its letter instead of becoming one of its own', () => {
    const { splitLetters } = require('../../bot/vendor/lp-v9/diagrams/types/word_blank');
    expect(splitLetters('کَتاب')).toEqual(['کَ', 'ت', 'ا', 'ب']);
  });

  test('an unknown pictogram fails with the roster, never a blank box', () => {
    expect(() => renderFigureSvg({ type: 'word_blank', word: 'cat', blanks: [1], picto: 'unicorn' }, 'en'))
      .toThrow(/unknown pictogram "unicorn"/);
  });

  test('a word with every letter blank is refused', () => {
    expect(() => renderFigureSvg({ type: 'word_blank', word: 'cat', blanks: [0, 1, 2] }, 'en'))
      .toThrow(/every letter is blank/);
  });
});

describe('count_objects', () => {
  test('draws one pictogram per thing and never writes the count', () => {
    const svg = renderFigureSvg({ type: 'count_objects', picto: 'apple', count: 7 }, 'en');
    expect((svg.match(/scale\(/g) || []).length).toBe(7); // one pictogram group each
    expect(seen(svg)).not.toMatch(/\b7\b/);
  });

  test('a compare spec draws both rows with their names and no counts', () => {
    const svg = renderFigureSvg({
      type: 'count_objects',
      rows: [{ picto: 'apple', count: 5, label: 'سیب' }, { picto: 'banana', count: 3, label: 'کیلے' }],
    }, 'ur');
    expect(seen(svg)).toContain('سیب');
    expect(seen(svg)).toContain('کیلے');
    expect((svg.match(/scale\(/g) || []).length).toBe(8);
  });

  test('past 30 things it refuses rather than drawing something uncountable', () => {
    expect(() => renderFigureSvg({ type: 'count_objects', picto: 'apple', count: 44 }, 'en'))
      .toThrow(/past counting/);
  });
});

describe('clock', () => {
  test('at 3:30 the hour hand is halfway between 3 and 4, not on the 3', () => {
    const svg = renderFigureSvg({ type: 'clock', time: '3:30' }, 'en');
    // The hour hand is the only 7.5-wide line; its angle is what is being asserted.
    const line = /<line [^>]*x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"[^>]*stroke-width="7.5"/.exec(svg);
    expect(line).toBeTruthy();
    const [, x1, y1, x2, y2] = line.map(Number);
    const deg = ((Math.atan2(x2 - x1, y1 - y2) * 180) / Math.PI + 360) % 360;
    expect(deg).toBeCloseTo(105, 1); // (3 + 30/60) * 30
  });

  test('the time is never printed on the face by default', () => {
    const svg = renderFigureSvg({ type: 'clock', time: '3:30' }, 'en');
    expect(seen(svg)).not.toContain('3:30');
  });

  test('numerals stay Latin on an Urdu clock — numerals read LTR in every language', () => {
    const svg = renderFigureSvg({ type: 'clock', time: '9:15', numerals: 'all' }, 'ur');
    expect(seen(svg)).toContain('12');
    expect(svg).not.toMatch(/[۰-۹]/);
  });

  test('a time that is not a time is refused', () => {
    expect(() => renderFigureSvg({ type: 'clock', time: 'half past three' }, 'en')).toThrow(/must look like/);
  });
});

describe('pattern', () => {
  test('the blank slot is drawn as a question mark and carries no hint', () => {
    const svg = renderFigureSvg({ type: 'pattern', items: ['circle', 'square', 'circle', 'square', '?'] }, 'en');
    expect(seen(svg)).toContain('?');
    expect(seen(svg)).not.toContain('circle');
  });

  test('a pattern with nothing missing is refused', () => {
    expect(() => renderFigureSvg({ type: 'pattern', items: ['circle', 'square', 'circle'] }, 'en'))
      .toThrow(/nothing is missing/);
  });
});

describe('match', () => {
  test('draws two lettered/numbered columns and joins nothing', () => {
    const svg = renderFigureSvg({
      type: 'match',
      left: [{ picto: 'cat' }, { picto: 'dog' }],
      right: [{ text: 'dog' }, { text: 'cat' }],
    }, 'en');
    const text = seen(svg);
    expect(text).toContain('a');
    expect(text).toContain('1');
    // Nothing is joined. The type itself draws no <line> at all; the only ones
    // in the output belong to the pictogram glyphs, and every element inside a
    // glyph carries data-ov="skip".
    (svg.match(/<line [^>]*>/g) || []).forEach((tag) => expect(tag).toContain('data-ov="skip"'));
  });

  test('columns of different lengths are refused', () => {
    expect(() => renderFigureSvg({
      type: 'match',
      left: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
      right: [{ text: 'x' }, { text: 'y' }],
    }, 'en')).toThrow(/same length/);
  });
});

describe('count_frame', () => {
  test('a ten-frame fills its cells and never writes the count', () => {
    const svg = renderFigureSvg({ type: 'count_frame', count: 7 }, 'en');
    expect((svg.match(/<circle /g) || []).length).toBe(7);
    expect(seen(svg)).toBe('');
  });

  test('a tally strikes the fifth stroke across the other four', () => {
    const svg = renderFigureSvg({ type: 'count_frame', model: 'tally', count: 12 }, 'en');
    // 12 = two full gates (4 uprights + 1 strike each) and two uprights
    expect((svg.match(/<line /g) || []).length).toBe(12);
  });
});

describe('money', () => {
  test('every piece carries its value and the currency symbol is the caller\'s', () => {
    const svg = renderFigureSvg({ type: 'money', currency: 'Rs', items: [{ value: 10, kind: 'coin' }, { value: 5, kind: 'note' }] }, 'en');
    expect(seen(svg)).toContain('rs 10');
    expect(seen(svg)).toContain('rs 5');
  });

  test('a question whose answer is one piece\'s value is caught as a leak', () => {
    const spec = { type: 'money', items: [{ value: 5, kind: 'coin' }, { value: 10, kind: 'coin' }] };
    const svg = renderFigureSvg(spec, 'en');
    expect(Figure.figureLeaksAnswer(spec, ['Rs 5', 'Rs 20', 'Rs 50'], 0, svg)).toBe(true);
  });
});

describe('compare_size', () => {
  test('the bars share one baseline and no size is ever printed', () => {
    const svg = renderFigureSvg({
      type: 'compare_size', model: 'length',
      items: [{ label: 'سرخ ربن', size: 5 }, { label: 'ہرا ربن', size: 8 }],
    }, 'ur');
    const xs = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*rx="5"/g)]
      .map((m) => Number(m[1]) + Number(m[3]));
    expect(xs.length).toBe(2); // the two bars, not the paper
    // every bar ends at the same right-hand edge in an Urdu figure
    expect(new Set(xs.map((x) => x.toFixed(1))).size).toBe(1);
    expect(seen(svg)).not.toMatch(/\b[58]\b/);
  });

  test('the balance tilts from the loads, and refuses two equal pans', () => {
    const svg = renderFigureSvg({
      type: 'compare_size', model: 'balance',
      left: { picto: 'apple', count: 3 }, right: { picto: 'apple', count: 1 },
    }, 'en');
    // stroke-width 5 is the beam; the stand's base rail is 4.5 and horizontal.
    const beam = /<line [^>]*x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"[^>]*stroke-width="5"/.exec(svg);
    expect(beam).toBeTruthy();
    expect(Number(beam[2])).toBeGreaterThan(Number(beam[4])); // the heavy (left) end is lower
    expect(() => renderFigureSvg({
      type: 'compare_size', model: 'balance',
      left: { picto: 'apple', count: 2 }, right: { picto: 'apple', count: 2 },
    }, 'en')).toThrow(/same load/);
  });
});

describe('the pictogram set', () => {
  test('is vendored, licensed, and every glyph in the index resolves to markup', () => {
    expect(Pictograms.INDEX.license).toBe('CC BY-SA 4.0');
    expect(Pictograms.names().length).toBeGreaterThanOrEqual(200);
    Pictograms.names().forEach((n) => expect(Pictograms.inner(n).length).toBeGreaterThan(20));
  });

  test('the attribution travels with the picture, in the SVG\'s own <desc>', () => {
    const svg = renderFigureSvg({ type: 'count_objects', picto: 'apple', count: 3 }, 'en');
    expect(svg).toContain('<desc>');
    expect(svg).toContain('OpenMoji');
    expect(svg).toContain('CC BY-SA 4.0');
  });

  test('a glyph\'s own strokes never register as rules crossing a label', () => {
    // Every drawn element inside a pictogram carries data-ov="skip": its
    // footprint is what layout respects, and a cat's whiskers are not a rule
    // running through the word beside it.
    const svg = renderFigureSvg({ type: 'word_blank', word: 'cat', blanks: [1], picto: 'cat' }, 'en');
    expect(checkOverlaps(svg)).toEqual([]);
    expect(svg).toContain('data-ov="skip"');
  });
});

describe('the phone floor', () => {
  test.each(EARLY_YEARS)('%s clears the 13.5px label floor on the quiz canvas', (type) => {
    const entry = MANIFEST.types.find((t) => t.type === type);
    const svg = renderFigureSvg(entry.minimal_spec, 'en');
    expect(Gates.labelFloorDefect(svg, type)).toBeNull();
  });
});
