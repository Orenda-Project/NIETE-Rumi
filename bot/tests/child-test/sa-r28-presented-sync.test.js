'use strict';
/**
 * Round 28 C (C.5 #5, red team C2/R3): the grading sync maps every cell a child was shown to an item of the task it
 * reads from the served battery. Its two steps, re-done here in a few lines (read only, nothing written):
 *   norm_items(task.items)            → [{ idx: position, item_id: item.id, show }]
 *   presented_of('timed', res, index) → [{ idx: index[cell.item_id] ?? cell.i, item_id, at_ms, ms, how }]
 * Over the battery served with sa_r28_ceiling ON (today's items, then ext_items, as the route serves them) every cell
 * of a 30-cell run resolves by its own id to a unique, strictly increasing idx; no id appears twice. Synthetic battery.
 */
const pad = (n) => String(n).padStart(2, '0');

const normItems = (items) => (items || []).map((it, i) => ({ idx: i, item_id: it.id, show: it.show }));
const presentedOf = (res, index) => (res.cells || []).map((c) => ({
  idx: index.has(c.item_id) ? index.get(c.item_id) : c.i, item_id: c.item_id, at_ms: c.at_ms, ms: c.ms, how: c.how,
}));

const LETTERS = Array.from({ length: 100 }, (_, k) => `L${k + 1}`);
/** letter names as committed with C: today's 5 items, then 95 ext_items beside them. */
function committed() {
  const all = LETTERS.map((s, k) => ({ id: `ur.letter_names5.${pad(k + 1)}`, show: s, target: s, answer: s, src: `fixture:letters[${k}]`, ...(k >= 5 ? { ext: true } : {}) }));
  const items = all.slice(0, 5);
  return { id: 'ur.letter_names5', present: 'one_at_a_time', items, grid: items.map((x) => x.show), base_n: 5, ext_items: all.slice(5), ext_stop: { type: 'first_row', n: 10 } };
}
/** As the route serves it: ON items + ext_items (grid rebuilt); OFF today's task, the extension keys stripped. */
function served(on) {
  const t = committed();
  if (!on) return { id: t.id, present: t.present, items: t.items, grid: t.grid };
  const items = t.items.concat(t.ext_items);
  return { id: t.id, present: t.present, items, grid: items.map((x) => x.show) };
}
/** The phone's cells (sa-core closeCell): i, item_id from task.items[i], at_ms, ms, how. */
const run = (task, n) => Array.from({ length: n }, (_, i) => ({ i, item_id: task.items[i].id, at_ms: i * 2000, ms: i === n - 1 ? 1000 : 2000, how: i === n - 1 ? 'time_up' : 'tap' }));

describe('the grading sync over the served battery', () => {
  test('ON, a 30-cell run: every cell resolves by id, idx unique and strictly increasing, the ext cells past the base', () => {
    const t = served(true);
    const index = new Map(normItems(t.items).map((x) => [x.item_id, x.idx]));
    const presented = presentedOf({ cells: run(t, 30) }, index);
    expect(presented).toHaveLength(30);
    presented.forEach((p) => expect(index.has(p.item_id)).toBe(true));
    expect(presented.map((p) => p.idx)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(new Set(presented.map((p) => p.item_id)).size).toBe(30);
    expect(presented[5]).toEqual({ idx: 5, item_id: 'ur.letter_names5.06', at_ms: 10000, ms: 2000, how: 'tap' });
    expect(presented[29]).toEqual({ idx: 29, item_id: 'ur.letter_names5.30', at_ms: 58000, ms: 1000, how: 'time_up' });
  });

  test('ON, the whole list: 100 ids, none twice, no second-pass id', () => {
    const t = served(true);
    const ids = normItems(t.items).map((x) => x.item_id);
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(ids.some((id) => /\.c2\./.test(id))).toBe(false);
    expect(ids.slice(0, 5)).toEqual(committed().items.map((x) => x.id));
  });

  test('OFF: a run on today\'s 5 resolves as today', () => {
    const t = served(false);
    const index = new Map(normItems(t.items).map((x) => [x.item_id, x.idx]));
    const presented = presentedOf({ cells: run(t, 5) }, index);
    expect(presented.map((p) => [p.idx, p.item_id])).toEqual(t.items.map((x, i) => [i, x.id]));
  });
});
