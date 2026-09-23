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
 * bd-b3pop adds, each behind a Railway variable whose unset state is today's behaviour:
 *   - LP_FIDELITY_RUNS=N    N concurrent gradings (odd, at most 5), the median scored run kept whole; every run's pct,
 *                           the count requested and the spread persisted
 *   - LP_FIDELITY_PHOTO=on  the vision pass's reading of the lesson photos handed to the grader (D34), with
 *                           photo-credit-guard.js deciding in code what a photo alone can earn
 * and, whatever the variables say, three pieces of telemetry on the blob: the recording facts (fidelity-preflight.js),
 * how many prescribed moves the kept grading left unjudged, and on failure the grader's reason as `cause`.
 */
const { normalisePhotoEvidence, countPhotoCited } = require('./grader-photo-evidence');
const { guardPhotoCredit } = require('./photo-credit-guard');
const { describeRecording } = require('./fidelity-preflight');

const MAX_RUNS = 5;
const PHOTO_ON = new Set(['on', 'true', '1']);
const PHOTO_OFF = new Set(['', 'off', 'false', '0']);
const warned = new Set();

function log(message, detail) {
  try { require('../../../utils/logger').logToFile(message, detail); } catch (_) { /* logging never fails a grading */ }
}

function warnOnce(key, detail) {
  if (warned.has(key)) return;
  warned.add(key);
  log(`[lp-fidelity] ${key}`, detail);
}

/** An odd number of runs between 1 and MAX_RUNS: an even count has no single middle run to keep. */
function normaliseRuns(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n % 2 === 0 ? n + 1 : n, MAX_RUNS);
}

function fidelityRuns() {
  const raw = process.env.LP_FIDELITY_RUNS;
  if (raw == null || String(raw).trim() === '') return 1;
  const runs = normaliseRuns(raw);
  if (String(runs) !== String(raw).trim()) warnOnce('LP_FIDELITY_RUNS adjusted', { value: raw, runs });
  return runs;
}

function isPhotoEvidenceOn() {
  const v = String(process.env.LP_FIDELITY_PHOTO || '').trim().toLowerCase();
  if (!PHOTO_ON.has(v) && !PHOTO_OFF.has(v)) warnOnce('LP_FIDELITY_PHOTO not recognised, photo evidence stays off', { value: v });
  return PHOTO_ON.has(v);
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
 *                          photoEvidence?:Array<object>, runs?:number }
 *                        `runs` overrides LP_FIDELITY_RUNS (the late-LP recompute and the backfill grade once).
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

    // 3) recording facts (bd-b3pop.5): telemetry on every graded blob. Nothing here changes a verdict — bd-b3pop.19
    // refuted a truncation rule built on them.
    const recording = describeRecording(input.transcript, input.audioDurationSeconds);
    // Photo evidence (bd-b3pop.15, D34): the vision pass's reading of the lesson photos, only under LP_FIDELITY_PHOTO.
    const photos = isPhotoEvidenceOn() ? normalisePhotoEvidence(input.photoEvidence) : [];
    const graderOpts = photos.length ? { photoEvidence: photos } : {};
    const runsRequested = input.runs != null ? normaliseRuns(input.runs) : fidelityRuns();

    // bd-b3pop.31 (Eval 12 §4/§8) — a transcript with no [MM:SS] stamps is decided HERE, not by the model. Every verdict
    // above not_done must quote a stamped span, so such a recording cannot be adjudicated move by move (D19: "not
    // scored", never 0%). Luna returns recording_unusable on the D19 fixture; Gemini 3.8 Flash returned 0% +
    // lesson_mismatch in 9 of 12 runs — a teacher with a bad recording would have got 0/40 and a mismatch line. On prod
    // (2,685 graded sessions, 15–22 Sep) 2 transcripts carry no stamps and both were already unscored, so this changes
    // nothing today and takes the model out of the decision. Same blob shape as a scored run so every reader (report
    // block, coach form, applyLpFidelity, RDF) sees the not-assessed state it already handles.
    if (recording.no_timestamps) {
      const verdicts = moves.map((m) => ({
        move_id: m.move_id, verdict: 'not_adjudicable', evidence: '', evidence_translation: '',
        rationale: 'The transcript carries no timestamps, so the recording cannot be adjudicated move by move.',
      }));
      const analysis = scoreFidelity(moves, verdicts, { moderators: { plan_navigability: null, note: 'recording_unusable' } });
      log('[lp-fidelity] no timestamps in the transcript — not scored, grader not called (bd-b3pop.31)', { lesson_id: meta.lesson_id || null, moves: moves.length });
      return {
        status: 'ok',
        source,
        lesson_id: meta.lesson_id || null,
        upload_hash: source === 'uploaded' ? uploadHash : null,
        meta,
        ...analysis,
        narrative: null,
        language_note: 'The transcript carries no [MM:SS] timestamps; the recording was not graded.',
        model: null,
        reasoning_effort: null,
        recording,
        runs: [],
        runs_requested: runsRequested,
        spread: null,
        missing_verdicts: 0,
        photo_citations: null,
        unusable_guard: 'no_timestamps',
        graded_at: null,
      };
    }

    // 4) grade + score — N runs, the median scored run kept (D23 / bd-5uloh). N=1 is today's single call plus one
    // retry (bd-5knlj: 4 observations lost Section B to a single transient analyzer failure in a week).
    // The grader's moderators go IN so the scorer can check the note against the verdicts written beside
    // it; the scorer's moderators come back out (below) as the single writer of that block on this path.
    const { graded, analysis, runs, spread } = await gradeWithRuns(
      { analyzeFidelity, scoreFidelity }, { moves, transcript: input.transcript, meta, graderOpts, photos }, runsRequested,
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
      // bd-b3pop — additive: every existing reader keys on status / fidelity_pct / moves and is unaffected. The voice
      // note and the debrief guide strip these (fidelity-telemetry.js).
      reasoning_effort: graded.reasoning_effort || null,
      // bd-29r3o: the analyzer marks a grading that only came back after an empty first answer. It has to survive this
      // hop or the marker dies one hop short of the blob and the degradation is invisible again — which is how the
      // hardcoded low-effort retry ran unnoticed until the first prod row was opened by hand.
      empty_retry: Boolean(graded.empty_retry),
      recording,
      runs,
      runs_requested: runsRequested,
      spread,
      missing_verdicts: graded.missing_verdicts || 0,
      photo_citations: photos.length ? { photos: photos.length, moves_cited: countPhotoCited(analysis.moves) } : null,
      graded_at: null, // stamped by the caller (Date.now unavailable here / keep deterministic)
    };
  } catch (e) {
    // never fail the coaching job — surface as a status the report can fall back on
    return { status: 'fidelity_unavailable', error: e.code || e.message, cause: e.reason || null };
  }
}

/**
 * bd-b3pop.12 (D23 / bd-5uloh) — grade N times and keep the median. Identical audio + plan re-graded moved
 * fidelity_pct by a mean 11.1 pts on prod; one call is one draw. N=1 reproduces today's call-then-retry exactly.
 * N>1: the calls run concurrently and each answer is scored on its own, so an answer the scorer cannot read is skipped
 * rather than fatal. The median of the runs that produced a percentage is kept whole — its verdicts, evidence and
 * narrative stay one coherent grading, never a per-move blend — unless most runs produced none, in which case a run
 * without one is kept. If every call fails, the first failure propagates (the caller turns it into fidelity_unavailable).
 * @returns {Promise<{graded:object, analysis:object, runs:Array<{pct:number|null, model:string|null}>, spread:number|null}>}
 */
async function gradeWithRuns({ analyzeFidelity, scoreFidelity }, { moves, transcript, meta, graderOpts, photos }, n) {
  let answered;
  if (n <= 1) {
    let graded;
    try {
      graded = await analyzeFidelity(moves, transcript, meta, graderOpts);
    } catch (firstErr) {
      log('[lp-fidelity] grading failed, retrying once', { reason: firstErr.reason || firstErr.code || null, error: firstErr.message });
      graded = await analyzeFidelity(moves, transcript, meta, graderOpts);
    }
    answered = [graded];
  } else {
    const settled = await Promise.allSettled(Array.from({ length: n }, () => analyzeFidelity(moves, transcript, meta, graderOpts)));
    answered = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed = settled.filter((r) => r.status === 'rejected').map((r) => r.reason);
    if (failed.length) {
      log('[lp-fidelity] grading runs failed', { failed: failed.length, of: n, reasons: failed.map((e) => (e && (e.reason || e.code)) || null) });
    }
    if (!answered.length) throw failed[0];
  }

  const scored = [];
  let scoreErr = null;
  for (const graded of answered) {
    try {
      const { verdicts, guarded } = guardPhotoCredit(moves, graded.verdicts, photos);
      const analysis = scoreFidelity(moves, verdicts, { moderators: graded.moderators });
      for (const { move_id: id, before, reason } of guarded) {
        const row = (analysis.moves || []).find((r) => r && r.move_id === id);
        if (row) Object.assign(row, { photo_guard: reason, verdict_before_guard: before });
      }
      scored.push({ graded, analysis });
    } catch (e) {
      scoreErr = scoreErr || e;
      log('[lp-fidelity] a grading could not be scored, skipped', { error: e.message });
    }
  }
  if (!scored.length) throw scoreErr;

  const rank = (p) => (p == null ? -1 : p);
  scored.sort((a, b) => rank(a.analysis.fidelity_pct) - rank(b.analysis.fidelity_pct));
  const withPct = scored.filter((x) => x.analysis.fidelity_pct != null);
  const pool = withPct.length * 2 >= scored.length ? withPct : scored.filter((x) => x.analysis.fidelity_pct == null);
  const pick = pool[Math.floor((pool.length - 1) / 2)];
  const pcts = withPct.map((x) => x.analysis.fidelity_pct);
  return {
    graded: pick.graded,
    analysis: pick.analysis,
    runs: scored.map((x) => ({ pct: x.analysis.fidelity_pct, model: x.graded.model || null })),
    spread: pcts.length >= 2 ? Math.round((Math.max(...pcts) - Math.min(...pcts)) * 10) / 10 : null,
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
  computeLpFidelity, isFidelityEnabled, isPhotoEvidenceOn, resolveFidelitySources, UPLOAD_TEXT_CAP, fidelityPatch, uploadTextHash,
};
