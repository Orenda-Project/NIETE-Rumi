/**
 * v29 Grade 1-2 Maths (bd-5jmnfj.4.58.4, round 4):
 *   G1 Q2 iv «Counts on instead of back and writes 59 and 61» does not follow from 58, 57, __, 55, __ (58 and 56);
 *   G1 Q2 ii «Counts on by 10 and writes 30 and 40» gives 30, a number the series prints right after the blank;
 *   G2 Q7, Q9, Q11 one-step word problems paid M1 + M1 + A1: one method mark, the freed mark goes to the answer.
 */

const { commonErrorNumbers } = require('../../bot/shared/services/assessment/fde-common-error-numbers');
const { earlyKeyFixes } = require('../../bot/shared/services/assessment/fde-early-key-fixes');
const { seriesError } = require('../../bot/shared/services/assessment/fde-common-error-series');
const { mergeMethodMarks } = require('../../bot/shared/services/assessment/fde-early-maths-fixes');
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-maths');

const G1 = require('./fixtures/fde-v34-g1-maths.json');
const G2 = require('./fixtures/fde-v34-g2-maths.json');

const itemsOf = (ex) => Object.values(ex.unseen).flatMap((byType) => Object.values(byType).flat());
const bySlot = (ex, slot) => itemsOf(ex).filter((q) => q.slot === slot);
const mk = (question, answer, common_error) => ({ slot: 'g1.maths.A.Q2', question, answer, scheme: { points: [], accept: [], common_error } });

describe('seriesError', () => {
  test('counting on instead of back recomputes: 58, 57, __, 55, __ gives 58 and 56', () => {
    expect(seriesError(mk('58, 57, __, 55, __', '56, 54', 'Counts on instead of back and writes 59 and 61.')))
      .toBe('Counts on instead of back and writes 58 and 56.');
  });
  test('counting on instead of back on an ascending series is dropped', () => {
    expect(seriesError(mk('12, 14, __, 18, __', '16, 20', 'Counts on instead of back and writes 15 and 19.'))).toBeNull();
  });
  test('a correct counts-on-by note is left alone', () => {
    expect(seriesError(mk('12, 14, __, 18, __', '16, 20', 'Counts on by 1 and writes 15 and 19.'))).toBeUndefined();
    expect(seriesError(mk('30, 40, __, 60, __', '50, 70', 'Counts on by 1 and writes 41 and 61.'))).toBeUndefined();
  });
  test('a wrong figure is recomputed', () => {
    expect(seriesError(mk('30, 40, __, 60, __', '50, 70', 'Counts on by 1 and writes 51 and 71.')))
      .toBe('Counts on by 1 and writes 41 and 61.');
  });
  test('a wrong number that is the next printed number is dropped (15, 20, __, 30, __ by 10 gives 30)', () => {
    expect(seriesError(mk('15, 20, __, 30, __', '25, 35', 'Counts on by 10 and writes 30 and 40.'))).toBeNull();
  });
  // v37 loop 4 G1 Q2: «Counts on by 1 and writes 7, 8» was turned into «writes 7 and 9, 8» (bd-5jmnfj.4.58.9.1).
  test('two blanks in a row: the child counts on from its own first answer, and a comma list is read whole', () => {
    expect(seriesError(mk('2, 4, 6, __, __', '8, 10', 'Counts on by 1 and writes 7, 8'))).toBeUndefined();
    expect(seriesError(mk('5, 10, 15, __, __', '20, 25', 'Counts on by 1 and writes 16 and 21'))).toBe('Counts on by 1 and writes 16 and 17');
    expect(seriesError(mk('30, 40, 50, __, __', '60, 70', 'Counts on by 1 and writes 51, 61'))).toBe('Counts on by 1 and writes 51, 52');
  });
  test('anything else is left alone', () => {
    expect(seriesError(mk('81, 82, __, 84, __', '83, 85', 'Repeats a number already in the series.'))).toBeUndefined();
    expect(seriesError({ scheme: {} })).toBeUndefined();
    expect(seriesError(null)).toBeUndefined();
  });
});

describe('G1 Q2 on the v29 paper', () => {
  const out = commonErrorNumbers(G1).examJson;
  const q = (s) => bySlot(out, 'g1.maths.A.Q2').find((x) => x.question === s);
  test('the count-back error follows from its numbers', () => {
    expect(q('58, 57, __, 55, __').scheme.common_error).toBe('Counts on instead of back and writes 58 and 56.');
  });
  test('the 5s series no longer names a printed number as the slip', () => {
    expect(q('15, 20, __, 30, __').scheme.common_error).toBeUndefined();
  });
  test('the good notes are untouched', () => {
    expect(q('12, 14, __, 18, __').scheme.common_error).toBe('Counts on by 1 and writes 15 and 19.');
    expect(q('30, 40, __, 60, __').scheme.common_error).toBe('Counts on by 1 and writes 41 and 61.');
  });
});

describe('G2 word problems pay one method mark', () => {
  const out = earlyKeyFixes(G2).examJson;
  ['g2.maths.B.Q7', 'g2.maths.B.Q9', 'g2.maths.B.Q11'].forEach((slot) => {
    test(`${slot}: M1 + A2 and the marks still add to 3`, () => {
      const q = bySlot(out, slot)[0];
      expect(q.scheme.points.map((p) => `${p.kind}${p.marks}`)).toEqual(['M1', 'A2']);
      expect(q.scheme.points.reduce((n, p) => n + p.marks, 0)).toBe(q.marks);
    });
  });
  test('a G1 one-mark word problem is not touched', () => {
    const q = { slot: 'g1.maths.B.Q5', marks: 1, scheme: { points: [{ text: 'x', marks: 1, kind: 'A' }] } };
    expect(mergeMethodMarks(q, [])).toBe(q);
  });
  test('an M1 + A2 item stays as it is', () => {
    const q = { slot: 'g2.maths.B.Q7', marks: 3, scheme: { points: [{ text: 'm', marks: 1, kind: 'M' }, { text: 'a', marks: 2, kind: 'A' }] } };
    expect(mergeMethodMarks(q, [])).toBe(q);
  });
  test('the pattern rule asks for M1 + A2', () => {
    const rule = g2.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.maths.B.Q7').prompt_rule;
    expect(rule).toMatch(/A 2/);
    expect(rule).not.toMatch(/M 1 for the working/);
  });
});
