'use strict';
/**
 * bd-2kxxa.5 — Section B backfill: re-transcribe a stranded observation from
 * its R2 audio and recompute lesson-plan fidelity. ONE-OFF REPAIR, not a
 * pipeline stage.
 *
 * Who this is for: the 331 coach observations created 28 Aug – 3 Sep 2026
 * whose analysis_data.lp_fidelity is {status:'ok', fidelity_pct:null}. Their
 * transcripts were produced inside the bd-s192t window — no diarization, no
 * [MM:SS] timestamps (328/331 have 0–1 diarization segments) — so the grader
 * marked every prescribed move not_adjudicable and Section B rendered blank.
 * fidelity-recompute cannot help them: it (correctly) refuses submitted
 * statuses, and re-grading the SAME flat transcript would refuse again anyway.
 * The audio is still in R2, and the transcription path is fixed, so the
 * repair is: download → transcribe with diarization → recompute → persist.
 *
 * Guarantees:
 *   - reads ONE row by id (the one legitimate whole-value read — Class R);
 *   - writes ONE update, in the exact column shape processTranscription
 *     writes (transcript_text, transcript_language, diarization_data,
 *     diarization_confidence, tokens_raw, silence_markers, audio_duration_seconds
 *     only if it was null) plus analysis_data with the recomputed lp_fidelity;
 *   - CAS-guarded: `.in('status', BACKFILL_STATUSES)` AND
 *     analysis_data->lp_fidelity->>fidelity_pct IS NULL at write time, so a
 *     concurrent live recompute is never clobbered (0 rows matched → cas_lost);
 *   - refuses to grade a re-transcript that STILL has no timestamps
 *     (still_untimestamped) — a second flat transcript is not an improvement
 *     worth writing;
 *   - never sends anything: no outbound message, no report render, no status change.
 *
 * Every boundary is injectable (deps), mirroring fidelity-recompute.service.js.
 */

const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../../utils/logger');
const { TEMP_DIR } = require('../../../utils/constants');

/** Submitted/terminal statuses the recompute service refuses; the ONLY ones this job touches. */
const BACKFILL_STATUSES = ['completed', 'observer_review_complete', 'awaiting_observer_review', 'cancelled'];

/** The grader's input contract (bd-s192t): a [MM:SS] stamp per speaker turn. */
const TIMESTAMP_RE = /\[\d{1,2}:\d{2}\]/g;

const SESSION_PROJECTION = [
  'id', 'status', 'audio_url', 'audio_duration_seconds', 'observation_type',
  'lesson_plan_structured', 'lesson_plan_text', 'analysis_data', 'transcript_text',
].join(', ');

function countTimestamps(text) {
  const m = String(text || '').match(TIMESTAMP_RE);
  return m ? m.length : 0;
}

function currentPct(analysis) {
  const lf = analysis && analysis.lp_fidelity;
  return lf && lf.fidelity_pct != null ? lf.fidelity_pct : null;
}

function segmentCount(diarization) {
  if (!diarization) return 0;
  if (typeof diarization.totalSegments === 'number') return diarization.totalSegments;
  return Array.isArray(diarization.segments) ? diarization.segments.length : 0;
}

// ─── default boundaries ────────────────────────────────────────────────────────

async function defaultLoadSession(sessionId) {
  const supabase = require('../../../config/supabase');
  // Class R: single row by primary key. Load math for the whole job: 331 rows ×
  // ~150KB, one at a time, never a set scan of a fat column.
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select(SESSION_PROJECTION)
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`load failed: ${error.message}`);
  return data || null;
}

/**
 * Download audio_url from R2 to a temp file, using the same key/URL helpers the
 * rest of the bot uses (storage/r2). Returns { path, bytes, buffer, cleanup }.
 */
async function defaultDownloadAudio(audioUrl, sessionId) {
  const { downloadFromR2, extractKeyFromUrl } = require('../../../storage/r2');
  const key = extractKeyFromUrl(audioUrl);
  const buffer = await downloadFromR2(key);
  if (!buffer || !buffer.length) throw new Error(`empty download for key ${key}`);
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const ext = path.extname(key) || '.ogg';
  const tmp = path.join(TEMP_DIR, `sectionb_backfill_${sessionId}_${Date.now()}${ext}`);
  fs.writeFileSync(tmp, buffer);
  return {
    path: tmp,
    bytes: buffer.length,
    buffer,
    cleanup: () => { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* best effort */ } },
  };
}

/**
 * The SAME call a live classroom observation makes today:
 * AudioService.transcribe(path, diarization=true, language=null, roles=null → CLASSROOM),
 * then the pipeline's own diarization/silence assembly.
 */
async function defaultTranscribe(audioPath) {
  const AudioService = require('../../audio.service');
  const { assembleDiarizedTranscription } = require('../diarization-from-tokens');
  const raw = await AudioService.transcribe(audioPath, true, null, null);
  if (!raw || typeof raw.text !== 'string') throw new Error('transcription returned no text');
  return assembleDiarizedTranscription(raw, null);
}

async function defaultProbeDuration(buffer) {
  const AudioService = require('../../audio.service');
  return AudioService.getAudioDuration(buffer);
}

function defaultApplyLpFidelity(analysis, lpFidelity) {
  try {
    const fico = require('../frameworks/fico-framework');
    if (analysis && analysis.framework === 'fico' && typeof fico.applyLpFidelity === 'function') {
      return fico.applyLpFidelity(analysis, lpFidelity) || analysis;
    }
  } catch (e) {
    logToFile('[sectionb-backfill] applyLpFidelity failed — persisting blob only', { error: e.message });
  }
  return analysis;
}

/**
 * ONE update, CAS-guarded twice: status still in the allowed set, AND the
 * fidelity pct is still null (PostgREST JSON path filter). 0 rows → not ok.
 */
async function defaultPersist(sessionId, patch, { allowedStatuses, requirePctNull }) {
  const supabase = require('../../../config/supabase');
  let q = supabase
    .from('coaching_sessions')
    .update(patch)
    .eq('id', sessionId)
    .in('status', allowedStatuses);
  if (requirePctNull) q = q.is('analysis_data->lp_fidelity->>fidelity_pct', null);
  const { data, error } = await q.select('id');
  if (error) return { ok: false, error: error.message };
  return { ok: !!(data && data.length) };
}

// ─── the job ──────────────────────────────────────────────────────────────────

/**
 * @param {string} sessionId
 * @param {object} deps  { loadSession, downloadAudio, transcribe, computeLpFidelity,
 *                         applyLpFidelity, persist, probeDuration, log, now, dryRun }
 * @returns {Promise<{ok:boolean, sessionId:string, status?:string, before:{pct:any},
 *   after?:{pct:any,status:string}, reason?:string, dryRun:boolean, persisted:boolean, wouldWrite?:object}>}
 */
async function backfillSession(sessionId, deps = {}) {
  const loadSession = deps.loadSession || defaultLoadSession;
  const downloadAudio = deps.downloadAudio || defaultDownloadAudio;
  const transcribe = deps.transcribe || defaultTranscribe;
  const compute = deps.computeLpFidelity || require('./fidelity-orchestrator').computeLpFidelity;
  const apply = deps.applyLpFidelity || defaultApplyLpFidelity;
  const persist = deps.persist || defaultPersist;
  const probeDuration = deps.probeDuration || defaultProbeDuration;
  const log = deps.log || logToFile;
  const now = deps.now || (() => new Date());
  const dryRun = !!deps.dryRun;

  const base = { sessionId, dryRun, persisted: false, before: { pct: null } };
  let audio = null;

  try {
    const session = await loadSession(sessionId);
    if (!session) return { ...base, ok: false, reason: 'not_found' };
    base.status = session.status;

    if (!BACKFILL_STATUSES.includes(session.status)) {
      return { ...base, ok: false, reason: 'status_not_backfillable' };
    }
    const analysis = session.analysis_data || null;
    if (!analysis || analysis.framework !== 'fico') return { ...base, ok: false, reason: 'not_fico' };

    const pctBefore = currentPct(analysis);
    base.before = {
      pct: pctBefore,
      transcript_chars: String(session.transcript_text || '').length,
      timestamp_count: countTimestamps(session.transcript_text),
    };
    if (pctBefore != null) return { ...base, ok: false, reason: 'skipped_not_null' };
    if (!session.audio_url) return { ...base, ok: false, reason: 'no_audio_url' };

    // 1) audio → fixed transcription path
    audio = await downloadAudio(session.audio_url, sessionId);
    const t = await transcribe(audio.path);
    const timestampCount = countTimestamps(t && t.transcript);
    const diarSegments = segmentCount(t && t.diarization);
    if (!timestampCount) {
      log('[sectionb-backfill] re-transcript still untimestamped — not written', {
        sessionId, transcriptChars: String((t && t.transcript) || '').length, diarSegments,
      });
      return {
        ...base, ok: false, reason: 'still_untimestamped',
        after: { transcript_chars: String((t && t.transcript) || '').length, timestamp_count: 0, diarization_segments: diarSegments },
      };
    }

    // 2) recompute Section B against the NEW transcript
    const { resolveFidelitySources } = require('./fidelity-orchestrator');
    const { corpusKey, uploadedText, meta } = resolveFidelitySources(session);
    const result = await compute({ corpusKey, uploadedText, transcript: t.transcript, meta });
    if (!result) return { ...base, ok: false, reason: 'no_sources' };
    if (result.status !== 'ok') {
      log('[sectionb-backfill] grader non-ok — not written', { sessionId, status: result.status, error: result.error });
      return { ...base, ok: false, reason: result.status, after: { pct: null, status: result.status } };
    }
    if (result.fidelity_pct == null) {
      log('[sectionb-backfill] grader ok but still unscorable — not written', { sessionId, timestampCount });
      return { ...base, ok: false, reason: 'still_unscorable', after: { pct: null, status: 'ok', timestamp_count: timestampCount } };
    }

    const stamp = now().toISOString();
    const lpFidelity = {
      ...result,
      graded_at: stamp,
      meta: {
        ...(result.meta || {}),
        backfilled_at: stamp,
        backfill_source: 'retranscribe',
        backfill_bead: 'bd-2kxxa.5',
        previous_transcript_chars: base.before.transcript_chars,
        previous_timestamp_count: base.before.timestamp_count,
      },
    };
    let v2 = { ...analysis, lp_fidelity: lpFidelity };
    v2 = apply(v2, lpFidelity) || v2;

    // 3) the pipeline's column shape (processTranscription's updateData, minus
    //    audio_url/format/size/status/cost which are already right on the row)
    const patch = {
      transcript_text: t.transcript,
      transcript_language: t.language,
      diarization_data: t.diarization,
      diarization_confidence: t.diarization && t.diarization.confidence,
      analysis_data: v2,
    };
    if (Array.isArray(t.tokens) && t.tokens.length) patch.tokens_raw = t.tokens;
    if (Array.isArray(t.silences) && t.silences.length) patch.silence_markers = t.silences;
    if (!session.audio_duration_seconds && audio.buffer) {
      try {
        const probed = await probeDuration(audio.buffer);
        if (probed > 0) patch.audio_duration_seconds = Math.round(probed);
      } catch (e) {
        log('[sectionb-backfill] duration probe failed (non-fatal)', { sessionId, error: e.message });
      }
    }

    const after = {
      pct: result.fidelity_pct,
      status: 'ok',
      band: result.band || null,
      source: result.source || null,
      transcript_chars: t.transcript.length,
      timestamp_count: timestampCount,
      diarization_segments: diarSegments,
    };
    const wouldWrite = {
      pct: result.fidelity_pct,
      transcriptLength: t.transcript.length,
      timestampCount,
      diarizationSegments: diarSegments,
      tokens: Array.isArray(t.tokens) ? t.tokens.length : 0,
      audioDurationSeconds: patch.audio_duration_seconds || null,
      columns: Object.keys(patch),
    };

    if (dryRun) {
      log('[sectionb-backfill] DRY RUN — would write', { sessionId, ...wouldWrite });
      return { ...base, ok: true, after, wouldWrite };
    }

    // 4) ONE guarded write
    const saved = await persist(sessionId, patch, { allowedStatuses: BACKFILL_STATUSES, requirePctNull: true });
    if (!saved || !saved.ok) {
      log('[sectionb-backfill] CAS lost / persist refused', { sessionId, error: saved && saved.error });
      return { ...base, ok: false, reason: saved && saved.error ? 'persist_error' : 'cas_lost', after, error: saved && saved.error };
    }
    log('[sectionb-backfill] Section B repaired', { sessionId, pct: result.fidelity_pct, timestampCount, diarSegments });
    return { ...base, ok: true, persisted: true, after, wouldWrite };
  } catch (e) {
    log('[sectionb-backfill] failed', { sessionId, error: e.message });
    return { ...base, ok: false, reason: 'error', error: e.message };
  } finally {
    if (audio && typeof audio.cleanup === 'function') audio.cleanup();
  }
}

module.exports = {
  backfillSession,
  BACKFILL_STATUSES,
  SESSION_PROJECTION,
  TIMESTAMP_RE,
  countTimestamps,
  // exported for the CLI / tests
  defaultLoadSession,
  defaultPersist,
};
