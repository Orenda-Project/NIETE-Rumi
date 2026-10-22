'use strict';

/**
 * A bot restart while a row is being scored (the host restarts on every deploy) left the row claimed,
 * `failed | final:sa_scoring`, until a 5-minute takeover. The coach saw "scored later" in the meantime. Now:
 *  - each process claims with its own token, so the compare-and-set changes the value and two processes
 *    cannot both win;
 *  - a claim older than 2 minutes is taken again;
 *  - on a process's first sweep, a claim from any other process (gone with the restart) is taken at once.
 * The fixture is shaped like the walk's ma.mul2i row, claimed 8 s before the restart.
 */

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000004';
const KEY = (t) => `child-test/sandbox/sch-1/${SID}/sa/${t}.webm`;

function fakeDb(tables) {
  const writes = [];
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
        if (patch) { hit.forEach((r) => { Object.assign(r, patch); writes.push({ id: r.id, ...patch }); }); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
        const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
        return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
      },
    };
    return q;
  }
  return { from: query, writes };
}

const session = () => ({ id: SID, grade: 5, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-21T17:46:10Z' });
const mul = (over = {}) => ({
  id: 'row-mul', session_id: SID, block: 'ma.mul2i', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_scoring',
  ai_marks: null, audio_r2_key: KEY('ma.mul2i'), audio_r2_keys: null, updated_at: '2026-10-21T17:45:17.870Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'dddddddd-0000-4000-8000-00000000000b', time_used_ms: 9000, cells: [{ i: 0 }, { i: 1 }] }],
  ...over,
});
const W3 = { tasks: [{ id: 'ma.mul2i', kind: 'oral', subtask: 'mental_multiplication', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
  items: [{ id: 'ma.mul2i.01', show: '3 × 4', target: 12, answer: 12 }, { id: 'ma.mul2i.02', show: '5 × 2', target: 10, answer: 10 }] }] };
const deps = (db) => ({
  supabase: db, phoneBattery: (g, f, l) => (l === 'ur' ? W3 : null),
  clipOf: async () => ({ base64: 'AAAA', durationSec: 9 }), model: () => 'google/gemini-test',
  chatJSON: async () => ({ json: { found: true, items: [{ i: 1, heard: '12', v: 'c', conf: 0.9 }, { i: 2, heard: '10', v: 'c', conf: 0.9 }] }, cost: 0.001, seconds: 1 }),
});

describe('a claim left by a restart is taken again', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; if (score.__internals.resetBoot) score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  test("the first sweep after a restart scores the row the old process had claimed 30 s earlier", async () => {
    const r = mul();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    const out = await score.sweepOnce({ now: new Date('2026-10-21T17:45:48Z'), deps: deps(db) });
    expect(out).toMatchObject({ scored: 1 });
    expect(r).toMatchObject({ ai_status: 'scored', ai_reason: null });
    expect(r.ai_marks).toMatchObject({ task: 'ma.mul2i', correct: 2, of: 2 });
  });

  test('later sweeps: a claim older than 2 min is taken again; a younger one of another process is left', async () => {
    await score.sweepOnce({ now: new Date('2026-10-21T17:40:00Z'), deps: deps(fakeDb({ child_test_blocks: [], child_test_sessions: [] })) });
    const young = mul({ id: 'young', ai_reason: 'final:sa_scoring:other1', updated_at: '2026-10-21T17:46:00Z' });
    const old = mul({ id: 'old', ai_reason: 'final:sa_scoring:other2', updated_at: '2026-10-21T17:45:17.870Z' });
    const db = fakeDb({ child_test_blocks: [young, old], child_test_sessions: [session()] });
    await score.sweepOnce({ now: new Date('2026-10-21T17:47:30Z'), deps: deps(db) });
    expect(old.ai_status).toBe('scored');
    expect(young).toMatchObject({ ai_status: 'failed', ai_reason: 'final:sa_scoring:other1', ai_marks: null });
  });

  test("the claim is this process's own token: a second claim on the old value loses, and only the owner writes", async () => {
    const r = mul({ ai_reason: 'final:sa_score_later' });
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()] });
    expect(await score.__internals.claim({ ...r }, db)).toBe(true);
    expect(r.ai_reason).toMatch(/^final:sa_scoring:[a-z0-9]+$/);
    expect(await score.__internals.claim({ ...r, ai_reason: 'final:sa_score_later' }, db)).toBe(false);
    // another process took it over: this one's late write does nothing
    const mine = r.ai_reason;
    r.ai_reason = 'final:sa_scoring:someoneelse';
    await score.__internals.finish({ ...r, ai_reason: mine }, { ok: true, marks: { correct: 9 } }, db);
    expect(r.ai_marks).toBeNull();
  });
});
