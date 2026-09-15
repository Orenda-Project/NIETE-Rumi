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
 *
 * bd-b3pop (grader v2) adds, each behind a Railway variable whose unset state is today's behaviour:
 *   - pre-flight recording facts + plan anchors, always computed and persisted (telemetry; the v2 prompt reads them)
 *   - LP_FIDELITY_RUNS=N       N concurrent grader calls, the median run kept, every run's pct + the spread persisted
 *   - LP_FIDELITY_PHOTO=on     the vision pass's reading of the lesson photos handed to the grader (D34)
 */
const { normalisePhotoEvidence, countPhotoCited } = require('./grader-photo-evidence');

const MAX_RUNS = 5;

function fidelityRuns() {
  const n = Math.floor(Number(process.env.LP_FIDELITY_RUNS));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_RUNS) : 1;
}

function photoEvidenceOn() {
  return String(process.env.LP_FIDELITY_PHOTO || '').trim().toLowerCase() === 'on';
}

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
    // The subject/grade the corpus key encodes travel with the key. Refs written
    // before the linker carried them hold only `lesson_id`, which encodes both — so
    // derive rather than read, and the 3,437 sessions already in the older shape
    // behave identically to a new one.
    const { parseCorpusLessonId, canonicalSubject } = require('../subject-resolution');
    const parsed = parseCorpusLessonId(fidelityRef.lesson_id);
    const subject = canonicalSubject(fidelityRef.subject) || (parsed && parsed.subject) || null;
    const grade = fidelityRef.grade != null && fidelityRef.grade !== ''
      ? String(fidelityRef.grade)
      : (parsed && parsed.grade) || null;
    const meta = { lesson_id: fidelityRef.lesson_id };
    if (subject) meta.subject = subject;
    if (grade) meta.grade = grade;
    return { corpusKey: fidelityRef, uploadedText: null, meta };
  }
  return { corpusKey: null, uploadedText: s.lesson_plan_text || null, meta: {} };
}

/**
 * @param {object} input  { corpusKey?:{lesson_id,version_stamp,content_hash}, uploadedText?:string,
 *                          transcript:string, meta?:object, audioDurationSeconds?:number,
 *                          photoEvidence?:Array<object> }
 * @param {object} deps    { resolveMoveList, extractUploadedLp, analyzeFidelity, scoreFidelity, preflight } (optional)
 * @returns {Promise<null | {status:'ok'|'lp_absent'|'fidelity_unavailable', ...}>}
 */
async function computeLpFidelity(input = {}, deps = {}) {
  const resolveMoveList = deps.resolveMoveList || require('./lp-fidelity-store').resolveMoveList;
  const extractUploadedLp = deps.extractUploadedLp || require('./lp-upload-extractor').extractUploadedLp;
  const analyzeFidelity = deps.analyzeFidelity || require('./fidelity-analyzer').analyzeFidelity;
  const scoreFidelity = deps.scoreFidelity || require('./fidelity-scorer').scoreFidelity;
  const { describeRecording, planAnchorHits } = deps.preflight || require('./fidelity-preflight');

  if (!input || !input.transcript) return null; // nothing to grade against

  try {
    let moves = null;
    let source = null;
    let uploadHash = null;
    let meta = { ...(input.meta || {}) };

    // 1) corpus LP the teacher selected — the EXACT version she downloaded first,
    // then the lesson's CURRENT list. bd-5knlj: the store is a point-in-time
    // backfill and regeneration re-stamps versions (the Aug-18 02:01 batch made
    // every seg995 pick miss exactly) — a near-identical current move-list beats
    // scoring the observation as if no plan existed. version_drift flags it.
    if (input.corpusKey && input.corpusKey.lesson_id) {
      const resolved = await resolveMoveList(input.corpusKey, { fallbackToCurrent: true });
      if (resolved && Array.isArray(resolved.moves) && resolved.moves.length) {
        moves = resolved.moves;
        source = 'corpus';
        meta = { ...meta, lesson_id: resolved.lesson_id, template: resolved.template };
        if (resolved.resolved === 'current') meta.version_drift = true;
      }
    }

    // 2) else her own uploaded LP — extract the move-list on the fly (same schema downstream).
    // bd-5knlj: cap the input — a 1,052,368-char lesson_plan_text reached this
    // uncapped on prod and the extractor produced nothing.
    if (!moves && input.uploadedText) {
      const capped = String(input.uploadedText).length > UPLOAD_TEXT_CAP
        ? String(input.uploadedText).slice(0, UPLOAD_TEXT_CAP)
        : input.uploadedText;
      const ext = await extractUploadedLp(capped, { lessonId: meta.lesson_id });
      if (ext && Array.isArray(ext.moves) && ext.moves.length) {
        moves = ext.moves;
        source = 'uploaded';
        uploadHash = uploadTextHash(capped);
        meta = { ...meta, template: 'UPLOADED', goal: ext.goal };
      }
    }

    if (!moves || !moves.length) return { status: 'lp_absent' };

    // 3) pre-flight facts (bd-b3pop.5): computed and persisted on every graded blob; only the v2 prompt reads them,
    // and nothing here changes a verdict (bd-b3pop.19 refuted a truncation rule built on them).
    const recording = describeRecording(input.transcript, input.audioDurationSeconds);
    const anchors = planAnchorHits(moves, input.transcript);
    const graderOpts = { facts: { recording, anchors } };
    // Photo evidence (bd-b3pop.15, D34) — the vision pass's reading of the lesson photos, only under LP_FIDELITY_PHOTO=on.
    const photos = photoEvidenceOn() ? normalisePhotoEvidence(input.photoEvidence) : [];
    if (photos.length) graderOpts.photoEvidence = photos;

    // 4) grade + score — N runs, median kept (D23 / bd-5uloh). N=1 is today's single call plus one retry
    // (bd-5knlj: 4 observations lost Section B to a single transient analyzer failure in a week).
    // The grader's moderators go IN so the scorer can check the note against the verdicts written beside
    // it; the scorer's moderators come back out (below) as the single writer of that block on this path.
    const { graded, analysis, runs, spread } = await gradeWithRuns(
      { analyzeFidelity, scoreFidelity }, moves, input.transcript, meta, graderOpts, fidelityRuns(),
    );

    return {
      status: 'ok',
      source,
      lesson_id: meta.lesson_id || null,
      // bd-2kxxa.4: identity of the uploaded plan this blob was graded from, so the
      // recompute gate can tell a re-upload from the same document. Top-level, not
      // in meta — meta is the grader's prompt input.
      upload_hash: source === 'uploaded' ? uploadHash : null,
      meta,
      ...analysis,
      narrative: graded.narrative || null,
      language_note: graded.language_note || null,
      // NOT `graded.moderators` — the scorer returns that block with its own
      // truncation_inconsistent finding folded in, and re-reading the grader's copy
      // here would silently drop it. One writer.
      model: graded.model || null,
      // bd-b3pop — additive: every existing reader keys on status / fidelity_pct / moves and is unaffected.
      prompt_version: graded.prompt_version || 'v1',
      reasoning_effort: graded.reasoning_effort || null,
      recording,
      anchors,
      lesson_identity: graded.lesson_identity || null,
      lesson_stretches: graded.lesson_stretches || null,
      runs,
      spread,
      photo_evidence: photos.length ? { count: photos.length, moves_cited: countPhotoCited(analysis.moves) } : null,
      graded_at: null, // stamped by the caller (Date.now unavailable here / keep deterministic)
    };
  } catch (e) {
    // never fail the coaching job — surface as a status the report can fall back on
    return { status: 'fidelity_unavailable', error: e.code || e.message };
  }
}

/**
 * bd-b3pop.12 (D23 / bd-5uloh) — grade N times and keep the median. Identical audio + plan re-graded moved
 * fidelity_pct by a mean 11.1 pts on prod; one call is one draw. N=1 reproduces today's call-then-retry exactly.
 * N>1: the calls run concurrently, each is scored, the (lower) median run is kept whole — its verdicts, evidence
 * and narrative stay one coherent grading, never a per-move blend. A failed call is skipped; if every call fails,
 * one last call is made and its error propagates (the caller turns it into fidelity_unavailable).
 * @returns {Promise<{graded:object, analysis:object, runs:Array<{pct:number|null, model:string|null}>, spread:number|null}>}
 */
async function gradeWithRuns({ analyzeFidelity, scoreFidelity }, moves, transcript, meta, opts, n) {
  const scoreRun = (g) => scoreFidelity(moves, g.verdicts, { moderators: g.moderators });
  if (!(n > 1)) {
    let graded;
    try {
      graded = await analyzeFidelity(moves, transcript, meta, opts);
    } catch (firstErr) {
      graded = await analyzeFidelity(moves, transcript, meta, opts);
    }
    const analysis = scoreRun(graded);
    return { graded, analysis, runs: [{ pct: analysis.fidelity_pct, model: graded.model || null }], spread: 0 };
  }
  const settled = await Promise.allSettled(Array.from({ length: n }, () => analyzeFidelity(moves, transcript, meta, opts)));
  let answered = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!answered.length) answered = [await analyzeFidelity(moves, transcript, meta, opts)];
  const rank = (p) => (p == null ? -1 : p);
  const scored = answered.map((g) => ({ graded: g, analysis: scoreRun(g) }))
    .sort((a, b) => rank(a.analysis.fidelity_pct) - rank(b.analysis.fidelity_pct));
  const pick = scored[Math.floor((scored.length - 1) / 2)];
  const pcts = scored.map((x) => x.analysis.fidelity_pct).filter((p) => p != null);
  return {
    graded: pick.graded,
    analysis: pick.analysis,
    runs: scored.map((x) => ({ pct: x.analysis.fidelity_pct, model: x.graded.model || null })),
    spread: pcts.length ? Math.round((Math.max(...pcts) - Math.min(...pcts)) * 10) / 10 : null,
  };
}

// bd-5knlj: uploaded-LP text cap (chars) before extraction.
const UPLOAD_TEXT_CAP = 24000;

/**
 * bd-2kxxa.4: sha1 of an uploaded plan's text exactly as the extractor sees it
 * (capped), so the same document hashes the same whether or not it was over the
 * cap. null for no text.
 */
function uploadTextHash(text) {
  if (text == null || text === '') return null;
  const s = String(text);
  const capped = s.length > UPLOAD_TEXT_CAP ? s.slice(0, UPLOAD_TEXT_CAP) : s;
  return require('crypto').createHash('sha1').update(capped, 'utf8').digest('hex');
}

/**
 * The persist patch for a computeLpFidelity result. NON-ok statuses persist
 * too (bd-5knlj): lp_absent vs fidelity_unavailable vs never-ran used to be
 * indistinguishable, which cost a week of archaeology. Every reader guards on
 * status === 'ok' (extractFidelity, composeEditableFidelity, applyLpFidelity).
 */
function fidelityPatch(lpFidelity) {
  return lpFidelity ? { lp_fidelity: lpFidelity } : {};
}

module.exports = {
  computeLpFidelity, isFidelityEnabled, resolveFidelitySources, UPLOAD_TEXT_CAP, fidelityPatch, uploadTextHash,
  gradeWithRuns, fidelityRuns, MAX_RUNS,
};
