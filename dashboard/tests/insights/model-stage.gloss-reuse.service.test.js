'use strict';
/**
 * bd-sex15q.40: a re-glossed moment must be storable when its gloss call is reused (board 20261028T033226).
 *
 * A moment goes back to `pending` (the ruling-B reset of 223945, or any re-gloss) and its input is unchanged, so findRun
 * finds the earlier night's call and callModel returns the stored row ({ id, status, output }) with reused: true. Two
 * writes then broke on staging (28 Oct 2026):
 *   1. glossMoment returned runForPatch for the reused call, so runGlosses took the run id from ctx.record([]) (none) and
 *      wrote gloss_status 'ok' with gloss_model_run_id null: coachip_moments_check2 (V1.8.0) refused it, `after=circle`.
 *   2. recheckGloss handed back the reused stored row and runGlosses recorded it: a coachip_model_runs insert with no
 *      session_id, analysis or model (the NOT NULLs of V1.8.0), as phonics did before #3850.
 *
 * The chain under test: createModelContext (write mode, the real findRun over the store) → runGlosses → G.glossMoment /
 * G.recheckGloss → M.callModel, twice on one store (two nights). fetch is scripted; every fixture is fictional.
 */
const { createModelContext, runGlosses } = require('../../lib/insights/model-stage');
const { MemoryStore, memoryClient } = require('../../lib/insights/store');
const { readAllowed } = require('../../lib/insights/allowlist');
const F = require('./fixtures/analysis');
const X = require('./fixtures/model');

const SID = '00000000-0000-4000-8000-0000000c0002';
const MID = '00000000-0000-4000-8000-0000000e0001';

/** The MemoryStore with the V1.8.0 constraints this path can trip: coachip_model_runs' NOT NULLs and coachip_moments_check2. */
class ConstraintStore extends MemoryStore {
  async insert(table, list) {
    if (table === 'coachip_model_runs') {
      for (const r of list) {
        for (const col of ['session_id', 'analysis', 'target', 'model', 'prompt_version', 'input_hash', 'purpose']) {
          if (r[col] == null) throw new Error(`insert coachip_model_runs: null value in column "${col}" violates not-null constraint`);
        }
      }
    }
    return super.insert(table, list);
  }
  async update(table, id, patch) {
    if (table === 'coachip_moments') {
      const next = { ...this.rows(table).find((x) => x.id === id), ...patch };
      if (next.gloss_status === 'ok' && next.gloss_model_run_id == null) {
        throw new Error('update coachip_moments: new row for relation "coachip_moments" violates check constraint "coachip_moments_check2"');
      }
    }
    return super.update(table, id, patch);
  }
}

const fact = () => ({ id: 'f1', session_id: SID, allowed: readAllowed({ lp_fidelity: F.lp([F.move('m7', 'independent', 'not_done', { at: '12:30' })]) }) });
const pendingMoment = () => ({ id: MID, fact_id: 'f1', session_id: SID, w_id: 'W-IP', phase: 'independent', move_id: 'm7', kind: 'missing',
  moment_s: 750, from_s: 740, to_s: 800, confidence: 'high', gloss_status: 'pending', gloss_en: null, gloss_ur: null, gloss_model_run_id: null });

async function night(store, fetch, jobRunId) {
  const stored = store.rows('coachip_moments').find((m) => m.id === MID);
  const m = { ...stored };
  const ctx = createModelContext({ capUsd: 2, write: true, store, jobRunId, log: () => {},
    deps: { fetch, apiKey: 'k', readClient: memoryClient({ coaching_sessions: [{ id: SID, user_id: 'u1' }] }) } });
  await runGlosses(ctx, { shown: [MID], moments: [m], facts: [fact()] });
  return ctx;
}

test('a re-glossed moment whose gloss and re-check calls are reused: stored ok with the first run\'s id, nothing re-inserted', async () => {
  const store = new ConstraintStore();
  store.rows('coachip_moments').push(pendingMoment());
  const fetch = X.scriptedFetch([X.ok({ gloss_en: X.GLOSS.clean.en, gloss_ur: X.GLOSS.clean.ur }), X.ok({ faithful: true })]);

  await night(store, fetch, 'job-night-1');
  const runs1 = store.rows('coachip_model_runs');
  expect(runs1).toHaveLength(2);                                          // the gloss and its re-check
  const glossRunId = runs1.find((r) => r.purpose !== 'recheck').id;
  const first = store.rows('coachip_moments')[0];
  expect(first).toMatchObject({ gloss_status: 'ok', gloss_model_run_id: glossRunId });
  expect(first.gloss_en.startsWith('At minute 13: ')).toBe(true);

  // The reset (lead-final 223945): back to pending, text cleared, nothing else changed.
  Object.assign(first, { gloss_status: 'pending', gloss_en: null, gloss_ur: null, gloss_model_run_id: null });

  const two = await night(store, fetch, 'job-night-2');
  expect(fetch.calls).toHaveLength(2);                                    // the second night paid for nothing
  expect(store.rows('coachip_model_runs')).toHaveLength(2);               // and inserted nothing
  expect(two.summary.calls).toBe(0);
  expect(store.rows('coachip_moments')[0]).toMatchObject({ gloss_status: 'ok', gloss_model_run_id: glossRunId });
  expect(store.rows('coachip_moments')[0].gloss_en.startsWith('At minute 13: ')).toBe(true);
});
