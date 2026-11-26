/**
 * bd-zrdvmi.74.1 — a bare caret exponent must not reach the teacher's WhatsApp body.
 *
 * bd-lafr9 converts maths INSIDE `$…$`, `\(…\)` and `\[…\]`. Authors also write exponents with no
 * delimiters at all — `x^2`, `3^40`, `10^-5` — and those went to the handset as source. Measured
 * on niete_lp612_renders (400 most recent maths renders with a one_screen, 26 Sep - 26 Nov 2026):
 * 12 bodies still carried a caret after the bd-lafr9 pass. The samples below are those strings.
 *
 * An exponent whose characters all have a superscript form becomes that form; one that does not
 * (`y^(1/3)`, `7^y`) keeps the caret, which is the module's existing degradation rule.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocument: jest.fn() }));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(), getSignedUrl: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));

const { texToUnicode } = require('../../bot/shared/utils/tex-to-unicode');
const { buildBody } = require('../../bot/shared/services/lp612-serving.service');

describe('bare caret exponents in prose become superscripts', () => {
  test.each([
    // grade_12_mathematics.c01.p007-009
    ['walk through f(x) = 2x^2 - 4: no value', 'walk through f(x) = 2x² - 4: no value'],
    // grade_9_mathematics.c02.p039-041
    ['find the digit count of 3^40 using', 'find the digit count of 3⁴⁰ using'],
    // grade_9_mathematics.c02.p026-028
    ['which is bigger, 10^5 or 10^-5?', 'which is bigger, 10⁵ or 10⁻⁵?'],
    // grade_8_mathematics.c06.p100-103
    ['15y^5 ÷ 3y^2, then -21x^5y^2 ÷ 3x^3y', '15y⁵ ÷ 3y², then -21x⁵y² ÷ 3x³y'],
    // grade_7_mathematics.c06.r990
    ['expanding (x+3)^2, then', 'expanding (x+3)², then'],
    // grade_9_mathematics.c02.p035-038
    ['m = b^x, n = b^y, multiply', 'm = b^x, n = b^y, multiply'],
    ['a^n times a^m', 'aⁿ times a^m'],
    ['raise it to (n+1): x^(n+1)', 'raise it to (n+1): x⁽ⁿ⁺¹⁾'],
  ])('%s', (input, expected) => {
    expect(texToUnicode(input)).toBe(expected);
  });

  test('an exponent with no superscript form keeps its caret (degradation rule)', () => {
    expect(texToUnicode('is y^(1/3) allowed as an exponent')).toBe('is y^(1/3) allowed as an exponent');
    expect(texToUnicode('8^(2/3) as a radical')).toBe('8^(2/3) as a radical');
    expect(texToUnicode('6y^4 - 7^y')).toBe('6y⁴ - 7^y');
  });

  test('a caret not attached to a base is prose and is left alone', () => {
    expect(texToUnicode('press ^ then 2')).toBe('press ^ then 2');
    expect(texToUnicode('^5 alone')).toBe('^5 alone');
  });

  test('buildBody: the WhatsApp body for a maths lesson carries no caret exponent', () => {
    const body = buildBody({
      oneScreen: '*Warm-up* Quick retrieval: evaluate 2^5, name the base and exponent in 3^4=81.',
      segment: {},
    });
    expect(body).toContain('evaluate 2⁵, name the base and exponent in 3⁴=81.');
    expect(body).not.toMatch(/\^/);
  });
});
