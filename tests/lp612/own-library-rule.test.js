'use strict';
/**
 * bd-snkn32.46 — who puts an own plan on the shelf is a switch (app_settings lp_own_library_rule):
 *   'ai' (the default, and any unreadable or unknown value): the AI reviewer's pass is enough; a person can still
 *        Reject on the check page, and a rejected plan comes off the shelf.
 *   'ai_and_person': as bd-snkn32.42 built it, the AI passed it AND a person approved it.
 */
const { createOwnLibrary, libraryRule } = require('../../bot/shared/services/lp612-own-library');

function fakeFrom(result) {
  const calls = { eq: [], or: [] };
  const q = {
    select: () => q,
    eq: (k, v) => { calls.eq.push([k, v]); return q; },
    or: (s) => { calls.or.push(s); return q; },
    order: () => q,
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  return { calls, from: () => q };
}
const lib = (f, rule) => createOwnLibrary({ from: f.from, log: jest.fn(), ...(rule ? { rule: async () => rule } : {}) });
const NOT_REJECTED = 'library_decision.is.null,library_decision.neq.rejected';

test.each([[undefined, 'ai'], [null, 'ai'], ['ai', 'ai'], ['ai_and_person', 'ai_and_person'], ['nonsense', 'ai'], [5, 'ai']])(
  'the setting %p reads as %p', (v, want) => expect(libraryRule(v)).toBe(want),
);

test('by default (no rule given) the shelf lists AI-passed ready plans that nobody rejected', async () => {
  const f = fakeFrom({ data: [], error: null });
  await lib(f).listShelf({ keys: ['seg-7'] });
  expect(f.calls.eq).toEqual(expect.arrayContaining([['library_eligible', true], ['status', 'ready']]));
  expect(f.calls.eq).not.toEqual(expect.arrayContaining([['library_decision', 'approved']]));
  expect(f.calls.or).toEqual(expect.arrayContaining([NOT_REJECTED]));
});

test("under 'ai' the library list drops rejected plans, and needs no approval", async () => {
  const f = fakeFrom({ data: [], error: null });
  await lib(f, 'ai').listLibraryOwnPlans();
  expect(f.calls.or).toEqual([NOT_REJECTED]);
  expect(f.calls.eq).not.toEqual(expect.arrayContaining([['library_decision', 'approved']]));
});

test("under 'ai_and_person' a person's approval is still required", async () => {
  const f = fakeFrom({ data: [], error: null });
  await lib(f, 'ai_and_person').listShelf({ keys: ['seg-7'] });
  expect(f.calls.eq).toEqual(expect.arrayContaining([['library_decision', 'approved']]));
  expect(f.calls.or).not.toContain(NOT_REJECTED);
});

const ROW = {
  id: 'o1', segment_id: 'seg-7', lesson_id: null, status: 'ready', r2_key: 'k.pdf', error_code: null, lang: 'en',
  library_eligible: true, library_decision: null,
};
test.each([
  ['ai', {}, true],
  ['ai', { library_decision: 'approved' }, true],
  ['ai', { library_decision: 'rejected' }, false],
  ['ai', { library_eligible: false }, false],
  ['ai', { status: 'authoring' }, false],
  ['ai_and_person', {}, false],
  ['ai_and_person', { library_decision: 'approved' }, true],
])("rule %s, row %p: opens = %p", async (rule, patch, opens) => {
  const out = await lib(fakeFrom({ data: { ...ROW, ...patch }, error: null }), rule).shelfStatus('o1');
  expect(Boolean(out)).toBe(opens);
});

test('a rule read that throws falls back to the AI rule, never a throw', async () => {
  const f = fakeFrom({ data: ROW, error: null });
  const l = createOwnLibrary({ from: f.from, log: jest.fn(), rule: async () => { throw new Error('down'); } });
  expect(await l.shelfStatus('o1')).not.toBeNull();
});
