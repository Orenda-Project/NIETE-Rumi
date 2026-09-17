/**
 * bd-60113 — normalising the I-SAPS "Place After Unit" column.
 *
 * Each formative item names the unit video it follows, which is what pins the
 * question to a `training_modules` row. The source workbooks spell that
 * reference nine different ways, because nine people filled them in:
 *
 *   M1/M2/M4/M6/M8   "101"                        — the bare unit code
 *   M5               "501 (unit 2 - 08:49)"       — code + a timestamp note
 *   M9               "901 - scene 3 (17:42)"      — code + scene + timestamp
 *   M7               "1", "2", "3"                — ordinal WITHIN the module
 *
 * The first three yield the unit code directly. The fourth does not: "3" in
 * Module 7 means unit 703, and the module number is the only thing that can
 * disambiguate it — which is why the parser takes the module number too.
 *
 * Getting this wrong attaches a question to the wrong video, so it is pinned
 * with the real strings lifted from the workbooks rather than invented ones.
 */

const { parseUnitRef } = require('../../bot/shared/services/training/isaps-import.rules');

describe('bd-60113 — parseUnitRef', () => {
  test('bare three-digit unit code', () => {
    expect(parseUnitRef('101', 1)).toBe(101);
    expect(parseUnitRef('208', 2)).toBe(208);
  });

  test('unit code followed by a parenthetical timestamp (M5)', () => {
    expect(parseUnitRef('501 (unit 2 - 08:49)', 5)).toBe(501);
    expect(parseUnitRef('509 (unit 6 - 41:37)', 5)).toBe(509);
  });

  test('unit code with a scene and timestamp (M9)', () => {
    expect(parseUnitRef('901 - scene 3 (17:42)', 9)).toBe(901);
    expect(parseUnitRef('906 - scene 1 (07:53)', 9)).toBe(906);
  });

  test('bare ordinal is resolved against the module number (M7)', () => {
    // "3" in Module 7 is unit 703 — NOT unit 3, and not unit 300.
    expect(parseUnitRef('3', 7)).toBe(703);
    expect(parseUnitRef('1', 7)).toBe(701);
    expect(parseUnitRef('5', 7)).toBe(705);
  });

  test('an ordinal that is already the module\'s own code is not doubled', () => {
    // M9 row "3" must become 903, but a row already reading "903" stays 903.
    expect(parseUnitRef('3', 9)).toBe(903);
    expect(parseUnitRef('903', 9)).toBe(903);
  });

  test('whitespace and stray punctuation are tolerated', () => {
    expect(parseUnitRef('  101  ', 1)).toBe(101);
    expect(parseUnitRef('101.', 1)).toBe(101);
  });

  test('a unit code from a DIFFERENT module is returned as written', () => {
    // Trust the sheet over the folder: a cross-referenced unit is legitimate
    // and silently rewriting it to the current module would hide the link.
    expect(parseUnitRef('204', 3)).toBe(204);
  });

  test('unparseable input returns null rather than guessing', () => {
    expect(parseUnitRef('', 1)).toBeNull();
    expect(parseUnitRef(null, 1)).toBeNull();
    expect(parseUnitRef('n/a', 1)).toBeNull();
    expect(parseUnitRef('see module 2', 1)).toBeNull();
  });
});
