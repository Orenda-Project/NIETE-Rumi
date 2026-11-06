'use strict';
/**
 * bd-5jmnfj.38.30 round 6 (a8: p3 G9 Physics ch2, p4 G11 Chemistry ch2), key-leak only. Fictional stems modelled on
 * the a8 cases.
 * (a) key-leak reports refs in the shared walk form (board-checks/walk.js), so a stimulus child's issue maps to its id.
 * (b) a concept key quoted in another SECTION's stem is soft (the Section A sheet is collected first); in the same
 *     section it stays hard and names the keyed item and the phrase.
 * (c) leading determiners and pronouns are set aside before comparing ("Its acceleration" -> "acceleration").
 */
const m = require('../../../bot/shared/services/assessment/board-checks/key-leak');
const Checks = require('../../../bot/shared/services/assessment/board-checks');
const W = require('../../../bot/shared/services/assessment/board-checks/walk');

const BOARD = { mode: 'board' };
const LAYOUT = { sections: [{ id: 'A', slots: [{ slot: 'A.Q1' }, { slot: 'A.Q2' }] }, { id: 'B', slots: [{ slot: 'B.Q1' }] }] };
const mc = (id, slot, question, key, rest) => ({ id, slot, type: 'mcq', question, options: [`A) ${key}`, ...rest.map((r, i) => `${'BCD'[i]}) ${r}`)], answer: `A) ${key}` });
const srq = (id, slot, question, answer) => ({ id, slot, type: 'srq', question, answer });
const hard = (r) => r.issues.filter((i) => i.hard);
const n18 = (r) => r.issues.filter((i) => i.code === 'KEY_IN_STEM');
const paperOf = (mcqs, srqs = [], scenario = []) => ({ _layout: LAYOUT, unseen: { objective: { mcq: mcqs, scenario }, subjective: { srq: srqs } } });

describe('(a) refs in the walk form', () => {
  const group = (n, items) => ({ id: `A.Q2#${n}`, slot: 'A.Q2', type: 'scenario', stimulus: { text: `A made-up passage ${n} about a cart on a ramp.`, items } });
  const ex = paperOf([], [], [
    group(1, [mc('g1a', 'A.Q2', 'Which made-up lamp is brightest?', 'lamp three', ['lamp one', 'lamp two', 'lamp four']), mc('g1b', 'A.Q2', 'Which made-up lamp is dimmest?', 'lamp one', ['lamp two', 'lamp three', 'lamp four'])]),
    group(2, [
      mc('g2a', 'A.Q2', 'Near the Earth a falling ball speeds up because of:', 'acceleration due to gravity', ['air resistance', 'its mass', 'its colour']),
      mc('g2b', 'A.Q2', 'A made-up stone falls; its acceleration due to gravity is taken as 10 m/s^2. Its speed after 2 s is:', '20 m/s', ['10 m/s', '5 m/s', '40 m/s']),
    ]),
  ]);
  test('a stimulus child is reported by its walk ref', () => {
    const refs = new Set(W.leaves(ex).map((l) => l.ref));
    const got = hard(m.run(ex, BOARD));
    expect(got).toHaveLength(1);
    expect(got[0].item_ref).toBe(W.leaves(ex).find((l) => l.item.id === 'g2b').ref);
    expect(refs.has(got[0].item_ref)).toBe(true);
  });
  test('the registry maps that hard issue to the child id (key-leak alone)', () => {
    const items = Checks.makeRun([m])(ex, BOARD).shortfall.flatMap((r) => r.items);
    expect(items).toEqual(['g2b']);
  });
});

describe('(b) concept leaks scoped by section', () => {
  const keyed = mc('a1', 'A.Q1', 'The nucleus of a made-up atom holds:', 'protons and neutrons', ['electrons only', 'photons', 'ions']);
  test('a Section A key quoted in a Section B stem is soft', () => {
    const r = m.run(paperOf([keyed], [srq('b1', 'B.Q1', 'Zara studies a made-up atom of mass number 23. Find the number of protons and neutrons in it.', 'eleven and twelve')]), BOARD);
    expect(hard(r)).toEqual([]);
    expect(n18(r)).toHaveLength(1);
  });
  test('a Section B key quoted in a Section A stem is soft (the reverse)', () => {
    const r = m.run(paperOf([mc('a2', 'A.Q1', 'Hira says three made-up electrons occupy separate orbitals with the same spin. This is:', 'a rule', ['b', 'c', 'd'])],
      [srq('b2', 'B.Q1', 'State how electrons fill orbitals of equal energy.', 'separate orbitals with the same spin')]), BOARD);
    expect(hard(r)).toEqual([]);
  });
  test('the same section stays hard and names the keyed item and the phrase', () => {
    const r = m.run(paperOf([
      mc('a3', 'A.Q1', 'A made-up bus covers equal distances in equal times. Its speed is the:', 'average speed', ['peak speed', 'zero speed', 'top speed']),
      mc('a4', 'A.Q1', "Faisal's made-up bus covers 60 km in 2 h. Its average speed is:", '30 km/h', ['120 km/h', '62 km/h', '58 km/h']),
    ]), BOARD);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0]).toMatchObject({ item_ref: 'A.Q1#2', keyed_ref: 'A.Q1#1', phrase: 'average speed' });
  });
});

describe('(c) leading determiners and pronouns are set aside', () => {
  test('"Its acceleration" in another stem of the same section is single-word vocabulary: soft', () => {
    const r = m.run(paperOf([
      mc('c1', 'A.Q1', 'A made-up ball falls freely. Which quantity stays the same during the fall?', 'Its acceleration', ['Its speed', 'Its distance from the roof', 'Its time of fall']),
      mc('c2', 'A.Q1', "A made-up van's velocity rises from 4 m/s to 16 m/s in 3 s. Its acceleration is", '4 m/s^2', ['12 m/s^2', '3 m/s^2', '48 m/s^2']),
    ]), BOARD);
    expect(hard(r)).toEqual([]);
    expect(n18(r)).toHaveLength(1);
  });
  test('"the" or "their" before a two-word concept leaves it a hard concept phrase', () => {
    const r = m.run(paperOf([
      mc('c3', 'A.Q1', 'In a made-up atom the nucleus holds:', 'their protons and neutrons', ['electrons', 'photons', 'ions']),
      mc('c4', 'A.Q1', 'A made-up atom has 12 protons and neutrons in all. Its mass number is:', '12', ['6', '24', '1']),
    ]), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
});
