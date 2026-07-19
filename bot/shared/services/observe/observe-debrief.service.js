/**
 * FEAT-053 bd-21/bd-22 — guided debrief for leader observations.
 *
 * bd-21 (this slice): entry points — the Debrief sasa / Baadaye choice after
 * form submission, and the pending-debrief interactive list on /observe
 * re-trigger (quiz-list pattern, bd-1246 lesson: every list row id MUST have
 * a dispatch branch in whatsapp-bot.js or taps die at "Unknown list item ID").
 *
 * bd-22 adds startDebrief (guide builder + delivery). Design + research base:
 * Reports/Active/School Leader Feature - Jul 2026/Observe Build/DEBRIEF_GUIDE_DESIGN.md
 *
 * A session is debrief-able only after the observer submitted the form
 * (status 'observer_review_complete') — before that there is no v2 to build
 * the guide from. debrief_status: 'pending' → 'done' (bd-28); 'skipped' has
 * no writer in v1 (pendings persist, list shows newest 9).
 */

const WhatsAppService = require('../whatsapp.service');
const supabase = require('../../config/supabase');
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile } = require('../../utils/logger');
const ObserveState = require('./observe-state.service');
const GPT5MiniService = require('../gpt5-mini.service');
const {
  buildGuidePrompt,
  validateGuide,
  renderGuideMessage,
  buildFallbackGuide,
} = require('./observe-debrief-guide');

const BUTTON_NOW_PREFIX = 'observe_debrief_now_';
const BUTTON_LATER_PREFIX = 'observe_debrief_later_';
const LIST_ROW_PREFIX = 'observe_debrief_';
const LIST_NEW_ID = 'observe_new';
const MAX_PENDING_ROWS = 9; // + the new-observation sentinel = 10 (WhatsApp cap)

/**
 * Parse a button_reply id. Returns {action:'now'|'later', sessionId} or null.
 */
function parseDebriefButtonId(buttonId) {
  if (!buttonId || typeof buttonId !== 'string') return null;
  if (buttonId.startsWith(BUTTON_NOW_PREFIX)) {
    return { action: 'now', sessionId: buttonId.slice(BUTTON_NOW_PREFIX.length) };
  }
  if (buttonId.startsWith(BUTTON_LATER_PREFIX)) {
    return { action: 'later', sessionId: buttonId.slice(BUTTON_LATER_PREFIX.length) };
  }
  return null;
}

/**
 * Parse a list_reply id. Returns {action:'debrief', sessionId} | {action:'new'} | null.
 * Button ids share the observe_debrief_ prefix — they are NOT list rows, so
 * reject them explicitly (prefix-overlap guard).
 */
function parseDebriefListReplyId(listId) {
  if (!listId || typeof listId !== 'string') return null;
  if (listId === LIST_NEW_ID) return { action: 'new' };
  if (parseDebriefButtonId(listId)) return null;
  if (listId.startsWith(LIST_ROW_PREFIX)) {
    return { action: 'debrief', sessionId: listId.slice(LIST_ROW_PREFIX.length) };
  }
  return null;
}

/**
 * The post-submit choice: debrief now or later.
 * Titles must fit WhatsApp's 20-char reply-button cap.
 */
function buildDebriefChoiceButtons(sessionId, S) {
  return {
    body: S.debrief_choice_body,
    buttons: [
      { id: `${BUTTON_NOW_PREFIX}${sessionId}`, title: S.btn_debrief_now },
      { id: `${BUTTON_LATER_PREFIX}${sessionId}`, title: S.btn_debrief_later },
    ],
  };
}

/**
 * Sessions awaiting a debrief for this observer, newest first, capped at 9.
 * Backed by the partial index idx_coaching_sessions_observer_pending.
 */
async function listPendingDebriefs(observerUserId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, created_at, analysis_data')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .eq('debrief_status', 'pending')
    .eq('status', 'observer_review_complete')
    .order('created_at', { ascending: false })
    .limit(MAX_PENDING_ROWS);
  if (error) throw new Error(`listPendingDebriefs failed: ${error.message}`);
  return data || [];
}

/**
 * bd-24: sessions whose debrief is DONE but whose combined report has not
 * reached the teacher — the durable re-entry point for "Baadaye" on the send
 * offer. Row cap shared with the debrief rows in buildPendingListPayload.
 */
async function listUnsentReports(observerUserId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, created_at, analysis_data')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .eq('debrief_status', 'done')
    .eq('status', 'observer_review_complete')
    .order('created_at', { ascending: false })
    .limit(MAX_PENDING_ROWS);
  if (error) throw new Error(`listUnsentReports failed: ${error.message}`);
  const DONE = ['sent', 'awaiting_teacher_tap', 'operator_review'];
  return (data || []).filter((r) => {
    const d = r.analysis_data && r.analysis_data.teacher_delivery;
    return !d || !DONE.includes(d.status);
  });
}

// "12 Jul, 09:46" in East Africa Time — recognisable, fits the 24-char title cap.
function _rowTitle(createdAt) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: 'Africa/Dar_es_Salaam',
    }).format(new Date(createdAt));
  } catch (_) {
    return String(createdAt).slice(0, 16);
  }
}

// Score-free row context: the focus-area headline if the analysis has one.
// (focus_area_sw.indicator is an ID like "C3.7" — title_sw is the human text.)
function _rowDescription(analysisData, S) {
  const focus =
    (analysisData && (analysisData.focus_area_sw || analysisData.focus_area)) || {};
  const label = focus.title_sw || focus.title || focus.indicator;
  return (label || S.list_row_default_desc).slice(0, 72);
}

/**
 * Interactive-list payload for sendInteractiveMessage: one row per pending
 * debrief + the "start a new observation" sentinel. Max 10 rows total.
 */
function buildPendingListPayload(pendings, S, unsentReports = []) {
  const debriefRows = pendings.map((p) => ({
    id: `${LIST_ROW_PREFIX}${p.id}`,
    title: `📋 ${_rowTitle(p.created_at)}`.slice(0, 24),
    description: _rowDescription(p.analysis_data, S),
  }));
  // bd-24: debrief-done sessions whose report hasn't reached the teacher yet
  const sendRows = unsentReports.map((r) => {
    const d = (r.analysis_data && r.analysis_data.teacher_delivery) || {};
    return {
      id: `observe_send_${r.id}`,
      title: `📨 ${_rowTitle(r.created_at)}`.slice(0, 24),
      description: (d.teacher_name
        ? `${S.list_send_desc_prefix} ${d.teacher_name}`
        : S.list_send_default_desc).slice(0, 72),
    };
  });
  const rows = [...debriefRows, ...sendRows].slice(0, MAX_PENDING_ROWS);
  rows.push({
    id: LIST_NEW_ID,
    title: S.list_new_observation.slice(0, 24),
    description: S.list_new_observation_desc.slice(0, 72),
  });
  return {
    body: S.list_body,
    action: {
      button: S.list_button,
      sections: [{ title: S.list_section_title.slice(0, 24), rows }],
    },
  };
}

/**
 * "Baadaye" — acknowledge and leave debrief_status 'pending' so the session
 * resurfaces in the /observe list. A stale tap on an already-done debrief
 * gets the already-done ack instead of a pointer to a list entry that no
 * longer exists (review fix).
 */
async function handleDebriefLater(sessionId, from, user) {
  const lang = observeLang(user);
  const S = observeStrings(lang);
  try {
    const { data: row } = await supabase
      .from('coaching_sessions')
      .select('debrief_status')
      .eq('id', sessionId)
      .single();
    if (row && row.debrief_status && row.debrief_status !== 'pending') {
      await WhatsAppService.sendMessage(from, S.debrief_already_done);
      return;
    }
  } catch (_) { /* staleness check is best-effort */ }
  logToFile('🗓 observe debrief deferred', { sessionId, phoneNumber: from });
  await WhatsAppService.sendMessage(from, S.debrief_later_ack);
}

/**
 * Called from the observe_mewaka nfm branch after a form submission.
 * Clears the observer's capture/form state — but NEVER a live
 * awaiting_debrief_audio armed for a DIFFERENT session (review fix: the FO
 * may be mid-debrief for observation A when form B's submission lands;
 * wiping the state would misroute the debrief recording).
 */
async function clearStateAfterSubmit(observerId, submittedSessionId) {
  const state = await ObserveState.getState(observerId);
  if (
    state && state.state === 'awaiting_debrief_audio'
    && state.sessionId && state.sessionId !== submittedSessionId
  ) {
    logToFile('🔭 observe: form submitted while mid-debrief for another session — state left armed', {
      submittedSessionId, debriefSessionId: state.sessionId,
    });
    return false;
  }
  await ObserveState.clearState(observerId);
  return true;
}

/**
 * Arm awaiting_debrief_audio for a session — but NEVER over a live debrief
 * recording armed for a DIFFERENT session (same invariant as
 * clearStateAfterSubmit / onAnalysisReady). Used by startDebrief and the
 * worker's too-short re-arm, which can otherwise race a concurrent debrief.
 */
async function armDebriefAudio(observerId, sessionId, guideSnapshot) {
  const state = await ObserveState.getState(observerId);
  if (
    state && state.state === 'awaiting_debrief_audio'
    && state.sessionId && state.sessionId !== sessionId
  ) {
    logToFile('🔭 observe: refused to arm debrief audio over a live debrief for another session', {
      wantSession: sessionId, liveSession: state.sessionId,
    });
    return false;
  }
  await ObserveState.setState(observerId, 'awaiting_debrief_audio', {
    sessionId, guide_snapshot: guideSnapshot || null,
  });
  return true;
}

// NOTE (D28): cross-session closure ("Mara ya mwisho ulisema utajaribu…")
// is deliberately NOT built here. Observations are not linked to a teacher
// until P3 (D5) — seeding the guide from the observer's previous session
// would attribute another TEACHER's commitment to this one. Ships with P3.

/**
 * bd-22 — "Debrief sasa" (button or pending-list pick): build the 6-step
 * guide from the observer's OWN edited analysis (v2), deliver it as ONE
 * text message + the recording instruction, and arm awaiting_debrief_audio.
 *
 * Guide build: single LLM attempt → programmatic gates (validateGuide) →
 * deterministic fallback on ANY failure. The FO standing next to the teacher
 * always gets a guide.
 */
async function startDebrief(sessionId, from, user) {
  const lang = observeLang(user);
  const S = observeStrings(lang);

  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (error || !session) {
    logToFile('❌ observe debrief: session load failed', {
      sessionId, error: error && error.message,
    });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
    return;
  }
  if (session.observer_user_id !== user.id) {
    logToFile('🚫 observe debrief: observer mismatch', {
      sessionId, requester: user.id, owner: session.observer_user_id,
    });
    await WhatsAppService.sendMessage(from, S.debrief_not_yours);
    return;
  }
  if (session.debrief_status && session.debrief_status !== 'pending') {
    await WhatsAppService.sendMessage(from, S.debrief_already_done);
    return;
  }
  // Double-tap idempotency (review fix): if the FO is still armed to record
  // THIS session's debrief, don't burn another LLM call — re-send the guide
  // (from the persisted snapshot, so a silently-failed first send is repaired,
  // not just re-nudged) + the recording nudge. TTL expiry clears the state,
  // so a genuine later re-arm still rebuilds.
  const existing = await ObserveState.getState(user.id);
  if (existing && existing.state === 'awaiting_debrief_audio' && existing.sessionId === sessionId) {
    if (existing.guide_snapshot) {
      await WhatsAppService.sendMessage(from, renderGuideMessage(existing.guide_snapshot, S));
    }
    await WhatsAppService.sendMessage(from, S.debrief_record_instruction);
    logToFile('🔭 observe debrief: already armed for this session — re-sent guide + nudge', { sessionId });
    return;
  }

  const v2 = session.analysis_data || {};

  let guide;
  try {
    const prompt = buildGuidePrompt(v2, { language: lang });
    const { result } = await GPT5MiniService.completeJson(prompt, {
      maxTokens: 4000, label: 'observeDebriefGuide',
    });
    validateGuide(result, S, lang);
    guide = result;
  } catch (err) {
    logToFile('⚠️ observe debrief: guide LLM failed/invalid — using fallback', {
      sessionId, error: err.message,
    });
    // The fallback sanitizes interpolated v2 fields, but validate anyway —
    // if pathological v2 content still slips a gate, drop to the fully
    // static scaffold (always valid). The FO must never be left guideless.
    guide = buildFallbackGuide(v2, { language: lang });
    try {
      validateGuide(guide, S, lang);
    } catch (fallbackErr) {
      logToFile('⚠️ observe debrief: fallback failed gates — using static scaffold', {
        sessionId, error: fallbackErr.message,
      });
      guide = buildFallbackGuide({}, { language: lang });
    }
  }

  await WhatsAppService.sendMessage(from, renderGuideMessage(guide, S));
  await WhatsAppService.sendMessage(from, S.debrief_record_instruction);
  // Direct arm (NOT the guarded armDebriefAudio): the FO explicitly chose to
  // debrief THIS session now — their tap is the intent, so it wins over any
  // stale arm for another session (which becomes pending, resurfaces in the
  // list). The guard is only for the background worker's too-short re-arm,
  // which must never override a newer user-initiated debrief.
  await ObserveState.setState(user.id, 'awaiting_debrief_audio', {
    sessionId, guide_snapshot: guide,
  });
  logToFile('🗣 observe debrief guide delivered', { sessionId, userId: user.id, lang });
}

// ── bd-28: debrief recording + coach-the-coach ─────────────────────────

// Read-merge-write into analysis_data.observer_debrief (D26: zero new
// columns). Safe: applyObserverEdits has already produced v2 by debrief
// time, and P3 send-to-teacher only reads. `extraColumns` lets the caller
// set debrief_status in the same write.
async function _mergeObserverDebrief(sessionId, patch, extraColumns = {}) {
  const { data: row, error } = await supabase
    .from('coaching_sessions')
    .select('analysis_data')
    .eq('id', sessionId)
    .single();
  if (error || !row) {
    throw new Error(`observer_debrief merge: session load failed: ${error && error.message}`);
  }
  const analysis = row.analysis_data || {};
  const merged = {
    ...analysis,
    observer_debrief: { ...(analysis.observer_debrief || {}), ...patch },
  };
  const { error: updateError } = await supabase
    .from('coaching_sessions')
    .update({ analysis_data: merged, ...extraColumns })
    .eq('id', sessionId);
  if (updateError) {
    throw new Error(`observer_debrief merge: update failed: ${updateError.message}`);
  }
  return merged;
}

/**
 * bd-28 (web side) — a voice note arrived while awaiting_debrief_audio.
 * Persist audio id + guide snapshot on the row (row-derived recovery,
 * bd-1525 class), queue the dedicated observe_debrief job — NEVER
 * queueTranscription (its processor writes transcript_text and would
 * overwrite the LESSON transcript on this same row) — ack, clear state.
 */
async function startDebriefFromAudio(user, from, audioId, observeState) {
  const lang = observeLang(user);
  const S = observeStrings(lang);
  const sessionId = observeState && observeState.sessionId;
  if (!sessionId) {
    logToFile('❌ observe debrief audio: state has no sessionId', { userId: user.id });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
    return;
  }
  const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
  try {
    // bd-56: a new recording is a FRESH debrief. The worker skips
    // re-transcription when a transcript is already stored (correct for
    // retries of the same audio) — so a stale transcript/feedback from a
    // previous attempt must be cleared here, or every retry re-coaches the
    // OLD recording and the FO can never recover from a bad first attempt.
    await _mergeObserverDebrief(sessionId, {
      audio_id: audioId,
      guide_snapshot: observeState.guide_snapshot || null,
      recorded_at: new Date().toISOString(),
      transcript: null,
      transcript_language: null,
      diarization_confidence: null,
      feedback: null,
    });
    await CoachingJobQueueService.queueObserveDebrief(sessionId, { from, audioId });
    await WhatsAppService.sendMessage(from, S.debrief_audio_received);
    await ObserveState.clearState(user.id);
    logToFile('🎙 observe debrief recording queued', { sessionId, userId: user.id });
  } catch (err) {
    logToFile('❌ observe debrief capture failed', { sessionId, error: err.message });
    await WhatsAppService.sendMessage(from, S.debrief_feedback_failed);
  }
}

// Deliver stored feedback (praise bubble + card) and mark done. Sends are
// CHECKED — WhatsAppService.sendMessage returns false instead of throwing,
// and flipping 'done' after a silent failure would lose the feedback forever
// (review fix). A throw here keeps status 'pending' and lets SQS retry;
// the feedback is already persisted, so the retry is deliver-only.
async function _deliverCoachFeedback(sessionId, from, feedback, S) {
  const { renderCoachFeedbackMessages } = require('./observe-coach-feedback');
  const [praiseMsg, cardMsg] = renderCoachFeedbackMessages(feedback, S);
  const sentPraise = await WhatsAppService.sendMessage(from, praiseMsg);

  // bd-44: the celebration card ships as a rendered image (hero design,
  // value-anchored). renderCoachCard returns null for harmful debriefs and on
  // any render failure — both fall back to the text card, so an officer can
  // never lose their feedback to a Playwright hiccup. Harm gate unchanged.
  let sentCard = false;
  const { renderCoachCard } = require('./observe-coach-card');
  const lang = S && S.coach_card_wins_label === 'Ulichofanya vizuri' ? 'sw'
    : (S && S.coach_card_wins_label === 'آپ نے کیا اچھا کیا' ? 'ur' : 'en');
  const png = await renderCoachCard(feedback, { lang });
  if (png) {
    sentCard = await WhatsAppService.sendImageFromBuffer(from, png, S.coach_card_closing);
  }
  if (!png || sentCard === false) {
    sentCard = await WhatsAppService.sendMessage(from, cardMsg);
  }
  if (sentPraise === false || sentCard === false) {
    throw new Error('observe debrief: feedback send failed — retrying via SQS');
  }
  const { error } = await supabase
    .from('coaching_sessions')
    .update({ debrief_status: 'done' })
    .eq('id', sessionId);
  if (error) throw new Error(`observe debrief: done-flip failed: ${error.message}`);
  logToFile('✅ observe debrief coached', { sessionId, rubric: feedback.rubric });

  // FEAT-053 bd-24: the natural next step — offer to send the teacher her
  // combined report. Non-fatal: the /observe list carries an unsent-report
  // row as the durable re-entry point.
  try {
    const { buildSendChoiceButtons } = require('./observe-send.service');
    await WhatsAppService.sendInteractiveButtons(from, buildSendChoiceButtons(sessionId, S));
  } catch (offerErr) {
    logToFile('⚠️ observe: send-report offer failed (list re-entry still available)', {
      sessionId, error: offerErr.message,
    });
  }
}

/**
 * bd-28 (worker side) — transcribe the debrief recording and coach the coach.
 * Success: praise line + 2-wins-1-try card, debrief_status → 'done', rubric
 * booleans persisted for the study. Any failure keeps status 'pending' (the
 * session resurfaces in the /observe list) and tells the FO gently.
 *
 * Idempotent under SQS redelivery (review fix): 'done' → no-op; stored
 * feedback → deliver-only; stored transcript → skip re-transcription.
 * Write order: transcript merge → feedback merge → checked sends → done-flip.
 */
async function processDebriefRecording(sessionId, payload = {}) {
  const fs = require('fs');
  const path = require('path');
  const { TEMP_DIR } = require('../../utils/constants');
  const TranscriptionProcessorService = require('../coaching/transcription-processor.service');
  const {
    MIN_TRANSCRIPT_CHARS,
    buildCoachFeedbackPrompt,
    validateCoachFeedback,
  } = require('./observe-coach-feedback');

  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select('*, users(phone_number, preferred_language)')
    .eq('id', sessionId)
    .single();
  if (error || !session) {
    throw new Error(`observe debrief: session not found: ${error && error.message}`);
  }

  const from = payload.from || (session.users && session.users.phone_number);
  const lang = (session.users && session.users.preferred_language) === 'sw' ? 'sw' : 'en';
  const S = observeStrings(lang);
  const observerDebrief = (session.analysis_data && session.analysis_data.observer_debrief) || {};

  // Redelivery guards (in order of how far the previous attempt got):
  if (session.debrief_status === 'done') {
    logToFile('🔭 observe debrief: already done — redelivery no-op', { sessionId });
    return;
  }
  if (observerDebrief.feedback) {
    logToFile('🔭 observe debrief: feedback stored — deliver-only redelivery', { sessionId });
    await _deliverCoachFeedback(sessionId, from, observerDebrief.feedback, S);
    return;
  }

  // bd-1525 class: payload can lose fields — the row is the source of truth.
  const audioId = payload.audioId || observerDebrief.audio_id;
  if (!audioId) throw new Error('observe debrief: no audio id in payload or row');

  const tempAudioPath = path.join(TEMP_DIR, `observe_debrief_${sessionId}_${Date.now()}.ogg`);
  try {
    let transcript = observerDebrief.transcript || '';
    let diarization = null;

    if (!transcript) {
      if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
      const audioData = await WhatsAppService.downloadMedia(audioId);
      fs.writeFileSync(tempAudioPath, audioData);

      const transcription = await TranscriptionProcessorService.transcribeWithDiarization(tempAudioPath);
      transcript = (transcription && transcription.transcript) || '';
      diarization = transcription && transcription.diarization;

      if (transcript.length < MIN_TRANSCRIPT_CHARS) {
        logToFile('🔇 observe debrief: transcript too short for feedback', {
          sessionId, chars: transcript.length,
        });
        // Re-arm the recording state so "record a longer stretch and send it"
        // actually works — but never over a debrief the FO started for another
        // session meanwhile (re-verify fix: this write raced clearStateAfterSubmit).
        await armDebriefAudio(session.observer_user_id, sessionId, observerDebrief.guide_snapshot);
        await WhatsAppService.sendMessage(from, S.debrief_too_short);
        return; // stays 'pending' — resurfaces in the /observe list
      }

      // Persist the transcript BEFORE the LLM pass so an analysis failure
      // never loses the recording's content (and redelivery skips re-transcribing).
      await _mergeObserverDebrief(sessionId, {
        transcript,
        transcript_language: transcription.language || null,
        diarization_confidence:
          (transcription.diarization && transcription.diarization.confidence) || null,
      });
    }

    let feedback;
    try {
      const { buildCoachFeedbackPromptI18n } = require('./observe-coach-feedback');
      const _fbLang = observeLang(session.users);
      const prompt = _fbLang !== 'sw' ? buildCoachFeedbackPromptI18n(transcript, {
        foName: session.users && session.users.first_name,
      }, _fbLang) : buildCoachFeedbackPrompt(transcript, {
        guide: observerDebrief.guide_snapshot || null,
        diarization,
        language: lang,
      });
      const { result } = await GPT5MiniService.completeJson(prompt, {
        maxTokens: 6000, label: 'observeCoachFeedback',
      });
      validateCoachFeedback(result);
      feedback = result;
    } catch (llmErr) {
      logToFile('⚠️ observe debrief: coach-feedback LLM failed/invalid', {
        sessionId, error: llmErr.message,
      });
      await WhatsAppService.sendMessage(from, S.debrief_feedback_failed);
      return; // transcript stored; status stays 'pending'
    }

    await _mergeObserverDebrief(sessionId, {
      feedback, completed_at: new Date().toISOString(),
    });
    await _deliverCoachFeedback(sessionId, from, feedback, S);
  } finally {
    try { if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath); } catch (_) { /* temp cleanup */ }
  }
}

module.exports = {
  parseDebriefButtonId,
  parseDebriefListReplyId,
  buildDebriefChoiceButtons,
  listPendingDebriefs,
  listUnsentReports,
  buildPendingListPayload,
  handleDebriefLater,
  clearStateAfterSubmit,
  armDebriefAudio,
  startDebrief,
  startDebriefFromAudio,
  processDebriefRecording,
};
