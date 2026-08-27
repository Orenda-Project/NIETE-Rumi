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
const { detectRegion } = require('../../utils/region');
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
async function listPendingDebriefs(observerUserId, opts = {}) {
  // bd-43474: MAX_PENDING_ROWS is a WhatsApp interactive-list limit (9 + the
  // sentinel = 10). The Flow's NavigationList holds 20, so it passes its own
  // window rather than inheriting a constraint that does not apply to it.
  const limit = opts.limit == null ? MAX_PENDING_ROWS : opts.limit;
  const offset = opts.offset || 0;
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, created_at, analysis_data')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .eq('debrief_status', 'pending')
    .eq('status', 'observer_review_complete')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`listPendingDebriefs failed: ${error.message}`);
  return _withObservedTeacher(data || []);
}

/**
 * bd-2669: attach the observed teacher from the linked observation_schedules
 * row (session_id — stamped by markDone for a scheduled visit, or by
 * observe-who for one recorded ad-hoc). A failure here only costs the name, so
 * it degrades to the rows as they were rather than breaking the list.
 */
async function _withObservedTeacher(rows) {
  if (!rows.length) return rows;
  try {
    const { data } = await supabase
      .from('observation_schedules')
      .select('session_id, teacher_name, school_name')
      .in('session_id', rows.map((r) => r.id));
    if (!data || !data.length) return rows;
    const bySession = new Map();
    for (const s of data) if (s.session_id && !bySession.has(s.session_id)) bySession.set(s.session_id, s);
    return rows.map((r) => {
      const s = bySession.get(r.id);
      return s ? { ...r, teacher_name: s.teacher_name, school_name: s.school_name } : r;
    });
  } catch (_) {
    return rows;
  }
}

/**
 * bd-24: sessions whose debrief is DONE but whose combined report has not
 * reached the teacher — the durable re-entry point for "Baadaye" on the send
 * offer. Row cap shared with the debrief rows in buildPendingListPayload.
 */
async function listUnsentReports(observerUserId, opts = {}) {
  const limit = opts.limit == null ? MAX_PENDING_ROWS : opts.limit;
  const offset = opts.offset || 0;
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, created_at, analysis_data')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .eq('debrief_status', 'done')
    .eq('status', 'observer_review_complete')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`listUnsentReports failed: ${error.message}`);
  // bd-1ezak: awaiting_teacher_tap counted as DONE, so a report waiting on the
  // teacher's tap VANISHED from Send-reports. includeAwaitingTap surfaces those
  // rows (annotated below); the default keeps historical chat-list semantics.
  const DONE = opts.includeAwaitingTap
    ? ['sent', 'operator_review']
    : ['sent', 'awaiting_teacher_tap', 'operator_review'];
  const dOf = (r) => (r.analysis_data && r.analysis_data.teacher_delivery) || {};
  const open = (data || [])
    .filter((r) => !DONE.includes(dOf(r).status))
    .map((r) => ({ ...r, delivery_status: dOf(r).status || null, template_sent_at: dOf(r).template_sent_at || null }));
  // bd-bos31: these rows never got the schedule join, so every one of them
  // rendered as the literal "Observation". The pending list has had it since
  // bd-2669; this one was simply missed.
  return _withObservedTeacher(open);
}

// bd-1ezak — the live status line a Send-reports row carries (Flow metadata is
// plain English by convention on these screens, same as 'debrief pending').
const _META_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sendReportRowMeta(sess) {
  const d = (sess && sess.analysis_data && sess.analysis_data.teacher_delivery) || {};
  const status = (sess && sess.delivery_status) || d.status || null;
  if (status === 'awaiting_teacher_tap') {
    const ts = (sess && sess.template_sent_at) || d.template_sent_at;
    const when = ts ? new Date(ts) : null;
    const day = when && !Number.isNaN(when.getTime())
      ? ` ${when.getUTCDate()} ${_META_MONTHS[when.getUTCMonth()]}` : '';
    return `invite sent${day} - waiting for teacher's tap`;
  }
  if (status === 'send_failed') return 'send failed - tap to retry';
  return 'report not sent yet';
}

/**
 * bd-tju8f — stage A of the coach's worklist: observations not yet at the FICO
 * form. Everything here is RESUMABLE (audio + transcript live on the row); the
 * `resume` field says which step a tap re-enters:
 *   gate  → re-send the photo/LP prompt (with its normal skip path)
 *   form  → re-send the FICO form Flow (awaiting_observer_review)
 *   retry → re-queue analysis (failed, or silently stuck mid-pipeline), bounded
 *   wait  → fresh pipeline still working — informational row, no action
 */
const STAGE_A_STATUSES = ['confirmed', 'transcribing', 'analyzing', 'analysis_started',
  'analysis_complete', 'awaiting_photo', 'awaiting_classroom_photo', 'awaiting_lesson_plan',
  'awaiting_observer_review', 'failed'];

function resumeKindFor(status, updatedAt, nowMs = Date.now()) {
  if (['awaiting_photo', 'awaiting_classroom_photo', 'awaiting_lesson_plan'].includes(status)) return 'gate';
  if (status === 'awaiting_observer_review') return 'form';
  if (status === 'failed') return 'retry';
  const ageMin = (nowMs - Date.parse(updatedAt || 0)) / 60000;
  return ageMin > 30 ? 'retry' : 'wait';   // a 30-min-silent pipeline is stuck, not working
}

async function listUnfinished(observerUserId, opts = {}) {
  const limit = opts.limit == null ? MAX_PENDING_ROWS : opts.limit;
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, status, created_at, updated_at, analysis_data')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .eq('debrief_status', 'pending')
    .in('status', STAGE_A_STATUSES)
    .order('created_at', { ascending: false })
    .range(0, limit - 1);
  if (error) throw new Error(`listUnfinished failed: ${error.message}`);
  const rows = await _withObservedTeacher(data || []);
  return rows.map((r) => ({ ...r, resume: resumeKindFor(r.status, r.updated_at) }));
}

/** Total rows waiting for this coach — drives the "show more" decision. */
async function countPending(observerUserId) {
  const [p, u] = await Promise.all([
    listPendingDebriefs(observerUserId, { limit: 1000 }).catch(() => []),
    listUnsentReports(observerUserId, { limit: 1000 }).catch(() => []),
  ]);
  return p.length + u.length;
}

// bd-2216: the deployment's own timezone, not a hardcoded one. This row is how
// a coach identifies WHICH observation to pick, so a wrong clock time makes the
// list ambiguous — ICT coaches were seeing East Africa Time, two hours behind
// their own. Config-driven per this codebase's region philosophy: an explicit
// DISPLAY_TIMEZONE wins, else the deployment region's zone, else UTC.
const REGION_TIMEZONES = {
  niete: 'Asia/Karachi',
  punjab: 'Asia/Karachi',
  pakistan: 'Asia/Karachi',
  tanzania: 'Africa/Dar_es_Salaam',
  kenya: 'Africa/Nairobi',
  yemen: 'Asia/Aden',
  palestine: 'Asia/Hebron',
};

function _displayTimeZone() {
  if (process.env.DISPLAY_TIMEZONE) return process.env.DISPLAY_TIMEZONE;
  return REGION_TIMEZONES[detectRegion()] || 'UTC';
}

// "12 Jul, 09:46" in the deployment's timezone — fits the 24-char title cap.
function _rowTitle(createdAt) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: _displayTimeZone(),
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
function buildPendingListPayload(pendings, S, unsentReports = [], unfinished = []) {
  // bd-2669: lead with WHO, not when. A coach with two pending debriefs could
  // not tell them apart from a date and a focus-area line (Aleeha R28, Riffat
  // R29). The name comes from the linked observation_schedules row; legacy
  // rows that never recorded a teacher keep the old date-led shape.
  const debriefRows = pendings.map((p) => {
    const name = p.teacher_name;
    const when = _rowTitle(p.created_at);
    const desc = name
      ? [when, p.school_name].filter(Boolean).join(' · ')
      : _rowDescription(p.analysis_data, S);
    return {
      id: `${LIST_ROW_PREFIX}${p.id}`,
      title: `📋 ${name || when}`.slice(0, 24),
      description: String(desc).slice(0, 72),
    };
  });
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
  // bd-tju8f: three labelled stage sections inside the WhatsApp 10-row cap.
  // Priority when over budget: stage A (the previously-INVISIBLE backlog this
  // exists for) → debriefs → sends; the new-observation sentinel always ships.
  const unfinishedRows = (unfinished || []).map((u) => ({
    id: `observe_resume_${u.id}`,
    title: `📝 ${u.teacher_name || _rowTitle(u.created_at)}`.slice(0, 24),
    description: String(S[`resume_desc_${u.resume}`] || S.resume_desc_gate || '').slice(0, 72),
  }));
  const budget = MAX_PENDING_ROWS;   // 9 + the sentinel = 10 (WhatsApp cap)
  const a = unfinishedRows.slice(0, budget);
  const b = debriefRows.slice(0, Math.max(0, budget - a.length));
  const c = sendRows.slice(0, Math.max(0, budget - a.length - b.length));
  const sections = [];
  if (a.length) sections.push({ title: String(S.section_stage_a || S.list_section_title).slice(0, 24), rows: a });
  if (b.length) sections.push({ title: String(a.length ? (S.section_stage_b || S.list_section_title) : S.list_section_title).slice(0, 24), rows: b });
  if (c.length) sections.push({ title: String((a.length || S.section_stage_c) ? (S.section_stage_c || S.list_section_title) : S.list_section_title).slice(0, 24), rows: c });
  sections.push({
    title: String(S.list_section_new || S.list_section_title).slice(0, 24),
    rows: [{
      id: LIST_NEW_ID,
      title: S.list_new_observation.slice(0, 24),
      description: S.list_new_observation_desc.slice(0, 72),
    }],
  });
  return {
    body: S.list_body,
    action: { button: S.list_button, sections },
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
async function _deliverCoachFeedback(sessionId, from, feedback, S, framework, lang = 'en') {
  const { renderCoachFeedbackMessages } = require('./observe-coach-feedback');
  const [praiseMsg, cardMsg] = renderCoachFeedbackMessages(feedback, S);
  const sentPraise = await WhatsAppService.sendMessage(from, praiseMsg);

  // bd-44: the celebration card ships as a rendered image (hero design,
  // value-anchored). renderCoachCard returns null for harmful debriefs and on
  // any render failure — both fall back to the text card, so an officer can
  // never lose their feedback to a Playwright hiccup. Harm gate unchanged.
  // bd-2453: the card carries the framework's brand (fico → niete), same
  // routing as the hero report — one session, one brand, every surface.
  let sentCard = false;
  const { renderCoachCard } = require('./observe-coach-card');
  const { heroBrandFor } = require('../coaching/report-renderers/renderer-registry');
  // bd-y7jr8: the language is PASSED now. It used to be reverse-engineered by
  // string-matching S.coach_card_wins_label against a hardcoded Urdu literal —
  // so re-labelling the card silently flipped Urdu coaches to the English one.
  // Same failure shape as bd-2644 (tofu boxes), one layer up.
  const png = await renderCoachCard(feedback, { lang, brand: heroBrandFor(framework) });
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

  // bd-9rrd5: debrief done — if the teacher report already went out (the other
  // completion order), the observation is COMPLETE. Non-fatal by design.
  {
    const { maybeCompleteObservation } = require('./observe-completion');
    await maybeCompleteObservation(sessionId);
  }

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
 * bd-b5elb — the coach-feedback LLM pass, with ONE guided repair. A shape
 * rejection from validateCoachFeedback used to dead-end the whole debrief
 * (coach told "couldn't analyze it", no retry of the LLM call): 10 sessions
 * since 20-Aug held a transcript and no feedback, three distinct validator
 * errors in one morning (24-Aug). The repair feeds the validator's error back
 * and asks for a corrected SAME-shape answer. The harm gate stays programmatic
 * — a repair that still fails validation throws; there is no bypass and no
 * manufactured praise.
 */
async function coachFeedbackWithRepair(prompt, sessionId) {
  const { validateCoachFeedback } = require('./observe-coach-feedback');
  const { result } = await GPT5MiniService.completeJson(prompt, {
    maxTokens: 6000, label: 'observeCoachFeedback',
  });
  try {
    validateCoachFeedback(result);
    return result;
  } catch (vErr) {
    logToFile('⚠️ observe debrief: feedback failed validation — one guided repair', {
      sessionId, error: vErr.message,
    });
    const repairPrompt = `${prompt}\n\nIMPORTANT — your previous answer was rejected by a strict validator with this error:\n"${vErr.message}"\nProduce the SAME JSON shape again, corrected so the validator passes. Stay faithful to the transcript; fix only what the error names. Remember the hard rules: a harmful debrief (teacher disparaged, or feedback aimed at the person not the moves) must have wins: [] , NO praise_line, and a filled concern {what_happened, why_it_matters, instead}; a non-harmful one needs a praise_line and exactly 2 wins, each with behaviour + evidence.`;
    const { result: repaired } = await GPT5MiniService.completeJson(repairPrompt, {
      maxTokens: 6000, label: 'observeCoachFeedbackRepair',
    });
    validateCoachFeedback(repaired);   // still strict — throws on a second miss
    return repaired;
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
  // bd-y7jr8: this used to be `preferred_language === 'sw' ? 'sw' : 'en'`, which
  // collapsed URDU into English — an Urdu coach got the English strings pack
  // while the model wrote Urdu prose. That is why her card had English headings.
  const lang = observeLang(session.users);
  const S = observeStrings(lang);
  const observerDebrief = (session.analysis_data && session.analysis_data.observer_debrief) || {};

  // Redelivery guards (in order of how far the previous attempt got):
  if (session.debrief_status === 'done') {
    logToFile('🔭 observe debrief: already done — redelivery no-op', { sessionId });
    return;
  }
  if (observerDebrief.feedback) {
    logToFile('🔭 observe debrief: feedback stored — deliver-only redelivery', { sessionId });
    await _deliverCoachFeedback(sessionId, from, observerDebrief.feedback, S,
      session.analysis_data && session.analysis_data.framework, lang);
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

      // bd-ri5o9.2 — a debrief is the COACH and the TEACHER, not a lesson. Without
      // these roles the classroom schema applies and one of the two adults is
      // announced as "Student" — and because the label follows word count, WHICH
      // adult flips between sessions (80/20 across 520 production debriefs). Every
      // downstream pass reads this transcript, so a report could quote the coach
      // as the teacher (reported by a coach, 2026-08-25).
      const { DEBRIEF_ROLES } = require('../speaker-roles');
      const transcription = await TranscriptionProcessorService.transcribeWithDiarization(
        tempAudioPath, { roles: DEBRIEF_ROLES });
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
    const _fbLang = observeLang(session.users);
    try {
      const { buildCoachFeedbackPromptI18n } = require('./observe-coach-feedback');
      const prompt = _fbLang !== 'sw' ? buildCoachFeedbackPromptI18n(transcript, {
        foName: session.users && session.users.first_name,
      }, _fbLang) : buildCoachFeedbackPrompt(transcript, {
        guide: observerDebrief.guide_snapshot || null,
        diarization,
        language: lang,
      });
      feedback = await coachFeedbackWithRepair(prompt, sessionId);
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
    await _deliverCoachFeedback(sessionId, from, feedback, S,
      session.analysis_data && session.analysis_data.framework, _fbLang);
  } finally {
    try { if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath); } catch (_) { /* temp cleanup */ }
  }
}

module.exports = {
  listUnfinished,
  resumeKindFor,
  parseDebriefButtonId,
  parseDebriefListReplyId,
  buildDebriefChoiceButtons,
  listPendingDebriefs,
  listUnsentReports,
  sendReportRowMeta,
  countPending,
  buildPendingListPayload,
  handleDebriefLater,
  clearStateAfterSubmit,
  armDebriefAudio,
  startDebrief,
  startDebriefFromAudio,
  processDebriefRecording,
  coachFeedbackWithRepair,
};
