/**
 * bd-snkn32.59 (queue #165) — she changes the outline before any plan is made: move up/down, join with next, split,
 * undo (mockup option A, the ⋯ menu). And the server's check on an outline the portal sends back.
 */
const O = require('../../bot/shared/services/lp-own-unit-outline');
const E = require('../../bot/shared/services/lp-own-unit-edit');
const catalog = require('../../bot/data/lp_catalog.json');

const MATHS = catalog.books.find((b) => b.stem === 'grade_3_math');
const days = (over = {}) => O.buildOutline({ book: MATHS, from: 2, to: 3, pace: 'recommended', period: 35, bookMinutes: 40, ...over }).days;
const start = () => E.startEditing(days());

describe('move', () => {
  it('moves a day down and up, and undo puts it back', () => {
    const s0 = start();
    const s1 = E.edit(s0, { op: 'move', at: 1, dir: 1 });
    expect(s1.ok).toBe(true);
    expect(s1.state.days[2].lesson_ids).toEqual(['grade_3_math_ch2_seg2']);
    const s2 = E.edit(s1.state, { op: 'undo' });
    expect(s2.state.days).toEqual(s0.days);
  });
  it('a test day never moves, and nothing moves across one', () => {
    expect(E.edit(start(), { op: 'move', at: 10, dir: -1 })).toEqual({ ok: false, error: 'test_day_fixed' });
    expect(E.edit(start(), { op: 'move', at: 11, dir: -1 })).toEqual({ ok: false, error: 'test_day_fixed' });
  });
  it('not past either end', () => {
    expect(E.edit(start(), { op: 'move', at: 0, dir: -1 })).toEqual({ ok: false, error: 'out_of_range' });
  });
});

describe('join with next', () => {
  it('joins two lesson days into one day of both', () => {
    const r = E.edit(start(), { op: 'join', at: 0 });
    expect(r.state.days).toHaveLength(20);
    expect(r.state.days[0]).toMatchObject({ kind: 'lesson', lesson_ids: ['grade_3_math_ch2_seg1', 'grade_3_math_ch2_seg2'] });
  });
  it('at most two book days in one', () => {
    const once = E.edit(start(), { op: 'join', at: 0 }).state;
    expect(E.edit(once, { op: 'join', at: 0 })).toEqual({ ok: false, error: 'too_big' });
  });
  it('never joins a review or test day', () => {
    expect(E.edit(start(), { op: 'join', at: 8 })).toEqual({ ok: false, error: 'not_joinable' });
    expect(E.edit(start(), { op: 'join', at: 9 })).toEqual({ ok: false, error: 'not_joinable' });
  });
  it('joining the two parts of a split day makes it whole again', () => {
    const short = E.startEditing(days({ period: 30 }));
    const at = short.days.findIndex((d) => d.part === 1);
    const r = E.edit(short, { op: 'join', at });
    expect(r.state.days[at].part).toBeUndefined();
    expect(r.state.days[at].lesson_ids).toHaveLength(1);
  });
});

describe('split', () => {
  it('splits one book day into part 1 and part 2', () => {
    const r = E.edit(start(), { op: 'split', at: 3 });
    expect(r.state.days).toHaveLength(22);
    expect(r.state.days.slice(3, 5).map((d) => d.part)).toEqual([1, 2]);
  });
  it('splits a joined day back into its two book days', () => {
    const joined = E.edit(start(), { op: 'join', at: 0 }).state;
    const r = E.edit(joined, { op: 'split', at: 0 });
    expect(r.state.days.slice(0, 2).map((d) => d.lesson_ids)).toEqual([['grade_3_math_ch2_seg1'], ['grade_3_math_ch2_seg2']]);
  });
  it('a part, a review or a test day does not split', () => {
    const parted = E.edit(start(), { op: 'split', at: 3 }).state;
    expect(E.edit(parted, { op: 'split', at: 3 })).toEqual({ ok: false, error: 'not_splittable' });
    expect(E.edit(start(), { op: 'split', at: 9 })).toEqual({ ok: false, error: 'not_splittable' });
  });
});

describe('undo', () => {
  it('with nothing to undo is refused', () => {
    expect(E.edit(start(), { op: 'undo' })).toEqual({ ok: false, error: 'nothing_to_undo' });
  });
  it('an unknown op is refused', () => {
    expect(E.edit(start(), { op: 'delete', at: 0 })).toEqual({ ok: false, error: 'bad_op' });
  });
});

describe('checkOutline — the server\'s check on an outline sent back', () => {
  const ids = (ds) => ds.flatMap((d) => d.lesson_ids);
  const unit = days();
  it('accepts the built outline and any edit of it', () => {
    expect(E.checkOutline(unit, unit)).toEqual({ ok: true });
    const edited = E.edit(E.edit(start(), { op: 'join', at: 0 }).state, { op: 'split', at: 4 }).state.days;
    expect(E.checkOutline(edited, unit)).toEqual({ ok: true });
  });
  it('refuses a day from outside the unit, a dropped book day, a 3-day join, a moved test day, an unknown kind', () => {
    const foreign = unit.map((d, i) => (i === 0 ? { ...d, lesson_ids: ['grade_4_math_ch1_seg1'] } : d));
    expect(E.checkOutline(foreign, unit).ok).toBe(false);
    expect(E.checkOutline(unit.slice(1), unit).ok).toBe(false);
    const three = [{ ...unit[0], lesson_ids: ids(unit.slice(0, 3)) }, ...unit.slice(3)];
    expect(E.checkOutline(three, unit).ok).toBe(false);
    const swapped = [...unit];
    [swapped[10], swapped[11]] = [swapped[11], swapped[10]];
    expect(E.checkOutline(swapped, unit).ok).toBe(false);
    expect(E.checkOutline([{ ...unit[0], kind: 'party' }, ...unit.slice(1)], unit).ok).toBe(false);
    expect(E.checkOutline('nope', unit).ok).toBe(false);
  });
});
