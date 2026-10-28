'use strict';
/**
 * bd-sex15q.39 — the second models night must not die on a reused phonics call (board 20261027T202449).
 *
 * runPhonics records the detector's row. When findRun finds the same call from an earlier night, callModel returns that
 * stored row ({ id, status, output }, model-stage.js findRun) with reused: true, and detectPhonics passed it on as `row`.
 * Recording it inserted a coachip_model_runs row with no session_id, analysis or model; Postgres refused it (NOT NULL,
 * V1.8.0) and every night after the first failed `after=moments` (staging, 27 Oct 2026). The homework path already
 * skips the insert for a reused call; phonics must too, and keep the stored run's id for detector_run_id.
 *
 * The chain under test: createModelContext (write mode, the real findRun over the store) → runPhonics → Ph.detectPhonics
 * → M.callModel, twice on one store (two nights). fetch is scripted; the transcript is the fixtures' fictional placeholder.
 */
const { createModelContext, runPhonics } = require('../../lib/insights/model-stage');
const { MemoryStore, memoryClient } = require('../../lib/insights/store');
const X = require('./fixtures/model');

const SID = '00000000-0000-4000-8000-0000000c0001';

/** The MemoryStore with coachip_model_runs' NOT NULL columns enforced, as Postgres does (V1.8.0). */
class NotNullStore extends MemoryStore {
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
}

const fact = () => ({ id: 'f1', instrument: 'lp_fidelity', status: 'ok', is_duplicate: false, is_mismatch: false, is_unusable: false,
  lesson_type: 'literacy_phonics', session_id: SID, recorded_at: '2026-10-20T05:00:00Z', grade: 2, subject: 'urdu' });

async function night(store, fetch, jobRunId) {
  const ctx = createModelContext({ capUsd: 2, write: true, store, jobRunId, log: () => {},
    deps: { fetch, apiKey: 'k', readClient: memoryClient({ coaching_sessions: [{ id: SID, transcript_text: X.TRANSCRIPT }] }) } });
  const f = fact();
  await runPhonics(ctx, { facts: [f], inWindow: () => true });
  return { f, ctx };
}

describe.each([
  ['not literacy (not_applicable, as on staging)', { applicable: false }],
  ['a scored lesson (ok)', { stages: [['sound', X.Q.sound]] }],
])('runPhonics on the second night: %s', (_label, out) => {
  test('reuses the first night\'s run: no second insert, no stub row, the stored id kept', async () => {
    const store = new NotNullStore();
    const fetch = X.scriptedFetch([X.ok(X.phonicsOut(out), { cost: 0.002 })]);
    const one = await night(store, fetch, 'job-night-1');
    const runs1 = store.rows('coachip_model_runs').length;
    expect(runs1).toBe(1);
    const firstId = store.rows('coachip_model_runs')[0].id;

    const two = await night(store, fetch, 'job-night-2');
    expect(fetch.calls).toHaveLength(1);                                // the second night paid for nothing
    expect(store.rows('coachip_model_runs')).toHaveLength(runs1);      // and inserted nothing
    expect(two.ctx.summary.calls).toBe(0);
    if (one.f.detector) expect(two.f.detector_run_id).toBe(firstId);  // W-PHON signals still point at the stored run
  });
});
