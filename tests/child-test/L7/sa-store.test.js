/**
 * A self-administered battery on the child-test rows: one child_test_blocks row per subtask holding the
 * phone's evidence and marks; the session holding the device's sync state. Pinned here:
 *   - a phone-scored subtask is written once with its marks; a re-sent result changes nothing
 *   - a recording nobody asked to score is parked as a final failure, so the sweep never scores (or pays for) it
 *   - per-item recordings collect in audio_r2_keys; a marked row is frozen
 *   - the session keeps the device's first start, the highest seq, and its block once fixed
 *   - a failed write is { ok: false }, never a throw
 */

let db;
let fail;
let calls;

function table(name) {
  const filters = [];
  const match = (r) => filters.every(([c, v]) => r[c] === v);
  const c = {
    select: () => c,
    eq: (col, v) => { filters.push([col, v]); return c; },
    limit: () => Promise.resolve(fail ? { data: null, error: fail } : { data: db[name].filter(match).map((r) => ({ ...r })), error: null }),
    then: (resolve) => resolve(fail ? { data: null, error: fail } : { data: db[name].filter(match).map((r) => ({ ...r })), error: null }),
    insert: (row) => {
      calls.push({ name, op: 'insert', row });
      const r = { id: `b${db[name].length + 1}`, ai_marks: null, audio_r2_key: null, audio_r2_keys: null, responses: null, ...row };
      if (!fail) db[name].push(r);
      return { select: () => Promise.resolve(fail ? { data: null, error: fail } : { data: [{ ...r }], error: null }) };
    },
    update: (patch) => ({
      eq: (col, v) => {
        calls.push({ name, op: 'update', patch, where: [col, v] });
        if (!fail) db[name].filter((r) => r[col] === v).forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ error: fail });
      },
    }),
  };
  return c;
}

let Store;
beforeEach(() => {
  jest.resetModules();
  fail = null;
  calls = [];
  db = {
    child_test_sessions: [{ id: 's1', admin_mode: null, device: null, client_started_at: null, client_finished_at: null }],
    child_test_blocks: [],
  };
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: (t) => table(t) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logError: jest.fn(), logToFile: jest.fn() }));
  Store = require('../../../bot/shared/services/child-test/sa-store');
});

const blockOf = (b) => db.child_test_blocks.find((r) => r.block === b);

describe('putResults', () => {
  test('a phone-scored subtask: its evidence and its marks, once', async () => {
    const r = { task_id: 'ur.letters', scored_on: 'phone', correct: 12, attempted: 20, per_minute: 12, stop_reason: 'time_up', answers: [{ i: 0, ok: true }] };
    expect(await Store.putResults('s1', [r], 'ur')).toEqual({ ok: true });
    const row = blockOf('ur.letters');
    expect(row.responses).toEqual([
      { kind: 'result', task_id: 'ur.letters', scored_on: 'phone', correct: 12, attempted: 20, per_minute: 12, stop_reason: 'time_up' },
      { kind: 'answer', i: 0, ok: true },
    ]);
    expect(row).toEqual(expect.objectContaining({
      lang: 'ur', ai_status: 'scored', ai_model_versions: { scorer: 'sa-tap-v1' },
      ai_marks: { scorer: 'sa-tap-v1', attempted: 20, correct: 12, per_minute: 12, stop_reason: 'time_up' },
    }));
    const before = calls.length;
    await Store.putResults('s1', [{ ...r, correct: 99 }], 'ur');
    expect(calls.slice(before).filter((c) => c.op === 'update')).toEqual([]);
    expect(blockOf('ur.letters').ai_marks.correct).toBe(12);
  });

  test('a subtask scored later keeps its evidence and no marks', async () => {
    await Store.putResults('s1', [{ task_id: 'ur.story', scored_on: 'later', last_word_index: 12, answers: [] }], null);
    expect(blockOf('ur.story')).toEqual(expect.objectContaining({ ai_marks: null, ai_status: 'pending', responses: [{ kind: 'result', task_id: 'ur.story', scored_on: 'later', last_word_index: 12 }] }));
  });
});

describe('setAudio', () => {
  test('parked as a final failure unless scoring is asked for', async () => {
    await Store.setAudio('s1', 'ur.story', null, 'k1');
    expect(blockOf('ur.story')).toEqual(expect.objectContaining({ audio_r2_key: 'k1', ai_status: 'failed', ai_reason: 'final:sa_score_later' }));
    await Store.setAudio('s1', 'ur.story', null, 'k1', { scoreLater: true });
    expect(blockOf('ur.story')).toEqual(expect.objectContaining({ ai_status: 'pending', ai_reason: null }));
  });

  test('spoken answers collect per item, a re-sent one replaced', async () => {
    await Store.setAudio('s1', 'ur.story_comp', 'q1', 'a');
    await Store.setAudio('s1', 'ur.story_comp', 'q2', 'b');
    await Store.setAudio('s1', 'ur.story_comp', 'q1', 'c');
    expect(blockOf('ur.story_comp').audio_r2_keys).toEqual([{ i: 'q2', key: 'b' }, { i: 'q1', key: 'c' }]);
  });

  test('a marked row is frozen', async () => {
    await Store.putResults('s1', [{ task_id: 'ur.letters', scored_on: 'phone', correct: 1 }], 'ur');
    expect(await Store.setAudio('s1', 'ur.letters', null, 'k')).toEqual({ ok: false, reason: 'frozen' });
  });
});

describe('markSynced and summary', () => {
  test('first device start kept, the highest seq, the block once fixed, coach_present', async () => {
    await Store.markSynced('s1', { lastSeq: 5, clientStartedAt: 'T1', device: { ua: 'x', name: 'never stored' }, block: 'B2' });
    await Store.markSynced('s1', { lastSeq: 3, clientStartedAt: 'T2', clientFinishedAt: 'T9', block: 'B4' });
    expect(db.child_test_sessions[0]).toEqual(expect.objectContaining({
      admin_mode: 'coach_present', client_started_at: 'T1', client_finished_at: 'T9', device: { ua: 'x', last_seq: 5, block: 'B2' },
    }));
  });

  test('summary: seq, block, the subtasks with evidence and with recordings', async () => {
    await Store.markSynced('s1', { lastSeq: 7, block: 'B1' });
    await Store.putResults('s1', [{ task_id: 'ur.letters', scored_on: 'phone', correct: 1 }], 'ur');
    await Store.setAudio('s1', 'ur.story', null, 'k');
    expect(await Store.summary('s1')).toEqual({ ok: true, lastSeq: 7, block: 'B1', tasksDone: ['ur.letters'], audio: ['ur.story'] });
  });

  test('no such session', async () => {
    expect(await Store.markSynced('nope', {})).toEqual({ ok: false, reason: 'no_session' });
  });
});

test('a failed write is ok:false', async () => {
  fail = { message: 'nope' };
  expect(await Store.putResults('s1', [{ task_id: 'x.y', scored_on: 'phone' }])).toEqual({ ok: false, error: 'nope' });
  expect(await Store.setAudio('s1', 'x.y', null, 'k')).toEqual({ ok: false, error: 'nope' });
  expect(await Store.markSynced('s1', {})).toEqual({ ok: false, error: 'nope' });
  expect((await Store.summary('s1')).ok).toBe(false);
});
