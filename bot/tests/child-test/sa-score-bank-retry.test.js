'use strict';

/**
 * A row recorded on a newer build than the scorer's (a G1/G2/G4 task when the scorer still ran a G3/G5-only bank)
 * failed for good, `final:sa_score_failed:task_not_in_bank`, and needed a hand re-queue once the scorer caught up.
 * Now it waits and tries again with a growing backoff (1, 2, 4 … min, at most an hour apart), and fails for good only
 * after 24 h of waiting. So a build skew heals itself as soon as the scorer serves the newer bank.
 */

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000020';
const KEY = `child-test/sandbox/sch-1/${SID}/sa/ma.mul2i.webm`;

function fakeDb(tables) {
  function query(name) {
    const f = []; let patch = null; let lim = null;
    const q = {
      select() { return q; }, order() { return q; },
      limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
      like(c, v) { const p = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(p)); return q; },
      gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
      update(p) { patch = p; return q; },
      then(ok, bad) {
        const hit = tables[name].filter((r) => f.every((fn) => fn(r)));
        if (patch) { hit.forEach((r) => { Object.assign(r, patch); }); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
        const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
        return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
      },
    };
    return q;
  }
  return { from: query };
}

const session = () => ({ id: SID, grade: 2, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T09:00:00Z' });
const mul = (over = {}) => ({
  id: 'row-mul', session_id: SID, block: 'ma.mul2i', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY, audio_r2_keys: null, updated_at: '2026-10-22T09:01:00.000Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'dddddddd-0000-4000-8000-000000000020', time_used_ms: 9000 }],
  ...over,
});
const W3 = { tasks: [{ id: 'ma.mul2i', kind: 'oral', subtask: 'mental_multiplication', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
  items: [{ id: 'ma.mul2i.01', show: '3 × 4', target: 12, answer: 12 }, { id: 'ma.mul2i.02', show: '5 × 2', target: 10, answer: 10 }] }] };
const base = { stopRules: false, bank: { forms: {}, tasks: {} }, clipOf: async () => ({ base64: 'AAAA', durationSec: 9 }), model: () => 'google/gemini-test',
  chatJSON: async () => ({ json: { found: true, items: [{ i: 1, heard: '12', v: 'c', conf: 0.9 }, { i: 2, heard: '10', v: 'c', conf: 0.9 }] }, cost: 0.001, seconds: 1 }) };
const oldBuild = (db) => ({ ...base, supabase: db, phoneBattery: () => null });   // the scorer has no form for this grade
const newBuild = (db) => ({ ...base, supabase: db, phoneBattery: (g, f, l) => (l === 'ur' ? W3 : null) });
const at = (iso, min) => new Date(Date.parse(iso) + min * 60 * 1000);

describe('task_not_in_bank is a retry with backoff, not a final failure', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  test('scoreRow: a task the scorer does not know is retryable', async () => {
    const got = await score.scoreRow(mul(), session(), oldBuild(null));
    expect(got).toMatchObject({ ok: false, reason: 'task_not_in_bank', retry: true });
  });

  test('the row waits (1 min, then 2 min …), is not retaken early, and scores once the scorer has the bank', async () => {
    const r = mul();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const t0 = '2026-10-22T09:02:00.000Z';
    await score.sweepOnce({ now: new Date(t0), deps: oldBuild(db) });
    expect(r.ai_reason).toBe('final:sa_wait_bank:1');
    expect(r.ai_marks).toBeNull();
    // 30 s later: still backing off, not even claimed
    r.updated_at = t0;
    expect(await score.sweepOnce({ now: at(t0, 0.5), deps: oldBuild(db) })).toMatchObject({ found: 0 });
    // after the first backoff: tried again, still unknown → the second wait
    await score.sweepOnce({ now: at(t0, 1.1), deps: oldBuild(db) });
    expect(r.ai_reason).toBe('final:sa_wait_bank:2');
    // the scorer is now the newer build: the row scores
    r.updated_at = t0;
    const out = await score.sweepOnce({ now: at(t0, 3), deps: newBuild(db) });
    expect(out.scored).toBe(1);
    expect(r).toMatchObject({ ai_status: 'scored', ai_reason: null });
    expect(r.ai_marks).toMatchObject({ task: 'ma.mul2i', correct: 2 });
  });

  test('the backoff grows to at most an hour, and the row fails for good after 24 h of waiting', () => {
    const { bankBackoffMs, finishPatch } = score.__internals;
    expect([1, 2, 3, 4, 7, 8, 30].map((n) => bankBackoffMs(n) / 60000)).toEqual([1, 2, 4, 8, 60, 60, 60]);
    const bank = { ok: false, reason: 'task_not_in_bank', retry: true };
    expect(finishPatch({ ai_reason: 'final:sa_wait_bank:5' }, bank).ai_reason).toBe('final:sa_wait_bank:6');
    let n = 1; let waited = 0;
    while (waited < 24 * 3600 * 1000) { waited += bankBackoffMs(n); n += 1; }
    expect(finishPatch({ ai_reason: `final:sa_wait_bank:${n - 2}` }, bank).ai_reason).toMatch(/^final:sa_wait_bank:/);
    expect(finishPatch({ ai_reason: `final:sa_wait_bank:${n - 1}` }, bank).ai_reason).toBe('final:sa_score_failed:task_not_in_bank');
  });

  test('other failures keep their rule: three attempts, no backoff', () => {
    const { finishPatch } = score.__internals;
    const model = { ok: false, reason: 'model_failed', retry: true };
    expect(finishPatch({ ai_reason: 'final:sa_score_later' }, model).ai_reason).toBe('final:sa_retry:1');
    expect(finishPatch({ ai_reason: 'final:sa_retry:2' }, model).ai_reason).toBe('final:sa_score_failed:model_failed');
    expect(finishPatch({ ai_reason: 'final:sa_score_later' }, { ok: false, reason: 'no_scorer_for_kind', retry: false }).ai_reason).toBe('final:sa_score_failed:no_scorer_for_kind');
  });
});
