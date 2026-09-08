/**
 * The list rows showed "1", "2", "3", "4" — numbers and nothing else — on a
 * Grade 2 Urdu paper (staging, 6 Sep, operator screenshot).
 *
 * navFit trims a truncated row title with `.replace(/[\s\W]+$/, '')`. In
 * JavaScript `\W` is "not [A-Za-z0-9_]", so every Urdu letter matches it: the
 * 20-character cut "1. محترمہ فاطمہ" loses all its Urdu, then its trailing ".",
 * and the row reads "1".
 *
 * This is the optionTitle bug (bd-60041) in the function that runs right after
 * it. The first fix was made without checking the sibling. Same rule as there:
 * name the punctuation you strip; never negate the Latin alphabet.
 */
const { _internal } = require('../../bot/shared/routes/assessment-gen-endpoint');
const { navFit, NAV_MAX } = _internal;

const URDU = '1. محترمہ فاطمہ جناح کے بارے میں درست معلومات کا کالم';
const ENGLISH = '1. Which of the following is a living thing in the garden';

describe('navFit keeps a row readable in every script', () => {
  test('a long Urdu title is cut, not erased', () => {
    const t = navFit(URDU);
    expect(t.length).toBeLessThanOrEqual(NAV_MAX);
    expect(t.replace(/^\d+\.?\s*/, '').length).toBeGreaterThan(3);
  });

  test('a short Urdu title survives whole', () => {
    expect(navFit('ملاپ کریں')).toBe('ملاپ کریں');
  });

  test('English still cuts on a word boundary with no dangling space', () => {
    const t = navFit(ENGLISH);
    expect(t.length).toBeLessThanOrEqual(NAV_MAX);
    expect(t.endsWith(' ')).toBe(false);
    expect(t.startsWith('1. Which')).toBe(true);
  });
});
