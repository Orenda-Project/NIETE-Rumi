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
 *   observe2 → an /observe2 visit waiting at its own step: the check is sent again (sealed, moments
 *           in), or the live form (not sealed yet); otherwise the same "still working" ack
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
const { isTerminalStatus } = require('../coaching/session-terminal');
const { logToFile } = require('../../utils/logger');
// bd-i3618q: the shared helpers and the retry half live in sibling files; runRetry is re-exported below.
const { _loadOwn, _refuseTerminal, _sendButtons } = require('./observe-resume-common');
const { _retryPlan, _refuseRetry, runRetry } = require('./observe-resume-retry');

const FORM_MAX_AGE_DAYS = 14;
const GATE_PHOTO = ['awaiting_photo', 'awaiting_classroom_photo'];

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
  // 'wait' too: a recording held for its /observe2 form (record first) is still being transcribed, and
  // its form can be filled meanwhile. A classic one has no form, so it gets the wait ack as before.
  if ((kind === 'observe2' || kind === 'wait' || kind === 'obs612_form') && await _resumeObserve2(s, from, user)) return;
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
    // Her downloads + her own ready plans (bd-snkn32.45), the same source as the gate's list.
    const recents = await require('../coaching/lp-coaching/lp-step.service')._recentLpsFor(s.user_id);
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

// An /observe2 visit, from the worklist: send the message it is waiting for. The check message is the
// coach's only way into the check, and on 5 Oct WhatsApp refused it for every coach for 50 minutes
// (Meta #131042); the visit then waited with nothing in the coach's chat to tap.
// @returns {Promise<boolean>} false when there is nothing to open yet (the caller sends the wait ack).
async function _resumeObserve2(s, from, user) {
  const Store = require('./observe2/field-form.store');
  const got = await Store.findBySession(s.id);
  const form = got.ok ? got.form : null;
  if (!form || form.checked_at) return false;
  // bd-pni007: an FDE (obs612) visit's form is FDE's own Flow, never the FICO live form.
  const Obs612 = require('./obs612/visit');
  if (Obs612.isObs612Form(form)) {
    if (form.sealed_at) return false;
    const sent = await Obs612.sendForm(user, from, form);
    logToFile('🔁 observe-resume: FDE form re-sent', { sessionId: s.id, formId: form.id, sent: Boolean(sent) });
    return Boolean(sent);
  }
  if (!form.sealed_at) {
    // The recording is in (that is how this visit has a session), so the form is filled after the lesson.
    const { sendLiveForm } = require('./observe2/start');
    await sendLiveForm(user, from, form.id, form.period_minutes, { afterLesson: true });
    logToFile('🔁 observe-resume: /observe2 form re-sent', { sessionId: s.id, formId: form.id });
    return true;
  }
  if (!form.moments_ready_at) return false;
  const Moments = require('./observe2/moments');
  const sent = await Moments.openCheck(form);
  if (sent) await Moments.setStatus(s.id, 'observe2_checking');
  logToFile('🔁 observe-resume: /observe2 check re-sent', { sessionId: s.id, formId: form.id, sent });
  return sent;
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
  if (isTerminalStatus(s.status)) return _refuseTerminal(s, from, user, 'form');
  // Queue #191: the Flow the visit was stamped for, exactly as the first send (observe-draft) picks it. This always sent
  // the V3 Flow, so a coach reopening a FICO17 v6 visit got V3 screens the endpoint refused on every page (prod 16-19
  // Nov: 11 v6 visits, 10 coaches). A v6 visit with no v6 Flow id configured gets the text fallback, never V3's Flow.
  const v6Visit = !!require('./observe-fico17-v6').visitFramework(s);
  const flowId = (v6Visit ? process.env.OBSERVE_FICO17_V6_FLOW_ID : process.env.OBSERVE_MEWAKA_FLOW_ID) || '';
  if (!flowId) {
    if (v6Visit) logToFile('⚠️ observe-resume: FICO17 v6 visit but OBSERVE_FICO17_V6_FLOW_ID is unset — text fallback', { sessionId: s.id });
    await WhatsAppService.sendMessage(from, S.flow_fallback);
    return;
  }
  await WhatsAppService.sendFlow(from, {
    flowId,
    flowToken: `${user.id}:${s.id}`,   // the endpoint derives identity from this
    header: S.flow_header,
    body: S.flow_body,
    buttonText: S.flow_button,
  });
  logToFile('🔁 observe-resume: review form re-sent', { sessionId: s.id, observerId: user.id, flow: v6Visit ? 'fico17_v6' : 'v3' });
}

async function _resumeRetry(s, from, user, S) {
  const plan = _retryPlan(s);
  if (!plan.ok) return _refuseRetry(s, from, S, plan);
  await _sendButtons(from, S.resume_desc_retry, [
    { id: `observe_retry_${s.id}`, title: S.btn_retry_now.slice(0, 20) },
    { id: `observe_cancel_${s.id}`, title: S.btn_cancel_obs.slice(0, 20) },
  ]);
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
  if (isTerminalStatus(s.status)) return { outcome: 'already' };
  const { data: written } = await supabase
    .from('coaching_sessions')
    .update({ status: 'cancelled' })
    .eq('id', sessionId)
    .eq('status', s.status)    // CAS — a concurrent pipeline advance wins
    .select('id');
  if (!written || !written.length) {
    // The CAS matched no row, so the cancel did NOT happen. Returning
    // 'cancelled' here is how a coach came to see a SUCCESS screen for a cancel
    // that never landed; the ack must describe the actual state.
    logToFile('🏁 observe-resume: cancel lost the race — row already advanced', {
      sessionId, coachId: user.id, readStatus: s.status,
    });
    return { outcome: 'raced' };
  }
  logToFile('🗑 observe-resume: observation cancelled by coach', { sessionId, coachId: user.id });
  return { outcome: 'cancelled' };
}

async function cancelObservation(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const { outcome } = await cancelObservationCore(sessionId, user);
  const msg = { not_yours: S.debrief_not_yours, too_late: S.cancel_too_late,
    already: S.cancel_ack, cancelled: S.cancel_ack,
    // Lost the race to the pipeline: the analysis had already moved on, which
    // is the same thing the coach needs to hear as 'too_late'.
    raced: S.cancel_too_late }[outcome];
  await WhatsAppService.sendMessage(from, msg);
}

async function keepObservation(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  await WhatsAppService.sendMessage(from, S.bind_not_obs_ack);
}

module.exports = { resume, sendForm, runRetry, askCancel, cancelObservation, cancelObservationCore, keepObservation };
