'use strict';
/**
 * bd-29r3o — an empty first answer must not silently re-grade at a DIFFERENT reasoning effort.
 *
 * Found on the first morning of D37 in production (23 Sep, session b9698b1d): the stored blob carried
 * `reasoning_effort: "low"` although LP_FIDELITY_REASONING_EFFORT is unset on all three prod services. The cause is
 * this module, not the configuration — `retryEffort = !effort && lastErr.reason === 'empty_content' ? 'low' : null`.
 * The path was written for GLM/DeepSeek, which answer with empty content unless given a reasoning budget (Eval 8), and
 * nothing revisited it when the model became Gemini 3.8 Flash. On Gemini, `low` means thinking OFF — the arm Eval 12 §8
 * measured and REJECTED: false credit on reader-not_done 15–17% against 5–9%, κ 0.45 against 0.56, ~1% broken JSON.
 * So one transient empty answer silently downgrades that teacher's grading to the configuration we refused to ship,
 * and the only trace is a field nobody reads.
 *
 * The contract: a retry re-grades at the SAME configuration. The coaxing retry stays available for models that need it,
 * but only when LP_FIDELITY_EMPTY_RETRY_EFFORT explicitly asks for it. And a grading that came from a retry says so, so
 * this can never again be invisible.  RED FIRST.
 */
const { analyzeFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-analyzer');

function fakeClient(answers) {
  const calls = [];
  const queue = [...answers];
  return {
    calls,
    chat: {
      completions: {
        create: async (p) => {
          calls.push(p);
          const a = queue.shift();
          const { content, finish } = typeof a === 'string' ? { content: a, finish: 'stop' } : a;
          return { choices: [{ message: { content }, finish_reason: finish }], usage: {} };
        },
      },
    },
  };
}

const MOVES = [
  { move_id: 'm1', phase: 'explain', text: 'Write the three new words on the board', bucket: 'must_happen', selection: 'none' },
  { move_id: 'm2', phase: 'exit', text: 'Exit ticket', bucket: 'must_happen', selection: 'none' },
];
const META = { lesson_id: 'L' };
const GOOD = JSON.stringify({
  verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[05:00] x' }, { move_id: 'm2', verdict: 'not_done', evidence: '' }],
});
const EMPTY = { content: '', finish: 'stop' };
const KNOBS = ['LP_FIDELITY_REASONING_EFFORT', 'LP_FIDELITY_EMPTY_RETRY_EFFORT', 'LP_FIDELITY_MAX_TOKENS'];

describe('an empty answer is retried at the SAME effort, never silently at low (bd-29r3o)', () => {
  const saved = {};
  beforeEach(() => { for (const k of KNOBS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KNOBS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test('effort unset + empty first answer → the retry carries NO reasoning field (today it sends low)', async () => {
    const client = fakeClient([EMPTY, GOOD]);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].reasoning).toBeUndefined();
    expect(client.calls[1].reasoning).toBeUndefined();   // ← RED: currently { effort: 'low' }
    expect(out.reasoning_effort).toBeNull();
  });

  test('the grading says it came from a retry, so a degraded answer is never invisible', async () => {
    const client = fakeClient([EMPTY, GOOD]);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(out.empty_retry).toBe(true);                  // ← RED: the field does not exist
  });

  test('a first answer that is good carries no retry marker', async () => {
    const client = fakeClient([GOOD]);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls).toHaveLength(1);
    expect(out.empty_retry).toBeFalsy();
  });

  test('LP_FIDELITY_EMPTY_RETRY_EFFORT keeps the Eval-8 escape hatch for models that answer empty without a budget', async () => {
    process.env.LP_FIDELITY_EMPTY_RETRY_EFFORT = 'low';
    const client = fakeClient([EMPTY, GOOD]);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls[0].reasoning).toBeUndefined();
    expect(client.calls[1].reasoning).toEqual({ effort: 'low' });
    expect(out.reasoning_effort).toBe('low');
    expect(out.empty_retry).toBe(true);
  });

  test('an explicit reasoning effort is used on BOTH calls and the retry never overrides it', async () => {
    process.env.LP_FIDELITY_REASONING_EFFORT = 'medium';
    const client = fakeClient([EMPTY, GOOD]);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls[0].reasoning).toEqual({ effort: 'medium' });
    expect(client.calls[1].reasoning).toEqual({ effort: 'medium' });
    expect(out.reasoning_effort).toBe('medium');
  });

  test('an unrecognised LP_FIDELITY_EMPTY_RETRY_EFFORT is ignored rather than sent to the provider', async () => {
    process.env.LP_FIDELITY_EMPTY_RETRY_EFFORT = 'turbo';
    const client = fakeClient([EMPTY, GOOD]);
    await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls[1].reasoning).toBeUndefined();
  });

  test('a non-empty failure (unparseable JSON) does not trigger the coaxing retry even when it is configured', async () => {
    process.env.LP_FIDELITY_EMPTY_RETRY_EFFORT = 'low';
    const client = fakeClient(['{ not json', GOOD]);
    await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls[1].reasoning).toBeUndefined();
  });
});

// The marker is worthless if it dies at the analyzer boundary: the whole reason the hardcoded low-effort retry ran
// unnoticed is that nothing downstream carried the signal. This drives the REAL orchestrator with a stub analyzer at
// the dependency seam, so the field is proven onto the persisted blob, not just onto a return value.
describe('the retry marker survives the orchestrator hop onto the stored blob (bd-29r3o)', () => {
  const { computeLpFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');
  const MOVES2 = [
    { move_id: 'm1', phase: 'explain', text: 'Model the subtraction on the board', bucket: 'must_happen' },
    { move_id: 'm2', phase: 'guided', text: 'Pairs solve two problems', bucket: 'must_happen' },
  ];
  const KEY = { lesson_id: 'L', version_stamp: 'v', content_hash: 'h' };
  const STAMPED = '[00:10] Teacher: آج ہم تفریق کریں گے۔\n\n[10:00] Teacher: دو دو بچے مل کے حل کریں۔';
  const deps = (graded) => ({
    resolveMoveList: async () => ({ moves: MOVES2, lesson_id: 'L', template: 'STANDARD', resolved: 'exact' }),
    extractUploadedLp: async () => null,
    analyzeFidelity: async () => graded,
  });
  const verdicts = [{ move_id: 'm1', verdict: 'executed', evidence: '[00:10] x' }, { move_id: 'm2', verdict: 'not_done', evidence: '' }];
  const saved = process.env.LP_FIDELITY_RUNS;
  beforeEach(() => { delete process.env.LP_FIDELITY_RUNS; });
  afterEach(() => { if (saved === undefined) delete process.env.LP_FIDELITY_RUNS; else process.env.LP_FIDELITY_RUNS = saved; });

  test('a grading that came from a retry is persisted as empty_retry: true', async () => {
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: STAMPED, audioDurationSeconds: 1800 },
      deps({ verdicts, model: 'google/gemini-3.8-flash', reasoning_effort: null, empty_retry: true }));
    expect(r.status).toBe('ok');
    expect(r.empty_retry).toBe(true);
  });

  test('an ordinary grading is persisted as empty_retry: false, never undefined', async () => {
    const r = await computeLpFidelity({ corpusKey: KEY, transcript: STAMPED, audioDurationSeconds: 1800 },
      deps({ verdicts, model: 'google/gemini-3.8-flash', reasoning_effort: null }));
    expect(r.empty_retry).toBe(false);
  });
});
