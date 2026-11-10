'use strict';
/**
 * bd-snkn32.5 — "My own plans" on Lesson Plans home: her own Make my own plans across every lesson, newest first, each
 * carrying where it lives (grade, subject, chapter, title) so the portal can open it with the edit options. A 6-12
 * plan is placed by its segment row; a 1-5 plan by the catalogue day. A plan whose lesson cannot be placed is left out.
 */
const { placeOf, listRecent } = require('../../bot/shared/services/lp-own-recent');

const plan = (over = {}) => ({ ownId: 'o1', rootId: 'o1', lesson: 'seg1', band: 'g612', status: 'ready', changesLeft: 2, round: 0, createdAt: 't', ...over });
const segs = { seg1: { segment_id: 'seg1', grade: 9, subject: 'Physics', chapter_key: 'c02', menu_title: 'Speed', subtopic_title: 'Speed and velocity' } };
const lessonById = (id) => (id === 'grade_3_math_ch4_seg2'
  ? { book: { grade: 3, subject_key: 'math' }, chapter: { number: 4 }, lesson: { topic: 'Fractions', section: 'Halves' } }
  : null);

describe('placeOf', () => {
  test('a 6-12 plan is placed by its segment', () => {
    expect(placeOf(plan(), { segs, lessonById })).toEqual(expect.objectContaining({ grade: 9, subject: 'Physics', chapter: 'c02', title: 'Speed and velocity' }));
  });
  test('a 1-5 plan is placed by its catalogue day', () => {
    expect(placeOf(plan({ lesson: 'grade_3_math_ch4_seg2', band: 'k5' }), { segs, lessonById }))
      .toEqual(expect.objectContaining({ grade: 3, subject: 'math', chapter: '4', title: 'Fractions' }));
  });
  test('an unknown lesson cannot be placed', () => {
    expect(placeOf(plan({ lesson: 'gone' }), { segs, lessonById })).toBeNull();
    expect(placeOf(plan({ lesson: 'nope', band: 'k5' }), { segs, lessonById })).toBeNull();
  });
});

describe('listRecent', () => {
  function fakeDb(tables) {
    const calls = [];
    const counts = {};
    return {
      calls,
      from: (t) => {
        counts[t] = (counts[t] || 0) + 1;
        const rows = typeof tables[t] === 'function' ? tables[t](counts[t]) : tables[t];
        const b = { table: t, filters: [] };
        ['select', 'eq', 'is', 'neq', 'or', 'in', 'order', 'limit'].forEach((m) => { b[m] = (...a) => { b.filters.push([m, ...a]); return b; }; });
        b.then = (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
        calls.push(b);
        return b;
      },
    };
  }
  const roots = [
    { id: 'a', parent_own_id: null, edit_round: 0, status: 'ready', segment_id: 'seg1', lesson_id: null, created_at: '2026-11-10T09:00:00Z' },
    { id: 'k', parent_own_id: null, edit_round: 0, status: 'ready', segment_id: null, lesson_id: 'grade_3_math_ch4_seg2', created_at: '2026-11-10T08:00:00Z' },
    { id: 'z', parent_own_id: null, edit_round: 0, status: 'ready', segment_id: 'gone', lesson_id: null, created_at: '2026-11-10T07:00:00Z' },
  ];

  test('her recent plans, each placed, the unplaceable left out', async () => {
    const db = fakeDb({ niete_lp612_own_plans: (n) => (n === 1 ? roots : [{ id: 'b', parent_own_id: 'a', edit_round: 1, status: 'ready', created_at: 'x' }]), niete_lp612_segments: [segs.seg1] });
    const out = await listRecent(db, { userId: 'u1' }, { lessonById });
    expect(out.map((p) => [p.rootId, p.ownId, p.grade, p.chapter])).toEqual([['a', 'b', 9, 'c02'], ['k', 'k', 3, '4']]);
    const [r] = db.calls;
    expect(r.filters).toEqual(expect.arrayContaining([['eq', 'user_id', 'u1'], ['is', 'parent_own_id', null], ['neq', 'status', 'failed'], ['limit', 20]]));
    const s = db.calls.find((c) => c.table === 'niete_lp612_segments');
    expect(s.filters).toEqual(expect.arrayContaining([['in', 'segment_id', ['seg1', 'gone']]]));
  });

  test('no user: nothing read', async () => {
    const db = fakeDb({});
    expect(await listRecent(db, { userId: '' }, { lessonById })).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  test('no plans: one read only', async () => {
    const db = fakeDb({ niete_lp612_own_plans: [] });
    expect(await listRecent(db, { userId: 'u1' }, { lessonById })).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });
});
