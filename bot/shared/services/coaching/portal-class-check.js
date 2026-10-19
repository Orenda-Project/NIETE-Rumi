'use strict';
/**
 * bd-aqotzx — ICT IAB feedback row 16: "does this recording sound like a class being taught?"
 *
 * A teacher's own Digital Coach upload from the PORTAL is checked right after transcription, before
 * anything is queued. Not a class (a lunch chat recorded by accident, an app test, an empty transcript) →
 * the session waits for her answer at `awaiting_class_confirm`: no analysis, no reflection question, no
 * report. She answers on the portal:
 *   yes ("Yes, my class")     → analysis is queued exactly as the portal path queues it (afterTranscription)
 *   no  ("No, record again")  → cancelled, failed_step 'not_a_class'
 * No answer for 24 hours → cancelled, failed_step 'not_a_class_no_answer', with a note saying why.
 *
 * Measured before shipping (read-only dry run, 4,760 sessions, 5–19 Oct 2026, prompt v1 below): 28 flagged,
 * all 28 genuinely not a class on a hand read, no class flagged. Folder:
 * 06_Logs & Misc/Investigations/workspace/pk-ict/digital-coach/bd-aqotzx-not-a-lesson-check/
 *
 * Untouched: WhatsApp sessions and a coach's observation (not even checked). A check that errors, times out
 * or answers in the wrong shape lets the session through — a broken check must never block a real class.
 * Kill switch: PORTAL_CLASS_CHECK=off (set it on the sqs-worker, which runs transcription).
 */

const PAUSED_STATUS = 'awaiting_class_confirm';
const STOP_NOT_A_CLASS = 'not_a_class';
const STOP_NO_ANSWER = 'not_a_class_no_answer';
const NO_ANSWER_MS = 24 * 60 * 60 * 1000;
const JOB = 'coaching.classCheck';
const PROMPT_VERSION = 'v1';

const NO_ANSWER_NOTE = 'Not carried forward: the recording did not sound like a class being taught and the teacher '
  + 'did not answer within 24 hours, so no reflection question or report was made.';
const NOT_A_CLASS_NOTE = 'Not carried forward: the recording did not sound like a class being taught and the teacher '
  + 'chose to record again.';

function isPortalTeacherDc(session) {
  const { isPortalSession } = require('./portal-coaching.service');
  return !!session && !session.observation_type && isPortalSession(session);
}

/** Start, middle and end of a long transcript — the shape the dry run measured. */
function excerpt(t, head = 2500, mid = 1500, tail = 1500) {
  const s = String(t || '');
  if (s.length <= head + mid + tail + 200) return s;
  const m = Math.floor(s.length / 2);
  return `${s.slice(0, head)}\n\n[... cut ...]\n\n${s.slice(m - mid / 2, m + mid / 2)}\n\n[... cut ...]\n\n${s.slice(-tail)}`;
}

function buildPrompt(transcript) {
  return `You check audio transcripts submitted to a teacher-coaching service in Pakistan (Islamabad government schools, grades K-12; Urdu and English, often mixed).
A teacher records her class and the service gives feedback on the lesson. Sometimes the recording is NOT a lesson: an accidental recording of a staff-room or lunch conversation, a phone call, a test of the app, silence/noise, TV, a meeting.

Decide whether the transcript is a recording of a CLASSROOM LESSON (a teacher teaching students: explaining, asking students questions, giving tasks, reading, correcting, managing the class). A lesson can be noisy, short, mostly teacher talk, or have few student replies — that is still a lesson. Speaker labels (Teacher/Student) come from automatic diarization and can be wrong; judge by the content.

Reply with JSON only: {"is_lesson": true|false, "confidence": "high"|"medium"|"low", "kind": "<lesson|staff_conversation|phone_call|app_test|noise_or_silence|meeting|other>", "reason": "<one short sentence in English>"}

Transcript:
${excerpt(transcript)}`;
}

/**
 * @returns {Promise<{is_class: boolean|null, confidence?, kind?, reason?, error?}>}
 *   is_class null = no usable verdict (the caller lets the session through)
 */
async function judgeRecording(transcript, deps) {
  if (!String(transcript || '').trim()) {
    return { is_class: false, confidence: 'high', kind: 'empty_transcript', reason: 'The transcript is empty.' };
  }
  try {
    const { result } = await deps.llm.completeJson(buildPrompt(transcript), { job: JOB, label: 'class-check', maxTokens: 300 });
    if (!result || typeof result.is_lesson !== 'boolean') return { is_class: null, error: 'wrong_shape' };
    return {
      is_class: result.is_lesson,
      confidence: result.confidence || null,
      kind: result.kind || null,
      reason: result.reason || null,
    };
  } catch (err) {
    return { is_class: null, error: (err && err.message) || 'check_failed' };
  }
}

function defaultDeps() {
  const { onUnlessOff } = require('../nudges/flags');
  const { updateIfNotTerminal } = require('./session-terminal');
  const { logToFile } = require('../../utils/logger');
  return {
    enabled: () => onUnlessOff('PORTAL_CLASS_CHECK'),
    llm: require('../gpt5-mini.service'),
    readAnalysisData: async (id) => {
      const supabase = require('../../config/supabase');
      const { data } = await supabase.from('coaching_sessions').select('analysis_data').eq('id', id).maybeSingle();
      return (data && data.analysis_data) || {};
    },
    updateIfNotTerminal,
    log: logToFile,
  };
}

/**
 * Called by transcription for every session, after the transcript is saved and before anything is queued.
 * @returns {Promise<{paused: boolean, verdict?: object}>} paused: the caller must stop here
 */
async function pauseIfNotAClass({ session, coachingSessionId, transcript }, deps = defaultDeps()) {
  const log = deps.log || (() => {});
  if (!isPortalTeacherDc(session) || !deps.enabled()) return { paused: false };

  const verdict = await judgeRecording(transcript, deps);
  log('🧭 class check', { coachingSessionId, prompt: PROMPT_VERSION, ...verdict });
  if (verdict.is_class !== false) return { paused: false, verdict };

  const existing = (await deps.readAnalysisData(coachingSessionId)) || {};
  const { applied } = await deps.updateIfNotTerminal(coachingSessionId, {
    status: PAUSED_STATUS,
    analysis_data: {
      ...existing,
      class_check: { ...verdict, prompt: PROMPT_VERSION, checked_at: new Date().toISOString() },
    },
  });
  if (!applied) log('🚫 class check: not a class, but the session is already over', { coachingSessionId });
  return { paused: true, verdict };
}

/**
 * Her answer on the portal. `yes` → analysis queued as the portal path queues it; `no` → cancelled.
 * @returns {{status:'ok', next:'analysis'|'record_again'} | {status:'not_found'|'not_ready'|'invalid', reason?}}
 */
async function answerClassCheck({ userId, coachingSessionId, answer }, deps = {}) {
  const choice = String(answer || '').trim().toLowerCase();
  if (choice !== 'yes' && choice !== 'no') return { status: 'invalid', reason: 'answer_must_be_yes_or_no' };
  const supabase = deps.supabase || require('../../config/supabase');
  const afterTranscription = deps.afterTranscription
    || ((...a) => require('./portal-coaching.service').afterTranscription(...a));

  const { data: row } = await supabase
    .from('coaching_sessions')
    .select('id, user_id, audio_url, observation_type, status, has_lesson_plan, lesson_plan_r2_key, lesson_plan_format, analysis_data')
    .eq('id', coachingSessionId)
    .maybeSingle();
  // One answer for "not hers", "not a portal session" and "does not exist".
  if (!row || row.user_id !== userId || !isPortalTeacherDc(row)) return { status: 'not_found' };
  if (row.status !== PAUSED_STATUS) return { status: 'not_ready', sessionStatus: row.status };

  const classCheck = { ...((row.analysis_data && row.analysis_data.class_check) || {}), answer: choice, answered_at: new Date().toISOString() };
  const fields = choice === 'yes'
    ? { status: 'transcription_complete', analysis_data: { ...(row.analysis_data || {}), class_check: classCheck } }
    : {
      status: 'cancelled',
      failed_step: STOP_NOT_A_CLASS,
      error_message: NOT_A_CLASS_NOTE,
      analysis_data: { ...(row.analysis_data || {}), class_check: classCheck },
    };
  // Only while it is still waiting: a second tap, or the 24-hour sweep, has already moved it on.
  const { data: moved, error } = await supabase
    .from('coaching_sessions')
    .update(fields)
    .eq('id', coachingSessionId)
    .eq('status', PAUSED_STATUS)
    .select('id');
  if (error) throw new Error(`class check answer write failed: ${error.message}`);
  if (!Array.isArray(moved) || moved.length === 0) return { status: 'not_ready', sessionStatus: 'moved_on' };

  if (choice === 'no') return { status: 'ok', next: 'record_again' };

  const { data: user } = await supabase.from('users').select('id, phone_number').eq('id', userId).single();
  await afterTranscription({ ...row, status: 'transcription_complete' }, coachingSessionId, user && user.phone_number);
  return { status: 'ok', next: 'analysis' };
}

/**
 * The 24-hour close, run by the recovery sweep. Conditional on the status, so an answer that lands at
 * the same moment wins or loses cleanly — never both.
 */
async function closeUnanswered(deps = {}) {
  const supabase = deps.supabase || require('../../config/supabase');
  const now = deps.now || Date.now();
  const cutoff = new Date(now - NO_ANSWER_MS).toISOString();
  const list = deps.list || (async () => {
    const { data, error } = await supabase
      .from('coaching_sessions')
      .select('id')
      .eq('status', PAUSED_STATUS)
      .lt('updated_at', cutoff)
      .limit(50);
    if (error) throw new Error(`class check sweep read failed: ${error.message}`);
    return data || [];
  });

  const rows = await list();
  let closed = 0;
  for (const r of rows) {
    const { data: moved } = await supabase
      .from('coaching_sessions')
      .update({ status: 'cancelled', failed_step: STOP_NO_ANSWER, error_message: NO_ANSWER_NOTE })
      .eq('id', r.id)
      .eq('status', PAUSED_STATUS)
      .select('id');
    if (Array.isArray(moved) && moved.length) closed += 1;
  }
  return { found: rows.length, closed };
}

module.exports = {
  PAUSED_STATUS,
  STOP_NOT_A_CLASS,
  STOP_NO_ANSWER,
  NO_ANSWER_MS,
  isPortalTeacherDc,
  excerpt,
  buildPrompt,
  judgeRecording,
  pauseIfNotAClass,
  answerClassCheck,
  closeUnanswered,
};
