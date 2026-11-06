'use strict';
/**
 * bd-5jmnfj.38.30 round 6 (a9: p3 G9 Physics ch2 failed on N20 at A.Q41-60#11@s3 with `items: []`).
 * Every check that walks with _walk-local reports refs index.js can map, so a stimulus child's hard issue names
 * its id and the writer can drop and rewrite it. Fictional stems.
 */
const Checks = require('../../../bot/shared/services/assessment/board-checks');
const figureBan = require('../../../bot/shared/services/assessment/board-checks/figure-ban');
const W = require('../../../bot/shared/services/assessment/board-checks/walk');

const mc = (id, question) => ({ id, slot: 'A.Q2', type: 'mcq', question, options: ['A) one', 'B) two', 'C) three', 'D) four'], answer: 'A) one' });
const group = (n, items) => ({ id: `grp${n}`, slot: 'A.Q2', type: 'scenario', stimulus: { text: `A made-up passage ${n} about a toy cart.`, items } });
const ex = {
  _layout: { sections: [{ id: 'A', slots: [{ slot: 'A.Q2' }] }] },
  unseen: { objective: { scenario: [
    group(1, [mc('g1a', 'How many made-up wheels does the cart have?'), mc('g1b', 'How many made-up seats?')]),
    group(2, [mc('g2a', 'How far does the made-up cart roll?'), mc('g2b', 'Using the graph shown below, find the made-up speed.')]),
  ] } },
};

test('figure-ban reports a stimulus child by its walk ref', () => {
  const hard = figureBan.run(ex, { mode: 'board' }).issues.filter((i) => i.hard);
  expect(hard.map((i) => i.item_ref)).toEqual([W.leaves(ex).find((l) => l.item.id === 'g2b').ref]);
});

test('the registry maps that figure-ban issue to the child id', () => {
  const items = Checks.makeRun([figureBan])(ex, { mode: 'board' }).shortfall.flatMap((r) => r.items);
  expect(items).toEqual(['g2b']);
});
