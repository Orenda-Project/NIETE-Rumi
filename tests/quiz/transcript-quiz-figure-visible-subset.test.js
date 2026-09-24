'use strict';
/**
 * A counters picture can only show a PART of a set if that part looks different.
 *
 * Staging (a proper-fractions lesson, Urdu): «تصویر میں رنگین پنسلوں کے سیٹ…»
 * — "the set of COLOURED pencils" — over five identical outline pencils, two
 * on the top row and three below, keyed 2/5. FIGURE_MISMATCH already accepted
 * "a row's share of the whole" for count_objects, but never asked whether the
 * child can SEE which row that is: nothing in the picture was coloured.
 *
 * Now a row's share is an answer the picture can produce only when that row
 * looks different from the rest (another picture, its own colour, or its own
 * name); and a stem that names a colour or a shading needs the picture to
 * show it. So that the picture CAN show it, a count_objects row may carry a
 * `color` (the palette tokens the other types use), drawn on its things — an
 * engine change recorded in vendor SYNC.md 3.22.
 *
 * Through the real validator and the real engine; only the loggers mocked.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { renderDiagram } = require('../../bot/vendor/lp-v9/diagrams');

const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const DIGEST = { subject: 'maths', grade_band: '3', slos: [{ id: 'S1', statement: 'fractions of a set', taught_level: 'understand' }] };
const ctx = (language = 'en') => ({ language, subject: 'maths', digest: DIGEST, nExpected: 1 });
const q = (over) => ({
  slo_id: 'S1', level: 'understand', question: 'What fraction of the set are the coloured pencils?', options: [F(2, 5), F(3, 5), F(5, 2)], correct_index: 0,
  explanation: 'Two of the five pencils are coloured.', selected_because: 'the pencils in the lesson',
  distractor_misconceptions: { 1: 'counts the plain ones', 2: 'swaps the numbers' },
  option_feedback: { correct: 'Yes.', wrong: { 1: 'Those are the plain ones.', 2: 'The whole goes under the line.' } },
  figure_role: 'read_off', ...over,
});
const mismatch = (v) => v.errors.filter((e) => /^q0: FIGURE_MISMATCH/.test(e));
const pencils = (top = {}) => ({ type: 'count_objects', rows: [{ picto: 'pencil', count: 2, ...top }, { picto: 'pencil', count: 3 }] });

describe('a share of the set needs a part that looks different', () => {
  test('the staging case: 2 of 5 identical pencils, "coloured", keyed 2/5 — refused', () => {
    const e = mismatch(validate([q({ figure: pencils() })], ctx()));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/look/);
  });

  test('the same Urdu stem over the same picture — refused', () => {
    const ur = q({ question: 'تصویر میں رنگین پنسلوں کے سیٹ کو ظاہر کرنے والا proper fraction کون سا ہے؟', figure: pencils(), explanation: 'پانچ میں سے دو پنسلیں رنگین ہیں۔', selected_because: 'سبق کی پنسلیں', distractor_misconceptions: { 1: 'سادہ پنسلیں گننا', 2: 'اعداد الٹ دینا' }, option_feedback: { correct: 'جی ہاں۔', wrong: { 1: 'یہ سادہ پنسلیں ہیں۔', 2: 'کل تعداد نیچے آتی ہے۔' } } });
    expect(mismatch(validate([ur], ctx('ur')))).toHaveLength(1);
  });

  test('the top row in its own colour — allowed', () => {
    expect(mismatch(validate([q({ figure: pencils({ color: 'warn' }) })], ctx()))).toEqual([]);
  });

  test('a different picture for the part — allowed', () => {
    const fruit = { type: 'count_objects', rows: [{ picto: 'apple', count: 2 }, { picto: 'banana', count: 3 }] };
    expect(mismatch(validate([q({ question: 'What fraction of the fruit are apples?', figure: fruit })], ctx()))).toEqual([]);
  });

  test('a colour-named count over two rows that look alike — refused; with the row coloured — allowed', () => {
    const ask = (figure) => q({ question: 'How many coloured pencils are in the picture?', options: ['2', '5', '3'], figure });
    expect(mismatch(validate([ask(pencils())], ctx()))).toHaveLength(1);
    expect(mismatch(validate([ask(pencils({ color: 'cool' }))], ctx()))).toEqual([]);
  });

  test('a colour-named count over one plain row: 2 of 5 cannot be seen, 5 of 5 can', () => {
    const one = { type: 'count_objects', picto: 'pencil', count: 5 };
    const count = (key, opts) => q({ question: 'How many coloured pencils are in the picture?', options: opts, figure: one });
    expect(mismatch(validate([count(0, ['2', '5', '3'])], ctx()))).toHaveLength(1);
    expect(mismatch(validate([count(0, ['5', '2', '3'])], ctx()))).toEqual([]);
  });
});

describe('the engine draws a row in its own colour', () => {
  test('a row with "color": "warn" is drawn in that colour; without it, in ink as before', () => {
    const coloured = renderDiagram({ ...pencils({ color: 'warn' }), lang: 'en' });
    expect(coloured).toMatch(/#9B2C2C/i);
    expect(renderDiagram({ ...pencils(), lang: 'en' })).not.toMatch(/#9B2C2C/i);
  });
});

describe('the author and the repair are told how to show a part of a set', () => {
  test('the author prompt names the row colour', () => {
    const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const p = Author.buildAuthorPrompt({ digest: { ...DIGEST, topic: 'Fractions of a set' }, excerpts: '…', language: 'en', gradeBand: '3' });
    expect(p).toMatch(/a PART of a set[^\n]*"color"/);
  });

  test('the manifest the author reads lists color among a row\'s fields', () => {
    const MANIFEST = require('../../bot/vendor/lp-v9/diagrams/types_manifest.json');
    const t = MANIFEST.types.find((x) => x.type === 'count_objects');
    expect(t.limits.join(' ')).toMatch(/\{picto,count,label,color\}/);
  });
});
