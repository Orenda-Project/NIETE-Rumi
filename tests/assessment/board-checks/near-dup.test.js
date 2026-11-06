'use strict';
// bd-5jmnfj.38.30 round 8: two MCQs in one section that ask the same thing with the same key are a hard issue
// (the later one is dropped and the extras absorb it). Pairs modelled on a live G11 chemistry paper; text made up.
const M = require('../../../bot/shared/services/assessment/board-checks/near-dup');
const R = require('../../../bot/shared/services/assessment/board-checks');
const { mcq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const m = (id, question, options, answer, slot = 's') => mcq(id, slot, answer, options, { question });
const sec = (items, id = 'A') => ({ id, marks: items.length, slots: [row('s', { attempt: items.length, printed: items.length })] });
const one = (items) => M.run(paper({ sections: [sec(items)], items }), ctxBoard());

const D_ORB = ['A) 1', 'B) 3', 'C) 5', 'D) 7'];
const dA = m('d1', 'The number of orbitals in a d sub-shell is:', D_ORB, 'C) 5');
const dB = m('d2', 'How many orbitals make up the d sub-shell, according to the values of the magnetic quantum number?', D_ORB, 'C) 5');
const sA = m('s1', 'The shape of an s orbital is:', ['A) dumb-bell', 'B) double dumb-bell', 'C) spherical', 'D) flat'], 'C) spherical');
const sB = m('s2', 'According to the book, the s orbital is:', ['A) dumb-bell shaped', 'B) flat', 'C) four-lobed', 'D) spherically symmetrical'], 'D) spherically symmetrical');

describe('D17 near-dup: same question twice in a section', () => {
  test('interface: hard, board mode only', () => {
    expect(M).toMatchObject({ id: 'D17', name: 'near-dup', hard: true, modes: ['board'] });
  });

  test('d orbitals pair (same stem words, key 5) -> NEAR_DUP on the later item only', () => {
    const r = one(deepFreeze([dA, m('x', 'Mass number equals the number of:', ['A) protons', 'B) electrons', 'C) neutrons', 'D) nucleons'], 'D) nucleons'), dB]));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ check: 'D17', rule: 'NEAR_DUP', item_ref: 's#3', hard: true });
    expect(r.issues[0].msg).toMatch(/s#1/);
  });

  test('s orbital shape pair (key "spherical" ~ "spherically symmetrical") -> NEAR_DUP', () => {
    expect(one([sA, sB]).issues.map((i) => i.item_ref)).toEqual(['s#2']);
  });

  test('same stem, different key is not a duplicate (p vs d sub-shell)', () => {
    const p = m('p1', 'The number of orbitals in a p sub-shell is:', D_ORB, 'B) 3');
    expect(one([dA, p]).issues).toEqual([]);
  });

  test('same key, different question is not a duplicate', () => {
    const e = m('e1', 'The maximum number of electrons in a 2p sub-shell with one vacancy is:', D_ORB, 'C) 5');
    expect(one([dA, e]).issues).toEqual([]);
  });

  test('different sections never pair', () => {
    const items = [dA, { ...dB, slot: 't' }];
    const p = paper({ sections: [sec([dA]), { id: 'B', marks: 1, slots: [row('t')] }], items });
    expect(M.run(p, ctxBoard()).issues).toEqual([]);
  });

  test('passage MCQs compare on their own stems, not the shared passage', () => {
    const grp = { id: 'g', slot: 's', type: 'scenario', stimulus: { text: 'Made-up passage about a d sub-shell and its orbitals.', items: [
      m('g1', 'Which colour is the made-up flask?', ['A) red', 'B) blue', 'C) green', 'D) grey'], 'B) blue'),
      m('g2', 'Which shape is the made-up flask?', ['A) round', 'B) blue', 'C) square', 'D) flat'], 'A) round'),
    ] } };
    expect(one([grp]).issues).toEqual([]);
  });

  test('registry: near-dup runs after mcq-shape and its hard issue lands in the shortfall', () => {
    expect(R.MEMBERS.map((x) => x.name)).toContain('near-dup');
    const r = R.run(paper({ sections: [sec([dA, dB])], items: [dA, dB] }), ctxBoard());
    expect(r.record.ran.indexOf('near-dup')).toBe(r.record.ran.indexOf('mcq-shape') + 1);
    expect(r.shortfall.find((s) => s.reason === 'D17')).toMatchObject({ slot: 's', items: ['d2'] });
  });
});

describe('D17 r9: written (SRQ) stems that share >= 80% of their content words (bd-5jmnfj.38.30)', () => {
  const { srq } = require('./paper-builder');
  const w = (id, question) => srq(id, 's', 2, { question });
  const written = (items) => M.run(paper({ sections: [{ id: 'B', marks: 2 * items.length, slots: [row('s', { type: 'srq', attempt: items.length, printed: items.length })] }], items }), ctxBoard());
  const hA = w('h1', 'Define the half-life of a made-up isotope and state its unit.');
  const hB = w('h2', 'State the unit of half-life and define half-life for the made-up isotope.');

  test('a paraphrased SRQ pair -> NEAR_DUP on the later one, no key needed', () => {
    const r = written([hA, w('x', 'Explain why a made-up spring stretches more under a larger load.'), hB]);
    expect(r.issues).toEqual([expect.objectContaining({ rule: 'NEAR_DUP', item_ref: 's#3', hard: true })]);
  });

  test('SRQs on different outcomes of one topic are kept', () => {
    expect(written([hA, w('h3', 'Calculate the mass left after two half-lives from a made-up 80 g sample.')]).issues).toEqual([]);
  });

  test('the two alternatives of one OR question never pair with each other', () => {
    const o = { id: 'o', slot: 's', or: [w('a', hA.question), w('b', hB.question)] };
    expect(written([o]).issues).toEqual([]);
  });
});

describe('D17 round 10: same tested fact, different key', () => {
  test('the same stem asked twice is a duplicate even with another key', () => {
    const a = m('v1', 'Which of the following is a scalar quantity?', ['A) speed', 'B) velocity', 'C) force', 'D) displacement'], 'A) speed');
    const b = m('v2', 'Which one of these is a scalar quantity?', ['A) weight', 'B) mass', 'C) momentum', 'D) acceleration'], 'B) mass');
    expect(one([a, b]).issues.map((i) => [i.rule, i.item_ref])).toEqual([['NEAR_DUP', 's#2']]);
  });
});
