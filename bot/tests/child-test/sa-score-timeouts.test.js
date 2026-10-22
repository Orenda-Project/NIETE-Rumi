'use strict';

/**
 * The scorer stopped for good after one call that never answered: sweepOnce sets `running`, and a model, STT, R2 or
 * database await that never settles kept it set, so every 20-s tick returned `skipped: 'running'` and logged nothing.
 * Now every outbound call has a bound (model and STT 60 s, R2 30 s; the tests shrink them through deps.limits), a
 * sweep has a 90-s deadline that clears `running` and logs the stage it reached, and a skipped tick is logged (at most
 * once a minute). A row whose call timed out is a retry, never a silent loss.
 */

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
const logger = require('../../shared/utils/logger');
const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000010';
const KEY = (t) => `child-test/sandbox/sch-1/${SID}/sa/${t}.webm`;
const never = () => new Promise(() => {});
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

function fakeDb(tables, { hang = null } = {}) {
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
        if (hang === name) return never().then(ok, bad);
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

const session = () => ({ id: SID, grade: 5, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T09:40:00Z' });
const mul = (over = {}) => ({
  id: 'row-mul', session_id: SID, block: 'ma.mul2i', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY('ma.mul2i'), audio_r2_keys: null, updated_at: '2026-10-22T09:41:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'dddddddd-0000-4000-8000-000000000010', time_used_ms: 9000 }],
  ...over,
});
const W3 = { tasks: [{ id: 'ma.mul2i', kind: 'oral', subtask: 'mental_multiplication', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
  items: [{ id: 'ma.mul2i.01', show: '3 × 4', target: 12, answer: 12 }, { id: 'ma.mul2i.02', show: '5 × 2', target: 10, answer: 10 }] }] };
const good = async () => ({ json: { found: true, items: [{ i: 1, heard: '12', v: 'c', conf: 0.9 }, { i: 2, heard: '10', v: 'c', conf: 0.9 }] }, cost: 0.001, seconds: 1 });
const deps = (db, over = {}) => ({
  supabase: db, stopRules: false, phoneBattery: (g, f, l) => (l === 'ur' ? W3 : null),
  clipOf: async () => ({ base64: 'AAAA', durationSec: 9 }), model: () => 'google/gemini-test', chatJSON: good,
  limits: { model: 60, stt: 60, r2: 60, sweep: 400 },
  ...over,
});
const NOW = new Date('2026-10-22T09:45:00Z');
const logged = (name) => [...logger.logToFile.mock.calls, ...logger.logError.mock.calls].filter((c) => c[0] === name);

describe('the SA scorer cannot be pinned by a call that never answers', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    score.__internals.resetBoot();
    jest.clearAllMocks();
  });
  afterEach(() => { process.env = { ...before }; });

  test('a model call that never settles is aborted: the row is a timeout retry, and the call got an abort signal', async () => {
    let signal = null;
    const r = mul();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const out = await score.sweepOnce({ now: NOW, deps: deps(db, { chatJSON: (a) => { signal = a.signal; return never(); } }) });
    expect(out).toMatchObject({ failed: 1, scored: 0 });
    expect(r.ai_reason).toBe('final:sa_retry:1');
    expect(signal && signal.aborted).toBe(true);
    expect(logged('child_test.sa_scored')[0][1]).toMatchObject({ ok: false, reason: 'timeout' });
  });

  test('scoreRow returns { ok:false, retry:true, reason:"timeout" } for a clip read (R2) or an STT call that never settles', async () => {
    const d = deps(null);
    const r2 = await score.scoreRow(mul(), session(), { ...d, clipOf: never });
    expect(r2).toMatchObject({ ok: false, retry: true, reason: 'timeout' });
    process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    const stt = await score.scoreRow(mul(), session(), { ...d, speechOf: never });
    expect(stt).toMatchObject({ ok: false, retry: true, reason: 'timeout' });
  });

  test('a database read that never settles: the sweep ends at its deadline, logs the stage, and the next tick runs', async () => {
    const hung = fakeDb({ child_test_blocks: [mul()], child_test_sessions: [session()] }, { hang: 'child_test_sessions' });
    const t0 = Date.now();
    const first = await score.sweepOnce({ now: NOW, deps: deps(hung, { limits: { model: 60, stt: 60, r2: 60, sweep: 120 } }) });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(first.timeout).toBe('session');
    expect(logged('child_test.sa_score.sweep_timeout')[0][1]).toMatchObject({ stage: 'session' });
    const r = mul();
    const next = await score.sweepOnce({ now: NOW, deps: deps(fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] })) });
    expect(next.skipped).toBeUndefined();
    expect(next.scored).toBe(1);
    expect(r.ai_status).toBe('scored');
  });

  test('a row claimed by a sweep that timed out is taken again once the claim is stale (never stuck under this process)', async () => {
    const r = mul();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const slow = deps(db, { chatJSON: never, limits: { model: 300, stt: 60, r2: 60, sweep: 100 } });
    const first = await score.sweepOnce({ now: NOW, deps: slow });
    expect(first.timeout).toBe('score');
    await wait(450); // the abandoned score settles (model timeout) after the sweep gave up: its write must not land
    expect(r.ai_reason).toMatch(/^final:sa_scoring:/);
    const later = new Date(NOW.getTime() + 3 * 60 * 1000);
    r.updated_at = NOW.toISOString();
    const out = await score.sweepOnce({ now: later, deps: deps(db) });
    expect(out.scored).toBe(1);
    expect(r).toMatchObject({ ai_status: 'scored', ai_reason: null });
  });

  test('a tick skipped because a sweep is running is logged, at most once a minute', async () => {
    const hung = fakeDb({ child_test_blocks: [mul()], child_test_sessions: [session()] }, { hang: 'child_test_sessions' });
    const p = score.sweepOnce({ now: NOW, deps: deps(hung, { limits: { model: 60, stt: 60, r2: 60, sweep: 200 } }) });
    await wait(20);
    for (let i = 0; i < 3; i += 1) expect(await score.sweepOnce({ now: NOW, deps: deps(hung) })).toMatchObject({ skipped: 'running' });
    expect(logged('child_test.sa_score.sweep_skipped')).toHaveLength(1);
    expect(logged('child_test.sa_score.sweep_skipped')[0][1]).toMatchObject({ reason: 'running' });
    await p;
  });
});

describe('the outbound calls take an abort signal', () => {
  test('chatJSON hands its signal to the client (an aborted call is not retried)', async () => {
    jest.resetModules();
    const create = jest.fn((params, options) => new Promise((ok, bad) => { options.signal.addEventListener('abort', () => bad(new Error('aborted'))); }));
    jest.doMock('../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create } } }) }));
    const { chatJSON } = require('../../shared/services/child-test/scoring/llm');
    const r = await chatJSON({ model: 'm', prompt: 'p', job: 'j', signal: AbortSignal.timeout(30) });
    expect(r.json).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].signal).toBeDefined();
  });

  test('stt.transcribe rejects with a timeout when its signal aborts', async () => {
    jest.resetModules();
    jest.doMock('../../shared/services/audio.service', () => ({ transcribe: () => new Promise(() => {}) }));
    const stt = require('../../shared/services/child-test/scoring/stt');
    await expect(stt.transcribe('/nope.mp3', 'ur', 3, { signal: AbortSignal.timeout(30) })).rejects.toMatchObject({ reason: 'timeout' });
  });
});
