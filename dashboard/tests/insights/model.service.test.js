'use strict';
/** NIGHTLY_JOB §6, §7, §8, §9, §12 test 11: the OpenRouter client, the nightly ledger and cap, retry, usage on the row,
 * no quote in a stored output, reuse, the gloss fallback and the spend order. fetch is mocked; nothing leaves the machine. */
const M = require('../../lib/insights/model');
const X = require('./fixtures/model');

const SID = '00000000-0000-4000-8000-000000000001';
const base = (deps, extra = {}) => ({
  model: 'openai/gpt-6-luna', prompt: 'placeholder system prompt', input: { W: 'W-IP', verdict: 'not_done' },
  purpose: 'primary', analysis: 'gloss', target: 'm7', sessionId: SID, promptVersion: 'gloss_v2',
  deps: { apiKey: 'sk-fictional-key-0000', jobRunId: '00000000-0000-4000-8000-0000000000aa', ...deps }, ...extra,
});

describe('the ledger and the cap (test 11)', () => {
  test('canStart is spent + p90 <= cap; once refused, every later call is refused too', () => {
    const L = M.createLedger({ capUsd: 2, p90: { gloss: 0.00026, phonics: 0.0031 } });
    L.record({ cost: 1.9995 });
    expect(L.spent).toBeCloseTo(1.9995, 6);
    expect(L.canStart('gloss')).toBe(true);
    L.record({ cost: 0.0003 });
    expect(L.canStart('phonics')).toBe(false);
    expect(L.isCapHit).toBe(true);
    expect(L.canStart('gloss')).toBe(false); // gloss alone would still fit; the order says every later item waits
  });

  test('an unknown analysis is refused rather than run uncapped', () => {
    const L = M.createLedger({ capUsd: 2, p90: { gloss: 0.00026 } });
    expect(L.canStart('nonsense')).toBe(false);
  });

  test('the cap stops new calls: no fetch, rows pending with cap_reached, pending counted, one log line', async () => {
    const L = M.createLedger({ capUsd: 2, p90: M.P90_USD });
    L.record({ cost: 1.9999 });
    const fetch = X.scriptedFetch([]);
    const logs = [];
    const a = await M.callModel(base({ fetch, ledger: L, log: (s) => logs.push(s) }));
    const b = await M.callModel(base({ fetch, ledger: L, log: (s) => logs.push(s) }, { target: 'm8' }));
    expect(fetch.calls).toHaveLength(0);
    expect(a.row.status).toBe('pending');
    expect(a.row.failure_class).toBe('cap_reached');
    expect(b.row.status).toBe('pending');
    expect(L.pending).toBe(2);
    expect(L.capLine()).toBe('cap_reached pending=2');
    expect(logs.filter((s) => /^cap_reached/.test(s))).toHaveLength(1);
  });

  test('the usage of every attempt is recorded against the cap', async () => {
    const L = M.createLedger({ capUsd: 2, p90: M.P90_USD });
    const fetch = X.scriptedFetch([X.ok('not json', { cost: 0.0001 }), X.ok({ gloss_en: 'a', gloss_ur: 'ب' }, { cost: 0.0002 })]);
    await M.callModel(base({ fetch, ledger: L }));
    expect(L.spent).toBeCloseTo(0.0003, 8);
  });
});

describe('callModel', () => {
  test('the request: OpenRouter, temperature 0, JSON mode, usage included, key only in the header', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: 'a', gloss_ur: 'ب' })]);
    const out = await M.callModel(base({ fetch }));
    expect(fetch.calls).toHaveLength(1);
    const c = fetch.calls[0];
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.body).toMatchObject({ model: 'openai/gpt-6-luna', temperature: 0, response_format: { type: 'json_object' }, usage: { include: true } });
    expect(c.body.messages[0]).toEqual({ role: 'system', content: 'placeholder system prompt' });
    expect(c.init.headers.Authorization).toBe('Bearer sk-fictional-key-0000');
    expect(JSON.stringify(out.row)).not.toMatch(/sk-fictional/);
  });

  test('usage becomes tokens and cost on the row; the row has the coachip_model_runs columns', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: 'a', gloss_ur: 'ب' }, { pin: 704, pout: 258, cost: 0.000201234 })]);
    const { row, output } = await M.callModel(base({ fetch }));
    expect(Object.keys(row).sort()).toEqual(['analysis', 'cost_usd', 'failure_class', 'input_hash', 'job_run_id', 'model', 'output',
      'prompt_version', 'purpose', 'session_id', 'status', 'target', 'tokens_in', 'tokens_out'].sort());
    expect(row).toMatchObject({ status: 'ok', failure_class: null, tokens_in: 704, tokens_out: 258, cost_usd: 0.0002, analysis: 'gloss',
      target: 'm7', purpose: 'primary', prompt_version: 'gloss_v2', session_id: SID });
    expect(row.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(output).toEqual({ gloss_en: 'a', gloss_ur: 'ب' });
  });

  test('one retry on 429, then ok; both attempts counted on the row', async () => {
    const fetch = X.scriptedFetch([X.http(429), X.ok({ x: 1 }, { pin: 10, pout: 5, cost: 0.0001 })]);
    const { row } = await M.callModel(base({ fetch }));
    expect(fetch.calls).toHaveLength(2);
    expect(row.status).toBe('ok');
    expect(fetch.calls[1].body).toEqual(fetch.calls[0].body);
  });

  test.each([
    ['5xx', () => [X.http(500), X.http(503)], 'http'],
    ['timeout', () => [X.timeout(), X.timeout()], 'timeout'],
    ['empty', () => [X.ok(''), X.ok('   ')], 'empty'],
    ['unparseable', () => [X.ok('not json'), X.ok('{"half":')], 'unparseable'],
    ['truncated', () => [X.ok('{"a":', { finish: 'length' }), X.ok('{"a":', { finish: 'length' })], 'truncated'],
  ])('retry then failed: %s', async (_n, q, cls) => {
    const fetch = X.scriptedFetch(q());
    const { row, output } = await M.callModel(base({ fetch }));
    expect(fetch.calls).toHaveLength(2);
    expect(row.status).toBe('failed');
    expect(row.failure_class).toBe(cls);
    expect(row.output).toBeNull();
    expect(output).toBeNull();
  });

  test('a 400 is not retried', async () => {
    const fetch = X.scriptedFetch([X.http(400)]);
    const { row } = await M.callModel(base({ fetch }));
    expect(fetch.calls).toHaveLength(1);
    expect(row).toMatchObject({ status: 'failed', failure_class: 'http' });
  });

  test('a stored output never carries a quote key at any depth; the in-memory output keeps it', async () => {
    const parsed = { applicable: true, stages_heard: [{ stage: 'sound', at: '02:10', quote: 'placeholder' }], deep: { a: [{ b: { quote: 'x' } }] } };
    const fetch = X.scriptedFetch([X.ok(parsed)]);
    const { row, output } = await M.callModel(base({ fetch }, { analysis: 'phonics', promptVersion: 'phonics_v2', target: '-' }));
    expect(JSON.stringify(row.output)).not.toMatch(/"quote"/);
    expect(row.output.stages_heard[0]).toEqual({ stage: 'sound', at: '02:10' });
    expect(output.stages_heard[0].quote).toBe('placeholder');
    expect(M.hasQuoteKey(row.output)).toBe(false);
  });

  test('reuse: an ok, blocked or not_applicable row with the same key is returned without a call', async () => {
    for (const status of ['ok', 'blocked', 'not_applicable']) {
      const fetch = X.scriptedFetch([]);
      const seen = [];
      const findRun = async (key) => { seen.push(key); return { status, output: { kept: true } }; };
      const out = await M.callModel(base({ fetch, findRun }));
      expect(fetch.calls).toHaveLength(0);
      expect(out.reused).toBe(true);
      expect(out.row.status).toBe(status);
      expect(seen[0]).toMatchObject({ session_id: SID, analysis: 'gloss', target: 'm7', model: 'openai/gpt-6-luna', prompt_version: 'gloss_v2', purpose: 'primary' });
      expect(seen[0].input_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('a failed or pending row is retried', async () => {
    const fetch = X.scriptedFetch([X.ok({ a: 1 })]);
    const out = await M.callModel(base({ fetch, findRun: async () => ({ status: 'failed' }) }));
    expect(fetch.calls).toHaveLength(1);
    expect(out.row.status).toBe('ok');
  });

  test('the input hash moves with the input and the pipeline version, not with the key', async () => {
    const h1 = M.runInputHash({ a: 1 });
    expect(M.runInputHash({ a: 1 })).toBe(h1);
    expect(M.runInputHash({ a: 2 })).not.toBe(h1);
  });
});

describe('the gloss fallback', () => {
  test('primary fails after its retry → Haiku, stamped purpose = fallback', async () => {
    const fetch = X.scriptedFetch([X.http(502), X.http(502), X.ok({ gloss_en: 'a', gloss_ur: 'ب' })]);
    const out = await M.callGlossModel(base({ fetch }));
    expect(out.rows.map((r) => [r.model, r.purpose, r.status])).toEqual([
      ['openai/gpt-6-luna', 'primary', 'failed'], ['anthropic/claude-haiku-5.5', 'fallback', 'ok']]);
    expect(out.row.purpose).toBe('fallback');
    expect(out.output).toEqual({ gloss_en: 'a', gloss_ur: 'ب' });
  });

  test('primary ok → no fallback call', async () => {
    const fetch = X.scriptedFetch([X.ok({ gloss_en: 'a', gloss_ur: 'ب' })]);
    const out = await M.callGlossModel(base({ fetch }));
    expect(fetch.calls).toHaveLength(1);
    expect(out.rows).toHaveLength(1);
  });

  test('a pending primary (cap) does not fall back', async () => {
    const L = M.createLedger({ capUsd: 0, p90: M.P90_USD });
    const fetch = X.scriptedFetch([]);
    const out = await M.callGlossModel(base({ fetch, ledger: L }));
    expect(out.row.status).toBe('pending');
    expect(out.rows).toHaveLength(1);
  });
});

describe('orderWork (NIGHTLY_JOB §7)', () => {
  test('S1/S2 glosses → circle → drift → re-check → phonics window (newest first) → Listen → homework → backfill', () => {
    const items = [
      { kind: 'phonics_backfill', recorded_at: '2026-09-01T00:00:00Z' },
      { kind: 'homework' },
      { kind: 'gloss_listen' },
      { kind: 'phonics_window', recorded_at: '2026-10-10T00:00:00Z', n: 'old' },
      { kind: 'phonics_window', recorded_at: '2026-10-20T00:00:00Z', n: 'new' },
      { kind: 'recheck' },
      { kind: 'drift_audit' },
      { kind: 'gloss_circle' },
      { kind: 'gloss_s1s2' },
    ];
    const out = M.orderWork(items);
    expect(out.map((i) => i.kind)).toEqual(['gloss_s1s2', 'gloss_circle', 'drift_audit', 'recheck', 'phonics_window', 'phonics_window',
      'gloss_listen', 'homework', 'phonics_backfill']);
    expect(out[4].n).toBe('new');
    expect(items[0].kind).toBe('phonics_backfill'); // input untouched
  });

  test('an unknown kind goes last, never first', () => {
    expect(M.orderWork([{ kind: 'mystery' }, { kind: 'homework' }]).map((i) => i.kind)).toEqual(['homework', 'mystery']);
  });
});

describe('prompts', () => {
  test('each prompt loads without its source header', () => {
    for (const name of ['gloss_v2', 'phonics_v2', 'homework_v1', 'gloss_recheck_v1']) {
      const p = M.loadPrompt(name);
      expect(p.length).toBeGreaterThan(200);
      expect(p).not.toMatch(/<!--|source:/);
      expect(p).toMatch(/Return only JSON/);
    }
  });
});
