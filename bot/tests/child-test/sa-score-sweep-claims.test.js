'use strict';

/**
 * Many sweeps run at once in one bot process: every saRegister kicks a per-session sweep, and those skip the global
 * sweep's `running` guard. The claim token was one value for the whole process, and a sweep that passed its deadline
 * changed it. So one slow row (a single task has taken 120 s) turned every OTHER sweep's finished marks into a write
 * that matched nothing: those rows stayed claimed, were taken again 2 minutes later and paid for twice. And nothing
 * capped how many rows the process scored at once.
 *
 * Now:
 *  - each sweep claims with its own token and writes its marks against that token, so a sweep that times out gives up
 *    only its own rows (taken again once stale, as a dead process's are), never another sweep's;
 *  - a row a sweep of this process still holds is never taken by another sweep of this process, the boot rule included;
 *  - at most CHILD_TEST_SA_SCORE_MAX_INFLIGHT rows are being scored at once in the process; the rest stay parked.
 */

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
const score = require('../../shared/services/child-test/sa/score');

const SA = 'cccccccc-0000-4000-8000-0000000000a1';
const SB = 'cccccccc-0000-4000-8000-0000000000b2';
const KEY = (sid, id) => `child-test/sandbox/sch-1/${sid}/sa/ma.mul2i-${id}.webm`;
const never = () => new Promise(() => {});
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

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
        const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
        if (patch) { hit.forEach((r) => { Object.assign(r, patch); }); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
        const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
        return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
      },
    };
    return q;
  }
  return { from: query };
}

const session = (id) => ({ id, grade: 5, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T09:40:00Z', coach_user_id: null });
const mul = (sid, id) => ({
  id, session_id: sid, block: 'ma.mul2i', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY(sid, id), audio_r2_keys: null, updated_at: '2026-10-22T09:41:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'dddddddd-0000-4000-8000-0000000000c3', time_used_ms: 9000 }],
});
const W3 = { tasks: [{ id: 'ma.mul2i', kind: 'oral', subtask: 'mental_multiplication', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
  items: [{ id: 'ma.mul2i.01', show: '3 × 4', target: 12, answer: 12 }, { id: 'ma.mul2i.02', show: '5 × 2', target: 10, answer: 10 }] }] };
const good = async () => ({ json: { found: true, items: [{ i: 1, heard: '12', v: 'c', conf: 0.9 }, { i: 2, heard: '10', v: 'c', conf: 0.9 }] }, cost: 0.001, seconds: 1 });
const deps = (db, over = {}) => ({
  supabase: db, stopRules: false, coachLastWord: false, phoneBattery: (g, f, l) => (l === 'ur' ? W3 : null),
  clipOf: async () => ({ base64: 'AAAA', durationSec: 9 }), model: () => 'google/gemini-test', chatJSON: good,
  limits: { model: 60 * 1000, stt: 60 * 1000, r2: 60 * 1000, sweep: 5000 },
  ...over,
});
const NOW = new Date('2026-10-22T09:45:00Z');
const claimedRow = (r) => /^final:sa_scoring:/.test(String(r.ai_reason || ''));

describe('a sweep that times out gives up only its own claims', () => {
  const before = { ...process.env };
  beforeAll(() => { require('../../shared/services/child-test/scoring/llm'); require('../../shared/services/child-test/scoring/media'); }); // eslint-disable-line global-require
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    delete process.env.CHILD_TEST_SA_SPEECH_GATE; delete process.env.CHILD_TEST_SA_SECOND_VOICE; delete process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT;
    score.__internals.resetBoot();
  });
  afterEach(async () => { process.env = { ...before }; await wait(20); });

  test("a slow row's sweep passing its deadline never voids another sweep's marks: the fast sweep's row is written", async () => {
    const slow = mul(SA, 'slow');
    const fast = mul(SB, 'fast');
    const db = fakeDb({ child_test_blocks: [slow, fast], child_test_sessions: [session(SA), session(SB)] });
    const a = score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db, { chatJSON: never, limits: { model: 400, stt: 60, r2: 60, sweep: 60 } }) });
    const b = score.sweepOnce({ sessionId: SB, now: NOW, deps: deps(db, { chatJSON: async () => { await wait(200); return good(); } }) });
    const [outA] = await Promise.all([a, b]);
    expect(outA.timeout).toBe('score');
    expect(fast).toMatchObject({ ai_status: 'scored', ai_reason: null });
    expect(fast.ai_marks).toMatchObject({ task: 'ma.mul2i', correct: 2 });
    await wait(450); // the abandoned slow score settles (model bound): its own write still does not land
    expect(claimedRow(slow)).toBe(true);
    expect(slow.ai_marks).toBeNull();
  });

  test("a timed-out sweep's rows are taken again once stale, not before — even by the process's first full sweep", async () => {
    const slow = mul(SA, 'slow');
    const db = fakeDb({ child_test_blocks: [slow], child_test_sessions: [session(SA)] });
    const out = await score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db, { chatJSON: never, limits: { model: 300, stt: 60, r2: 60, sweep: 60 } }) });
    expect(out.timeout).toBe('score');
    await wait(400);
    expect(claimedRow(slow)).toBe(true);
    const at = Date.parse(slow.updated_at);
    const early = await score.sweepOnce({ now: new Date(at + 60 * 1000), deps: deps(db) });
    expect(early.scored).toBe(0);
    expect(claimedRow(slow)).toBe(true);
    expect(slow.ai_marks).toBeNull();
    const late = await score.sweepOnce({ now: new Date(at + 3 * 60 * 1000), deps: deps(db) });
    expect(late.scored).toBe(1);
    expect(slow).toMatchObject({ ai_status: 'scored', ai_reason: null });
  });

  test("the boot rule never takes a row another sweep of this process is still scoring", async () => {
    const live = mul(SB, 'live');
    const slow = mul(SA, 'slow');
    const db = fakeDb({ child_test_blocks: [live, slow], child_test_sessions: [session(SA), session(SB)] });
    let release;
    const gate = new Promise((r) => { release = r; });
    let liveCalls = 0;
    const held = score.sweepOnce({ sessionId: SB, now: NOW, deps: deps(db, { chatJSON: async () => { liveCalls += 1; await gate; return good(); } }) });
    await wait(30);
    expect(claimedRow(live)).toBe(true);
    // another sweep times out meanwhile
    const t = await score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db, { chatJSON: never, limits: { model: 300, stt: 60, r2: 60, sweep: 60 } }) });
    expect(t.timeout).toBe('score');
    // the process's first full sweep (the boot rule is on) must leave both rows alone
    let bootCalls = 0;
    const boot = await score.sweepOnce({ now: NOW, deps: deps(db, { chatJSON: async () => { bootCalls += 1; return good(); } }) });
    expect(boot.scored).toBe(0);
    expect(bootCalls).toBe(0);
    release();
    await held;
    expect(liveCalls).toBe(1);
    expect(live).toMatchObject({ ai_status: 'scored', ai_reason: null });
    await wait(350);
  });
});

describe('rows scored at once in one process are capped (CHILD_TEST_SA_SCORE_MAX_INFLIGHT)', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox';
    delete process.env.CHILD_TEST_SA_SPEECH_GATE; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
    score.__internals.resetBoot();
  });
  afterEach(async () => { process.env = { ...before }; await wait(20); });

  test('at the cap a sweep stops claiming; the rest stay parked, and a freed slot is used by the next sweep', async () => {
    process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT = '2';
    const rows = [1, 2, 3, 4, 5].map((n) => mul(SA, `r${n}`));
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: [session(SA)] });
    let release;
    const gate = new Promise((r) => { release = r; });
    const p = score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db, { chatJSON: async () => { await gate; return good(); } }) });
    await wait(30);
    expect(rows.filter(claimedRow)).toHaveLength(2);
    expect(rows.filter((r) => r.ai_reason === 'final:sa_score_later')).toHaveLength(3);
    // a concurrent sweep (another register's kick) claims nothing while the two are in flight
    const q = await score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db) });
    expect(q.scored).toBe(0);
    expect(rows.filter((r) => r.ai_reason === 'final:sa_score_later')).toHaveLength(3);
    release();
    const out = await p;
    expect(out.scored).toBe(2);
    expect(rows.filter((r) => r.ai_status === 'scored')).toHaveLength(2);
    // the slots are free again
    const next = await score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db) });
    expect(next.scored).toBe(2);
    expect(rows.filter((r) => r.ai_reason === 'final:sa_score_later')).toHaveLength(1);
  });

  test('the cap is process-wide: two sessions share it', async () => {
    process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT = '3';
    const a = [1, 2].map((n) => mul(SA, `a${n}`));
    const b = [1, 2].map((n) => mul(SB, `b${n}`));
    const db = fakeDb({ child_test_blocks: [...a, ...b], child_test_sessions: [session(SA), session(SB)] });
    let release;
    const gate = new Promise((r) => { release = r; });
    const chat = async () => { await gate; return good(); };
    const pa = score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db, { chatJSON: chat }) });
    await wait(30);
    const pb = score.sweepOnce({ sessionId: SB, now: NOW, deps: deps(db, { chatJSON: chat }) });
    await wait(30);
    expect(a.filter(claimedRow)).toHaveLength(2);
    expect(b.filter(claimedRow)).toHaveLength(1);
    release();
    await Promise.all([pa, pb]);
    expect([...a, ...b].filter((r) => r.ai_status === 'scored')).toHaveLength(3);
  });

  test('a slot taken by a sweep that timed out is freed when its score settles, not before', async () => {
    process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT = '1';
    const slow = mul(SA, 'slow');
    const other = mul(SB, 'other');
    const db = fakeDb({ child_test_blocks: [slow, other], child_test_sessions: [session(SA), session(SB)] });
    const t = await score.sweepOnce({ sessionId: SA, now: NOW, deps: deps(db, { chatJSON: never, limits: { model: 300, stt: 60, r2: 60, sweep: 60 } }) });
    expect(t.timeout).toBe('score');
    // the abandoned score still runs (its model call is bounded at 300 ms): the slot is still taken
    const busy = await score.sweepOnce({ sessionId: SB, now: NOW, deps: deps(db) });
    expect(busy.scored).toBe(0);
    expect(other.ai_reason).toBe('final:sa_score_later');
    await wait(400);
    const free = await score.sweepOnce({ sessionId: SB, now: NOW, deps: deps(db) });
    expect(free.scored).toBe(1);
    expect(other.ai_status).toBe('scored');
  });

  test('a bad or missing value is the default cap (24), never "no cap" and never zero', async () => {
    process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT = 'lots';
    expect(score.__internals.maxInflight()).toBe(24);
    process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT = '0';
    expect(score.__internals.maxInflight()).toBe(24);
    delete process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT;
    expect(score.__internals.maxInflight()).toBe(24);
    process.env.CHILD_TEST_SA_SCORE_MAX_INFLIGHT = '40';
    expect(score.__internals.maxInflight()).toBe(40);
  });
});
