'use strict';

/**
 * bd-ra8xu.38 — FICO17 v6 scored in the background on a teacher's self-recording (deploy spec §4.2 'shadow').
 *
 * The fico_dc_rubric switch (coaching/fico-rubric-switch.js) decides, per region or per test account:
 *   'v3'      (default, and on any failure) nothing here runs: no model call, nothing stored. Byte-identical to before.
 *   'shadow'  V3 scores the recording and drives everything the teacher sees, exactly as today; this module runs the
 *             v6 prompt on the same transcript, at the same time, and the result is stored under
 *             analysis_data.shadow.fico17_v6. It is never sent to anyone.
 *   'v6'      scored the same way (stored under analysis_data.shadow.fico17_v6 on main until bd-qix9oh.2 reaches it),
 *             and, when the read is ok, the teacher's DC report is built from it (bd-ra8xu.52, operator 14 Nov ~01:10:
 *             "Yes" to Qurat seeing her DC report on v6 instead of V3). analysis-processor stores teacherFacing()'s v6
 *             analysis as the analysis (framework 'fico17_v6', V3 kept under v3_fico); any other status keeps today's
 *             V3 report. The wait is V6_GRACE_MS, not GRACE_MS, because the report depends on it. The prod row names
 *             one account; a region or "*" value would move every teacher it covers, and the v10 A/B test reads V3.
 *
 * Only ICT's FICO self-recordings: a coach visit (leader_observation) is the coach switch's business, never this one.
 * Never throws and never delays the teacher by more than GRACE_MS ('v6': V6_GRACE_MS) after V3 is ready; a v6 failure or a slow reply is
 * recorded as status 'failed' / 'invalid' / 'timeout', never as a default level.
 */

const { logToFile } = require('../../../../utils/logger');
const v6 = require('./index');

const GRACE_MS = 45 * 1000;
// bd-ra8xu.52: in 'v6' mode the report is built from the v6 read, so wait longer for it. Her prod read on 12 Nov took
// ~85 s against V3's ~40 s and landed 4 s after the 45 s grace. Past this, the teacher gets the V3 report.
const V6_GRACE_MS = 150 * 1000;

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

/** Runs the v6 prompt through the production DC call (same model and settings as V3), validates, adds up. */
async function scoreV6(transcript, metadata) {
  const GPT5MiniService = require('../../../gpt5-mini.service');
  const fw = require('../fico17-v6-framework');
  const meta = shadowMetadata(metadata);
  let res;
  try {
    res = await GPT5MiniService.analyzePedagogy(transcript, meta, null, fw);
  } catch (first) {
    // Spec §5.5: one retry (a reply that would not parse is the usual cause).
    logToFile('[fico17-v6 shadow] first call failed — retrying once', { coachingSessionId: meta.coachingSessionId, error: first.message }, 'warn');
    res = await GPT5MiniService.analyzePedagogy(transcript, meta, null, fw);
  }
  const analysis = res && res.analysis;
  const check = fw.validate(analysis, transcript);
  if (!check.ok) {
    logToFile('[fico17-v6 shadow] reply failed validation — stored as invalid, no level filled', {
      coachingSessionId: meta.coachingSessionId, errors: check.errors.slice(0, 10),
    }, 'error');
    return { status: 'invalid', ...stampNow(), errors: check.errors.slice(0, 20) };
  }
  if (check.dropped) logToFile('[fico17-v6 shadow] evidence not found in the transcript — dropped', { coachingSessionId: meta.coachingSessionId, dropped: check.dropped });
  for (const w of check.warnings) logToFile(`[fico17-v6 shadow] ${w}`, { coachingSessionId: meta.coachingSessionId }, 'warn');
  const scored = fw.computeScores(analysis, false, transcript);
  return {
    status: 'ok',
    ...stampNow(),
    levels: scored.levels,
    combined_evidence: scored.combined_evidence,
    scores: { ...scored.scores, overall_max_possible: fw.maxMarks },
    dropped_evidence: check.dropped,
    ...(check.warnings.length ? { warnings: check.warnings } : {}),
    usage: res.usage || null,
  };
}

/**
 * Starts the shadow beside the V3 call. Returns a promise that never rejects: null when the switch is off (or this is
 * not a FICO self-recording), else the blob to store.
 */
function start({ session, metadata, frameworkKey, transcript }) {
  const state = { mode: null };
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
      logToFile('[fico17-v6 shadow] fico_dc_rubric is v6 — the DC report is built from the v6 read when it comes back ok', {
        coachingSessionId: session && session.id,
      });
    }
    try {
      return { ...(await scoreV6(transcript, metadata)), mode };
    } catch (err) {
      logToFile('[fico17-v6 shadow] failed — V3 unaffected', { coachingSessionId: session && session.id, error: err.message }, 'error');
      return { status: 'failed', ...stampNow(), mode, error: String(err.message || err).slice(0, 300) };
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
    if (out && out.__timeout) return { status: 'timeout', ...stampNow() };
    return out;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** How long settle() waits for this task: V6_GRACE_MS when its switch said 'v6', else GRACE_MS. */
function graceFor(task) {
  return task && task.state && task.state.mode === 'v6' ? V6_GRACE_MS : GRACE_MS;
}

// What the lesson was, taken from V3's analysis (as the 13 Nov eval page's simulated report did). Nothing V3 scored or
// advised (focus_area, uptake, summaries, its domains) crosses over: V3 and v6 codes collide (V3 C5 != v6 C5).
const LESSON_FACTS = ['topic', 'subject', 'has_lesson_plan', 'subject_resolution', 'photo_mode', 'photo_analysis', 'photo_count_analysed', 'lp_fidelity'];

/**
 * bd-ra8xu.52 — the analysis the teacher's DC report is built from, when the switch said 'v6' and the read is ok: the v6
 * levels and evidence added up by the v6 framework (computeScores, D2 counted from the transcript), stamped
 * 'fico17_v6'. Null for anything else (no blob, 'shadow', failed / invalid / timeout), so the caller keeps V3.
 * Never changes the blob (it is stored as is beside the analysis).
 */
function teacherFacing(blob, v3Analysis, transcript) {
  if (!blob || blob.mode !== 'v6' || blob.status !== 'ok' || !blob.levels) return null;
  const fw = require('../fico17-v6-framework');
  const base = {};
  for (const k of LESSON_FACTS) if (v3Analysis && v3Analysis[k] !== undefined) base[k] = v3Analysis[k];
  const copy = JSON.parse(JSON.stringify({ levels: blob.levels, combined_evidence: blob.combined_evidence || {} }));
  const a = fw.computeScores({ ...base, ...copy }, false, transcript);
  return { ...a, framework: v6.RUBRIC_KEY, rubric: v6.RUBRIC_KEY, transcript_quality: blob.transcript_quality || null };
}

/** The analysis_data keys to merge into the V3 write: {} when there is nothing, so the write is unchanged. */
function patch(blob) {
  return blob ? { shadow: { fico17_v6: blob } } : {};
}

module.exports = { GRACE_MS, V6_GRACE_MS, modeFor, shadowMetadata, scoreV6, start, settle, graceFor, teacherFacing, patch };
