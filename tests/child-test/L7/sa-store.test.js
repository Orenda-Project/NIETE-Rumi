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
let noModeColumn;

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
        if (noModeColumn && 'response_mode' in patch) {
          return Promise.resolve({ error: { code: 'PGRST204', message: "Could not find the 'response_mode' column of 'child_test_blocks' in the schema cache" } });
        }
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
  noModeColumn = false;
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
  // RULING #9: a tap or keypad score is its own scale; never a v3 rate name on these rows
  test('a tap subtask: its evidence, the SA tap marks only, once', async () => {
    const r = { task_id: 'ur.letters', mode: 'tap', scored_on: 'phone', correct: 12, incorrect: 6, attempted: 18, options_n: 4, per_minute: 12, time_used_ms: 60000, stop_reason: 'time_up', clpm: 99, answers: [{ i: 0, ok: true }] };
    expect(await Store.putResults('s1', [r], 'ur')).toEqual({ ok: true });
    const row = blockOf('ur.letters');
    expect(row.responses).toEqual([
      { kind: 'result', task_id: 'ur.letters', mode: 'tap', scored_on: 'phone', correct: 12, incorrect: 6, attempted: 18, options_n: 4, per_minute: 12, time_used_ms: 60000, stop_reason: 'time_up', clpm: 99 },
      { kind: 'answer', i: 0, ok: true },
    ]);
    expect(row).toEqual(expect.objectContaining({
      lang: 'ur', response_mode: 'tap', ai_status: 'scored', ai_model_versions: { scorer: 'tap-v1' },
      ai_marks: { tap_correct: 12, tap_attempted: 18, options_n: 4, chance_corrected: 10, items_per_min: 12, stop_reason: 'time_up' },
    }));
    const before = calls.length;
    await Store.putResults('s1', [{ ...r, correct: 99 }], 'ur');
    expect(calls.slice(before).filter((c) => c.op === 'update')).toEqual([]);
    expect(blockOf('ur.letters').ai_marks.tap_correct).toBe(12);
  });

  test('a keypad subtask: keypad marks; chance correction never below zero', async () => {
    await Store.putResults('s1', [{ task_id: 'ma.add1', mode: 'keypad', scored_on: 'phone', correct: 5, attempted: 7, per_minute: 5, stop_reason: 'time_up' }], 'ur');
    expect(blockOf('ma.add1').ai_marks).toEqual({ keypad_correct: 5, keypad_attempted: 7, items_per_min: 5, stop_reason: 'time_up' });
    expect(blockOf('ma.add1').response_mode).toBe('keypad');
    await Store.putResults('s1', [{ task_id: 'en.letters', mode: 'tap', scored_on: 'phone', correct: 1, incorrect: 9, attempted: 10, options_n: 5, per_minute: null, stop_reason: 'first_line' }], 'en');
    expect(blockOf('en.letters').ai_marks).toEqual({ tap_correct: 1, tap_attempted: 10, options_n: 5, chance_corrected: 0, items_per_min: null, stop_reason: 'first_line' });
  });

  test('before V1.6.21 the row is still written, its mode kept in responses[0]', async () => {
    noModeColumn = true;
    expect(await Store.putResults('s1', [{ task_id: 'ur.story', mode: 'record', scored_on: 'later', answers: [] }], 'ur')).toEqual({ ok: true });
    expect(blockOf('ur.story').responses[0].mode).toBe('record');
    expect(blockOf('ur.story').response_mode).toBeUndefined();
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
    await Store.putResults('s1', [{ task_id: 'ur.letters', mode: 'tap', scored_on: 'phone', correct: 1 }], 'ur');
    expect(await Store.setAudio('s1', 'ur.letters', null, 'k')).toEqual({ ok: false, reason: 'frozen' });
  });
});

describe('markSynced and summary', () => {
  test('first device start kept, the highest seq, the block once fixed, coach_present', async () => {
    await Store.markSynced('s1', { lastSeq: 5, clientStartedAt: 'T1', device: { ua: 'x', mic_ok: true, mic_rms: 0.12, name: 'never stored' }, block: 'B2' });
    await Store.markSynced('s1', { lastSeq: 3, clientStartedAt: 'T2', clientFinishedAt: 'T9', block: 'B4' });
    expect(db.child_test_sessions[0]).toEqual(expect.objectContaining({
      admin_mode: 'coach_present', client_started_at: 'T1', client_finished_at: 'T9', device: { ua: 'x', mic_ok: true, mic_rms: 0.12, last_seq: 5, block: 'B2' },
    }));
  });

  test('summary: seq, block, the subtasks with evidence and with recordings', async () => {
    await Store.markSynced('s1', { lastSeq: 7, block: 'B1' });
    await Store.putResults('s1', [{ task_id: 'ur.letters', mode: 'tap', scored_on: 'phone', correct: 1 }], 'ur');
    await Store.setAudio('s1', 'ur.story', null, 'k');
    expect(await Store.summary('s1')).toEqual({ ok: true, lastSeq: 7, block: 'B1', tasksDone: ['ur.letters'], audio: ['ur.story'], audioWaiting: [] });
  });

  test('the phone readiness fields persisted and voice are kept on the device', async () => {
    await Store.markSynced('s1', { device: { persisted: true, voice: 'clips' } });
    await Store.markSynced('s1', { device: { ua: 'y' } });
    expect(db.child_test_sessions[0].device).toEqual(expect.objectContaining({ persisted: true, voice: 'clips', ua: 'y' }));
  });

  test('kept events: added once by seq, in seq order, capped at 200 with the oldest kept', async () => {
    const e = (seq) => ({ seq, type: 'visibility_lost', task_id: 'ur.story', at: 'T', data: null });
    await Store.markSynced('s1', { events: [e(3), e(1)] });
    await Store.markSynced('s1', { events: [e(1), e(2)] });
    expect(db.child_test_sessions[0].device.events.map((x) => x.seq)).toEqual([1, 2, 3]);
    await Store.markSynced('s1', { events: Array.from({ length: 250 }, (_, i) => e(10 + i)) });
    const kept = db.child_test_sessions[0].device.events;
    expect(kept).toHaveLength(200);
    expect(kept[0].seq).toBe(1);
    expect(kept[199].seq).toBe(206);
  });

  test('audioWaiting: a task the engine skipped, or a spoken task with nothing attempted, never records, so it is never waiting', async () => {
    await Store.putResults('s1', [
      { task_id: 'ur.story', mode: 'record', stop_reason: 'skipped_no_first_line' },
      { task_id: 'ur.story_comp', mode: 'oral', stop_reason: 'skipped_no_first_line', attempted: 0 },
      { task_id: 'en.listening', mode: 'oral', stop_reason: 'complete', attempted: 0 },
      { task_id: 'ur.listening', mode: 'oral', stop_reason: 'complete', attempted: 2 },
      { task_id: 'en.story', mode: 'record', stop_reason: 'early_stop_silence' },
      { task_id: 'en.story_comp', mode: 'oral', stop_reason: 'coach_end', attempted: 0 },
      { task_id: 'ur.story2', mode: 'record', stop_reason: 'coach_end', recorded: false },
    ], 'ur');
    expect((await Store.summary('s1')).audioWaiting).toEqual(['ur.listening', 'en.story']);
  });

  test('audioWaiting: a recorded or spoken subtask whose answers arrived but no recording yet; not one with no microphone or audio not kept', async () => {
    await Store.putResults('s1', [
      { task_id: 'ur.story', mode: 'record', correct: 0 },
      { task_id: 'en.listening', mode: 'oral', correct: 0 },
      { task_id: 'ur.letters', mode: 'tap', scored_on: 'phone', correct: 1 },
      { task_id: 'en.story', mode: 'record', stop_reason: 'mic_unavailable' },
      { task_id: 'ur.listening', mode: 'oral', audio: 'not_kept' },
    ], 'ur');
    expect((await Store.summary('s1')).audioWaiting).toEqual(['ur.story', 'en.listening']);
    await Store.setAudio('s1', 'ur.story', null, 'k');
    expect((await Store.summary('s1')).audioWaiting).toEqual(['en.listening']);
  });

  test('no such session', async () => {
    expect(await Store.markSynced('nope', {})).toEqual({ ok: false, reason: 'no_session' });
  });
});

test('a failed write is ok:false', async () => {
  fail = { message: 'nope' };
  expect(await Store.putResults('s1', [{ task_id: 'x.y', mode: 'tap', scored_on: 'phone' }])).toEqual({ ok: false, error: 'nope' });
  expect(await Store.setAudio('s1', 'x.y', null, 'k')).toEqual({ ok: false, error: 'nope' });
  expect(await Store.markSynced('s1', {})).toEqual({ ok: false, error: 'nope' });
  expect((await Store.summary('s1')).ok).toBe(false);
});

describe("the phone's own session id", () => {
  test('setClient keeps the id and a first block; findByClient answers the session', async () => {
    db.child_test_sessions[0].client_session_id = null;
    expect(await Store.setClient('s1', { clientSessionId: 'c1', block: 'B3' })).toEqual({ ok: true });
    await Store.setClient('s1', { block: 'B5' });
    expect(db.child_test_sessions[0]).toEqual(expect.objectContaining({ client_session_id: 'c1', device: { block: 'B3' } }));
    expect(await Store.findByClient('c1')).toEqual({ ok: true, sessionId: 's1' });
    expect(await Store.findByClient('c2')).toEqual({ ok: true, sessionId: null });
    expect(await Store.setClient('nope', {})).toEqual({ ok: false, reason: 'no_session' });
    fail = { message: 'nope' };
    expect(await Store.findByClient('c1')).toEqual({ ok: false, error: 'nope' });
  });
});
