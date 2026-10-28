'use strict';
/**
 * bd-sex15q.43 — the US$21 first-night backfill in ONE night (COS 28 Oct ~15:25Z; ops-r6 idea 151822). Phonics calls ran one
 * at a time, so the night's phonics cut-off (22:50Z) left most of the backlog pending. COACHIP_MODEL_CONCURRENCY (default 1,
 * at most 3) lets N detector calls run at once, under three invariants:
 *   1. never more than N model calls in flight;
 *   2. the cap holds with N in flight: each call holds its p90 from start until its cost is recorded, so N at once buy no
 *      more than one at a time would (the ledger's affordable() counts what is in flight);
 *   3. the database stays bounded whatever N is: every PostgREST request still goes through the job's guardedFetch
 *      (≤ 2 in flight), so N model calls add no database connection.
 * Network boundaries are faked (OpenRouter fetch, the PostgREST wire under the REAL supabase-js client); the chain
 * createModelContext → runPhonics → Ph.detectPhonics → M.callModel → SupabaseStore runs for real. Fixtures are fictional.
 */
const { createClient } = require('@supabase/supabase-js');
const M = require('../../lib/insights/model');
const ms = require('../../lib/insights/model-stage');
const safety = require('../../lib/insights/safety');
const { MemoryStore, SupabaseStore, memoryClient } = require('../../lib/insights/store');
const { readAllowed } = require('../../lib/insights/allowlist');
const F = require('./fixtures/analysis');
const X = require('./fixtures/model');

const P90 = M.P90_USD.phonics;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const facts = (n) => Array.from({ length: n }, (_, k) => ({ id: `f-${k + 1}`, session_id: sid(k + 1), instrument: 'lp_fidelity', status: 'ok',
  is_duplicate: false, is_mismatch: false, is_unusable: false, lesson_type: 'literacy_phonics',
  recorded_at: `2026-10-${String(10 + (k % 18)).padStart(2, '0')}T05:${String(k % 60).padStart(2, '0')}:00Z`, grade: 2, subject: 'urdu' }));
const transcripts = (n) => ({ coaching_sessions: Array.from({ length: n }, (_, k) => ({ id: sid(k + 1), transcript_text: X.TRANSCRIPT })) });

/**
 * OpenRouter stand-in: each call costs `cost`; the peak number at once is kept. With `together` > 1 a call first waits until
 * that many are in flight (or as many as are still to come of `total`), so "N at once" never depends on timer luck on a loaded
 * machine; `fallbackMs` lets a build that never reaches N fail the test instead of hanging it.
 */
function modelNet({ ms = 15, cost = P90, together = 1, total = Infinity, fallbackMs = 1000 } = {}) {
  let active = 0;
  let finished = 0;
  let waiters = [];
  const openIfReady = () => {
    if (active < Math.min(together, total - finished)) return;
    const w = waiters; waiters = [];
    for (const go of w) go();
  };
  const fetch = async () => {
    active += 1; fetch.peak = Math.max(fetch.peak, active); fetch.calls += 1;
    try {
      if (together > 1) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, fallbackMs);
          waiters.push(() => { clearTimeout(t); resolve(); });
          openIfReady();
        });
      }
      await sleep(ms);
      return X.ok(X.phonicsOut({ applicable: false }), { cost });
    } finally { active -= 1; finished += 1; openIfReady(); }
  };
  fetch.peak = 0; fetch.calls = 0;
  Object.defineProperty(fetch, 'active', { get: () => active });
  return fetch;
}

const ctxFor = ({ capUsd = 2, write = false, store = new MemoryStore(), n, net, readClient, lines = [] }) => ms.createModelContext({
  capUsd, write, store, jobRunId: 'job-c', log: (l) => lines.push(l),
  deps: { fetch: net, apiKey: 'k', readClient, ...(n == null ? {} : { modelConcurrency: n }) } });

describe('the ledger holds what is in flight', () => {
  test('hold() adds a call\'s p90 to held until released; release is idempotent', () => {
    const ledger = M.createLedger({ capUsd: 1 });
    const a = ledger.hold(P90);
    const b = ledger.hold(P90);
    expect(ledger.held).toBeCloseTo(2 * P90, 10);
    a(); a();
    expect(ledger.held).toBeCloseTo(P90, 10);
    b();
    expect(ledger.held).toBe(0);
  });
});

describe('runPhonics with COACHIP_MODEL_CONCURRENCY', () => {
  test('N = 3: never more than 3 calls in flight, and 3 at once do happen; every lesson read once', async () => {
    const net = modelNet({ together: 3, total: 10 });
    const ctx = ctxFor({ n: 3, net, readClient: memoryClient(transcripts(10)) });
    await ms.runPhonics(ctx, { facts: facts(10), inWindow: () => true });
    expect(net.peak).toBe(3);
    expect(net.calls).toBe(10);
    expect(ctx.summary.calls).toBe(10);
    expect(ctx.summary.pending).toBe(0);
  });

  test('default (no knob): one at a time, as before', async () => {
    const net = modelNet();
    const ctx = ctxFor({ net, readClient: memoryClient(transcripts(4)) });
    await ms.runPhonics(ctx, { facts: facts(4), inWindow: () => true });
    expect(net.peak).toBe(1);
    expect(net.calls).toBe(4);
  });

  test('a knob above 12 is held at 12 (the one-night backfill needs about 12 at once; GO_PACKAGE §13.7)', async () => {
    const net = modelNet({ together: 13, total: 30, fallbackMs: 200 });
    const ctx = ctxFor({ n: 40, net, readClient: memoryClient(transcripts(30)) });
    await ms.runPhonics(ctx, { facts: facts(30), inWindow: () => true });
    expect(net.peak).toBe(12);
    expect(net.calls).toBe(30);
  });

  test('the cap holds with 3 in flight: exactly the calls one at a time would buy, never past cap − reserve', async () => {
    const reserveUsd = 0.1;
    const capUsd = reserveUsd + 5 * P90 + 1e-6;   // room for exactly 5 phonics calls at their p90
    const run = async (n) => {
      const net = modelNet({ cost: P90, together: n, total: 5 });
      const ctx = ctxFor({ capUsd, n, net, readClient: memoryClient(transcripts(12)) });
      await ms.runPhonics(ctx, { facts: facts(12), inWindow: () => true, reserveUsd });
      return { net, ctx };
    };
    const one = await run(1);
    const three = await run(3);
    expect(one.net.calls).toBe(5);
    expect(three.net.peak).toBeGreaterThan(1);
    expect(three.net.calls).toBe(one.net.calls);
    expect(three.ctx.ledger.spent).toBeLessThanOrEqual(capUsd - reserveUsd);
    expect(three.ctx.ledger.held).toBe(0);
    expect(three.ctx.summary.pending).toBe(12 - 5);
  });

  test('past the cut-off mid-run: no new call starts, the ones in flight finish and are recorded, the rest pending once', async () => {
    let t = Date.parse('2026-10-28T22:00:00Z');
    const cut = Date.parse('2026-10-28T22:50:00Z');
    const net = modelNet();
    const counted = net;
    const lines = [];
    const ctx = ms.createModelContext({ capUsd: 2, write: false, store: new MemoryStore(), jobRunId: 'job-c', log: (l) => lines.push(l),
      deps: { fetch: async (...a) => { if (counted.calls === 4) t = cut; return counted(...a); }, apiKey: 'k',
        readClient: memoryClient(transcripts(10)), modelConcurrency: 3, now: () => t, deadlines: { phonics: cut } } });
    await ms.runPhonics(ctx, { facts: facts(10), inWindow: () => true });
    expect(net.calls).toBeGreaterThanOrEqual(5);
    expect(net.calls).toBeLessThanOrEqual(5 + 2);         // at most the two others already in flight
    expect(ctx.summary.calls).toBe(net.calls);           // every call made was recorded
    expect(ctx.summary.pending).toBe(10 - net.calls);
    expect(lines.filter((l) => l.startsWith('deadline_reached stage=phonics'))).toEqual([`deadline_reached stage=phonics pending=${10 - net.calls}`]);
  });

  test('a failing write stops the stage only after the calls in flight have settled (nothing left running)', async () => {
    const net = modelNet({ together: 3, total: 9, fallbackMs: 200 });
    const store = new MemoryStore();
    let inserts = 0;
    const orig = store.insert.bind(store);
    store.insert = async (table, list) => { inserts += 1; if (inserts === 2) throw new Error('insert coachip_model_runs: fictional'); return orig(table, list); };
    store.select = async () => [];
    const ctx = ctxFor({ write: true, store, n: 3, net, readClient: memoryClient(transcripts(9)) });
    await expect(ms.runPhonics(ctx, { facts: facts(9), inWindow: () => true })).rejects.toThrow(/fictional/);
    expect(net.peak).toBe(3);
    expect(net.active).toBe(0);
    expect(net.calls).toBeLessThan(9);
  });

  test('it says how it runs: one phonics_start line with the candidates and the concurrency', async () => {
    const lines = [];
    const ctx = ctxFor({ n: 2, net: modelNet(), readClient: memoryClient(transcripts(3)), lines });
    await ms.runPhonics(ctx, { facts: facts(3), inWindow: () => true });
    expect(lines.filter((l) => l.startsWith('phonics_start'))).toEqual(['phonics_start candidates=3 concurrency=2']);
  });
});

describe('the database stays at ≤ 2 requests in flight whatever N is (the real supabase-js client, guardedFetch, a fake wire)', () => {
  /** PostgREST stand-in: every request takes `ms`; the peak number at once is kept. Ids are minted for inserts. */
  function restWire({ ms = 8 } = {}) {
    let active = 0; let id = 0;
    const fetch = async (url, init = {}) => {
      active += 1; fetch.peak = Math.max(fetch.peak, active); fetch.requests += 1;
      try {
        await sleep(ms);
        const u = new URL(url);
        const table = u.pathname.split('/').pop();
        const method = String(init.method || 'GET').toUpperCase();
        let body = [];
        if (method === 'POST') body = JSON.parse(init.body).map(() => ({ id: `run-${(id += 1)}` }));
        else if (table === 'coaching_sessions') {
          const ids = String(u.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, ''));
          body = ids.filter(Boolean).map((i) => ({ id: i, transcript_text: X.TRANSCRIPT }));
        }
        return new Response(JSON.stringify(body), { status: method === 'POST' ? 201 : 200,
          headers: { 'content-type': 'application/json', 'content-range': `0-${Math.max(0, body.length - 1)}/*` } });
      } finally { active -= 1; }
    };
    fetch.peak = 0; fetch.requests = 0;
    return fetch;
  }

  test.each([1, 3])('N = %i: model calls up to N at once, PostgREST requests never more than 2', async (n) => {
    const wire = restWire();
    const client = createClient('https://fictional-sandbox.supabase.co', 'k', { auth: { persistSession: false },
      global: { fetch: safety.guardedFetch({ fetch: wire, maxInFlight: 2, timeoutMs: 5000 }) } });
    // The model calls wait for N in flight (the barrier); each one's reuse lookup and insert still queue for the 2-request limit.
    const net = modelNet({ ms: 20, together: n, total: 12 });
    const ctx = ctxFor({ write: true, store: new SupabaseStore(client), n, net, readClient: client });
    await ms.runPhonics(ctx, { facts: facts(12), inWindow: () => true });
    expect(net.calls).toBe(12);
    expect(net.peak).toBe(n);
    expect(wire.requests).toBeGreaterThanOrEqual(12 * 2);   // a reuse lookup and an insert per call, plus the transcript reads
    expect(wire.peak).toBeLessThanOrEqual(2);
  });
});

describe('the health guard under concurrent callers', () => {
  test('three checks at once share one round of metrics reads', async () => {
    const fetch = jest.fn(async () => { await sleep(5); return { ok: true, status: 200, text: async () => [
      'node_memory_SwapTotal_bytes 1073741824', 'node_memory_SwapFree_bytes 973741824', 'node_memory_MemAvailable_bytes 943718400'].join('\n') }; });
    const guard = safety.createHealthGuard({ fetch, primaryUrl: 'https://fictional.supabase.co', key: 'k', sleep: async () => {} });
    const out = await Promise.all([guard.check(), guard.check(), guard.check()]);
    expect(out.every((h) => h.ok)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('runGlosses with COACHIP_MODEL_CONCURRENCY (the shown moments: same shape as phonics)', () => {
  const GSID = '00000000-0000-4000-8000-0000000c0009';
  const mid = (i) => `00000000-0000-4000-8000-0000000e${String(i).padStart(4, '0')}`;
  const glossFact = (k) => ({ id: 'gf1', session_id: GSID,
    allowed: readAllowed({ lp_fidelity: F.lp(Array.from({ length: k }, (_, i) => F.move(`m${i + 1}`, 'independent', 'not_done', { at: '12:30' }))) }) });
  const moments = (k) => Array.from({ length: k }, (_, i) => ({ id: mid(i + 1), fact_id: 'gf1', session_id: GSID, w_id: 'W-IP', phase: 'independent',
    move_id: `m${i + 1}`, kind: 'missing', moment_s: 750, from_s: 740, to_s: 800, confidence: 'high', gloss_status: 'pending',
    gloss_en: null, gloss_ur: null, gloss_model_run_id: null }));
  /** Gloss stand-in: the clean fictional gloss, `cost` each; with `together`, waits for that many in flight (as modelNet). */
  function glossNet({ together = 1, total = Infinity, cost = M.P90_USD.gloss, fallbackMs = 1000 } = {}) {
    const net = modelNet({ together, total, cost, fallbackMs, ms: 5 });
    const inner = net;
    const f = async (...a) => { await inner(...a); return X.ok({ gloss_en: X.GLOSS.clean.en, gloss_ur: X.GLOSS.clean.ur }, { cost }); };
    Object.defineProperty(f, 'peak', { get: () => inner.peak });
    Object.defineProperty(f, 'calls', { get: () => inner.calls });
    return f;
  }
  const run = async ({ k, n, net, capUsd = 2 }) => {
    const ms_ = moments(k);
    const ctx = ctxFor({ capUsd, n, net, readClient: memoryClient({ coaching_sessions: [{ id: GSID, user_id: 'u-fict' }] }) });
    await ms.runGlosses(ctx, { shown: ms_.map((m) => m.id), moments: ms_, facts: [glossFact(k)] });
    return ctx;
  };

  test('N = 4: never more than 4 gloss calls at once, 4 at once do happen, every shown moment glossed', async () => {
    const net = glossNet({ together: 4, total: 10 });
    const ctx = await run({ k: 10, n: 4, net });
    expect(net.peak).toBe(4);
    expect(net.calls).toBe(10);
    expect(ctx.summary.by_analysis.gloss).toEqual({ ok: 10 });
  });

  test('the cap holds with 4 in flight: the same number of glosses as one at a time, the rest pending', async () => {
    const capUsd = 6 * M.P90_USD.gloss + 1e-7;
    const one = glossNet({ cost: M.P90_USD.gloss });
    const c1 = await run({ k: 10, n: 1, net: one, capUsd });
    const four = glossNet({ together: 4, total: 6, cost: M.P90_USD.gloss, fallbackMs: 200 });
    const c4 = await run({ k: 10, n: 4, net: four, capUsd });
    expect(one.calls).toBe(6);
    expect(four.peak).toBeGreaterThan(1);
    expect(four.calls).toBe(one.calls);
    expect(c4.ledger.spent).toBeLessThanOrEqual(capUsd);
    expect(c4.ledger.held).toBe(0);
    expect(c4.summary.by_analysis.gloss.pending).toBe(c1.summary.by_analysis.gloss.pending);
  });
});
