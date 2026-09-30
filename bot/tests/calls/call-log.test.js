/**
 * P3.1 (bd-1hae7.11) — the audit spine.
 *
 * "How do we see what the call actually pulled from the DB?" is the question
 * this answers. Every call writes: the row, both-side transcript, the EXACT
 * instructions it ran with, one trace row per tool invocation, and a cost
 * estimate that the budget ledger then sums.
 *
 * The rule throughout: **persistence never breaks a call.** Every writer here
 * swallows its errors and reports failure by return value. Losing an audit row
 * is bad; dropping a teacher mid-sentence because an INSERT failed is worse.
 */

const makeSupabase = () => {
  const calls = { insert: [], update: [], trace: [] };
  const api = {
    _calls: calls,
    from(table) { this._table = table; return this; },
    insert(row) {
      if (this._table === 'call_trace') calls.trace.push(row);
      else calls.insert.push({ table: this._table, row });
      return { error: api._insertError || null };
    },
    update(patch) { this._patch = patch; return this; },
    eq(col, val) {
      if (this._patch) {
        calls.update.push({ table: this._table, patch: this._patch, [col]: val });
        this._patch = null;
        return { error: api._updateError || null };
      }
      this._filter = { col, val };
      return this;
    },
    gte() { return this; },
    select() { return this; },
    then(resolve) { return resolve({ data: api._selectData || [], error: api._selectError || null }); },
  };
  return api;
};

let supabase;
let log;

beforeEach(() => {
  jest.resetModules();
  supabase = makeSupabase();
  jest.doMock('../../shared/config/supabase', () => supabase);
  log = require('../../shared/calls/call-log.service');
});

describe('call start', () => {
  test('writes the row with everything needed to reconstruct the call', async () => {
    await log.logCallStart({
      waCallId: 'CALL1', from: '923001234567', callerName: 'Ayesha', userId: 'u-1',
      model: 'gpt-realtime-2.1-mini', voice: 'marin',
      contextSnapshot: { instructions: 'SYSTEM…', blocks: { identity: true } },
    });

    const { table, row } = supabase._calls.insert[0];
    expect(table).toBe('calls');
    expect(row.wa_call_id).toBe('CALL1');
    expect(row.caller_number).toBe('923001234567');
    expect(row.caller_name).toBe('Ayesha');
    expect(row.user_id).toBe('u-1');
    expect(row.model).toBe('gpt-realtime-2.1-mini');
    expect(row.context_snapshot.instructions).toBe('SYSTEM…');
    expect(row.started_at).toBeTruthy();
  });

  test('an unknown caller writes a row with a null user_id, not a crash', async () => {
    await log.logCallStart({ waCallId: 'C2', from: '92300', userId: null });
    expect(supabase._calls.insert[0].row.user_id).toBeNull();
  });

  test('an insert failure is reported but never thrown into the call', async () => {
    supabase._insertError = { message: 'permission denied' };
    await expect(log.logCallStart({ waCallId: 'C3', from: '92300' })).resolves.toBe(false);
  });
});

describe('call end', () => {
  test('closes the row with duration, status, transcript and a cost estimate', async () => {
    await log.logCallEnd({
      waCallId: 'CALL1', durationSeconds: 180, status: 'COMPLETED',
      model: 'gpt-realtime-2.1-mini',
      transcript: [{ role: 'caller', text: 'سلام', at: '2026-08-24T10:00:00Z' }],
    });

    const upd = supabase._calls.update[0];
    expect(upd.table).toBe('calls');
    expect(upd.wa_call_id).toBe('CALL1');
    expect(upd.patch.duration_seconds).toBe(180);
    expect(upd.patch.status).toBe('COMPLETED');
    expect(upd.patch.transcript).toHaveLength(1);
    expect(upd.patch.ended_at).toBeTruthy();
    expect(upd.patch.cost_estimate).toBeGreaterThan(0);
  });

  test('the cost estimate reflects the model that actually ran', async () => {
    await log.logCallEnd({ waCallId: 'A', durationSeconds: 300, model: 'gpt-realtime-2.1-mini' });
    await log.logCallEnd({ waCallId: 'B', durationSeconds: 300, model: 'gpt-realtime-2.1' });
    const [mini, full] = supabase._calls.update.map((u) => u.patch.cost_estimate);
    expect(full).toBeGreaterThan(mini * 2.5);
  });

  test('a call with no transcript still closes cleanly', async () => {
    await log.logCallEnd({ waCallId: 'C', durationSeconds: 5, status: 'FAILED' });
    expect(supabase._calls.update[0].patch.status).toBe('FAILED');
  });

  test('an update failure is reported, never thrown', async () => {
    supabase._updateError = { message: 'row missing' };
    await expect(log.logCallEnd({ waCallId: 'X', durationSeconds: 1 })).resolves.toBe(false);
  });
});

describe('transcript streaming', () => {
  test('each line rewrites the accumulated transcript, so a crash loses nothing', async () => {
    await log.recordTranscript({ waCallId: 'CALL1', transcript: [{ role: 'caller', text: 'a' }] });
    await log.recordTranscript({ waCallId: 'CALL1', transcript: [{ role: 'caller', text: 'a' }, { role: 'assistant', text: 'b' }] });
    expect(supabase._calls.update).toHaveLength(2);
    expect(supabase._calls.update[1].patch.transcript).toHaveLength(2);
  });

  test('a transcript write failure never surfaces to the call', async () => {
    supabase._updateError = { message: 'nope' };
    await expect(log.recordTranscript({ waCallId: 'C', transcript: [] })).resolves.toBe(false);
  });
});

describe('tool traces — "what did it pull from the DB?"', () => {
  test('writes one row per invocation, in sequence, with timing', async () => {
    await log.recordTrace({
      waCallId: 'CALL1', seq: 1, toolName: 'recall_niete',
      args: { query: 'my score' }, result: 'x'.repeat(50), latencyMs: 240,
    });
    const [row] = supabase._calls.trace;
    expect(row.wa_call_id).toBe('CALL1');
    expect(row.seq).toBe(1);
    expect(row.kind).toBe('tool');
    expect(row.tool_name).toBe('recall_niete');
    expect(row.args_json).toEqual({ query: 'my score' });
    expect(row.latency_ms).toBe(240);
    expect(row.result_bytes).toBe(50);
  });

  test('the result preview is capped so a huge payload cannot bloat the table', async () => {
    await log.recordTrace({ waCallId: 'C', seq: 1, toolName: 't', result: 'y'.repeat(50000) });
    const [row] = supabase._calls.trace;
    expect(row.result_preview.length).toBeLessThanOrEqual(1024);
    expect(row.result_bytes).toBe(50000);
  });

  test('safety flags ride the same table under kind=safety — no fifth table', async () => {
    await log.recordTrace({ waCallId: 'C', seq: 9, kind: 'safety', result: 'romantic:low' });
    expect(supabase._calls.trace[0].kind).toBe('safety');
  });

  test('a trace failure never throws into the live session', async () => {
    supabase._insertError = { message: 'denied' };
    await expect(log.recordTrace({ waCallId: 'C', seq: 1, toolName: 't' })).resolves.toBe(false);
  });

  test('a call with zero tool calls simply writes no trace rows', () => {
    expect(supabase._calls.trace).toHaveLength(0);
  });
});

describe('the ledger the governor reads', () => {
  test('weekly spend sums cost_estimate since the week boundary', async () => {
    supabase._selectData = [{ cost_estimate: 1.5 }, { cost_estimate: 2.25 }, { cost_estimate: null }];
    await expect(log.weeklySpendUsd(new Date('2026-08-23T19:00:00Z'))).resolves.toBeCloseTo(3.75);
  });

  test('an empty week is 0, not null', async () => {
    supabase._selectData = [];
    await expect(log.weeklySpendUsd(new Date())).resolves.toBe(0);
  });

  test('a query error propagates as null so the governor fails CLOSED', async () => {
    supabase._selectError = { message: 'db down' };
    await expect(log.weeklySpendUsd(new Date())).resolves.toBeNull();
  });

  test('callsToday counts this caller and returns a number', async () => {
    supabase._selectData = [{ id: 1 }, { id: 2 }];
    await expect(log.callsToday('92300')).resolves.toBe(2);
  });

  test('callsToday returns null on error so the governor fails CLOSED', async () => {
    supabase._selectError = { message: 'db down' };
    await expect(log.callsToday('92300')).resolves.toBeNull();
  });
});
