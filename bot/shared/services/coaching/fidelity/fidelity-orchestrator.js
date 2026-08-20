'use strict';
/**
 * P3.3 — the LP-fidelity orchestrator a coaching job calls (bd-wmfsp.8).
 *
 * Resolves the prescribed move-list — corpus (the store, by the LP version the teacher downloaded) OR
 * uploaded ("Add my own lesson plan", extracted on the fly) — then grades it against the transcript and
 * scores it. Returns the persist blob (analysis_data.lp_fidelity, D20) or a status.
 *
 * NON-BLOCKING BY CONTRACT: this never throws. Any failure returns { status: 'fidelity_unavailable' } so
 * a fidelity problem can never fail the coaching job (the report simply falls back). The caller also
 * gates on isFidelityEnabled() before calling, so the feature ships OFF.
 *
 * All collaborators are injectable (deps) for unit testing. Refs: bd-wmfsp.8, D19/D20/D22/D23.
 */

function isFidelityEnabled() {
  return process.env.LP_FIDELITY_ENABLED === 'true';
}

/**
 * Decide the fidelity inputs for a coaching session (bd-dflr7).
 *   - a corpus `_fidelity_ref` (teacher picked a Taleemabad LP) → corpusKey, preferred.
 *   - else any extracted uploaded-LP text → uploadedText — REGARDLESS of link_method.
 *     (Auto-detected uploads carry link_method=null, not 'uploaded'; the old gate on
 *     link_method==='uploaded' + the never-populated lesson_plan_text meant uploaded
 *     fidelity never fired.)
 * `lesson_plan_text` is only stored for CONFIRMED lesson plans, so its presence is the signal.
 * @param {object} session
 * @returns {{corpusKey: object|null, uploadedText: string|null, meta: object}}
 */
function resolveFidelitySources(session) {
  const s = session || {};
  const fidelityRef = s.lesson_plan_structured && s.lesson_plan_structured._fidelity_ref;
  if (fidelityRef) {
    return { corpusKey: fidelityRef, uploadedText: null, meta: { lesson_id: fidelityRef.lesson_id } };
  }
  return { corpusKey: null, uploadedText: s.lesson_plan_text || null, meta: {} };
}

/**
 * @param {object} input  { corpusKey?:{lesson_id,version_stamp,content_hash}, uploadedText?:string,
 *                          transcript:string, meta?:object }
 * @param {object} deps    { resolveMoveList, extractUploadedLp, analyzeFidelity, scoreFidelity } (optional)
 * @returns {Promise<null | {status:'ok'|'lp_absent'|'fidelity_unavailable', ...}>}
 */
async function computeLpFidelity(input = {}, deps = {}) {
  const resolveMoveList = deps.resolveMoveList || require('./lp-fidelity-store').resolveMoveList;
  const extractUploadedLp = deps.extractUploadedLp || require('./lp-upload-extractor').extractUploadedLp;
  const analyzeFidelity = deps.analyzeFidelity || require('./fidelity-analyzer').analyzeFidelity;
  const scoreFidelity = deps.scoreFidelity || require('./fidelity-scorer').scoreFidelity;

  if (!input || !input.transcript) return null; // nothing to grade against

  try {
    let moves = null;
    let source = null;
    let meta = { ...(input.meta || {}) };

    // 1) corpus LP the teacher selected — resolve the EXACT version she downloaded (never "latest")
    if (input.corpusKey && input.corpusKey.lesson_id) {
      const resolved = await resolveMoveList(input.corpusKey);
      if (resolved && Array.isArray(resolved.moves) && resolved.moves.length) {
        moves = resolved.moves;
        source = 'corpus';
        meta = { ...meta, lesson_id: resolved.lesson_id, template: resolved.template };
      }
    }

    // 2) else her own uploaded LP — extract the move-list on the fly (same schema downstream)
    if (!moves && input.uploadedText) {
      const ext = await extractUploadedLp(input.uploadedText, { lessonId: meta.lesson_id });
      if (ext && Array.isArray(ext.moves) && ext.moves.length) {
        moves = ext.moves;
        source = 'uploaded';
        meta = { ...meta, template: 'UPLOADED', goal: ext.goal };
      }
    }

    if (!moves || !moves.length) return { status: 'lp_absent' };

    // 3) grade + score. (D23: a 2–3-call median is a follow-up; single temp-0 call for now.)
    const graded = await analyzeFidelity(moves, input.transcript, meta);
    const analysis = scoreFidelity(moves, graded.verdicts);

    return {
      status: 'ok',
      source,
      lesson_id: meta.lesson_id || null,
      ...analysis,
      narrative: graded.narrative || null,
      language_note: graded.language_note || null,
      moderators: graded.moderators || null,
      model: graded.model || null,
      graded_at: null, // stamped by the caller (Date.now unavailable here / keep deterministic)
    };
  } catch (e) {
    // never fail the coaching job — surface as a status the report can fall back on
    return { status: 'fidelity_unavailable', error: e.code || e.message };
  }
}

module.exports = { computeLpFidelity, isFidelityEnabled, resolveFidelitySources };
