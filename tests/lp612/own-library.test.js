'use strict';
/**
 * bd-snkn32.16 — the shared library: standard plans and teacher-made own plans side by side, each tagged. Only own
 * plans the reviewer passed (library_eligible) are listed, and never with the teacher's id.
 */
const { createOwnLibrary, tagLibrary, SOURCES } = require('../../bot/shared/services/lp612-own-library');

test('standard and teacher-made plans are listed together, each with its tag', () => {
  const out = tagLibrary([{ id: 'std-1' }], [{ id: 'own-1', review_score: 90 }]);
  expect(out).toEqual([
    { id: 'std-1', source: 'standard', tag: SOURCES.standard },
    { id: 'own-1', review_score: 90, source: 'teacher', tag: SOURCES.teacher },
  ]);
  expect(SOURCES.teacher.en).toBe('Made by a teacher');
  expect(SOURCES.teacher.ur).toBeTruthy();
  expect(tagLibrary(null, undefined)).toEqual([]);
});

test('the own-plan list asks only for ready, library-eligible rows and drops the teacher id', async () => {
  const calls = {};
  const rows = [{ id: 'own-1', user_id: 'u1', segment_id: 's1', review_score: 91 }];
  const q = {
    select: (c) => { calls.select = c; return q; },
    eq: (k, v) => { (calls.eq = calls.eq || []).push([k, v]); return q; },
    order: () => q,
    limit: (n) => { calls.limit = n; return Promise.resolve({ data: rows, error: null }); },
  };
  const lib = createOwnLibrary({ from: (t) => { calls.table = t; return q; }, log: jest.fn() });
  const out = await lib.listLibraryOwnPlans({ limit: 10 });
  expect(calls.table).toBe('niete_lp612_own_plans');
  expect(calls.eq).toEqual(expect.arrayContaining([['library_eligible', true], ['status', 'ready']]));
  expect(calls.select).not.toMatch(/user_id|answers/);
  expect(calls.limit).toBe(10);
  expect(out).toEqual([{ id: 'own-1', segment_id: 's1', review_score: 91, source: 'teacher', tag: SOURCES.teacher }]);
});

test('a read error is an empty list, never a throw', async () => {
  const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: null, error: { message: 'x' } }) };
  const log = jest.fn();
  const lib = createOwnLibrary({ from: () => q, log });
  await expect(lib.listLibraryOwnPlans()).resolves.toEqual([]);
  expect(log).toHaveBeenCalled();
});
