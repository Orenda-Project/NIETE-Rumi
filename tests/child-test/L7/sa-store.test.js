/**
 * The Learning assessment's rows: upserts on (session, seq) and (session, task), so a re-sent batch
 * changes nothing, and a failed write is { ok: false }, never a throw.
 */

let calls;
let fail;

function chain(table) {
  const c = {
    upsert: (rows, opts) => { calls.push({ table, op: 'upsert', rows, opts }); return Promise.resolve({ error: fail }); },
    select: () => c, eq: () => c, order: () => c,
    limit: () => Promise.resolve({ data: [{ seq: 7 }], error: fail }),
    then: (resolve) => resolve({
      data: [{ task_id: 'ur.letters', result: { correct: 3 }, audio_r2_key: 'k' }, { task_id: 'en.letters', result: {}, audio_r2_key: null }],
      error: null,
    }),
  };
  return c;
}

let Store;
beforeEach(() => {
  jest.resetModules();
  calls = [];
  fail = null;
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: (t) => chain(t) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logError: jest.fn(), logToFile: jest.fn() }));
  Store = require('../../../bot/shared/services/child-test/sa-store');
});

test('events upsert on (session_id, seq), keeping the first copy', async () => {
  expect(await Store.putEvents('s1', [{ seq: 0, type: 'tap' }])).toEqual({ ok: true });
  expect(calls[0]).toEqual({ table: 'child_test_sa_events', op: 'upsert', rows: [{ session_id: 's1', seq: 0, type: 'tap' }], opts: { onConflict: 'session_id,seq', ignoreDuplicates: true } });
});

test('results and audio upsert on (session_id, task_id)', async () => {
  await Store.putResults('s1', [{ task_id: 'ur.letters', result: { correct: 3 } }]);
  await Store.setResultAudio('s1', 'ur.letters', 'k');
  expect(calls.map((c) => [c.table, c.opts.onConflict])).toEqual([['child_test_sa_results', 'session_id,task_id'], ['child_test_sa_results', 'session_id,task_id']]);
  expect(calls[0].rows[0]).toEqual(expect.objectContaining({ session_id: 's1', task_id: 'ur.letters', result: { correct: 3 } }));
  expect(calls[1].rows).toEqual(expect.objectContaining({ audio_r2_key: 'k' }));
});

test('summary: the last seq, the tasks with a result, the tasks with a recording', async () => {
  expect(await Store.summary('s1')).toEqual({ ok: true, lastSeq: 7, tasksDone: ['ur.letters'], audio: ['ur.letters'] });
});

test('a failed write is ok:false', async () => {
  fail = { message: 'nope' };
  expect(await Store.putEvents('s1', [{ seq: 0, type: 'tap' }])).toEqual({ ok: false, error: 'nope' });
  expect(await Store.putResults('s1', [{ task_id: 'x.y', result: {} }])).toEqual({ ok: false, error: 'nope' });
  expect(await Store.setResultAudio('s1', 'x.y', 'k')).toEqual({ ok: false, error: 'nope' });
  expect((await Store.summary('s1')).ok).toBe(false);
});
