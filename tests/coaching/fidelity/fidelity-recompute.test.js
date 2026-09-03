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

  it('is a no-op when fidelity is already ok — for the plan that is linked', async () => {
    // bd-2kxxa.4: "already ok" is only terminal when the graded plan IS the linked
    // plan (makeDeps links g3_u_ch1_seg1), so the blob must name what it graded.
    const { deps, updates } = makeDeps({ session: { analysis_data: { framework: 'fico', lp_fidelity: { status: 'ok', fidelity_pct: 50, source: 'corpus', lesson_id: 'g3_u_ch1_seg1' } } } });
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

  // bd-s192t.3 — ok-with-null-pct is NOT a result, it is the guard-refusal
  // shape (every move not_adjudicable, nothing scored, Section B empty). The
  // 241-session Aug/Sep cohort was stranded because this gate treated it as
  // terminal: no late LP tap, extraction, or transcript repair could ever
  // recompute it. Only ok WITH a usable pct is "already ok".
  it('recomputes an ok blob whose fidelity_pct is null (guard-refused) instead of treating it as terminal', async () => {
    const { deps, updates } = makeDeps({
      session: {
        analysis_data: {
          framework: 'fico',
          lp_fidelity: { status: 'ok', fidelity_pct: null, recording_unusable: true },
        },
      },
    });
    const res = await recomputeFidelityForSession('cs-1', deps);
    expect(res.recomputed).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.analysis_data.lp_fidelity.fidelity_pct).toBe(70);
  });
});

/**
 * bd-2kxxa.4 — 'already_ok' used to fire on ANY ok blob with a score, without
 * asking which plan produced it. A coach correcting the linked plan BEFORE
 * submitting the review was refused as silently as one tapping after. Now the
 * gate compares the linked plan (lesson_plan_structured._fidelity_ref, or the
 * uploaded text) against the plan the blob was graded from (lesson_id / source /
 * upload_hash) and only skips when they are the same plan.
 */
describe("already_ok only when the graded plan IS the linked plan (bd-2kxxa.4)", () => {
  const { uploadTextHash } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');
  const graded = (extra = {}) => ({
    framework: 'fico',
    lp_fidelity: { status: 'ok', fidelity_pct: 62, source: 'corpus', lesson_id: 'lessonA', ...extra },
  });
  function spyDeps(overrides) {
    const built = makeDeps(overrides);
    const inner = built.deps.computeLpFidelity;
    let computeCalls = 0;
    built.deps.computeLpFidelity = async (...a) => { computeCalls += 1; return inner(...a); };
    built.computeCalls = () => computeCalls;
    return built;
  }

  it('T3a graded against lesson A, now linked to lesson B → compute runs and the new grade persists', async () => {
    const b = spyDeps({ session: {
      analysis_data: graded(),
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'lessonB', version_stamp: 'v8' } },
    } });
    const res = await recomputeFidelityForSession('cs-1', b.deps);
    expect(res.recomputed).toBe(true);
    expect(b.computeCalls()).toBe(1);
    expect(b.updates).toHaveLength(1);
    expect(b.updates[0].patch.analysis_data.lp_fidelity.fidelity_pct).toBe(70);
  });

  it('T3b graded against lesson A, still linked to lesson A → already_ok and compute NOT called', async () => {
    const b = spyDeps({ session: {
      analysis_data: graded(),
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'lessonA', version_stamp: 'v8' } },
    } });
    const res = await recomputeFidelityForSession('cs-1', b.deps);
    expect(res).toEqual({ recomputed: false, reason: 'already_ok' });
    expect(b.computeCalls()).toBe(0);
    expect(b.updates).toHaveLength(0);
  });

  it('graded from her upload, now a corpus plan is linked → recomputes', async () => {
    const b = spyDeps({ session: {
      analysis_data: graded({ source: 'uploaded', lesson_id: null }),
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'lessonB' } },
    } });
    const res = await recomputeFidelityForSession('cs-1', b.deps);
    expect(res.recomputed).toBe(true);
    expect(b.computeCalls()).toBe(1);
  });

  it('graded against corpus A, now her own upload replaced it → recomputes', async () => {
    const b = spyDeps({ session: {
      analysis_data: graded(),
      lesson_plan_structured: {},
      lesson_plan_text: 'her own plan',
    } });
    const res = await recomputeFidelityForSession('cs-1', b.deps);
    expect(res.recomputed).toBe(true);
    expect(b.computeCalls()).toBe(1);
  });

  it('re-upload: a different document recomputes, the same document is already_ok', async () => {
    const gradedUpload = graded({ source: 'uploaded', lesson_id: null, upload_hash: uploadTextHash('old plan') });
    const changed = spyDeps({ session: { analysis_data: gradedUpload, lesson_plan_structured: {}, lesson_plan_text: 'new plan' } });
    expect((await recomputeFidelityForSession('cs-1', changed.deps)).recomputed).toBe(true);
    expect(changed.computeCalls()).toBe(1);

    const same = spyDeps({ session: { analysis_data: gradedUpload, lesson_plan_structured: {}, lesson_plan_text: 'old plan' } });
    expect((await recomputeFidelityForSession('cs-1', same.deps)).reason).toBe('already_ok');
    expect(same.computeCalls()).toBe(0);
  });

  it('legacy uploaded blob with no upload_hash + an upload linked → already_ok (cannot tell them apart)', async () => {
    const b = spyDeps({ session: {
      analysis_data: graded({ source: 'uploaded', lesson_id: null }),
      lesson_plan_structured: {},
      lesson_plan_text: 'some plan',
    } });
    expect((await recomputeFidelityForSession('cs-1', b.deps)).reason).toBe('already_ok');
    expect(b.computeCalls()).toBe(0);
  });

  it('legacy blob naming no plan at all, corpus linked → recomputes (cannot prove it graded THIS plan)', async () => {
    const b = spyDeps({ session: {
      analysis_data: { framework: 'fico', lp_fidelity: { status: 'ok', fidelity_pct: 62 } },
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'lessonB' } },
    } });
    expect((await recomputeFidelityForSession('cs-1', b.deps)).recomputed).toBe(true);
    expect(b.computeCalls()).toBe(1);
  });
});
