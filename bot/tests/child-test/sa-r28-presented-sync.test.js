'use strict';
/**
 * Round 28 C (C.5 #5, red team C2/R3): the grading sync maps every cell a child was shown to an item of the task it
 * reads from the served battery. Its two steps, re-done here in a few lines (read only, nothing written):
 *   norm_items(task.items)            → [{ idx: position, item_id: item.id, show }]
 *   presented_of('timed', res, index) → [{ idx: index[cell.item_id] ?? cell.i, item_id, at_ms, ms, how }]
 * Over an extended battery (sa_r28_ceiling ON: base items, then ext items) every cell of a 30-cell run resolves by
 * its own id to a unique, strictly increasing idx; a second-pass id (the contract's `.c2.`) resolves to its own idx.
 * Synthetic battery.
 */
const pad = (n) => String(n).padStart(2, '0');

const normItems = (items) => (items || []).map((it, i) => ({ idx: i, item_id: it.id, show: it.show }));
const presentedOf = (res, index) => (res.cells || []).map((c) => ({
  idx: index.has(c.item_id) ? index.get(c.item_id) : c.i, item_id: c.item_id, at_ms: c.at_ms, ms: c.ms, how: c.how,
}));

const LETTERS = Array.from({ length: 100 }, (_, k) => `L${k + 1}`);
/** letter names as built with C: 5 base items then 95 ext items; optionally a second pass after them. */
function battery({ second = 0 } = {}) {
  const items = LETTERS.map((s, k) => ({ id: `ur.letter_names5.${pad(k + 1)}`, show: s, target: s, answer: s, src: `fixture:letters[${k}]`, ...(k >= 5 ? { ext: true } : {}) }));
  for (let k = 0; k < second; k += 1) items.push({ id: `ur.letter_names5.c2.${pad(k + 1)}`, repeat_of: items[k].id, show: items[k].show, target: items[k].target, answer: items[k].answer, src: items[k].src, ext: true, cycle: 2 });
  return { tasks: [{ id: 'ur.letter_names5', base_n: 5, present: 'one_at_a_time', items, grid: items.map((x) => x.show) }] };
}
/** The phone's cells (sa-core closeCell): i, item_id from task.items[i], at_ms, ms, how. */
const run = (task, n) => Array.from({ length: n }, (_, i) => ({ i, item_id: task.items[i].id, at_ms: i * 2000, ms: i === n - 1 ? 1000 : 2000, how: i === n - 1 ? 'time_up' : 'tap' }));

describe('the grading sync over the extended battery', () => {
  test('a 30-cell run: every cell resolves by id, idx unique and strictly increasing, the ext cells past the base', () => {
    const t = battery().tasks[0];
    const index = new Map(normItems(t.items).map((x) => [x.item_id, x.idx]));
    const presented = presentedOf({ cells: run(t, 30) }, index);
    expect(presented).toHaveLength(30);
    presented.forEach((p) => expect(index.has(p.item_id)).toBe(true));
    expect(presented.map((p) => p.idx)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(new Set(presented.map((p) => p.item_id)).size).toBe(30);
    expect(presented[5]).toEqual({ idx: 5, item_id: 'ur.letter_names5.06', at_ms: 10000, ms: 2000, how: 'tap' });
    expect(presented[29]).toEqual({ idx: 29, item_id: 'ur.letter_names5.30', at_ms: 58000, ms: 1000, how: 'time_up' });
  });

  test('a second-pass cell (the contract\'s .c2. id) resolves to its own idx, never the original\'s', () => {
    const t = battery({ second: 5 }).tasks[0];
    const index = new Map(normItems(t.items).map((x) => [x.item_id, x.idx]));
    const cells = run(t, 102);
    const presented = presentedOf({ cells }, index);
    const c2 = presented.find((p) => p.item_id === 'ur.letter_names5.c2.01');
    expect(c2.idx).toBe(100);
    expect(presented.find((p) => p.item_id === 'ur.letter_names5.01').idx).toBe(0);
    expect(new Set(presented.map((p) => p.idx)).size).toBe(102);
  });

  test('the OFF battery (ext items stripped by the route): a run on it resolves as today', () => {
    const t = battery().tasks[0];
    const off = t.items.filter((x) => !x.ext);
    const index = new Map(normItems(off).map((x) => [x.item_id, x.idx]));
    const presented = presentedOf({ cells: run({ items: off }, 5) }, index);
    expect(presented.map((p) => [p.idx, p.item_id])).toEqual(off.map((x, i) => [i, x.id]));
  });
});
