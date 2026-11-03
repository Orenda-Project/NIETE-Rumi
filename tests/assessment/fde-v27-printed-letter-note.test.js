/** bd-5jmnfj.4.58.2: a common-error note naming a printed letter. */
const { namesPrintedLetter } = require('../../bot/shared/services/assessment/fde-printed-letter-note');

describe('namesPrintedLetter', () => {
  test('silent b on "l _ _ b" is a printed letter', () => {
    expect(namesPrintedLetter('l _ _ b', 'Leaves out the silent letter b or writes lam')).toBe(true);
  });
  test('a letter the child must write is fine', () => {
    expect(namesPrintedLetter('l _ _ b', 'Leaves out the letter a')).toBe(false);
  });
  test('a stem with no blank is left alone', () => {
    expect(namesPrintedLetter('Spell lamb', 'Leaves out the silent letter b')).toBe(false);
  });
  test('a note naming no letter, or junk input, is false', () => {
    expect(namesPrintedLetter('t _ _ in', 'Writes tirain')).toBe(false);
    expect(namesPrintedLetter(null, undefined)).toBe(false);
  });
});
