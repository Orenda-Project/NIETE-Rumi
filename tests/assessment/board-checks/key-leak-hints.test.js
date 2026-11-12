'use strict';
/**
 * bd-qyi45h.6 (prod 11 Nov 2026: G11 Computer Science and G9 Physics board papers failed closed on N18). Fictional
 * stems modelled on the five prod leaks.
 * (1) a key of numbers only, found only in its own passage, is the given data (a truth table row), so soft.
 * (2) a short concept MCQ key (<= 3 words, no digit) quoted in a PASSAGE question outside its own passage is a hint,
 *     so soft. A sibling in the same passage restating it, or a standalone stem (earlier rulings), stays hard.
 * Own-stem concept leaks and short-question keys stay hard.
 */
const m = require('../../../bot/shared/services/assessment/board-checks/key-leak');

const BOARD = { mode: 'board' };
const FREE = { mode: 'free' };
const LAYOUT = { sections: [{ id: 'A', slots: [{ slot: 'A.Q1' }, { slot: 'A.Q2' }] }, { id: 'B', slots: [{ slot: 'B.Q1' }] }] };
const mc = (id, slot, question, key, rest) => ({ id, slot, type: 'mcq', question, options: [`A) ${key}`, ...rest.map((r, i) => `${'BCD'[i]}) ${r}`)], answer: `A) ${key}` });
const srq = (id, slot, question, answer) => ({ id, slot, type: 'srq', question, answer });
const group = (n, text, items) => ({ id: `A.Q2#${n}`, slot: 'A.Q2', type: 'scenario', stimulus: { text }, items, _n: n });
const paperOf = (mcqs, scenario = [], srqs = []) => ({
  _layout: LAYOUT,
  unseen: { objective: { mcq: mcqs, scenario: scenario.map(({ _n, items, ...g }) => ({ ...g, stimulus: { ...g.stimulus, items } })) }, subjective: { srq: srqs } },
});
const hard = (r) => r.issues.filter((i) => i.hard);
const n18 = (r) => r.issues.filter((i) => i.code === 'KEY_IN_STEM');

describe('(1) a numbers-only key found only in its own passage is given data', () => {
  const TABLE = 'Sana tests a made-up gate with inputs P and Q:\nP Q F\n0 0 1\n0 1 1\n1 0 1\n1 1 0\nShe feeds F into a NOT gate to get G.';
  const ex = paperOf([], [group(1, TABLE, [mc('t1', 'A.Q2', 'For which inputs (P, Q) is G equal to 1?', '(1, 1)', ['(0, 0)', '(0, 1)', '(1, 0)'])])]);
  test('board: soft, still noted', () => {
    const r = m.run(ex, BOARD);
    expect(hard(r)).toEqual([]);
    expect(n18(r)).toHaveLength(1);
  });
  test('free mode is unchanged (hard)', () => {
    expect(hard(m.run(ex, FREE))).toHaveLength(1);
  });
  test('the same numbers-only key in its own QUESTION stays hard', () => {
    const own = paperOf([], [group(1, 'A made-up gate table is given.', [mc('t2', 'A.Q2', 'Which input pair, (1, 1) or another, makes G equal to 1?', '(1, 1)', ['(0, 0)', '(0, 1)', '(1, 0)'])])]);
    expect(hard(m.run(own, BOARD))).toHaveLength(1);
  });
  test('a concept key in its own passage stays hard', () => {
    const own = paperOf([], [group(1, 'Noor has a made-up sorted list. Then she tries binary search on it.', [mc('t3', 'A.Q2', 'Which method halves the list each step?', 'binary search', ['linear search', 'bubble sort', 'hashing'])])]);
    expect(hard(m.run(own, BOARD))).toHaveLength(1);
  });
});

describe('(2) a short concept MCQ key in another question is a hint', () => {
  test('MCQ key in a passage question outside its passage: soft', () => {
    const ex = paperOf(
      [mc('h1', 'A.Q1', 'A made-up coin and feather fall in air; the coin lands first. The reason is:', 'air resistance', ['mass', 'colour', 'shape of Earth'])],
      [group(1, 'Hamza drops a made-up stone. Air resistance is ignored.', [mc('h2', 'A.Q2', "In Hamza's passage, the stone's acceleration is directed:", 'downward', ['upward', 'sideways', 'nowhere'])])],
    );
    const r = m.run(ex, BOARD);
    expect(hard(r)).toEqual([]);
    expect(n18(r)).toHaveLength(1);
  });
  test('a standalone MCQ key quoted in a passage question: soft', () => {
    const r = m.run(paperOf(
      [mc('h3', 'A.Q1', 'Which made-up force is a non-contact force?', 'gravitational force', ['friction', 'tension', 'normal force'])],
      [group(1, 'Zara watches a made-up apple fall.', [mc('h4', 'A.Q2', 'The gravitational force on the apple depends on:', 'their masses and distance', ['colour', 'shape', 'charge only'])])],
    ), BOARD);
    expect(hard(r)).toEqual([]);
  });
  test('the same key in another STANDALONE MCQ stem stays hard (earlier ruling)', () => {
    const r = m.run(paperOf([
      mc('h8', 'A.Q1', 'Which made-up force is a non-contact force?', 'gravitational force', ['friction', 'tension', 'normal force']),
      mc('h9', 'A.Q1', 'The gravitational force between two made-up masses depends on:', 'their masses and distance', ['colour', 'shape', 'charge only']),
    ]), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('the same phrase restated by a sibling in the same passage stays hard', () => {
    const ex = paperOf([], [group(1, 'Faisal learns that a made-up moon stays near its planet because of a force.', [
      mc('s3', 'A.Q2', 'The force that keeps the moon near the planet is the:', 'gravitational force', ['friction', 'magnetic force', 'tension']),
      mc('s4', 'A.Q2', 'The gravitational force that holds the moon near the planet acts:', 'at a distance', ['by touch', 'only in air', 'never']),
    ])]);
    const got = hard(m.run(ex, BOARD));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ phrase: 'gravitational force' });
  });
  test('a key of four or more words stays hard', () => {
    const r = m.run(paperOf([
      mc('h5', 'A.Q1', 'A made-up law says:', 'force equals mass times acceleration', ['a', 'b', 'c']),
      mc('h6', 'A.Q1', 'Since force equals mass times acceleration, a made-up cart of 2 kg needs:', '4 N', ['2 N', '8 N', '1 N']),
    ]), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('a short-question key in another stem of the same section stays hard', () => {
    const r = m.run(paperOf([mc('h7', 'A.Q1', 'A made-up stone falls with air resistance ignored. Its speed:', 'rises', ['falls', 'stays', 'stops'])], [],
      [srq('b1', 'A.Q1','Name the made-up force that slows a feather.', 'air resistance')]), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
});
