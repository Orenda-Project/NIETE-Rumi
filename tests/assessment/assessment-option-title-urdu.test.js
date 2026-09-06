/**
 * A checkbox option with an empty title is refused by Meta, and the teacher sees
 * "Something went wrong" on "Change this paper".
 *
 * optionTitle trimmed its truncated text with `.replace(/[\s\W]+$/, '')`. In
 * JavaScript `\W` is "not [A-Za-z0-9_]" — so EVERY Urdu letter matches it. The
 * regex was meant to shave a dangling space or comma off a cut word; against
 * Urdu it consumed the entire title and returned "1. ".
 *
 * English survived, which is why the review layer looked fine in every test and
 * failed for the only subjects the ICT deployment mostly teaches. It is the same
 * shape as the language bugs the language-protocol skill exists for: a rule
 * written in ASCII assumptions, applied to a script it was never measured on.
 */
const { optionTitle } = require('../../bot/shared/services/assessment/assessment-selection');

const URDU_LONG = 'محترمہ فاطمہ جناح کے بارے میں درست معلومات کا کالم الف سے کالم ب کے ساتھ ملاپ کریں۔';
const URDU_SHORT = 'ملاپ کریں';
const ENGLISH_LONG = 'Which of the following is a living thing in the classroom garden today';

describe('optionTitle keeps the question readable in every script', () => {
  test('a long Urdu question is not erased', () => {
    const title = optionTitle({ number: 1, text: URDU_LONG });
    expect(title).not.toBe('1. ');
    expect(title.replace(/^\d+\.\s*/, '').length).toBeGreaterThan(4);
  });

  test('a short Urdu question survives whole', () => {
    expect(optionTitle({ number: 2, text: URDU_SHORT })).toBe(`2. ${URDU_SHORT}`);
  });

  test('English still truncates on a word boundary, as before', () => {
    const title = optionTitle({ number: 1, text: ENGLISH_LONG });
    expect(title.startsWith('1. Which')).toBe(true);
    expect(title.endsWith(' ')).toBe(false);
  });

  test('every option a paper produces carries a non-empty title', () => {
    for (const text of [URDU_LONG, URDU_SHORT, ENGLISH_LONG, 'ایک', 'A']) {
      const body = optionTitle({ number: 3, text }).replace(/^\d+\.\s*/, '');
      expect(body).not.toBe('');
    }
  });
});
