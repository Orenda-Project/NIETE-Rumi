'use strict';
/**
 * Transcript quiz figures — THE MANIPULATIVES a grade 1-5 maths class counts with.
 *
 * The lesson plans draw counters, tiles and place-value bundles on nearly every
 * maths page (the slide scripts' own tokens: counter, dot, bead, marble, sq,
 * tile, bundle, bigbundle, flat …), and the quiz could draw none of them: the
 * pictogram set had no counter and no tile, and nothing drew a place-value
 * picture at all. So a quiz on "count the counters" or "what number do the
 * bundles show?" came back as text.
 *
 * Every assertion runs through the QUIZ LANE's own entry point
 * (`renderFigureSvg`, `validate`, `buildAuthorPrompt`), so a green run proves
 * the vendored engine, the allowlist, the phone scale and the prompt are wired.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { checkOverlaps } = require('../../bot/vendor/lp-v9/diagrams');
const MANIFEST = require('../../bot/vendor/lp-v9/diagrams/types_manifest.json');
const Pictograms = require('../../bot/vendor/lp-v9/diagrams/lib/pictogram');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const Gates = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const { renderFigureSvg, canonicalType } = Figure;

/** How many drawn items of one place a base_ten picture carries. */
const items = (svg, place) => (svg.match(new RegExp(`data-bt="${place}"`, 'g')) || []).length;
/** Every string the child actually sees in the drawing. */
const seen = (svg) => Figure.svgText(svg).join(' | ');

describe('counter and tile — the two manipulatives the pictogram set lacked', () => {
  test('both are on the roster the author is shown', () => {
    expect(Pictograms.names()).toEqual(expect.arrayContaining(['counter', 'tile']));
  });

  test('the lesson\'s own words for them resolve to the same picture, and are not listed twice', () => {
    ['dot', 'bead', 'marble', 'circle'].forEach((w) => {
      expect(Pictograms.has(w)).toBe(true);
      expect(Pictograms.inner(w)).toBe(Pictograms.inner('counter'));
    });
    ['sq', 'square'].forEach((w) => expect(Pictograms.inner(w)).toBe(Pictograms.inner('tile')));
    expect(Pictograms.names()).not.toEqual(expect.arrayContaining(['dot']));
    expect(Pictograms.names()).not.toEqual(expect.arrayContaining(['sq']));
  });

  test.each([['counter'], ['dot'], ['tile'], ['square']])(
    'count_objects draws seven of "%s" through the quiz lane, cleanly', (picto) => {
      const svg = renderFigureSvg({ type: 'count_objects', picto, count: 7 }, 'en');
      expect(checkOverlaps(svg)).toEqual([]);
      expect(Gates.figureGateDefects(svg, 'count_objects')).toEqual([]);
      // seven discs (or squares) drawn, and the seven is never written
      const shape = Pictograms.inner(picto).startsWith('<circle') ? /<circle data-ov="skip" cx="36" cy="36" r="26"/g : /<rect data-ov="skip" x="11"/g;
      expect((svg.match(shape) || []).length).toBe(7);
      expect(seen(svg)).not.toMatch(/\b7\b/);
    },
  );

  test('a "stick" is the thin counting stick base_ten draws, not a log, and is listed once', () => {
    // OpenMoji has no stick; the set's "stick" was its WOOD glyph, a log. A lesson
    // bundles thin sticks into tens, and base_ten draws exactly those.
    expect(Pictograms.inner('stick')).toMatch(/fill="var\(--clay, #B5651D\)"/);
    expect(Pictograms.names().filter((n) => n === 'stick')).toHaveLength(1);
    const svg = renderFigureSvg({ type: 'count_objects', picto: 'stick', count: 9 }, 'en');
    expect(Gates.figureGateDefects(svg, 'count_objects')).toEqual([]);
  });

  test('a counter is painted like the ten-frame\'s counters: accent fill, ink rim', () => {
    const svg = renderFigureSvg({ type: 'count_objects', picto: 'counter', count: 3 }, 'en');
    expect(svg).toMatch(/fill="var\(--amber, #F2A20C\)"/);
  });
});

describe('base_ten — a place-value picture drawn the way the class built it', () => {
  test('is on the quiz allowlist, in the early-years roster, and draws mathematics only', () => {
    expect(canonicalType('base_ten')).toBe('base_ten');
    expect(Figure.EARLY_YEARS_TYPES).toContain('base_ten');
    expect(Figure.CORE_TYPES).not.toContain('base_ten');
    expect(Figure.MATHS_ONLY_TYPES.has('base_ten')).toBe(true);
  });

  test('has a manifest entry whose minimal spec renders', () => {
    const entry = MANIFEST.types.find((t) => t.type === 'base_ten');
    expect(entry).toBeTruthy();
    expect(entry.limits.length).toBeGreaterThan(0);
    expect(renderFigureSvg(entry.minimal_spec, 'en').startsWith('<svg')).toBe(true);
  });

  test('342 in bundles: three hundreds, four tens, two ones — and the number is never written', () => {
    const svg = renderFigureSvg({ type: 'base_ten', hundreds: 3, tens: 4, ones: 2 }, 'en');
    expect(items(svg, 'hundred')).toBe(3);
    expect(items(svg, 'ten')).toBe(4);
    expect(items(svg, 'one')).toBe(2);
    const text = seen(svg);
    expect(text).toContain(resolveUx('tqPlaceHundreds', { language: 'en' }));
    expect(text).toContain(resolveUx('tqPlaceTens', { language: 'en' }));
    expect(text).toContain(resolveUx('tqPlaceOnes', { language: 'en' }));
    expect(text).not.toMatch(/\d/);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test('an Urdu quiz heads the columns in Urdu, from the catalog', () => {
    const svg = renderFigureSvg({ type: 'base_ten', hundreds: 1, tens: 2, ones: 5 }, 'ur');
    const text = seen(svg);
    ['tqPlaceHundreds', 'tqPlaceTens', 'tqPlaceOnes'].forEach((k) => {
      expect(text).toContain(resolveUx(k, { language: 'ur' }));
    });
    expect(checkOverlaps(svg)).toEqual([]);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test('a zero is an EMPTY column, not a missing one (209 keeps its tens)', () => {
    const svg = renderFigureSvg({ type: 'base_ten', hundreds: 2, tens: 0, ones: 9 }, 'en');
    expect(items(svg, 'ten')).toBe(0);
    expect(seen(svg)).toContain(resolveUx('tqPlaceTens', { language: 'en' }));
    expect(items(svg, 'hundred')).toBe(2);
    expect(items(svg, 'one')).toBe(9);
  });

  test('a two-digit number has no hundreds column', () => {
    const svg = renderFigureSvg({ type: 'base_ten', tens: 4, ones: 7 }, 'en');
    expect(seen(svg)).not.toContain(resolveUx('tqPlaceHundreds', { language: 'en' }));
    expect(items(svg, 'ten')).toBe(4);
    expect(items(svg, 'one')).toBe(7);
  });

  test('the blocks model draws flats, rods and unit cubes instead of bundles', () => {
    const svg = renderFigureSvg({ type: 'base_ten', model: 'blocks', hundreds: 1, tens: 3, ones: 6 }, 'en');
    expect(items(svg, 'hundred')).toBe(1);
    expect(items(svg, 'ten')).toBe(3);
    expect(items(svg, 'one')).toBe(6);
    expect(svg).toMatch(/data-model="blocks"/);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test('regrouping: thirteen tens are drawn as thirteen bundles', () => {
    const svg = renderFigureSvg({ type: 'base_ten', tens: 13, ones: 0, places: 2 }, 'en');
    expect(items(svg, 'ten')).toBe(13);
    expect(Gates.figureGateDefects(svg, 'base_ten')).toEqual([]);
  });

  test('an empty or impossible picture is refused with a reason', () => {
    expect(() => renderFigureSvg({ type: 'base_ten', hundreds: 0, tens: 0, ones: 0 }, 'en')).toThrow(/nothing/i);
    expect(() => renderFigureSvg({ type: 'base_ten', ones: 25 }, 'en')).toThrow(/20/);
  });

  test('the drawing can PRODUCE the answer: 342 is reachable, 432 is not', () => {
    const spec = { type: 'base_ten', hundreds: 3, tens: 4, ones: 2 };
    expect(Figure.figureMismatch(spec, ['342', '324', '432'], 0)).toBeNull();
    expect(Figure.figureMismatch(spec, ['342', '324', '432'], 2)).toMatch(/cannot produce/);
    expect(Figure.figureMismatch(spec, ['4', '3', '2'], 0)).toBeNull(); // "how many tens?"
  });

  test('a stem that already states the places does not need the picture (grade 6+ rule)', () => {
    const spec = { type: 'base_ten', hundreds: 3, tens: 4, ones: 2 };
    expect(Figure.figureIsRedundant(spec, 'Three hundreds, 4 tens and 2 ones make which number?')).toBe(true);
    expect(Figure.figureIsRedundant(spec, 'What number do the bundles show?')).toBe(false);
  });
});

describe('the validator accepts a place-value question, and only in maths', () => {
  const DIGEST = {
    subject: 'maths', grade_band: '1-2',
    slos: [{ id: 'S1', statement: 'read a number from bundles', taught_level: 'understand' }],
  };
  const base = (over = {}) => ({
    slo_id: 'S1', level: 'understand',
    question: 'What number do the bundles in the picture show?',
    options: ['342', '324', '432'], correct_index: 0,
    explanation: 'Three hundreds, four tens and two ones make 342.',
    distractor_misconceptions: { 1: 'swapped tens and ones', 2: 'swapped hundreds and tens' },
    option_feedback: { correct: 'Yes — 3 hundreds, 4 tens and 2 ones.', wrong: { 1: 'Look at the tens again.', 2: 'Look at the hundreds again.' } },
    figure: { type: 'base_ten', hundreds: 3, tens: 4, ones: 2 }, figure_role: 'read_off',
    ...over,
  });
  const text = (i) => ({
    slo_id: 'S1', level: 'recall', question: `Which digit is in the tens place of 5${i}8?`,
    options: [`${i}`, '5', '8'], correct_index: 0, explanation: 'The middle digit is the tens.',
    distractor_misconceptions: { 1: 'read the hundreds', 2: 'read the ones' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'That is the hundreds.', 2: 'That is the ones.' } },
  });
  const quiz = (first) => [first, ...[1, 2, 3, 4, 5].map(text)];

  test('a maths quiz with a base_ten question validates, and the drawing rides along', () => {
    const v = validate(quiz(base()), { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 6 });
    expect(v.errors.filter((e) => /^q0:/.test(e))).toEqual([]);
    expect(v.questions[0].figureSvg).toMatch(/data-bt="hundred"/);
  });

  test('a science quiz may not draw one', () => {
    const v = validate(quiz(base()), { language: 'en', subject: 'science', digest: { ...DIGEST, subject: 'science' }, nExpected: 6 });
    expect(v.errors.some((e) => /^q0: FIGURE_TYPE/.test(e))).toBe(true);
  });
});

describe('the grade 1-5 author prompt offers the manipulatives', () => {
  const digest = {
    subject: 'maths', grade_band: '1-2', topic: 'Tens and ones',
    slos: [{ id: 'S1', statement: 'count in tens and ones', taught_level: 'understand' }],
  };
  const p = buildAuthorPrompt({ digest, excerpts: '…', language: 'en', gradeBand: '1-2' });

  test('base_ten is in the minimal-spec block, and the roster carries counter and tile', () => {
    expect(p).toContain('- base_ten — ');
    expect(p).toMatch(/PICTOGRAM NAMES[\s\S]*\bcounter\b/);
    expect(p).toMatch(/PICTOGRAM NAMES[\s\S]*\btile\b/);
  });

  test('the early-years block says when to reach for base_ten', () => {
    expect(p).toMatch(/- base_ten — place value/);
  });

  test('a grade 9 prompt is not offered it', () => {
    const p9 = buildAuthorPrompt({ digest: { ...digest, grade_band: '9-10' }, excerpts: '…', language: 'en', gradeBand: '9-10' });
    expect(p9).not.toContain('- base_ten — ');
  });
});
