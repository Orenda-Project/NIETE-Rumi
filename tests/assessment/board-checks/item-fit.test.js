'use strict';
// bd-5jmnfj.38.30 round 10: two soft checks from blind-panel 2s. Fictional items.
// D19 stimulus-use: an item in a stimulus group that never uses the stimulus (stand-alone recall).
// D20 graph-slo: a graph/gradient SLO on an item with no graph.
const M = require('../../../bot/shared/services/assessment/board-checks/item-fit');
const { mcq, tag, row, paper, ctxBoard } = require('./paper-builder');

const STIM = 'A cyclist rides 120 m along a straight track in 20 s, then waits at a signal for 10 s.';
const group = (items) => ({ id: 'g', slot: 's', type: 'scenario', stimulus: { text: STIM, items } });
const run = (items, extra) => M.run(paper({ sections: [{ id: 'A', marks: 2, slots: [row('s', { attempt: 1, printed: 1 })] }], items }), ctxBoard({ subjectConfig: { code: 'physics', grade: 9 }, ...extra }));

describe('D19/D20 item-fit (soft)', () => {
  test('interface: soft, board only', () => {
    expect(M).toMatchObject({ id: 'D19/D20', name: 'item-fit', hard: false, modes: ['board'] });
  });
  test('a recall item inside a stimulus group -> STIMULUS_UNUSED; one using its numbers or naming it passes', () => {
    const recall = mcq('r', 's', 'A) m/s²', ['A) m/s²', 'B) m/s', 'C) N', 'D) J'], { question: 'The SI unit of acceleration is:' });
    const uses = mcq('u', 's', 'B) 6 m/s', ['A) 4 m/s', 'B) 6 m/s', 'C) 8 m/s', 'D) 12 m/s'], { question: 'What is the speed over the 120 m?' });
    const names = mcq('n', 's', 'A) rest', ['A) rest', 'B) motion', 'C) spin', 'D) swing'], { question: 'While waiting at the signal, the cyclist is at:' });
    const r = run([group([recall, uses, names])]);
    expect(r.issues.map((i) => [i.rule, i.item_ref, i.hard])).toEqual([['STIMULUS_UNUSED', 's#1@s1', false]]);
  });
  test('graph SLO on an item with no graph -> GRAPH_SLO_NO_GRAPH; with a graph it passes', () => {
    const t = { ...tag(), official_slo: 'P-09-B-14' };
    const plain = mcq('p', 's', 'B) 2 m/s²', ['A) 1 m/s²', 'B) 2 m/s²', 'C) 3 m/s²', 'D) 4 m/s²'], { question: 'A car speeds up from 0 to 10 m/s in 5 s. Its acceleration is:', tag: t });
    const graph = mcq('q', 's', 'B) 2 m/s²', ['A) 1 m/s²', 'B) 2 m/s²', 'C) 3 m/s²', 'D) 4 m/s²'], { question: 'The gradient of the speed-time graph above is:', tag: t });
    expect(run([plain, graph]).issues.map((i) => [i.rule, i.item_ref])).toEqual([['GRAPH_SLO_NO_GRAPH', 's#1']]);
  });
});
