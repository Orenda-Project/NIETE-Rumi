'use strict';
/**
 * bd-snkn32.42 — the human check before an own plan is listed: a reviewer sees the plans the AI passed and no one has
 * decided yet (score, the checks below the standard), and approves or rejects each. Only an undecided, AI-passed, ready
 * plan can be decided; a rejection needs a reason; who decided is the reviewer's own id.
 */
const { createOwnApproval } = require('../../bot/shared/services/lp612-own-approval');

function fakeFrom(result) {
  const calls = { eq: [], is: [] };
  const q = {
    select: (c) => { calls.select = c; return q; },
    update: (f) => { calls.update = f; return q; },
    eq: (k, v) => { calls.eq.push([k, v]); return q; },
    is: (k, v) => { calls.is.push([k, v]); return q; },
    order: (k, o) => { calls.order = [k, o]; return q; },
    limit: (n) => { calls.limit = n; return Promise.resolve(result); },
    maybeSingle: () => Promise.resolve(result),
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  };
  return { calls, from: (t) => { calls.table = t; return q; } };
}
const make = (f, extra = {}) => createOwnApproval({ from: f.from, log: jest.fn(), now: () => 'NOW', ...extra });

test('the queue: AI-passed, ready, undecided plans, oldest first, with score and checks below 3, never her id', async () => {
  const f = fakeFrom({ data: [{
    id: 'o1', segment_id: null, lesson_id: 'L1', lang: 'en', review_score: 86.9, reviewed_at: 't',
    review_items: { '6B': 2, '2H': 2, '7B': 3, '2I': null, '0A': 4 }, user_id: 'u9',
  }], error: null });
  const out = await make(f).listQueue();
  expect(f.calls.table).toBe('niete_lp612_own_plans');
  expect(f.calls.select).not.toMatch(/user_id|answers/);
  expect(f.calls.eq).toEqual(expect.arrayContaining([['library_eligible', true], ['status', 'ready']]));
  expect(f.calls.is).toEqual([['library_decision', null]]);
  expect(f.calls.order).toEqual(['reviewed_at', { ascending: true }]);
  expect(f.calls.limit).toBe(50);
  expect(out).toEqual([{
    ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en', score: 86.9, reviewedAt: 't',
    below: [{ id: '2H', name: 'Higher-order thinking opportunities', rating: 2 }, { id: '6B', name: 'Inclusive and diverse representation', rating: 2 }],
    notAssessed: ['2I'],
  }]);
});

test('a queue read error is an empty queue', async () => {
  expect(await make(fakeFrom({ data: null, error: { message: 'x' } })).listQueue()).toEqual([]);
});

test('approve: stamps who and when, only on an undecided AI-passed ready row', async () => {
  const f = fakeFrom({ data: [{ id: 'o1' }], error: null });
  const out = await make(f).decide({ ownId: 'o1', reviewerId: 'r1', decision: 'approve' });
  expect(out).toEqual({ outcome: 'ok', decision: 'approved' });
  expect(f.calls.update).toEqual({
    library_decision: 'approved', library_decided_by: 'r1', library_decided_at: 'NOW', library_reject_reason: null, updated_at: 'NOW',
  });
  expect(f.calls.eq).toEqual(expect.arrayContaining([['id', 'o1'], ['library_eligible', true], ['status', 'ready']]));
  expect(f.calls.is).toEqual([['library_decision', null]]);
});

test('reject: needs a reason, which is kept (trimmed, at most 500 characters)', async () => {
  const f = fakeFrom({ data: [{ id: 'o1' }], error: null });
  expect(await make(f).decide({ ownId: 'o1', reviewerId: 'r1', decision: 'reject', reason: '  ' })).toEqual({ outcome: 'bad_request' });
  expect(f.calls.update).toBeUndefined();
  const out = await make(f).decide({ ownId: 'o1', reviewerId: 'r1', decision: 'reject', reason: ` ${'x'.repeat(600)} ` });
  expect(out).toEqual({ outcome: 'ok', decision: 'rejected' });
  expect(f.calls.update.library_decision).toBe('rejected');
  expect(f.calls.update.library_reject_reason).toBe('x'.repeat(500));
});

test.each([
  [{ reviewerId: 'r1', decision: 'approve' }],
  [{ ownId: 'o1', decision: 'approve' }],
  [{ ownId: 'o1', reviewerId: 'r1', decision: 'maybe' }],
])('bad input is bad_request, nothing written: %j', async (args) => {
  const f = fakeFrom({ data: [{ id: 'o1' }], error: null });
  expect(await make(f).decide(args)).toEqual({ outcome: 'bad_request' });
  expect(f.calls.update).toBeUndefined();
});

test('already decided, not passed or not found: not_found; a write error: error', async () => {
  expect(await make(fakeFrom({ data: [], error: null })).decide({ ownId: 'o1', reviewerId: 'r1', decision: 'approve' }))
    .toEqual({ outcome: 'not_found' });
  expect(await make(fakeFrom({ data: null, error: { message: 'x' } })).decide({ ownId: 'o1', reviewerId: 'r1', decision: 'approve' }))
    .toEqual({ outcome: 'error' });
});

test('the reviewer may open any AI-passed ready plan (decided or not) to read it; nothing else', async () => {
  const ok = fakeFrom({ data: { id: 'o1', r2_key: 'lp612/edits/a.pdf', status: 'ready', library_eligible: true }, error: null });
  expect(await make(ok).reviewKey('o1')).toBe('lp612/edits/a.pdf');
  expect(ok.calls.eq).toEqual([['id', 'o1']]);
  const no = (data) => make(fakeFrom({ data, error: null })).reviewKey('o1');
  expect(await no({ id: 'o1', r2_key: 'k', status: 'ready', library_eligible: false })).toBeNull();
  expect(await no({ id: 'o1', r2_key: 'k', status: 'authoring', library_eligible: true })).toBeNull();
  expect(await no({ id: 'o1', r2_key: null, status: 'ready', library_eligible: true })).toBeNull();
  expect(await no(null)).toBeNull();
  expect(await make(ok).reviewKey('')).toBeNull();
  expect(await make(fakeFrom({ data: null, error: { message: 'x' } })).reviewKey('o1')).toBeNull();
});
