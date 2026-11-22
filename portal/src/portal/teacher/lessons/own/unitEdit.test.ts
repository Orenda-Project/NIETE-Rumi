import { describe, expect, it } from 'vitest';
import { canEdit, edit, startEditing, type UnitDay } from './unitEdit';

/** bd-snkn32.59.1 — her changes to a unit's days on the phone: the same rules the server checks (lp-own-unit-edit.js). */
const L = (id: string, chapter = 2): UnitDay => ({ kind: 'lesson', chapter, lesson_ids: [id], topic: id });
const days: UnitDay[] = [L('a'), L('b'), L('c'), { kind: 'review', chapter: 2, lesson_ids: ['r'], topic: 'Review' }, { kind: 'test', chapter: 2, lesson_ids: ['t'], topic: 'Test' }];

const ok = (r: ReturnType<typeof edit>) => {
  if ('error' in r) throw new Error(r.error);
  return r.state;
};

describe('unit outline edits', () => {
  it('moves a day down and undoes it', () => {
    const s = ok(edit(startEditing(days), { op: 'move', at: 0, dir: 1 }));
    expect(s.days.map((d) => d.lesson_ids[0])).toEqual(['b', 'a', 'c', 'r', 't']);
    expect(ok(edit(s, { op: 'undo' })).days).toEqual(days);
  });

  it('never moves across the test day', () => {
    expect(edit(startEditing(days), { op: 'move', at: 3, dir: 1 })).toEqual({ ok: false, error: 'test_day_fixed' });
  });

  it('joins two lesson days into one, at most two book days', () => {
    const s = ok(edit(startEditing(days), { op: 'join', at: 0 }));
    expect(s.days[0]).toMatchObject({ lesson_ids: ['a', 'b'], topic: 'a + b' });
    expect(s.days).toHaveLength(4);
    expect(edit(s, { op: 'join', at: 0 })).toEqual({ ok: false, error: 'too_big' });
  });

  it('never joins a review day', () => {
    expect(edit(startEditing(days), { op: 'join', at: 2 })).toEqual({ ok: false, error: 'not_joinable' });
  });

  it('splits a day in two parts, and a joined day back into its two days', () => {
    const s = ok(edit(startEditing(days), { op: 'split', at: 1 }));
    expect(s.days.slice(1, 3)).toEqual([{ ...L('b'), part: 1 }, { ...L('b'), part: 2 }]);
    expect(ok(edit(s, { op: 'join', at: 1 })).days).toEqual(days);
    const j = ok(edit(startEditing(days), { op: 'join', at: 0 }));
    expect(ok(edit(j, { op: 'split', at: 0 })).days.slice(0, 2)).toEqual([L('a'), L('b')]);
  });

  it('says which changes a day allows', () => {
    const s = startEditing(days);
    expect(canEdit(s.days, 0)).toEqual({ up: false, down: true, join: true, split: true });
    expect(canEdit(s.days, 3)).toEqual({ up: true, down: false, join: false, split: false });
    expect(canEdit(s.days, 4)).toEqual({ up: false, down: false, join: false, split: false });
  });

  it('has nothing to undo at the start', () => {
    expect(edit(startEditing(days), { op: 'undo' })).toEqual({ ok: false, error: 'nothing_to_undo' });
  });
});
