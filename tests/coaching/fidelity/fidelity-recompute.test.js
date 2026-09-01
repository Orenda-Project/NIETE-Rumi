'use strict';
/**
 * bd-5knlj — late-LP recovery. When a lesson plan reaches a session AFTER its
 * analysis already ran (a late list tap, or the extraction worker landing after
 * the analysis raced past it), Section B used to stay empty forever: nothing
 * recomputed fidelity. This service recomputes and re-persists — while, and
 * only while, the observer's review has not been submitted.
 */
const { recomputeFidelityForSession, RECOMPUTABLE_STATUSES } = require('../../../bot/shared/services/coaching/fidelity/fidelity-recompute.service');

function makeDeps(overrides = {}) {
  const session = {
    id: 'cs-1',
    status: 'awaiting_observer_review',
    transcript_text: 'a long transcript',
    lesson_plan_structured: { _fidelity_ref: { lesson_id: 'g3_u_ch1_seg1', version_stamp: 'v8' } },
    lesson_plan_text: null,
    analysis_data: { framework: 'fico', domains: {} },
    ...overrides.session,
  };
  const updates = [];
  return {
    session,
    updates,
    deps: {
      loadSession: async () => session,
      computeLpFidelity: overrides.computeLpFidelity
        || (async () => ({ status: 'ok', fidelity_pct: 70, band: 'green', moves: [{ text: 'm1', verdict: 'done' }], prescribed_count: 1 })),
      applyLpFidelity: overrides.applyLpFidelity || ((analysis) => analysis),
      persist: async (sessionId, patch, allowedStatuses) => { updates.push({ sessionId, patch, allowedStatuses }); return { ok: true }; },
      log: () => {},
    },
  };
}

describe('recomputeFidelityForSession', () => {
  it('recomputes, applies Section B, and persists — gated to unsubmitted-review statuses', async () => {
    const { deps, updates } = makeDeps();
    const res = await recomputeFidelityForSession('cs-1', deps);
    expect(res.recomputed).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.analysis_data.lp_fidelity.status).toBe('ok');
    // the CAS statuses: a submitted review must never be overwritten
    expect(updates[0].allowedStatuses).toEqual(RECOMPUTABLE_STATUSES);
    expect(RECOMPUTABLE_STATUSES).not.toContain('observer_review_complete');
    expect(RECOMPUTABLE_STATUSES).not.toContain('completed');
  });

  it('refuses when the review is already submitted', async () => {
    const { deps, updates } = makeDeps({ session: { status: 'observer_review_complete' } });
    const res = await recomputeFidelityForSession('cs-1', deps);
    expect(res.recomputed).toBe(false);
    expect(res.reason).toBe('review_submitted');
    expect(updates).toHaveLength(0);
  });

  it('is a no-op when fidelity is already ok', async () => {
    const { deps, updates } = makeDeps({ session: { analysis_data: { framework: 'fico', lp_fidelity: { status: 'ok', fidelity_pct: 50 } } } });
    const res = await recomputeFidelityForSession('cs-1', deps);
    expect(res.recomputed).toBe(false);
    expect(res.reason).toBe('already_ok');
    expect(updates).toHaveLength(0);
  });

  it('persists a NON-ok status too — the failure must be visible, not silent', async () => {
    const { deps, updates } = makeDeps({ computeLpFidelity: async () => ({ status: 'lp_absent' }) });
    const res = await recomputeFidelityForSession('cs-1', deps);
    expect(res.recomputed).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.analysis_data.lp_fidelity.status).toBe('lp_absent');
  });

  it('never throws into its caller', async () => {
    const { deps } = makeDeps({ computeLpFidelity: async () => { throw new Error('llm down'); } });
    const res = await recomputeFidelityForSession('cs-1', deps);
    expect(res.recomputed).toBe(false);
  });
});
