/**
 * Child test draw — the cycle id and the seeded shuffle. The order must be the same every time for
 * the same secret, cycle and class, different for another class or cycle, a true permutation, and
 * replayable for an audit without the secret ever being stored.
 */
const { cycleFor, sessionCodeFor } = require('../../../bot/shared/services/child-test/draw/cycle');
const { seedFor, seedDigest, shuffle, ALGO_VERSION } = require('../../../bot/shared/services/child-test/draw/shuffle');
const draw = require('../../../bot/shared/services/child-test/draw');

describe('cycleFor — calendar quarters, Pakistan time', () => {
  test.each([
    ['2026-10-02T09:00:00Z', 'ICT-2026-Q4'],
    ['2026-12-31T18:00:00Z', 'ICT-2026-Q4'], // 23:00 PKT
    ['2026-12-31T19:30:00Z', 'ICT-2027-Q1'], // 00:30 PKT on 1 Jan
    ['2027-03-31T12:00:00Z', 'ICT-2027-Q1'],
    ['2027-04-01T00:00:00Z', 'ICT-2027-Q2'],
    ['2027-07-15T00:00:00Z', 'ICT-2027-Q3'],
  ])('%s → %s', (iso, id) => {
    expect(cycleFor(new Date(iso))).toBe(id);
  });
  test('the draw module exposes the same function', () => {
    expect(draw.cycleFor(new Date('2026-10-02T09:00:00Z'))).toBe('ICT-2026-Q4');
  });
  test('the academic session runs August to July', () => {
    expect(sessionCodeFor(new Date('2026-10-02T09:00:00Z'))).toBe('2026-2027');
    expect(sessionCodeFor(new Date('2027-07-31T12:00:00Z'))).toBe('2026-2027');
    expect(sessionCodeFor(new Date('2027-08-01T12:00:00Z'))).toBe('2027-2028');
  });
});

describe('the seeded shuffle', () => {
  const items = Array.from({ length: 25 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);

  test('same secret, cycle and class → the same order, every time', () => {
    const a = shuffle(items, seedFor('k1', 'ICT-2026-Q4', 'class-1'));
    const b = shuffle(items, seedFor('k1', 'ICT-2026-Q4', 'class-1'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(items);
  });
  test('another class, cycle or secret → a different order', () => {
    const base = shuffle(items, seedFor('k1', 'ICT-2026-Q4', 'class-1'));
    expect(shuffle(items, seedFor('k1', 'ICT-2026-Q4', 'class-2'))).not.toEqual(base);
    expect(shuffle(items, seedFor('k1', 'ICT-2027-Q1', 'class-1'))).not.toEqual(base);
    expect(shuffle(items, seedFor('k2', 'ICT-2026-Q4', 'class-1'))).not.toEqual(base);
  });
  test('a permutation: every child once, none added, input untouched', () => {
    const copy = items.slice();
    const out = shuffle(items, seedFor('k1', 'ICT-2026-Q4', 'class-1'));
    expect([...out].sort()).toEqual(copy);
    expect(items).toEqual(copy);
  });
  test('the stored digest is not the secret and not the seed, but identifies the seed', () => {
    const seed = seedFor('top-secret', 'ICT-2026-Q4', 'class-1');
    const d = seedDigest(seed);
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(d).not.toContain('top-secret');
    expect(d).not.toBe(seed.toString('hex'));
    expect(seedDigest(seedFor('top-secret', 'ICT-2026-Q4', 'class-1'))).toBe(d);
  });
  test('roughly uniform: over many seeds each child is first about equally often', () => {
    const small = ['a', 'b', 'c', 'd', 'e'];
    const firsts = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    for (let i = 0; i < 5000; i++) firsts[shuffle(small, seedFor('k', 'ICT-2026-Q4', `c${i}`))[0]] += 1;
    for (const n of Object.values(firsts)) expect(Math.abs(n - 1000)).toBeLessThan(120);
  });
  test('the algorithm is versioned', () => {
    expect(ALGO_VERSION).toMatch(/^ctd-/);
  });
});
