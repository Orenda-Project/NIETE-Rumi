/**
 * bd-tju8f — re-enter an unfinished observation AT ITS OWN STEP, and cancel at
 * any stage.
 *
 * Resume kinds (observe-debrief.service resumeKindFor):
 *   gate  → re-send the photo prompt (awaiting_photo / awaiting_classroom_photo)
 *           or the LP-selection prompt (awaiting_lesson_plan) — identical to the
 *           live gate flow, so the taps advance it exactly as normal
 *   form  → re-send the FICO form Flow, prefilled. Sessions older than
 *           FORM_MAX_AGE_DAYS route to RETRY instead — a July analysis under an
 *           older rubric shape must not prefill today's Flow (the D28 class)
 *   retry → CAS + re-queue analysis, bounded at MAX_RETRIES
 *   wait  → fresh pipeline — informational ack only
 *
 * Cancel (operator, 2026-08-24: "at any stage a coach can cancel"): every
 * resume prompt carries cancel as its last button; two-tap confirm; the guard
 * is DELIVERY not stage — once the report reached the teacher, cancel is
 * refused. A cancelled row keeps its audio + transcript (support can
 * resurrect); it simply leaves every list and count.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile, logError } = require('../../utils/logger');

const MAX_RETRIES = 2;
const FORM_MAX_AGE_DAYS = 14;
const GATE_PHOTO = ['awaiting_photo', 'awaiting_classroom_photo'];

async function _loadOwn(sessionId, user) {
  const { data: s } = await supabase
    .from('coaching_sessions')
    .select('id, status, created_at, updated_at, user_id, observer_user_id, analysis_data, transcript_text, conversation_state, audio_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!s || s.observer_user_id !== user.id) return null;
  return s;
}

async function resume(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const s = await _loadOwn(sessionId, user);
  if (!s) { await WhatsAppService.sendMessage(from, S.debrief_not_yours); return; }

  const { resumeKindFor } = require('./observe-debrief.service');
  let kind = resumeKindFor(s.status, s.updated_at);

  // Rubric-drift guard: an old analysis must not prefill the current Flow.
  if (kind === 'form') {
    const ageDays = (Date.now() - Date.parse(s.created_at)) / 86_400_000;
    if (ageDays > FORM_MAX_AGE_DAYS) kind = 'retry';
  }

  logToFile('🔁 observe-resume: row tapped', { sessionId, kind, status: s.status });

  if (kind === 'gate') return _resumeGate(s, from, user, S);
  if (kind === 'form') return _resumeForm(s, from, user, S);
  if (kind === 'retry') return _resumeRetry(s, from, user, S);
  return _sendButtons(from, S.resume_wait_ack, [
    { id: `observe_ok_${s.id}`, title: S.btn_ok_wait },
    { id: `observe_cancel_${s.id}`, title: S.btn_cancel_obs },
  ]);
}

async function _resumeGate(s, from, user, S) {
  if (GATE_PHOTO.includes(s.status)) {
    // The live gate's own prompt (photo_yes_/photo_no_ taps advance it exactly
    // as normal — observer-aware since the parity port), plus cancel.
    const { buildPhotoPrompt } = require('../coaching/classroom-photo/photo-prompt.service');
    const lang = observeLang(user);
    const prompt = buildPhotoPrompt(s.id, lang);
    prompt.buttons = [...prompt.buttons.slice(0, 2), { id: `observe_cancel_${s.id}`, title: S.btn_cancel_obs.slice(0, 20) }];
    await WhatsAppService.sendInteractiveButtons(from, prompt);
    return;
  }
  // awaiting_lesson_plan — the same LP-selection prompt the gate sent (recents
  // belong to the session OWNER = the observed teacher; language = the coach's).
  try {
    const { buildLPSelectionList } = require('../coaching/lp-coaching/lp-selection-list.service');
    const { sendLpPrompt } = require('../coaching/lp-coaching/send-lp-prompt');
    let recents = [];
    try {
      const { isFidelityEnabled } = require('../coaching/fidelity/fidelity-orchestrator');
      if (isFidelityEnabled() && s.user_id) {
        const { getRecentFidelityLps } = require('../coaching/lp-coaching/recent-fidelity-lps.service');
        recents = await getRecentFidelityLps(s.user_id);
      }
    } catch (_) { /* Yes/No fallback */ }
    const { data: userRow } = await supabase
      .from('users').select('preferred_language, region').eq('id', user.id).maybeSingle();
    const lpPrompt = buildLPSelectionList(s.id, recents, userRow?.preferred_language || 'en', userRow?.region);
    await sendLpPrompt(WhatsAppService, from, lpPrompt);
  } catch (err) {
    logToFile('⚠️ observe-resume: LP prompt rebuild failed — photo prompt fallback', {
      sessionId: s.id, error: err.message,
    });
    const { buildPhotoPrompt } = require('../coaching/classroom-photo/photo-prompt.service');
    await WhatsAppService.sendInteractiveButtons(from, buildPhotoPrompt(s.id, observeLang(user)));
  }
}

async function _resumeForm(s, from, user, S) {
  // One extra tap buys a uniform cancel: [open the form] [cancel].
  await _sendButtons(from, S.resume_desc_form, [
    { id: `observe_form_${s.id}`, title: S.btn_open_form.slice(0, 20) },
    { id: `observe_cancel_${s.id}`, title: S.btn_cancel_obs.slice(0, 20) },
  ]);
}

/** The [open the form] tap — re-send the prefilled FICO Flow. */
async function sendForm(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const s = await _loadOwn(sessionId, user);
  if (!s) { await WhatsAppService.sendMessage(from, S.debrief_not_yours); return; }
  const OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || '';
  if (!OBSERVE_MEWAKA_FLOW_ID) { await WhatsAppService.sendMessage(from, S.flow_fallback); return; }
  await WhatsAppService.sendFlow(from, {
    flowId: OBSERVE_MEWAKA_FLOW_ID,
    flowToken: `${user.id}:${s.id}`,   // the endpoint derives identity from this
    header: S.flow_header,
    body: S.flow_body,
    buttonText: S.flow_button,
  });
  logToFile('🔁 observe-resume: review form re-sent', { sessionId: s.id, observerId: user.id });
}

// bd-go4tl.2 — WHERE to re-enter the pipeline, and whether we can at all.
//
// The old guard was `count >= MAX_RETRIES || !s.transcript_text`, and it only
// ever re-queued ANALYSIS. A session that died DURING transcription has no
// transcript by definition, so the coach's one lever refused precisely the
// sessions that needed it — on attempt ZERO. Javeria's 28-Aug row is the case:
// observe_retry_count undefined, transcript_text null, audio_id present, and
// she was told it "keeps stopping".
//
// The real question is not "is there a transcript" but "what is the earliest
// phase we still hold the inputs for". Status says where it died; 'failed' and
// 'confirmed' carry no phase, so fall back to what the row actually holds.
// The status->queue map is imported, not re-declared — one owner (bd-h9gnk).
const CLAIM_STATUS_BY_QUEUE = {
  transcription: 'confirmed',
  analysis: 'analysis_started',
  report: 'analysis_complete',
};

function _retryPlan(s) {
  const count = (s.analysis_data && s.analysis_data.observe_retry_count) || 0;
  if (count >= MAX_RETRIES) return { ok: false, reason: 'retry_bound_reached', count };

  const { RETRY_QUEUE_BY_STATUS } = require('../coaching/coaching-stale-recovery');
  let queue = RETRY_QUEUE_BY_STATUS[s.status] || (s.transcript_text ? 'analysis' : 'transcription');

  // Fall back to whichever input we still have; refuse only when we have neither.
  if (queue === 'transcription' && !s.audio_id) {
    if (!s.transcript_text) return { ok: false, reason: 'nothing_to_retry_from', count };
    queue = 'analysis';
  } else if (queue !== 'transcription' && !s.transcript_text) {
    if (!s.audio_id) return { ok: false, reason: 'nothing_to_retry_from', count };
    queue = 'transcription';
  }
  return { ok: true, queue, count };
}

// bd-go4tl.3 — the refusal used to promise "the team has been told" while doing
// nothing but an info-level log. Say something true to the coach, and leave a
// trace a human can actually find: an ERROR the sink can see, and error_message
// on the row (Javeria's still read null three hours in).
async function _refuseRetry(s, from, S, plan) {
  await WhatsAppService.sendMessage(from, S.resume_retry_exhausted);
  logError('⛔ observe-resume: retry refused', {
    sessionId: s.id, reason: plan.reason, count: plan.count,
    hasTranscript: !!s.transcript_text, hasAudio: !!s.audio_id,
  });
  await supabase
    .from('coaching_sessions')
    .update({
      error_message: `observe resume refused: ${plan.reason} after ${plan.count} attempt(s) (bd-go4tl)`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', s.id);
}

async function _resumeRetry(s, from, user, S) {
  const plan = _retryPlan(s);
  if (!plan.ok) return _refuseRetry(s, from, S, plan);
  await _sendButtons(from, S.resume_desc_retry, [
    { id: `observe_retry_${s.id}`, title: S.btn_retry_now.slice(0, 20) },
    { id: `observe_cancel_${s.id}`, title: S.btn_cancel_obs.slice(0, 20) },
  ]);
}

/** The [run it again] tap — CAS off the read status so a double-tap queues once. */
async function runRetry(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const s = await _loadOwn(sessionId, user);
  if (!s) { await WhatsAppService.sendMessage(from, S.debrief_not_yours); return; }
  const plan = _retryPlan(s);
  if (!plan.ok) return _refuseRetry(s, from, S, plan);

  const { data: claimed } = await supabase
    .from('coaching_sessions')
    .update({
      status: CLAIM_STATUS_BY_QUEUE[plan.queue],
      analysis_data: { ...(s.analysis_data || {}), observe_retry_count: plan.count + 1 },
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('status', s.status)      // CAS: only advance from the state we read
    .select();
  if (!claimed || !claimed.length) {
    await WhatsAppService.sendMessage(from, S.resume_wait_ack); return;
  }

  // bd-go4tl.2: re-enter at the phase it died in. Always queueing analysis meant
  // a session that never produced a transcript was handed to the analyser with
  // nothing to analyse.
  const Q = require('../coaching/coaching-job-queue.service');
  if (plan.queue === 'transcription') {
    await Q.queueTranscription(sessionId, { from, audioId: s.audio_id });
  } else if (plan.queue === 'analysis') {
    await Q.queueAnalysis(sessionId, { from, trigger: 'observe_manual_retry' });
  } else {
    await Q.queueReport(sessionId, { from });
  }
  await WhatsAppService.sendMessage(from, S.resume_retry_ack);
  logToFile('🔄 observe-resume: pipeline re-entered', {
    sessionId, queue: plan.queue, fromStatus: s.status, retry: plan.count + 1 });
}

// ── cancel ───────────────────────────────────────────────────────────────────

async function askCancel(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  await _sendButtons(from, S.cancel_confirm_body, [
    { id: `observe_cancel_yes_${sessionId}`, title: S.btn_cancel_yes.slice(0, 20) },
    { id: `observe_cancel_no_${sessionId}`, title: S.btn_back.slice(0, 20) },
  ]);
}

// bd-ej21x — the silent mutation both cancel surfaces share. NO chat sends
// here: the Flow's OBS_ACTION path renders the outcome on the SUCCESS screen,
// the chat-button path (cancelObservation below) speaks it.
async function cancelObservationCore(sessionId, user) {
  const s = await _loadOwn(sessionId, user);
  if (!s) return { outcome: 'not_yours' };

  const d = s.analysis_data && s.analysis_data.teacher_delivery;
  if (d && ['sent', 'awaiting_teacher_tap'].includes(d.status)) return { outcome: 'too_late' };
  if (['cancelled', 'abandoned'].includes(s.status)) return { outcome: 'already' };
  await supabase
    .from('coaching_sessions')
    .update({ status: 'cancelled' })
    .eq('id', sessionId)
    .eq('status', s.status);   // CAS — a concurrent pipeline advance wins
  logToFile('🗑 observe-resume: observation cancelled by coach', { sessionId, coachId: user.id });
  return { outcome: 'cancelled' };
}

async function cancelObservation(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const { outcome } = await cancelObservationCore(sessionId, user);
  const msg = { not_yours: S.debrief_not_yours, too_late: S.cancel_too_late,
    already: S.cancel_ack, cancelled: S.cancel_ack }[outcome];
  await WhatsAppService.sendMessage(from, msg);
}

async function keepObservation(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  await WhatsAppService.sendMessage(from, S.bind_not_obs_ack);
}

async function _sendButtons(from, body, buttons) {
  return WhatsAppService.sendInteractiveButtons(from, { body, buttons: buttons.slice(0, 3) });
}

module.exports = { resume, sendForm, runRetry, askCancel, cancelObservation, cancelObservationCore, keepObservation };
