'use strict';
/**
 * bd-snkn32.42 — under the 'ai_and_person' rule, the library and the teacher shelf list an own plan only when the AI reviewer passed it AND a person
 * approved it. The shelf is one chapter's lessons; it and the open never carry her user id or her answers.
 */
const { createOwnLibrary, SOURCES } = require('../../bot/shared/services/lp612-own-library');
const PERSON = async () => 'ai_and_person'; // bd-snkn32.46: the person-approval rule, now a switch (default 'ai')

function fakeFrom(result) {
  const calls = { eq: [], is: [] };
  const q = {
    select: (c) => { calls.select = c; return q; },
    eq: (k, v) => { calls.eq.push([k, v]); return q; },
    is: (k, v) => { calls.is.push([k, v]); return q; },
    or: (s) => { calls.or = s; return q; },
    order: (k) => { calls.order = k; return q; },
    limit: (n) => { calls.limit = n; return Promise.resolve(result); },
    maybeSingle: () => Promise.resolve(result),
  };
  return { calls, from: (t) => { calls.table = t; return q; } };
}

test('the library lists only approved plans', async () => {
  const f = fakeFrom({ data: [{ id: 'o1', user_id: 'u', answers: {} }], error: null });
  const out = await createOwnLibrary({ from: f.from, log: jest.fn(), rule: PERSON }).listLibraryOwnPlans();
  expect(f.calls.eq).toEqual(expect.arrayContaining([['library_eligible', true], ['library_decision', 'approved'], ['status', 'ready']]));
  expect(out).toEqual([{ id: 'o1', source: 'teacher', tag: SOURCES.teacher }]);
});

test('the shelf asks for approved, passed, ready plans on these lessons only, never her id or answers', async () => {
  const rows = [
    { id: 'o1', segment_id: null, lesson_id: 'G4_eng_ch1_d1', lang: 'en', user_id: 'u9', answers: { note: 'x' } },
    { id: 'o2', segment_id: 'seg-7', lesson_id: null, lang: 'ur' },
  ];
  const f = fakeFrom({ data: rows, error: null });
  const out = await createOwnLibrary({ from: f.from, log: jest.fn(), rule: PERSON }).listShelf({ keys: ['G4_eng_ch1_d1', 'seg-7', 'bad key!'] });
  expect(f.calls.table).toBe('niete_lp612_own_plans');
  expect(f.calls.select).not.toMatch(/user_id|answers/);
  expect(f.calls.eq).toEqual(expect.arrayContaining([['library_eligible', true], ['library_decision', 'approved'], ['status', 'ready']]));
  expect(f.calls.or).toBe('segment_id.in.(G4_eng_ch1_d1,seg-7),lesson_id.in.(G4_eng_ch1_d1,seg-7)');
  expect(f.calls.limit).toBe(30);
  expect(out).toEqual([
    { ownId: 'o1', lesson: 'G4_eng_ch1_d1', band: 'k5', lang: 'en' },
    { ownId: 'o2', lesson: 'seg-7', band: 'g612', lang: 'ur' },
  ]);
  expect(JSON.stringify(out)).not.toMatch(/u9|note/);
});

test('no usable lesson: nothing, and nothing read', async () => {
  const f = fakeFrom({ data: [], error: null });
  const lib = createOwnLibrary({ from: f.from, log: jest.fn(), rule: PERSON });
  expect(await lib.listShelf({ keys: [] })).toEqual([]);
  expect(await lib.listShelf({ keys: ['a b'] })).toEqual([]);
  expect(f.calls.table).toBeUndefined();
});

test('a shelf read error is an empty shelf, never a throw', async () => {
  const log = jest.fn();
  const f = fakeFrom({ data: null, error: { message: 'x' } });
  expect(await createOwnLibrary({ from: f.from, log, rule: PERSON }).listShelf({ keys: ['s1'] })).toEqual([]);
  expect(log).toHaveBeenCalled();
});

const READY = {
  id: 'o1', user_id: 'u9', segment_id: null, lesson_id: 'L1', status: 'ready', r2_key: 'lp612/edits/x.pdf', error_code: null,
  lang: 'en', started_at: 't0', completed_at: 't1', library_eligible: true, library_decision: 'approved',
};

test('an approved plan opens for anyone, in the render row shape, without her id', async () => {
  const f = fakeFrom({ data: READY, error: null });
  const out = await createOwnLibrary({ from: f.from, log: jest.fn(), rule: PERSON }).shelfStatus('o1');
  expect(f.calls.eq).toEqual([['id', 'o1']]);
  expect(f.calls.select).not.toMatch(/user_id|answers/);
  expect(out).toEqual({
    id: 'o1', segment_id: 'L1', status: 'ready', r2_key: 'lp612/edits/x.pdf', one_screen: null, error_code: null,
    lang: 'en', started_at: 't0', completed_at: 't1',
  });
});

test.each([
  ['not approved', { library_decision: null }],
  ['rejected', { library_decision: 'rejected' }],
  ['no longer passed', { library_eligible: false }],
  ['not ready', { status: 'authoring' }],
])('%s: does not open', async (_n, patch) => {
  const f = fakeFrom({ data: { ...READY, ...patch }, error: null });
  expect(await createOwnLibrary({ from: f.from, log: jest.fn(), rule: PERSON }).shelfStatus('o1')).toBeNull();
});

test('no id, no row, or a read error: does not open', async () => {
  const lib = (r) => createOwnLibrary({ from: fakeFrom(r).from, log: jest.fn(), rule: PERSON });
  expect(await lib({ data: READY, error: null }).shelfStatus('')).toBeNull();
  expect(await lib({ data: null, error: null }).shelfStatus('o1')).toBeNull();
  expect(await lib({ data: null, error: { message: 'x' } }).shelfStatus('o1')).toBeNull();
});
