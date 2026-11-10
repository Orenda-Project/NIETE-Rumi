'use strict';
/**
 * "Your plans for this chapter": her own plans for the chapter's lessons, so she can open one again and change it.
 * One entry per plan she made (the root row); it opens the newest READY round, says how many changes are left, and
 * never lists a failed plan or another teacher's.
 */
const { summarise, listMine, cleanKeys } = require('../../bot/shared/services/lp-own-mine');

const root = (id, over = {}) => ({ id, parent_own_id: null, edit_round: 0, status: 'ready', segment_id: 'seg1', lesson_id: null, created_at: '2026-11-10T08:00:00Z', ...over });
const round = (id, parent, n, status = 'ready') => ({ id, parent_own_id: parent, edit_round: n, status, segment_id: 'seg1', lesson_id: null, created_at: `2026-11-10T09:0${n}:00Z` });

describe('summarise', () => {
  test('a plan with no changes opens itself, two changes left, 6-12 band', () => {
    expect(summarise([root('a')], [])).toEqual([
      { ownId: 'a', rootId: 'a', lesson: 'seg1', band: 'g612', status: 'ready', changesLeft: 2, round: 0, createdAt: '2026-11-10T08:00:00Z' },
    ]);
  });

  test('opens the newest ready round; a round still being written is not opened but counts', () => {
    const out = summarise([root('a')], [round('b', 'a', 1), round('c', 'a', 2, 'authoring')]);
    expect(out[0]).toEqual(expect.objectContaining({ ownId: 'b', round: 1, changesLeft: 0 }));
  });

  test('a failed round never counts against her', () => {
    const out = summarise([root('a')], [round('b', 'a', 1, 'failed')]);
    expect(out[0]).toEqual(expect.objectContaining({ ownId: 'a', changesLeft: 2 }));
  });

  test('a 1-5 plan is keyed by its day and is band k5', () => {
    const out = summarise([root('a', { segment_id: null, lesson_id: 'grade_3_urdu_ch4_seg2' })], []);
    expect(out[0]).toEqual(expect.objectContaining({ lesson: 'grade_3_urdu_ch4_seg2', band: 'k5' }));
  });

  test('failed plans are left out; newest first; another root\'s rounds stay with their root', () => {
    const out = summarise(
      [root('old', { created_at: '2026-11-09T08:00:00Z' }), root('new'), root('bad', { status: 'failed' })],
      [round('x', 'old', 1)],
    );
    expect(out.map((p) => [p.rootId, p.ownId])).toEqual([['new', 'new'], ['old', 'x']]);
  });
});

describe('cleanKeys', () => {
  test('keeps lesson ids, drops anything that could break the query, caps the list', () => {
    expect(cleanKeys('seg1,grade_3_urdu_ch4_seg2, ,a),b')).toEqual(['seg1', 'grade_3_urdu_ch4_seg2', 'b']);
    expect(cleanKeys(Array.from({ length: 80 }, (_, i) => `k${i}`).join(','))).toHaveLength(60);
    expect(cleanKeys(undefined)).toEqual([]);
  });
});

describe('listMine', () => {
  function fakeDb(roots, children) {
    const calls = [];
    const q = (rows) => {
      const b = { filters: [] };
      ['select', 'eq', 'is', 'neq', 'or', 'in', 'order', 'limit'].forEach((m) => { b[m] = (...a) => { b.filters.push([m, ...a]); return b; }; });
      b.then = (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
      calls.push(b);
      return b;
    };
    let n = 0;
    return { calls, from: (t) => { expect(t).toBe('niete_lp612_own_plans'); n += 1; return q(n === 1 ? roots : children); } };
  }

  test('reads only HER roots for these lessons, then their rounds', async () => {
    const db = fakeDb([root('a')], [round('b', 'a', 1)]);
    const out = await listMine(db, { userId: 'u1', keys: ['seg1', 'seg2'] });
    expect(out[0]).toEqual(expect.objectContaining({ ownId: 'b', changesLeft: 1 }));
    const [r, c] = db.calls.map((b) => b.filters);
    expect(r).toEqual(expect.arrayContaining([['eq', 'user_id', 'u1'], ['is', 'parent_own_id', null], ['or', 'segment_id.in.(seg1,seg2),lesson_id.in.(seg1,seg2)']]));
    expect(c).toEqual(expect.arrayContaining([['eq', 'user_id', 'u1'], ['in', 'parent_own_id', ['a']]]));
  });

  test('no user or no lessons: nothing read, nothing listed', async () => {
    const db = fakeDb([], []);
    expect(await listMine(db, { userId: '', keys: ['seg1'] })).toEqual([]);
    expect(await listMine(db, { userId: 'u1', keys: [] })).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  test('no plans: one read only', async () => {
    const db = fakeDb([], []);
    expect(await listMine(db, { userId: 'u1', keys: ['seg1'] })).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });
});
