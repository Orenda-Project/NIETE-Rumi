'use strict';
/**
 * The bilingual drift check: every `.bi` body of the maker reply and its fallback is ONE value, byte for byte the
 * signed Urdu value, a blank line, the signed English value, held the same in both slots (COPY v1.2 §4 rule 1). A
 * one-word edit to either signed half that is not carried into the `.bi` value fails here. Bilingual buttons: Latin
 * first, « · », then Urdu, ≤ 20 code points. Pure: no mock, no I/O.
 */
const Fallback = require('../../shared/services/first-touch/maker.fallback.strings');
const Maker = require('../../shared/services/first-touch/maker.strings');

const cp = (s) => [...s].length;
const BODIES = [
  [Fallback.STRINGS, 'maker.fallback.body.unknown.bi', 'maker.fallback.body.unknown'],
  [Maker.STRINGS, 'maker.body.bi', 'maker.body'],
];

describe('.bi bodies = UR ⏎⏎ EN of the signed values', () => {
  test.each(BODIES.map(([table, bi, base]) => [bi, table, base]))('%s', (bi, table, base) => {
    const row = table[bi];
    expect(row).toBeDefined();
    const want = `${table[base].ur}\n\n${table[base].en}`;
    expect(Buffer.from(row.en, 'utf8').equals(Buffer.from(want, 'utf8'))).toBe(true);
    expect(row.ur).toBe(row.en);
  });
});

describe('.bi buttons: Latin first, « · », then Urdu, ≤ 20 cp, the same in both slots', () => {
  const ids = Object.keys(Fallback.STRINGS).filter((k) => /\.btn\d\.bi$/.test(k));
  test('there are three', () => expect(ids).toHaveLength(3));
  test.each(ids)('%s', (id) => {
    const { en, ur } = Fallback.STRINGS[id];
    expect(ur).toBe(en);
    expect(en).toMatch(/^[A-Za-z]+ · [؀-ۿ ]+$/);
    expect(cp(en)).toBeLessThanOrEqual(20);
  });
});
