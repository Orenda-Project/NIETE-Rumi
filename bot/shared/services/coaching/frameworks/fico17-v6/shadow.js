'use strict';

/**
 * bd-ra8xu.38 — FICO17 v6 scored in the background on a teacher's self-recording (deploy spec §4.2 'shadow').
 *
 * The fico_dc_rubric switch (coaching/fico-rubric-switch.js) decides, per region or per test account:
 *   'v3'      (default, and on any failure) nothing here runs: no model call, nothing stored. Byte-identical to before.
 *   'shadow'  V3 scores the recording and drives everything the teacher sees, exactly as today; this module runs the
 *             v6 prompt on the same transcript, at the same time, and the result is stored under
 *             analysis_data.shadow.fico17_v6. It is never sent to anyone.
 *   'v6'      scored the same way, stored under analysis_data.dc.fico17_v6 (bd-qix9oh.2, CONTRACTS §7). Still never
 *             sent: the operator decided (11 Nov) the teacher's report stays V3 (and the v10 coaching A/B test keeps
 *             reading V3) until the operator's go. Switching the report is its own change (teacher-report.js, option A).
 *
 * bd-qix9oh.2 — the transcript quality gate (observe/transcript-quality.js, spec §6) runs before the model call:
 * 'broken' → no call, every DC level 'IE'; 'partial' → its TRANSCRIPT GAPS block goes into the prompt. Every blob
 * carries transcript_quality, written here from the gate, never from the model's reply (spec §5.4).
 *
 * Only ICT's FICO self-recordings: a coach visit (leader_observation) is the coach switch's business, never this one.
 * Never throws and never delays the teacher by more than GRACE_MS after V3 is ready; a v6 failure or a slow reply is
 * recorded as status 'failed' / 'invalid' / 'timeout', never as a default level.
 */

const { logToFile } = require('../../../../utils/logger');
const v6 = require('./index');

const GRACE_MS = 45 * 1000;
const BROKEN_BECAUSE = 'the recording could not be used';
const RETRY_ON = /JSON pars/i; // GPT5MiniService.analyzePedagogy: 'JSON parsing failed: ...'

const stampNow = () => ({ ...v6.stamp('dc'), at: new Date().toISOString() });

/** Which DC rubric this session's teacher is on. 'v3' for anything that is not an ICT FICO self-recording. */
async function modeFor(session, frameworkKey) {
  if (frameworkKey !== 'fico') return 'v3';
  if (!session || session.observation_type === 'leader_observation') return 'v3';
  const sw = require('../../fico-rubric-switch');
  // Default off: no switch value anywhere means no region lookup and no model call.
  if (!(await sw.isAnySet('dc'))) return 'v3';
  const region = (session.users && session.users.region) || await sw.regionOfUser(session.user_id);
  return sw.dcRubric({ userId: session.user_id, region });
}

/** Only what the v6 prompt reads: no photos (never sent to the shadow call), no teacher name, no prior feedback. */
function shadowMetadata(metadata = {}) {
  const keep = ['coachingSessionId', 'duration', 'language', 'transcriptLanguage', 'grade', 'subject', 'subjectConfidence'];
  return Object.fromEntries(keep.filter((k) => metadata[k] !== undefined).map((k) => [k, metadata[k]]));
}

/** The gate on this recording: the period is the recording's length (CONTRACTS §3). */
function assessQuality(transcript, metadata = {}) {
  const gate = require('../../../observe/transcript-quality');
  const seconds = Number(metadata && metadata.duration);
  return gate.assess({ transcript, periodMinutes: seconds > 0 ? seconds / 60 : null });
}

const storedQuality = (quality) => require('../../../observe/transcript-quality').stored(quality);

/**
 * Why the gate said 'broken', for the warn log. A self-recording transcript with no [MM:SS] stamps is 'untimed': unlike
 * /observe2 (moments.js TIMED_RX), nothing stops it earlier, so the gate's 'broken' (11 × IE, no call) is what it gets
 * (spec §6.3, r1 T8). 'empty' is no text at all; 'loop' is a repeat over the broken share.
 */
function brokenReason(transcript, quality) {
  if (!String(transcript || '').trim()) return 'empty';
  if (!quality.first_ts) return 'untimed';
  return (quality.issues || []).some((i) => i.type === 'loop') ? 'loop' : 'unusable';
}

/** Spec §6.3 'broken': no call; all 11 levels 'IE', the five evidence rows 'IE' with nothing in them. */
function brokenBlob(quality) {
  const fw = require('../fico17-v6-framework');
  const levels = Object.fromEntries(v6.DC_CODES.map((c) => [c, { result: 'IE', because: BROKEN_BECAUSE, evidence: [] }]));
  const combined = Object.fromEntries(fw.EVIDENCE_CODES.map((c) => [c, { result: 'IE', items: [] }]));
  const scored = fw.computeScores({ levels, combined_evidence: combined }, false);
  return {
    status: 'broken',
    ...stampNow(),
    levels: scored.levels,
    combined_evidence: scored.combined_evidence,
    transcript_quality: storedQuality(quality),
    scores: { ...scored.scores, overall_max_possible: fw.maxMarks },
    dropped_evidence: 0,
    usage: null,
  };
}

/**
 * Runs the v6 prompt through the production DC call (same model and settings as V3), validates, adds up. The gate
 * runs first (quality may be passed in when the caller already has it).
 */
async function scoreV6(transcript, metadata, quality = assessQuality(transcript, metadata)) {
  const GPT5MiniService = require('../../../gpt5-mini.service');
  const fw = require('../fico17-v6-framework');
  const meta = shadowMetadata(metadata);
  const transcript_quality = storedQuality(quality);
  if (quality.status === 'broken') {
    logToFile('[fico17-v6 shadow] transcript broken — no scoring call, every DC level IE', {
      coachingSessionId: meta.coachingSessionId, reason: brokenReason(transcript, quality), transcript_quality,
    }, 'warn');
    return brokenBlob(quality);
  }
  const ask = { ...meta, transcriptQuality: quality };
  let res;
  try {
    res = await GPT5MiniService.analyzePedagogy(transcript, ask, null, fw);
  } catch (first) {
    // Spec §5.5: one retry; after a reply that would not parse, the same prompt plus RETRY_NOTE.
    logToFile('[fico17-v6 shadow] first call failed — retrying once', { coachingSessionId: meta.coachingSessionId, error: first.message }, 'warn');
    res = await GPT5MiniService.analyzePedagogy(transcript, RETRY_ON.test(first.message) ? { ...ask, retry: true } : ask, null, fw);
  }
  const analysis = res && res.analysis;
  const check = fw.validate(analysis, transcript);
  if (!check.ok) {
    logToFile('[fico17-v6 shadow] reply failed validation — stored as invalid, no level filled', {
      coachingSessionId: meta.coachingSessionId, errors: check.errors.slice(0, 10),
    }, 'error');
    return { status: 'invalid', ...stampNow(), transcript_quality, errors: check.errors.slice(0, 20) };
  }
  if (check.dropped) logToFile('[fico17-v6 shadow] evidence not found in the transcript — dropped', { coachingSessionId: meta.coachingSessionId, dropped: check.dropped });
  for (const w of check.warnings) logToFile(`[fico17-v6 shadow] ${w}`, { coachingSessionId: meta.coachingSessionId }, 'warn');
  const scored = fw.computeScores(analysis, false, transcript);
  return {
    status: 'ok',
    ...stampNow(),
    levels: scored.levels,
    combined_evidence: scored.combined_evidence,
    transcript_quality,
    scores: { ...scored.scores, overall_max_possible: fw.maxMarks },
    dropped_evidence: check.dropped,
    ...(check.warnings.length ? { warnings: check.warnings } : {}),
    usage: res.usage || null,
  };
}

/** What a blob that never got a reply still knows: its mode and the gate's reading, once they are known. */
const knownOf = (state) => ({
  ...(state && state.mode ? { mode: state.mode } : {}),
  ...(state && state.quality ? { transcript_quality: storedQuality(state.quality) } : {}),
});

/**
 * Starts the shadow beside the V3 call. Returns a promise that never rejects: null when the switch is off (or this is
 * not a FICO self-recording), else the blob to store. The promise carries `state` ({ mode, quality }) so a timeout
 * blob from settle() still says where it belongs and what the gate found.
 */
function start({ session, metadata, frameworkKey, transcript }) {
  const state = { mode: null, quality: null };
  const task = (async () => {
    let mode = 'v3';
    try {
      mode = await modeFor(session, frameworkKey);
    } catch (_) {
      return null;
    }
    if (mode !== 'shadow' && mode !== 'v6') return null;
    state.mode = mode;
    if (mode === 'v6') {
      logToFile('[fico17-v6 shadow] fico_dc_rubric is v6, but the teacher report stays V3 until the operator\'s go — scoring v6 in the background only', {
        coachingSessionId: session && session.id,
      });
    }
    try {
      state.quality = assessQuality(transcript, metadata);
      return { ...(await scoreV6(transcript, metadata, state.quality)), mode };
    } catch (err) {
      logToFile('[fico17-v6 shadow] failed — V3 unaffected', { coachingSessionId: session && session.id, error: err.message }, 'error');
      return { status: 'failed', ...stampNow(), ...knownOf(state), error: String(err.message || err).slice(0, 300) };
    }
  })();
  task.state = state;
  return task;
}

/** Waits for a started shadow at most graceMs more. Null when there is none. */
async function settle(promise, graceMs = GRACE_MS) {
  if (!promise) return null;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timeout: true }), graceMs); });
  try {
    const out = await Promise.race([promise, timeout]);
    if (out && out.__timeout) return { status: 'timeout', ...stampNow(), ...knownOf(promise.state) };
    return out;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The analysis_data keys to merge into the V3 write: {} when there is nothing, so the write is unchanged.
 * Switch 'v6' → analysis_data.dc.fico17_v6; 'shadow' (or a blob with no mode) → analysis_data.shadow.fico17_v6.
 */
function patch(blob) {
  if (!blob) return {};
  return blob.mode === 'v6' ? { dc: { fico17_v6: blob } } : { shadow: { fico17_v6: blob } };
}

module.exports = { GRACE_MS, modeFor, shadowMetadata, scoreV6, start, settle, patch };
