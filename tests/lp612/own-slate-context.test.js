/**
 * bd-snkn32.43 — the slates gate refused a Mohenjo-daro book question in G4 Urdu ch9: "تختی" there is a clay tablet,
 * book content, not a slate the children write on. "تختی" now refuses only as a slate in use (on it, held up, wiped,
 * her own); "slate(s)" and "سلیٹ" mean only the slate and always refuse.
 */
const { slates } = require('../../bot/shared/services/lp-own-period');

const plan = (youDo) => ({ hook: {}, iDo: {}, weDo: {}, youDo: { problems: [youDo] }, wrap: {} });

describe('تختی as book content passes', () => {
  it.each([
    'ہ۔ موہنجودڑو میں کس چیز کی دریافت نہیں ہوئی؟ (ہاتھی دانت / اونی اور سوتی کپڑے / مٹی کے برتن / کاغذ یا تختی) — کتاب میں دائرہ لگائیں۔',
    'کاغذ یا تختی (صفحہ ۷۸)۔',
    'تصویر میں مٹی کی تختی دیکھیں۔',
  ])('"%s"', (s) => {
    expect(slates(plan(s))).toEqual([]);
  });
});

describe('a slate in use still refuses', () => {
  it.each([
    'Each child writes the answer on slates.',
    'write A = 1/2 x 10 x 6 on slate, solve together.',
    'بچے سلیٹ پر جواب لکھیں۔',
    'بچے تختی پر جواب لکھیں۔',
    'اپنی تختی اوپر اٹھائیں۔',
    'تختیاں اٹھا کر دکھائیں۔',
    'جواب تختیوں پر لکھیں۔',
    'تختی صاف کریں اور اگلا لفظ لکھیں۔',
  ])('"%s"', (s) => {
    expect(slates(plan(s))).toHaveLength(1);
  });
});
