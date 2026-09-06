'use strict';
/**
 * Transcript quiz figures — THE ENGINE'S OWN WORDS FOLLOW THE QUIZ LANGUAGE
 * (the round-5 figure review).
 *
 * Round 4 shipped `lang` into every figure spec, and an Urdu quiz still came
 * back with English under the picture: several types WRITE A SENTENCE OF THEIR
 * OWN when the author gives no caption — the atom's "Sodium (Na) — Z = 11, 12
 * neutrons…", the ray diagram's "Real, inverted, diminished image…" and its
 * `Object` / `Image` labels — and those strings were English whatever `lang`
 * said. A teacher reading an otherwise-Urdu picture with an English sentence
 * under it reports the whole feature as broken, and she is right to (T11: a
 * document is ONE language).
 *
 * Notation is the deliberate exception in BOTH directions: element symbols, Z,
 * shell counts, distances, magnification and the F / 2F handles stay Latin and
 * left-to-right on an Urdu figure, exactly as a Pakistani Urdu-medium textbook
 * prints them, and exactly as the author prompt already requires of the model.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { checkOverlaps } = require('../../bot/vendor/lp-v9/diagrams');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const { renderFigureSvg, svgText } = Figure;
const words = (svg) => svgText(svg).map((t) => t.trim()).filter(Boolean);
const joined = (svg) => words(svg).join(' | ');
const LATIN_WORD = /\b[A-Za-z]{4,}\b/;

describe('atom', () => {
  const SPEC = { type: 'atom', element: 'Na' };

  test('an Urdu figure gets an Urdu caption, and keeps the symbol, Z and the shells in Latin', () => {
    const svg = renderFigureSvg(SPEC, 'ur');
    const caption = words(svg).find((t) => t.includes('Z ='));
    expect(caption).toBeTruthy();
    expect(caption).toContain('نیوٹرون');
    expect(caption).toContain('الیکٹران');
    expect(caption).toContain('Na');
    expect(caption).toContain('Z = 11');
    expect(caption).not.toMatch(LATIN_WORD); // no "Sodium", no "neutrons"
  });

  test('an English figure is byte-for-byte what it always was', () => {
    const svg = renderFigureSvg(SPEC, 'en');
    expect(joined(svg)).toContain('Sodium (Na) — Z = 11, 12 neutrons, electrons 2, 8, 1.');
  });

  test('a dot-and-cross bonding caption follows the language too', () => {
    const spec = { type: 'atom', mode: 'dot_cross', element: 'Na', partner: { element: 'Cl' }, bond: 'ionic', transfer: 1 };
    const ur = words(renderFigureSvg(spec, 'ur')).find((t) => t.includes('Na') && t.length > 20);
    expect(ur).toContain('الیکٹران');
    expect(ur).not.toMatch(/gives|outer|crosses/);
    expect(joined(renderFigureSvg(spec, 'en'))).toContain('gives 1 outer electron');
  });
});

describe('ray_diagram', () => {
  const SPEC = { type: 'ray_diagram', element: 'convex_lens', f: 10, u: 25, hObject: 6 };

  test('the auto caption and the object/image labels are Urdu on an Urdu figure', () => {
    const svg = renderFigureSvg(SPEC, 'ur');
    const all = joined(svg);
    expect(all).toContain('شے');   // Object
    expect(all).toContain('عکس');  // Image
    expect(all).not.toContain('Object');
    expect(all).not.toContain('Image');
    expect(all).toMatch(/حقیقی|مجازی/);
    expect(all).toContain('v = 16.67 cm'); // notation stays Latin and LTR
  });

  test('an Urdu ray diagram no longer collides — the label plate is sized by the shared estimator', () => {
    // The type used to compute its own halo width with Urdu arithmetic that did
    // not match _urduText's: the plate was narrower than the label, so it
    // stopped hiding the ray under it and every Urdu ray diagram reported six
    // collisions the moment its labels stopped being English.
    // The defect predates the Urdu captions: an author who wrote her own Urdu
    // object/image labels hit it on the shipped code, which is why this case is
    // asserted separately from the auto-caption ones.
    expect(checkOverlaps(renderFigureSvg({ ...SPEC, labels: { object: 'شے', image: 'عکس' } }, 'ur'))).toEqual([]);
    expect(checkOverlaps(renderFigureSvg(SPEC, 'ur'))).toEqual([]);
    expect(checkOverlaps(renderFigureSvg(SPEC, 'en'))).toEqual([]);
    expect(checkOverlaps(renderFigureSvg({ type: 'ray_diagram', element: 'concave_mirror', f: 15, u: 40, hObject: 6 }, 'ur'))).toEqual([]);
  });

  test('an English figure is unchanged', () => {
    expect(joined(renderFigureSvg(SPEC, 'en'))).toContain('Real, inverted, diminished image');
  });
});

describe('an author-supplied label is never overridden', () => {
  test('a caption the author wrote wins over the engine\'s own', () => {
    const svg = renderFigureSvg({ type: 'atom', element: 'Na', caption: 'سوڈیم کا ایٹم' }, 'ur');
    expect(joined(svg)).toContain('سوڈیم کا ایٹم');
    expect(joined(svg)).not.toContain('نیوٹرون');
  });

  test('an Urdu component name on a circuit survives the label gate', () => {
    // The gate strips a label that is neither a value nor a word the question
    // uses — scoped to fraction_bar and grid. A circuit's component names ARE
    // the drawing's content and must come through untouched, in either script.
    const spec = {
      type: 'circuit', layout: 'series',
      cells: [{ kind: 'battery', label: 'بیٹری', value: '6 V' }, { kind: 'lamp', label: 'بلب' }, { kind: 'switch', label: 'سوئچ' }],
    };
    const { spec: cleaned, stripped } = Figure.stripStrayLabels(spec, {
      stem: 'تصویر میں کون سا component بند ہے؟', options: ['سوئچ', 'بیٹری', 'بلب'],
    });
    expect(stripped).toEqual([]);
    const all = joined(renderFigureSvg(cleaned, 'ur'));
    expect(all).toContain('بیٹری');
    expect(all).toContain('بلب');
    expect(all).toContain('سوئچ');
    expect(all).toContain('6 V'); // the value stays Latin and LTR
  });
});
