'use strict';
/**
 * bd-5knlj — late-LP recovery.
 *
 * A lesson plan that reaches a session AFTER its analysis already ran used to
 * be silently useless: the coach picked/uploaded a plan, nothing recomputed,
 * and Section B stayed on its "no usable lesson plan" fallback forever.
 * Measured on prod (Aug 24 – Sep 1): 12 observation sessions with an LP linked
 * and no fidelity, plus every extraction that lost the race against analysis.
 *
 * This recomputes ONLY the fidelity section — computeLpFidelity + the same
 * applyLpFidelity the analysis processor uses — and persists it while, and only
 * while, the observer's review has NOT been submitted. The persist is CAS-
 * guarded on those statuses so a concurrent review submission always wins.
 * The review Flow builds its screens from analysis_data on every exchange, so
 * a persisted recompute surfaces the next time the coach opens Section B.
 *
 * Never throws into a caller; callers treat it as fire-and-forget.
 */

const { logToFile } = require('../../../utils/logger');

/** Statuses in which the fidelity section may still be rewritten. */
const RECOMPUTABLE_STATUSES = ['analysis_started', 'analysis_complete', 'awaiting_observer_review'];

/**
 * bd-2kxxa.4 — statuses in which the observer's review is in (or the session is
 * over): the linked plan can no longer change. The LP list handler checks these
 * BEFORE linking so the coach hears the truth instead of "linked".
 */
const REVIEW_SUBMITTED_STATUSES = ['observer_review_complete', 'completed', 'cancelled'];

/**
 * bd-2kxxa.4 — was this ok blob graded from the plan that is linked NOW?
 * 'already_ok' used to fire on ANY scored blob, so a coach correcting the plan
 * before submitting was refused as silently as one tapping after. Unknown
 * provenance counts as DIFFERENT: a tap or upload is an explicit intent and we
 * cannot prove the score already reflects it. One exception: an uploaded blob
 * with no upload_hash (pre-hash) against an upload — indistinguishable, keep it.
 */
function gradedPlanIsLinkedPlan(session, lpFidelity, { resolveFidelitySources, uploadTextHash }) {
  const { corpusKey, uploadedText } = resolveFidelitySources(session);
  const gradedLessonId = lpFidelity.lesson_id
    || (lpFidelity.meta && lpFidelity.meta.lesson_id) || null;
  if (corpusKey && corpusKey.lesson_id) return gradedLessonId === corpusKey.lesson_id;
  if (uploadedText) {
    if (lpFidelity.source !== 'uploaded') return false;
    if (!lpFidelity.upload_hash) return true;
    return lpFidelity.upload_hash === uploadTextHash(uploadedText);
  }
  return true; // nothing linked → nothing new to grade against
}

async function defaultLoadSession(sessionId) {
  const supabase = require('../../../config/supabase');
  const { data } = await supabase
    .from('coaching_sessions')
    .select('id, status, transcript_text, lesson_plan_structured, lesson_plan_text, analysis_data, observation_type')
    .eq('id', sessionId)
    .maybeSingle();
  return data || null;
}

async function defaultPersist(sessionId, patch, allowedStatuses) {
  const supabase = require('../../../config/supabase');
  const { data, error } = await supabase
    .from('coaching_sessions')
    .update(patch)
    .eq('id', sessionId)
    .in('status', allowedStatuses)
    .select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: !!(data && data.length) };
}

function defaultApplyLpFidelity(analysis, lpFidelity) {
  try {
    const fico = require('../frameworks/fico-framework');
    if (analysis && analysis.framework === 'fico' && typeof fico.applyLpFidelity === 'function') {
      return fico.applyLpFidelity(analysis, lpFidelity) || analysis;
    }
  } catch (e) {
    logToFile('[fidelity-recompute] applyLpFidelity failed — persisting blob only', { error: e.message });
  }
  return analysis;
}

async function recomputeFidelityForSession(sessionId, opts = {}) {
  const loadSession = opts.loadSession || defaultLoadSession;
  const compute = opts.computeLpFidelity || require('./fidelity-orchestrator').computeLpFidelity;
  const apply = opts.applyLpFidelity || defaultApplyLpFidelity;
  const persist = opts.persist || defaultPersist;
  const log = opts.log || logToFile;

  try {
    const session = await loadSession(sessionId);
    if (!session) return { recomputed: false, reason: 'not_found' };
    if (!RECOMPUTABLE_STATUSES.includes(session.status)) {
      return { recomputed: false, reason: 'review_submitted' };
    }
    const analysis = session.analysis_data || null;
    if (!analysis || analysis.framework !== 'fico') return { recomputed: false, reason: 'not_fico' };
    if (!session.transcript_text) return { recomputed: false, reason: 'no_transcript' };
    // bd-s192t.3 — ok is terminal only with a usable score. ok/pct-null is the
    // guard-refusal shape (all moves not_adjudicable, Section B empty); treating
    // it as "already ok" stranded the entire Aug/Sep unusable cohort with no
    // recovery path. Those blobs must stay recomputable.
    // bd-2kxxa.4 — and ok is terminal only for the plan that is linked NOW.
    const orchestrator = require('./fidelity-orchestrator');
    const { resolveFidelitySources } = orchestrator;
    if (analysis.lp_fidelity && analysis.lp_fidelity.status === 'ok'
        && analysis.lp_fidelity.fidelity_pct != null
        && gradedPlanIsLinkedPlan(session, analysis.lp_fidelity, orchestrator)) {
      return { recomputed: false, reason: 'already_ok' };
    }

    const { corpusKey, uploadedText, meta } = resolveFidelitySources(session);
    const result = await compute({ corpusKey, uploadedText, transcript: session.transcript_text, meta });
    if (!result) return { recomputed: false, reason: 'no_sources' };

    if (result.status !== 'ok') {
      // Persist the failure too — invisibility is what made this class cost a
      // week of archaeology (analysis-processor:269 used to discard non-ok).
      const v = { ...analysis, lp_fidelity: result };
      await persist(sessionId, { analysis_data: v }, RECOMPUTABLE_STATUSES);
      log('[fidelity-recompute] non-ok persisted', { sessionId, status: result.status });
      return { recomputed: false, reason: result.status };
    }

    let v2 = { ...analysis, lp_fidelity: result };
    v2 = apply(v2, result) || v2;
    const saved = await persist(sessionId, { analysis_data: v2 }, RECOMPUTABLE_STATUSES);
    log('[fidelity-recompute] Section B recomputed', {
      sessionId, pct: result.fidelity_pct, source: result.source, persisted: saved && saved.ok,
    });
    return { recomputed: true, fidelity_pct: result.fidelity_pct };
  } catch (e) {
    log('[fidelity-recompute] failed (non-blocking)', { sessionId, error: e.message });
    return { recomputed: false, reason: 'error', error: e.message };
  }
}

module.exports = { recomputeFidelityForSession, RECOMPUTABLE_STATUSES, REVIEW_SUBMITTED_STATUSES };
