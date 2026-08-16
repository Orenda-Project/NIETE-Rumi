/**
 * FEAT-053 bd-24/bd-25 — send the combined report to the teacher.
 *
 * Flow: coach feedback delivered → "Tuma ripoti / Baadaye" buttons →
 * FO texts teacher name + phone (one message, D34) → confirm echo →
 * worker renders a PREVIEW (the official hero report from v2 + companion
 * text) back to the FO → FO taps "Tuma sasa" → delivery (window-open direct,
 * else the observation_report template — quiz architecture, D19) with the
 * pilot review gate (OBSERVE_REVIEW_MODE=operator reroutes to the operator
 * review number, D11/D33).
 *
 * Delivery state lives in analysis_data.teacher_delivery (merge-write, zero
 * DDL — D26 pattern): { teacher_name, teacher_phone, status, report_url,
 * companion_text, notes, sent_at }. status: collecting → previewing →
 * awaiting_confirm → awaiting_teacher_tap | operator_review → sent.
 */

const WhatsAppService = require('../whatsapp.service');
const supabase = require('../../config/supabase');
const ObserveState = require('./observe-state.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile } = require('../../utils/logger');

const BTN = {
  start: 'observe_send_start_',
  later: 'observe_send_later_',
  confirm: 'observe_send_confirm_',
  cancel: 'observe_send_cancel_',
  // bd-2673 — flip the report between the market's two languages
  lang: 'observe_send_lang_',
};
const TEMPLATE_PAYLOAD_PREFIX = 'observe_report_';

// bd-2405 — the teacher's report copy must follow the TEACHER's language,
// scoped to the market's offered languages (Rule 20: language is market-scoped
// data). The old code hardcoded observeStrings('sw') (a Tanzania-era D6
// assumption), so NIETE (fico) teachers received a full Kiswahili report.
// mewaka=Tanzania stays sw; fico=NIETE and hots=PK never resolve to sw.
const MARKET_LANGS = {
  mewaka: { offer: ['sw', 'en'], fallback: 'sw' },
  fico:   { offer: ['ur', 'en'], fallback: 'en' },
  hots:   { offer: ['ur', 'en'], fallback: 'ur' },
};
function marketLangConfig() {
  const { getObservePack } = require('./observe-framework');
  return MARKET_LANGS[getObservePack().key] || { offer: ['en'], fallback: 'en' };
}
/** Clamp any language to the current market's offered set (else null). */
function clampToMarket(lang) {
  const { offer } = marketLangConfig();
  return offer.includes(lang) ? lang : null;
}
/**
 * Resolve the teacher-report language: the teacher's own locked preference
 * (looked up read-only by phone) → the coach's language → the market fallback,
 * each clamped to the market's offered languages. Never Swahili outside TZ.
 * @param {{teacher_phone?:string}} delivery
 * @param {string} coachLang
 * @returns {Promise<'ur'|'en'|'sw'>}
 */
function otherLang(lang) {
  const { offer } = marketLangConfig();
  const i = offer.indexOf(lang);
  if (i === -1) return offer[0];
  return offer[(i + 1) % offer.length];
}

async function resolveTeacherLang(delivery, coachLang) {
  const { fallback } = marketLangConfig();
  // bd-2673 (Riffat R36): the coach's explicit pick wins for THIS report. She
  // knows the teacher in the room; a teacher who never set a preference would
  // otherwise inherit the COACH's language. Clamped like everything else, so a
  // stale 'sw' from a Tanzania-era row can never leak onto NIETE. This is a
  // per-report override — the teacher's own stored preference is never rewritten.
  if (delivery && delivery.lang_override) {
    const forced = clampToMarket(delivery.lang_override);
    if (forced) return forced;
  }
  if (delivery && delivery.teacher_phone) {
    try {
      const { data } = await supabase
        .from('users')
        .select('preferred_language')
        .eq('phone_number', delivery.teacher_phone)
        .maybeSingle();
      const t = clampToMarket(data && data.preferred_language);
      if (t) return t;
    } catch (_) { /* fall through to coach/market default */ }
  }
  return clampToMarket(coachLang) || fallback;
}

// ── Pure helpers ───────────────────────────────────────────────────────

/**
 * TZ mobile normalizer (D34): returns 255XXXXXXXXX or null.
 * TZ mobiles are 06/07-prefixed (9 significant digits after the 0).
 */
function normalizeTzPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const d = raw.replace(/\D/g, '');
  if (/^255[67]\d{8}$/.test(d)) return d;
  if (/^0[67]\d{8}$/.test(d)) return `255${d.slice(1)}`;
  if (/^[67]\d{8}$/.test(d)) return `255${d}`;
  return null;
}

/**
 * One free-text message → { name, phone } or null. The phone is located by
 * pattern anywhere in the text; whatever remains (trimmed of separators) is
 * the name. Both are required — a bare number is not an identity.
 */
// bd-36: PK mobiles accepted alongside TZ (the PK-numbered test team could
// not run the send leg at all; ops review sends also go to PK numbers).
// TZ remains the primary format. Not a typo risk: a TZ typo cannot form a
// valid 92-prefixed 12-digit mobile, and the FO previews + confirms every
// send (D33), with the pilot review gate on top (D11).
function normalizePkPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const d = raw.replace(/\D/g, '');
  if (/^923\d{9}$/.test(d)) return d;
  if (/^03\d{9}$/.test(d)) return `92${d.slice(1)}`;
  // bd-2675: a bare mobile with no leading zero ("3001234567") is a common way
  // to type it, and used to be rejected in silence. A landline (051…) still
  // fails every branch, which is the behaviour we want to keep.
  if (/^3\d{9}$/.test(d)) return `92${d}`;
  return null;
}

function parseTeacherDetails(text) {
  if (!text || typeof text !== 'string') return null;
  // bd-2675: scan for any span that CONTAINS enough digits, then normalise —
  // rather than trying to enumerate every way a person writes a number. The old
  // character-class regex rejected "(0300) 123-4567" and a bare "3001234567"
  // silently, and a silent re-ask reads to the coach as "Rumi refused her
  // number". Validity is still decided by the normalisers, so a landline is
  // still refused.
  const re = /[+(\d][\d\s\-().]{7,}\d/g;
  let m;
  let span = null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].replace(/\D/g, '').length >= 9) { span = m[0]; break; }
  }
  if (!span) return null;
  const phone = normalizeTzPhone(span) || normalizePkPhone(span);
  if (!phone) return null;
  const name = text.replace(span, ' ').replace(/[,\n;]+/g, ' ').replace(/[()]/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
  if (!name || name.length < 2 || /^\d+$/.test(name)) return null;
  return { name, phone };
}

function parseSendButtonId(buttonId) {
  if (!buttonId || typeof buttonId !== 'string') return null;
  for (const [action, prefix] of Object.entries(BTN)) {
    if (buttonId.startsWith(prefix)) return { action, sessionId: buttonId.slice(prefix.length) };
  }
  return null;
}

function buildSendChoiceButtons(sessionId, S) {
  return {
    body: S.send_choice_body,
    buttons: [
      { id: `${BTN.start}${sessionId}`, title: S.btn_send_report },
      { id: `${BTN.later}${sessionId}`, title: S.btn_send_later },
    ],
  };
}

function buildSendConfirmButtons(sessionId, S, currentLang) {
  const buttons = [
    { id: `${BTN.confirm}${sessionId}`, title: S.btn_send_now },
  ];
  // bd-2673: offer the language she is NOT currently getting. WhatsApp allows
  // 3 buttons and 20 CODE POINTS per title (Rule 20 — Urdu is not measured in
  // bytes), so this fits alongside send + cancel exactly.
  if (currentLang) {
    const target = otherLang(currentLang);
    const title = target === 'ur' ? S.btn_send_in_ur : S.btn_send_in_en;
    if (title) buttons.push({ id: `${BTN.lang}${sessionId}`, title });
  }
  buttons.push({ id: `${BTN.cancel}${sessionId}`, title: S.btn_send_cancel });
  return { body: S.send_confirm_body, buttons };
}

// ── DB helper (read-merge-write, D26 pattern) ──────────────────────────

async function mergeTeacherDelivery(sessionId, patch, extraColumns = {}) {
  const { data: row, error } = await supabase
    .from('coaching_sessions')
    .select('analysis_data')
    .eq('id', sessionId)
    .single();
  if (error || !row) throw new Error(`teacher_delivery merge: load failed: ${error && error.message}`);
  const analysis = row.analysis_data || {};
  const merged = {
    ...analysis,
    teacher_delivery: { ...(analysis.teacher_delivery || {}), ...patch },
  };
  const { error: upErr } = await supabase
    .from('coaching_sessions')
    .update({ analysis_data: merged, ...extraColumns })
    .eq('id', sessionId);
  if (upErr) throw new Error(`teacher_delivery merge: update failed: ${upErr.message}`);
  return merged;
}

// ── Web-side flow ──────────────────────────────────────────────────────

/** "Tuma ripoti" — begin collecting the teacher's identity. */
/** FEAT-093 bd-54: per-market teacher-invite template (defaults = TZ, unchanged). */
function reportTemplateConfig() {
  return {
    name: process.env.OBSERVE_REPORT_TEMPLATE || 'observation_report_sw',
    lang: process.env.OBSERVE_REPORT_TEMPLATE_LANG || 'sw',
  };
}

async function startSendFlow(sessionId, from, user) {
  const lang = observeLang(user);
  const S = observeStrings(lang);

  const { data: session, error } = await supabase
    .from('coaching_sessions').select('*').eq('id', sessionId).single();
  if (error || !session) {
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
    return;
  }
  if (session.observer_user_id !== user.id) {
    await WhatsAppService.sendMessage(from, S.debrief_not_yours);
    return;
  }
  const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};
  if (delivery.status === 'sent' || delivery.status === 'awaiting_teacher_tap') {
    await WhatsAppService.sendMessage(from, S.send_already_sent);
    return;
  }

  // bd-43: offer the officer their known teachers first (name+phone learned
  // from past deliveries) — picking one skips typing details entirely. The
  // list is snapshotted into the state so a tap can never resolve against a
  // different list than the one the officer saw.
  const { getRoster } = require('./observe-roster');
  const teachers = await getRoster(user);
  if (teachers.length > 0) {
    await ObserveState.setState(user.id, 'awaiting_teacher_pick', { sessionId, teachers });
    await WhatsAppService.sendInteractiveMessage(from, buildTeacherPickPayload(teachers, S));
    return;
  }
  await ObserveState.setState(user.id, 'awaiting_teacher_details', { sessionId });
  await WhatsAppService.sendMessage(from, S.send_ask_details);
}

/**
 * bd-43 — the teachers this officer has sent reports to before, newest first,
 * deduped by phone (latest name wins). Derived from past sessions' delivery
 * records: zero new tables — the mapping accumulates as officers observe.
 * Capped at 9 so the list + the new-teacher row fit WhatsApp's 10-row limit.
 */
async function listKnownTeachers(observerUserId) {
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('analysis_data, created_at')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .not('analysis_data->teacher_delivery', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  const seen = new Set();
  const out = [];
  for (const row of data) {
    const td = (row.analysis_data || {}).teacher_delivery || {};
    if (!td.teacher_phone || !td.teacher_name) continue;
    if (seen.has(td.teacher_phone)) continue;   // newest-first → latest name wins
    seen.add(td.teacher_phone);
    out.push({ name: td.teacher_name, phone: td.teacher_phone });
    if (out.length >= 9) break;
  }
  return out;
}

/** WhatsApp interactive list: one row per known teacher + the new-teacher row. */
function buildTeacherPickPayload(teachers, S) {
  const rows = teachers.map((t, i) => ({
    id: `observe_pickt_${i}`,
    title: String(t.name).slice(0, 24),
    description: `+${t.phone}`.slice(0, 72),
  }));
  rows.push({
    id: 'observe_pickt_new',
    title: S.pick_teacher_new.slice(0, 24),
    description: S.pick_teacher_new_desc.slice(0, 72),
  });
  rows.push({
    id: 'observe_pickt_manage',
    title: S.pick_teacher_manage.slice(0, 24),
    description: S.pick_teacher_manage_desc.slice(0, 72),
  });
  return {
    type: 'list',
    header: '',
    body: S.pick_teacher_body,
    action: {
      button: S.pick_teacher_button.slice(0, 20),
      sections: [{ title: S.pick_teacher_section.slice(0, 24), rows }],
    },
  };
}

/**
 * A tap on the teacher-pick list. Returns true when consumed. A pick behaves
 * exactly like typing valid details: store → preview job → awaiting_send_confirm.
 */
async function handleTeacherPick(user, from, listId) {
  const state = await ObserveState.getState(user.id).catch(() => null);
  if (!state || state.state !== 'awaiting_teacher_pick') return false;
  const sessionId = state.sessionId;
  const lang = observeLang(user);
  const S = observeStrings(lang);

  if (listId === 'observe_pickt_new') {
    await ObserveState.setState(user.id, 'awaiting_teacher_details', { sessionId });
    await WhatsAppService.sendMessage(from, S.send_ask_details);
    return true;
  }
  // bd-45: 🛠 manage — full roster (not just the shown slice), remove/rename
  if (listId === 'observe_pickt_manage') {
    const { getRoster } = require('./observe-roster');
    const roster = await getRoster(user);
    await ObserveState.setState(user.id, 'awaiting_teacher_manage', { sessionId, teachers: roster });
    await WhatsAppService.sendInteractiveMessage(from, buildTeacherManagePayload(roster, S));
    return true;
  }
  const idx = parseInt(listId.replace('observe_pickt_', ''), 10);
  const picked = Array.isArray(state.teachers) ? state.teachers[idx] : null;
  if (!picked) {
    // out-of-range / stale index — re-ask rather than guess a recipient
    await WhatsAppService.sendMessage(from, S.send_details_reask);
    return true;
  }
  const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
  try {
    const { upsertTeacher } = require('./observe-roster');
    await upsertTeacher(user, picked);   // move-to-front — roster tracks usage
    await mergeTeacherDelivery(sessionId, {
      teacher_name: picked.name,
      teacher_phone: picked.phone,
      status: 'previewing',
    });
    await ObserveState.setState(user.id, 'awaiting_send_confirm', { sessionId });
    await WhatsAppService.sendMessage(
      from, S.send_preview_coming.replace('{name}', picked.name).replace('{phone}', `+${picked.phone}`));
    await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'preview' });
  } catch (err) {
    logToFile('❌ observe send: teacher pick failed', { sessionId, error: err.message });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
  }
  return true;
}

/**
 * bd-2673 — flip the report's language and re-render the preview. Re-rendering
 * is deliberate: the report PNG itself is language-bound, so showing the coach
 * a confirm button over a preview in the other language would be a lie. The
 * override lives on the delivery record, so it survives to the deliver phase.
 */
async function handleSendLangToggle(sessionId, from, user) {
  const lang = clampToMarket(observeLang(user)) || marketLangConfig().fallback;
  const S = observeStrings(lang);
  try {
    const session = await _loadSession(sessionId);
    const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};
    const current = await resolveTeacherLang(delivery, lang);
    const next = otherLang(current);
    await mergeTeacherDelivery(sessionId, { lang_override: next, status: 'previewing' });
    await WhatsAppService.sendMessage(from, S.send_lang_switching);
    const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
    await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'preview' });
    logToFile('🌐 observe send: report language switched', { sessionId, from: current, to: next });
  } catch (err) {
    logToFile('❌ observe send: language toggle failed', { sessionId, error: err.message }, 'error');
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
  }
}


/**
 * The approved UTILITY template that opens a cold teacher's window. Extracted
 * (bd-2675) so the nudge sends exactly what the first attempt sent — a nudge
 * that drifted from the original would be a second bug wearing the first one's
 * clothes.
 */
async function _sendReportTemplate(delivery, foName, sessionId) {
  const tpl = reportTemplateConfig();
  return WhatsAppService.sendTemplate(delivery.teacher_phone, tpl.name, tpl.lang, [
    { type: 'body',
      parameters: [
        { type: 'text', text: delivery.teacher_name },
        { type: 'text', text: foName },
      ] },
    { type: 'button', sub_type: 'quick_reply', index: '0',
      parameters: [{ type: 'payload', payload: `${TEMPLATE_PAYLOAD_PREFIX}${sessionId}` }] },
  ]);
}

/**
 * bd-2675 — act on ONE report that is still waiting for the teacher's tap.
 * The planner decides; this executes and, either way, tells the coach. Called
 * by the recovery sweep (NIETE has no cron).
 */
async function processUntappedDelivery(sessionId, nowMs = Date.now()) {
  const { classifyUntappedDelivery } = require('./observe-untapped.service');
  const session = await _loadSession(sessionId);
  const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};
  const decision = classifyUntappedDelivery(delivery, nowMs);
  if (decision.action === 'skip') return decision;

  const foPhone = session.users && session.users.phone_number;
  const foName = (session.users && session.users.first_name) || '';
  const lang = clampToMarket(observeLang(session.users)) || marketLangConfig().fallback;
  const S = observeStrings(lang);
  const name = delivery.teacher_name || '';
  const iso = new Date(nowMs).toISOString();

  if (decision.action === 'nudge') {
    await _sendReportTemplate(delivery, foName, sessionId);
    await mergeTeacherDelivery(sessionId, {
      nudged_at: iso, nudge_count: Number(delivery.nudge_count || 0) + 1,
    });
    if (foPhone) {
      await WhatsAppService.sendMessage(foPhone, (S.send_nudged_fo || '').replace('{name}', name))
        .catch(() => {});
    }
    logToFile('🔔 observe send: nudged untapped teacher', { sessionId, teacher: name });
    return decision;
  }

  // give_up — stop chasing the teacher and hand the coach a clear next step.
  await mergeTeacherDelivery(sessionId, { gave_up_at: iso });
  if (foPhone) {
    await WhatsAppService.sendMessage(foPhone, (S.send_gave_up_fo || '').replace('{name}', name))
      .catch(() => {});
  }
  logToFile('🛑 observe send: gave up chasing an untapped report', { sessionId, teacher: name });
  return decision;
}

/** "Baadaye" — the session resurfaces as an unsent-report row in /observe. */
async function handleSendLater(sessionId, from, user) {
  const lang = observeLang(user);
  await WhatsAppService.sendMessage(from, observeStrings(lang).send_later_ack);
}

/**
 * Text arriving while awaiting_teacher_details. Returns true when consumed.
 * Called from the text-message handler (school_leader gated there).
 */
async function handleTeacherDetailsText(user, from, text, observeState) {
  if (!observeState || observeState.state !== 'awaiting_teacher_details') return false;
  const sessionId = observeState.sessionId;
  const lang = observeLang(user);
  const S = observeStrings(lang);

  const parsed = parseTeacherDetails(text);
  if (!parsed) {
    await WhatsAppService.sendMessage(from, S.send_details_reask);
    return true;   // consumed — stay in the state, don't fall through to chat
  }

  const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
  try {
    const { upsertTeacher } = require('./observe-roster');
    await upsertTeacher(user, parsed);   // bd-45: every send teaches the roster
    await mergeTeacherDelivery(sessionId, {
      teacher_name: parsed.name,
      teacher_phone: parsed.phone,
      status: 'previewing',
    });
    await ObserveState.setState(user.id, 'awaiting_send_confirm', { sessionId });
    await WhatsAppService.sendMessage(
      from, S.send_preview_coming.replace('{name}', parsed.name).replace('{phone}', `+${parsed.phone}`));
    await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'preview' });
  } catch (err) {
    logToFile('❌ observe send: details capture failed', { sessionId, error: err.message });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
  }
  return true;
}

/** "Tuma sasa" — the FO approved the previewed report. */
/** bd-45: the manage list — every roster teacher, tap to remove/rename. */
function buildTeacherManagePayload(teachers, S) {
  const rows = teachers.slice(0, 10).map((t, i) => ({
    id: `observe_tmg_${i}`,
    title: String(t.name).slice(0, 24),
    description: `+${t.phone}`.slice(0, 72),
  }));
  return {
    type: 'list',
    header: '',
    body: S.manage_body,
    action: {
      button: S.manage_button.slice(0, 20),
      sections: [{ title: S.manage_section.slice(0, 24), rows }],
    },
  };
}

/** A tap on a manage-list row → remove/back buttons for that teacher. */
async function handleTeacherManage(user, from, listId) {
  const state = await ObserveState.getState(user.id).catch(() => null);
  if (!state || state.state !== 'awaiting_teacher_manage') return false;
  const lang = observeLang(user);
  const S = observeStrings(lang);
  const idx = parseInt(listId.replace('observe_tmg_', ''), 10);
  const t = Array.isArray(state.teachers) ? state.teachers[idx] : null;
  if (!t) {
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
    return true;
  }
  await ObserveState.setState(user.id, 'awaiting_teacher_manage_confirm',
    { sessionId: state.sessionId, teachers: state.teachers });
  await WhatsAppService.sendInteractiveButtons(from, {
    body: S.manage_confirm_body.replace('{name}', t.name).replace('{phone}', `+${t.phone}`),
    buttons: [
      { id: `observe_tmg_rm_${idx}`, title: S.manage_remove_btn.slice(0, 20) },
      { id: 'observe_tmg_back', title: S.manage_back_btn.slice(0, 20) },
    ],
  });
  return true;
}

/** Remove/back buttons. Either way the officer lands back on the picker. */
async function handleTeacherManageButton(user, from, buttonId) {
  const state = await ObserveState.getState(user.id).catch(() => null);
  if (!state || state.state !== 'awaiting_teacher_manage_confirm') return false;
  const lang = observeLang(user);
  const S = observeStrings(lang);
  if (buttonId.startsWith('observe_tmg_rm_')) {
    const idx = parseInt(buttonId.replace('observe_tmg_rm_', ''), 10);
    const t = Array.isArray(state.teachers) ? state.teachers[idx] : null;
    if (t) {
      const { removeTeacher } = require('./observe-roster');
      await removeTeacher(user, t.phone);
      await WhatsAppService.sendMessage(from, S.manage_removed_ack.replace('{name}', t.name));
    }
  }
  // both paths: back to the picker so the send continues where it left off
  await startSendFlow(state.sessionId, from, user);
  return true;
}

async function handleSendConfirm(sessionId, from, user) {
  const lang = observeLang(user);
  const S = observeStrings(lang);
  const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
  try {
    await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'deliver' });
    await WhatsAppService.sendMessage(from, S.send_delivering);
    await ObserveState.clearState(user.id);
  } catch (err) {
    logToFile('❌ observe send: confirm failed', { sessionId, error: err.message });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
  }
}

/** "Ghairi" — abandon; details kept so a later retry is one tap away. */
async function handleSendCancel(sessionId, from, user) {
  const lang = observeLang(user);
  await mergeTeacherDelivery(sessionId, { status: 'cancelled' }).catch(() => {});
  await ObserveState.clearState(user.id);
  await WhatsAppService.sendMessage(from, observeStrings(lang).send_cancel_ack);
}

// ── Worker side: preview → deliver → teacher_tap ───────────────────────

const MIN_DEBRIEF_CHARS_FOR_NOTES = 120;

async function _loadSession(sessionId) {
  const { data: session, error } = await supabase
    .from('coaching_sessions')
    .select('*, users(phone_number, first_name, preferred_language)')
    .eq('id', sessionId)
    .single();
  if (error || !session) {
    throw new Error(`observe send: session not found: ${error && error.message}`);
  }
  return session;
}

// Extract teacher-facing debrief notes. NEVER blocks the report — every
// failure path returns null and the report ships without the companion.
async function _extractNotes(session, foName) {
  const od = (session.analysis_data && session.analysis_data.observer_debrief) || {};
  const transcript = od.transcript;
  if (!transcript || transcript.length < MIN_DEBRIEF_CHARS_FOR_NOTES) return null;
  // bd-37: a HARMFUL debrief (harm-gate rubric, bd-30) gets NO teacher notes —
  // summarising an abusive conversation into warm fiction is worse than
  // silence. The report itself still ships.
  try {
    const { isHarmfulDebrief } = require('./observe-coach-feedback');
    const rubric = od.feedback && od.feedback.rubric;
    if (rubric && isHarmfulDebrief(rubric)) {
      logToFile('🔇 observe send: harmful debrief — teacher notes skipped', { sessionId: session.id });
      return null;
    }
  } catch (_) { /* rubric check is best-effort */ }
  try {
    const { buildDebriefNotesPrompt, buildDebriefNotesPromptI18n, validateDebriefNotes } = require('./observe-teacher-report');
    const GPT5MiniService = require('../gpt5-mini.service');
    // FEAT-093 bd-53: the note follows the officer's LOCKED language (sw untouched)
    const notesLang = observeLang(session.users);
    const { result } = await GPT5MiniService.completeJson(
      notesLang !== 'sw'
        ? buildDebriefNotesPromptI18n(transcript, { foName }, notesLang)
        : buildDebriefNotesPrompt(transcript, { foName }),
      { maxTokens: 2000, label: 'observeDebriefNotes' },
    );
    validateDebriefNotes(result);
    return result;
  } catch (err) {
    logToFile('⚠️ observe send: debrief-notes extraction failed — report ships without notes', {
      sessionId: session.id, error: err.message,
    });
    return null;
  }
}

// Send the report package (image + companion) to one destination.
// Sends are CHECKED — sendImageFromBuffer/sendMessage return false on failure.
async function _sendPackage(dest, pngBuffer, caption, companionText) {
  const sentImg = await WhatsAppService.sendImageFromBuffer(dest, pngBuffer, caption);
  if (sentImg === false) throw new Error('observe send: report image send failed');
  if (companionText) {
    const sentTxt = await WhatsAppService.sendMessage(dest, companionText);
    if (sentTxt === false) throw new Error('observe send: companion send failed');
  }
}

/**
 * bd-25 worker processor. payload.phase:
 *  'preview'     — extract notes, render the hero report from v2, upload to
 *                  R2, show the FO the exact package + confirm buttons.
 *  'deliver'     — FO confirmed: review-mode reroute | window-open direct |
 *                  window-closed template (payload observe_report_<sid>).
 *  'teacher_tap' — the teacher tapped the template button: direct delivery.
 */
/**
 * bd-2411 — a teacher-delivery send failed on the worker (e.g. a Meta template
 * 400, an R2 miss). The old code let the exception propagate silently: the
 * coach had already been told "📨 sending now, I'll confirm once it lands" by
 * handleSendConfirm, the delivery stayed frozen at 'awaiting_confirm', and
 * NEITHER the coach nor the teacher heard anything again (R17/18). Record the
 * failure and tell the coach so it's visible + one-tap retryable via /observe.
 */
async function _handleDeliverFailure(sessionId, foPhone, S, path, err, meta = {}) {
  logToFile('❌ observe send: teacher delivery failed', {
    sessionId, path, template: meta.tpl && meta.tpl.name,
    error: err && err.message, stack: err && err.stack,
  });
  await mergeTeacherDelivery(sessionId, {
    status: 'send_failed',
    last_error: err && err.message,
    failed_at: new Date().toISOString(),
  }).catch(() => {});
  await WhatsAppService.sendMessage(foPhone, S.send_failed_fo).catch(() => {});
}

async function processTeacherReport(sessionId, payload = {}) {
  const session = await _loadSession(sessionId);
  const foPhone = payload.from && payload.phase !== 'teacher_tap'
    ? payload.from
    : (session.users && session.users.phone_number);
  const foName = (session.users && session.users.first_name) || 'Afisa';
  // bd-2405: the coach's UI language, clamped to the market (never a stray sw
  // on NIETE/PK). observeLang handles ur/sw/en; clamp guards data anomalies.
  const lang = clampToMarket(observeLang(session.users)) || marketLangConfig().fallback;
  const S = observeStrings(lang);
  const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};
  // bd-2405: teacher copy follows the TEACHER's market language, not a
  // hardcoded 'sw'. (TZ still resolves to sw via the market config.)
  const teacherLang = await resolveTeacherLang(delivery, lang);
  const teacherS = observeStrings(teacherLang);

  if (delivery.status === 'sent') {
    logToFile('🔭 observe send: already sent — no-op', { sessionId });
    return;
  }

  const phase = payload.phase || 'preview';

  if (phase === 'preview') {
    const { buildCompanionText } = require('./observe-teacher-report');
    const { generateHeroReport } = require('../coaching/report-v2/hero-report.service');
    const { heroBrandFor } = require('../coaching/report-renderers/renderer-registry');
    const { uploadImageBuffer } = require('../../storage/r2');

    const notes = await _extractNotes(session, foName);
    const v2 = session.analysis_data || {};
    // D32: the OFFICIAL hero report, design unchanged — teacherName is what
    // the FO entered; commitmentAction is the teacher's debrief commitment.
    // bd-2453: this path calls generateHeroReport DIRECTLY (not via the
    // renderer registry), so the framework brand must be injected here too —
    // otherwise a FICO/NIETE observe report renders the default Rumi palette
    // while the same teacher's coaching-pipeline report renders NIETE.
    const { png, caption } = await generateHeroReport(session, v2, {
      teacherName: delivery.teacher_name,
      commitmentAction: (notes && notes.commitment_sw) || '',
      language: teacherLang,   // bd-2405 — the teacher's market language drives the report
      brand: heroBrandFor(v2.framework),
    });
    const companionText = notes ? buildCompanionText(notes, { foName }, teacherS) : null;
    const teacherCaption = teacherS.report_caption_teacher.replace('{fo}', foName);

    const reportKey = await uploadImageBuffer(png, `observe-reports/${sessionId}.png`);
    await mergeTeacherDelivery(sessionId, {
      status: 'awaiting_confirm',
      report_key: reportKey,
      caption: teacherCaption,
      companion_text: companionText,
      notes,
    });

    // The FO sees EXACTLY what the teacher would receive (D33)…
    await _sendPackage(foPhone, png, teacherCaption, companionText);
    // …then decides.
    // bd-2673: the toggle is labelled with the language she is NOT getting, so
    // the coach can flip THIS report without touching the teacher's account.
    await WhatsAppService.sendInteractiveButtons(
      foPhone, buildSendConfirmButtons(sessionId, S, teacherLang));
    logToFile('🔎 observe send: preview delivered to FO', { sessionId });
    return;
  }

  if (phase === 'deliver' || phase === 'teacher_tap') {
    if (!delivery.report_key || !delivery.teacher_phone) {
      throw new Error('observe send: delivery state incomplete (no report/phone)');
    }
    if (phase === 'teacher_tap') {
      // Only the number the FO named may claim this report.
      if (payload.from !== delivery.teacher_phone) {
        logToFile('🚫 observe send: template tap from unexpected number — refused', {
          sessionId, from: payload.from });
        return;
      }
    }

    const { downloadFromR2 } = require('../../storage/r2');

    // D11 review gate — read at call time (constants caches env at import).
    const reviewMode = process.env.OBSERVE_REVIEW_MODE || '';
    if (phase === 'deliver' && reviewMode === 'operator') {
      const reviewNumber = process.env.OBSERVE_REVIEW_NUMBER || '923333232533';
      const png = await downloadFromR2(delivery.report_key);
      await _sendPackage(
        reviewNumber, png,
        `[REVIEW — FEAT-053] Kwa: ${delivery.teacher_name} (+${delivery.teacher_phone}) · Kutoka: ${foName}\n${delivery.caption || ''}`,
        delivery.companion_text);
      await mergeTeacherDelivery(sessionId, { status: 'operator_review' });
      await WhatsAppService.sendMessage(foPhone, S.send_operator_review_fo);
      logToFile('🔎 observe send: routed to operator review', { sessionId });
      return;
    }

    // Window check (quiz architecture incl. the Meta 131047 negative cache).
    // teacher_tap just opened the window by definition — skip the check.
    let windowOpen = true;
    if (phase === 'deliver') {
      const QuizDeliveryService = require('../quiz/quiz-delivery.service');
      windowOpen = await QuizDeliveryService._hasOpenMessageWindow(delivery.teacher_phone);
    }

    if (!windowOpen) {
      // Cold teacher → approved UTILITY template opens the door (D19).
      // Body: {{1}} teacher name, {{2}} FO name. QUICK_REPLY carries the
      // session-scoped payload so the tap routes back to THIS report.
      const tpl = reportTemplateConfig();   // FEAT-093 bd-54 — per-market template
      try {
        await _sendReportTemplate(delivery, foName, sessionId);
      } catch (sendErr) {
        await _handleDeliverFailure(sessionId, foPhone, S, 'template', sendErr, { tpl });
        return;
      }
      // bd-2675: stamp WHEN — the untapped planner refuses to act without it,
      // and the coach's follow-up depends on it.
      await mergeTeacherDelivery(sessionId, {
        status: 'awaiting_teacher_tap',
        template_sent_at: new Date().toISOString(),
      });
      await WhatsAppService.sendMessage(foPhone, S.send_template_queued_fo);
      logToFile('📨 observe send: template sent (window closed)', { sessionId });
      return;
    }

    try {
      const png = await downloadFromR2(delivery.report_key);
      await _sendPackage(delivery.teacher_phone, png, delivery.caption || '', delivery.companion_text);
    } catch (sendErr) {
      await _handleDeliverFailure(sessionId, foPhone, S, 'direct', sendErr);
      return;
    }
    // bd-2675: the tap is the event that closes the loop — it stops every
    // further nudge, and the coach is told the report actually landed rather
    // than being left with a "sent" she can't trust.
    const nowIso = new Date().toISOString();
    await mergeTeacherDelivery(sessionId, {
      status: 'sent',
      sent_at: nowIso,
      ...(phase === 'teacher_tap' ? { tapped_at: nowIso } : {}),
    });
    await WhatsAppService.sendMessage(
      foPhone,
      phase === 'teacher_tap'
        ? (S.send_tapped_fo || S.send_done_fo).replace('{name}', delivery.teacher_name || '')
        : S.send_done_fo);
    logToFile('✅ observe send: combined report delivered to teacher', { sessionId });
    return;
  }

  throw new Error(`observe send: unknown phase ${phase}`);
}

module.exports = {
  reportTemplateConfig,
  listKnownTeachers,
  buildTeacherPickPayload,
  buildTeacherManagePayload,
  handleTeacherPick,
  handleTeacherManage,
  handleTeacherManageButton,
  TEMPLATE_PAYLOAD_PREFIX,
  normalizeTzPhone,
  parseTeacherDetails,
  parseSendButtonId,
  buildSendChoiceButtons,
  buildSendConfirmButtons,
  mergeTeacherDelivery,
  startSendFlow,
  handleSendLater,
  handleTeacherDetailsText,
  handleSendConfirm,
  handleSendCancel,
  processTeacherReport,
  resolveTeacherLang,
  otherLang,
  handleSendLangToggle,
  processUntappedDelivery,
  clampToMarket,
};
