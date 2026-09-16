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
const { languageFor, clampToMarket } = require('./observe-language');
const { metaErrorCodeOf, RE_ENGAGEMENT_ERROR_CODE } = require('../../config/meta-messaging-window');
const { teacherOf, coachOf, isBound } = require('./observe-people');
const { logToFile } = require('../../utils/logger');

const BTN = {
  start: 'observe_send_start_',
  later: 'observe_send_later_',
  confirm: 'observe_send_confirm_',
  other: 'observe_send_other_',
  cancel: 'observe_send_cancel_',
};
const TEMPLATE_PAYLOAD_PREFIX = 'observe_report_';

// bd-dy7hs — "whose language is this?" has ONE owner now (bd-04m67). The market
// table, the clamp and the teacher/coach resolution all live in
// observe-language.js; this file just names the audience.
//
// What used to be here, and why it is gone:
//   · resolveTeacherLang() fell back to the COACH's language when the teacher
//     had no preference, so a teacher who never chose one read her feedback in
//     whatever the coach speaks. languageFor('teacher', …) falls to the MARKET
//     default instead.
//   · a `lang_override` branch let the coach flip a single report by hand
//     (bd-2673). It was a human patch over a resolution bug, and it cost a full
//     re-render that SQS then silently dropped (bd-rkofm). Overrides already
//     written stay in analysis_data and simply stop being read — no migration,
//     and the record of what was chosen survives.

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

/**
 * The preview line names the teacher and her number. A roster row can legitimately
 * have no name (a number the coach typed), and `_person` normalises an empty name
 * to null — so "{name} ({phone})" left "Got it —  (+9933…)" with the gap still in
 * it, in every language. Fill the template, then close any gap the empty name left.
 */
function fillPreviewComing(S, name, phone) {
  return S.send_preview_coming
    .replace('{name}', String(name || '').trim())
    .replace('{phone}', `+${phone}`)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(—|-)\s+\(/, '$1 (')
    .replace(/\s+([.,۔])/g, '$1');
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

function buildSendConfirmButtons(sessionId, S) {
  // Send, someone else, or cancel. A bound session now resolves its own
  // recipient, so the middle button is the escape hatch for the 9% of sends
  // that legitimately go elsewhere — a deliberate act instead of the default
  // every coach had to walk through. WhatsApp allows three buttons; every
  // title is inside the 20-code-point cap.
  return {
    body: S.send_confirm_body,
    buttons: [
      { id: `${BTN.confirm}${sessionId}`, title: String(S.btn_send_now).slice(0, 20) },
      { id: `${BTN.other}${sessionId}`, title: String(S.btn_send_other).slice(0, 20) },
      { id: `${BTN.cancel}${sessionId}`, title: String(S.btn_send_cancel).slice(0, 20) },
    ],
  };
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
  if (delivery.status === 'awaiting_teacher_tap') {
    // bd-1ezak: say WHERE it stands — invite sent on <date>, teacher hasn't
    // tapped yet — instead of a bare "already sent". Never re-invites (the
    // untapped-nudge planner owns reminders, bd-2675).
    const ts = delivery.template_sent_at ? new Date(delivery.template_sent_at) : null;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = ts && !Number.isNaN(ts.getTime()) ? `${ts.getUTCDate()} ${MONTHS[ts.getUTCMonth()]}` : '';
    await WhatsAppService.sendMessage(from,
      (S.send_waiting_tap_info || '{name} — invite sent {date}; waiting for her tap.')
        .replace('{name}', delivery.teacher_name || '')
        .replace('{date}', day));
    return;
  }
  if (delivery.status === 'sent') {
    await WhatsAppService.sendMessage(from, S.send_already_sent);
    return;
  }

  // The observation already knows whose lesson it was. 665 of 665 report sends
  // since 7 Sep were on a bound session, and 665 of 665 already carried that
  // teacher's phone on her users row — yet the coach was asked every time, and
  // 9% of those answers went to the wrong person, in 54 of 60 cases to someone
  // the roster she was shown could not even have offered. So when the session
  // is bound and the teacher has a phone on file, go straight to preview and
  // confirm, exactly as a pick would.
  const boundTeacher = await teacherOf(session);
  if (isBound(session) && boundTeacher && boundTeacher.phone) {
    const CoachingJobQueueService = require('../coaching/coaching-job-queue.service');
    try {
      const { upsertTeacher } = require('./observe-roster');
      const picked = { name: boundTeacher.name || '', phone: boundTeacher.phone };
      // The roster starts learning correct pairs instead of whatever was typed.
      await upsertTeacher(user, picked);
      await mergeTeacherDelivery(sessionId, {
        teacher_name: picked.name,
        teacher_phone: picked.phone,
        status: 'previewing',
      });
      await ObserveState.setState(user.id, 'awaiting_send_confirm', { sessionId });
      await WhatsAppService.sendMessage(
        from, fillPreviewComing(S, picked.name, picked.phone));
      await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'preview' });
      logToFile('📤 observe send: bound teacher carried — no pick asked', {
        sessionId, observerId: user.id, recipientSource: 'session_binding',
      });
      return;
    } catch (err) {
      // Never dead-end a coach standing in a school: fall through to the pick.
      logToFile('⚠️ observe send: bound carry failed — falling back to the pick', {
        sessionId, observerId: user.id, error: err.message,
      });
    }
  }

  // bd-43: offer the officer their known teachers first (name+phone learned
  // from past deliveries) — picking one skips typing details entirely. The
  // list is snapshotted into the state so a tap can never resolve against a
  // different list than the one the officer saw.
  const { getRoster } = require('./observe-roster');
  const teachers = await getRoster(user);
  if (teachers.length > 0) {
    // bd-qq7wb: snapshot the FULL roster once; every page's row ids carry the
    // global index into this snapshot, so pagination can never mis-resolve.
    await ObserveState.setState(user.id, 'awaiting_teacher_pick', { sessionId, teachers });
    await WhatsAppService.sendInteractiveMessage(from, buildTeacherPickPayload(teachers, S));
    logToFile('📤 observe send: roster pick offered', {
      sessionId, observerId: user.id, rosterSize: teachers.length, bound: isBound(session),
    });
    return;
  }
  await ObserveState.setState(user.id, 'awaiting_teacher_details', { sessionId });
  await WhatsAppService.sendMessage(from, S.send_ask_details);
  logToFile('📤 observe send: details asked (empty roster)', {
    sessionId, observerId: user.id, bound: isBound(session),
  });
}

/**
 * "Someone else" on the confirm — hand the coach the roster pick for the SAME
 * session. Nothing is unwound: the delivery row is rewritten by whichever
 * recipient she then chooses.
 */
async function handleSendOther(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const { getRoster } = require('./observe-roster');
  const teachers = await getRoster(user).catch(() => []);
  if (!teachers.length) {
    await ObserveState.setState(user.id, 'awaiting_teacher_details', { sessionId });
    await WhatsAppService.sendMessage(from, S.send_ask_details);
    logToFile('📤 observe send: someone-else chosen, details asked', { sessionId, observerId: user.id });
    return;
  }
  await ObserveState.setState(user.id, 'awaiting_teacher_pick', { sessionId, teachers });
  await WhatsAppService.sendInteractiveMessage(from, buildTeacherPickPayload(teachers, S));
  logToFile('📤 observe send: someone-else chosen, roster pick offered', {
    sessionId, observerId: user.id, rosterSize: teachers.length,
  });
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
// bd-qq7wb: WhatsApp lists hold 10 rows TOTAL. The roster caps at 25, so an
// uncapped render (25 + new + manage = 27) made Meta refuse the send and the
// coach got SILENCE after tapping "Send report" — 26/83 coaches were over the
// cliff on 25 Aug (every coach with 9+ distinct delivered teachers, armed
// instantly by the history backfill). 8 MRU + new + manage = exactly 10.
const PICK_LIST_TEACHER_CAP = 8;   // fits without a more-row: 8 + new + manage = 10
const PICK_PAGE = 7;               // page size once a more-row is needed

function buildTeacherPickPayload(teachers, S, offset = 0) {
  // Row ids carry the GLOBAL roster index, so a tap on any page resolves
  // against the one full-roster snapshot taken at startSendFlow — a later
  // page can never mis-resolve to a different teacher.
  const paginated = teachers.length > PICK_LIST_TEACHER_CAP;
  const page = paginated ? teachers.slice(offset, offset + PICK_PAGE) : teachers;
  const rows = page.map((t, i) => ({
    id: `observe_pickt_${offset + i}`,
    title: String(t.name).slice(0, 24),
    description: `+${t.phone}`.slice(0, 72),
  }));
  if (paginated && offset + PICK_PAGE < teachers.length) {
    rows.push({
      id: `observe_pickt_more_${offset + PICK_PAGE}`,
      title: S.pick_teacher_more.slice(0, 24),
      description: `${Math.min(offset + PICK_PAGE, teachers.length)} / ${teachers.length}`,
    });
  }
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
  // bd-qq7wb pagination: "More teachers…" re-renders the next page from the
  // same snapshot. Checked before the numeric parse (parseInt('more_7') = NaN).
  if (listId.startsWith('observe_pickt_more_')) {
    const nextOffset = parseInt(listId.replace('observe_pickt_more_', ''), 10) || 0;
    await WhatsAppService.sendInteractiveMessage(
      from, buildTeacherPickPayload(state.teachers || [], S, nextOffset));
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
      from, fillPreviewComing(S, picked.name, picked.phone));
    await CoachingJobQueueService.queueObserveTeacherReport(sessionId, { from, phase: 'preview' });
    logToFile('🎯 observe send: recipient chosen from the roster', {
      sessionId, observerId: user.id, recipientSource: 'roster_pick',
    });
  } catch (err) {
    logToFile('❌ observe send: teacher pick failed', { sessionId, error: err.message });
    await WhatsAppService.sendMessage(from, S.debrief_load_error);
  }
  return true;
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

  // The coach's own chase-up, to the COACH and in the COACH's language.
  // `session.users` is the observed TEACHER on a bound session: the language
  // half of that was fixed earlier, the identity half sent 238 nudge and
  // give-up messages to the teacher instead of the coach.
  const coach = await coachOf(session);
  const foPhone = coach && coach.phone;
  const foName = (coach && coach.name) || '';
  const lang = await languageFor('coach', session);
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

  // give_up stops chasing and hands the coach a next step; `expire` is the same close for a report NOBODY ever chased, and it messages no one.
  const silent = decision.action === 'expire';
  await mergeTeacherDelivery(sessionId, { gave_up_at: iso, gave_up_reason: decision.reason });
  if (foPhone && !silent) {
    await WhatsAppService.sendMessage(foPhone, (S.send_gave_up_fo || '').replace('{name}', name)).catch(() => {});
  }
  logToFile(silent ? '🕰️ observe send: expired an unchased report, nobody messaged' : '🛑 observe send: gave up chasing an untapped report', { sessionId, teacher: name });
  return decision;
}

/**
 * The COACH's phone, resolved from `observer_user_id` and nowhere else.
 *
 * `session.users` on a bound observation is the OBSERVED TEACHER. Reading it to
 * decide who to message is how a teacher ends up receiving a chase-up about
 * herself, in someone else's language, about work she did not do. When the
 * coach cannot be resolved we go silent rather than message the wrong person —
 * the same call the mid-flight watchdog and the photo-gate sweep already make.
 */
async function _resolveCoach(session) {
  const observerId = session && session.observer_user_id;
  if (!observerId) return null;
  const { data: coach, error } = await supabase
    .from('users')
    .select('id, name, phone_number, preferred_language')
    .eq('id', observerId)
    .maybeSingle();
  if (error || !coach || !coach.phone_number) {
    logToFile('⚠️ observe send: could not resolve the coach — staying silent', {
      sessionId: session && session.id, observerUserId: observerId,
    }, 'error');
    return null;
  }
  return coach;
}

/**
 * Claim this row for this tick, or lose the race.
 *
 * Fifteen-minute ticks across several replicas classify the same row at the
 * same moment, so without a claim the coach gets the same reminder once per
 * replica. The claim IS the state write, compare-and-set on `updated_at`: the
 * replica whose write matches the `updated_at` it read wins, and every other
 * replica's write matches nothing and returns zero rows. PostgREST answers an
 * unmatched filter with an empty result rather than an error, so the row count
 * is the thing to check — not `error`.
 *
 * The claim is written BEFORE the message. A crash between the two costs one
 * unsent reminder; the other order costs a duplicate on every later tick.
 */
async function _claimDelivery(sessionId, seenUpdatedAt, patch) {
  const { data: row, error } = await supabase
    .from('coaching_sessions')
    .select('analysis_data')
    .eq('id', sessionId)
    .single();
  if (error || !row) throw new Error(`undelivered claim: load failed: ${error && error.message}`);
  const analysis = row.analysis_data || {};
  const merged = {
    ...analysis,
    teacher_delivery: { ...(analysis.teacher_delivery || {}), ...patch },
  };

  let q = supabase.from('coaching_sessions').update({ analysis_data: merged }).eq('id', sessionId);
  // A row read without an updated_at cannot be claimed safely, so it is not
  // claimed at all rather than claimed unguarded.
  if (!seenUpdatedAt) return { won: false };
  q = q.eq('updated_at', seenUpdatedAt);
  const { data: claimed, error: upErr } = await q.select('id');
  if (upErr) throw new Error(`undelivered claim: update failed: ${upErr.message}`);
  return { won: Array.isArray(claimed) ? claimed.length > 0 : !!claimed };
}

/**
 * Act on ONE finished observation whose report never reached the teacher.
 *
 * The planner decides (observe-undelivered.service); this resolves the coach,
 * claims the row and sends — or, past the age ceiling, closes it and says
 * nothing to anyone. Called by the recovery sweep.
 */
async function processUndeliveredDelivery(sessionId, nowMs = Date.now()) {
  const { classifyUndelivered } = require('./observe-undelivered.service');
  const session = await _loadSession(sessionId);
  const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};

  const decision = classifyUndelivered({
    deliveryStatus: delivery.status,
    sessionStatus: session.status,
    // When the report became available. `updated_at` is the last time anything
    // touched the row, which on a finished-and-abandoned observation IS the
    // moment it stopped moving.
    finishedAt: session.updated_at || session.created_at,
    reminded_at: delivery.reminded_at,
    reminder_count: delivery.reminder_count,
    gave_up_at: delivery.gave_up_at,
  }, nowMs);
  if (decision.action === 'skip') return decision;

  const silent = decision.action === 'expire';
  // Resolve the recipient BEFORE writing anything: a reminder we cannot deliver
  // should leave the row untouched so a later tick can try again once the
  // coach's record is fixed. An expire messages nobody, so it needs no coach.
  let coach = null;
  if (!silent) {
    coach = await _resolveCoach(session);
    if (!coach) return { action: 'skip', reason: 'coach_unresolved' };
  }

  const iso = new Date(nowMs).toISOString();
  const patch = decision.action === 'remind'
    ? { reminded_at: iso, reminder_count: Number(delivery.reminder_count || 0) + 1 }
    : { gave_up_at: iso, gave_up_reason: decision.reason };

  const { won } = await _claimDelivery(sessionId, session.updated_at, patch);
  if (!won) {
    logToFile('🤝 observe send: another replica claimed this undelivered report first', { sessionId });
    return { action: 'skip', reason: 'lost_race' };
  }

  if (silent) {
    logToFile('🕰️ observe send: expired an unsent report, nobody messaged', {
      sessionId, reason: decision.reason,
    });
    return decision;
  }

  const lang = await languageFor('coach', session);
  const S = observeStrings(lang);
  const name = delivery.teacher_name
    || (session.users && session.users.name)
    || S.send_undelivered_unnamed_teacher
    || '';
  const key = decision.action === 'remind'
    ? 'send_undelivered_reminder_fo'
    : 'send_undelivered_gave_up_fo';
  await WhatsAppService.sendMessage(coach.phone_number, (S[key] || '').replace('{name}', name))
    .catch(() => {});
  logToFile(decision.action === 'remind'
    ? '📨 observe send: reminded a coach about an unsent report'
    : '🛑 observe send: stopped reminding about an unsent report',
  { sessionId, reason: decision.reason });
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
// bd-qq7wb: the states in which a TYPED name+number is a valid answer. The
// pick list is an accelerator, not a gate — coaches habitually type the
// details anyway (Shazmina, 25 Aug: her typed reply fell into generic chat).
const DETAILS_TEXT_STATES = ['awaiting_teacher_details', 'awaiting_teacher_pick'];

async function handleTeacherDetailsText(user, from, text, observeState) {
  if (!observeState || !DETAILS_TEXT_STATES.includes(observeState.state)) return false;
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
      from, fillPreviewComing(S, parsed.name, parsed.phone));
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
    .select('*, users(name, phone_number, preferred_language)')
    .eq('id', sessionId)
    .single();
  if (error || !session) {
    throw new Error(`observe send: session not found: ${error && error.message}`);
  }
  return session;
}

// Extract teacher-facing debrief notes. NEVER blocks the report — every
// failure path returns null and the report ships without the companion.
async function _extractNotes(session, foName, notesLang) {
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
    // bd-c3uq9: the language arrives from the caller, already resolved for the
    // TEACHER — she is the one who reads this note. It used to be
    // observeLang(session.users), and that join is the teacher on a bound
    // observation but the coach on a bare one, so the note's language depended
    // on how the session had been created rather than on who reads it.
    const { result } = await GPT5MiniService.completeJson(
      notesLang !== 'sw'
        ? buildDebriefNotesPromptI18n(transcript, { foName }, notesLang)
        : buildDebriefNotesPrompt(transcript, { foName }),
      // bd-2670: raised from 2000 → 6000. NIETE-Rumi Urdu debrief output for
      // 40-min classroom-observation transcripts routinely exceeded 2000 tokens,
      // hitting `finish_reason: length` and either truncating mid-JSON or
      // breaking the mixed-script quote escape. niete-logs Aug 13-20 showed the
      // trend climbing 5→11→28→31/day. `_extractNotes` swallows the failure so
      // the report still ships, but teachers were routinely missing the
      // companion debrief notes. 6000 gives O(4-6K) NIETE Urdu output the
      // headroom it needs, well below completeJson's 24000-token ceiling.
      { maxTokens: 6000, label: 'observeDebriefNotes' },
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
//
// The failure must arrive at the caller WITH the reason. Both senders catch the
// Graph error, log it and answer `false`, so the Meta error code was available
// and then thrown away one frame below the only code that could act on it —
// which is how a re-engagement refusal (131047, remedy: send the invite
// template) became indistinguishable from an invalid parameter (remedy: tell
// the coach it failed). Each send now reports its error through the senders'
// `onError` seam and the thrown Error carries the code.
async function _sendPackage(dest, pngBuffer, caption, companionText) {
  let lastError = null;
  const capture = { onError: (err) => { lastError = err; } };

  const fail = (message) => {
    const err = new Error(message);
    err.cause = lastError;
    err.metaErrorCode = metaErrorCodeOf(lastError);
    return err;
  };

  const sentImg = await WhatsAppService.sendImageFromBuffer(dest, pngBuffer, caption, 'image/png', capture);
  if (sentImg === false) throw fail('observe send: report image send failed');
  if (companionText) {
    const sentTxt = await WhatsAppService.sendMessage(dest, companionText, capture);
    if (sentTxt === false) throw fail('observe send: companion send failed');
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
/**
 * A window that closed between our check and Meta's answer is not a failure —
 * it is the cold-teacher path arriving late, and it already has a remedy.
 *
 * Our check cuts a few minutes inside Meta's 24 hours, but Meta measures from
 * its own clock and against its own record of her last inbound, so the two can
 * disagree at the edge. When they do, Meta answers 131047 and the report is
 * refused. Recording that as `send_failed` leaves the coach with a dead end and
 * the teacher with nothing, while the invite template she would have been sent a
 * minute earlier still works. So: flag the window closed for the next send,
 * send the template, and hand the delivery to the untapped planner that already
 * owns "invite sent, waiting for her tap".
 *
 * Not on the teacher_tap path: she has just tapped, so the window is open by
 * definition, and answering a tap with another invite is a loop.
 */
async function _handleWindowClosedMidSend(sessionId, foPhone, S, delivery, foName, err) {
  logToFile('📨 observe send: window closed mid-send — falling back to the invite template', {
    sessionId, metaErrorCode: err && err.metaErrorCode,
  });
  // Next send for this teacher skips the free path instead of re-learning this.
  try {
    const metaWindowCache = require('../quiz/meta-window-cache.service');
    await metaWindowCache.markWindowClosed(delivery.teacher_phone);
  } catch (cacheErr) {
    logToFile('⚠️ observe send: could not flag the closed window (non-fatal)', {
      sessionId, error: cacheErr.message,
    });
  }

  try {
    await _sendReportTemplate(delivery, foName, sessionId);
  } catch (tplErr) {
    // The template is the last route in. If it fails too, this IS a failure.
    return false;
  }
  await mergeTeacherDelivery(sessionId, {
    status: 'awaiting_teacher_tap',
    template_sent_at: new Date().toISOString(),
  });
  await WhatsAppService.sendMessage(foPhone, S.send_template_queued_fo).catch(() => {});
  return true;
}

async function _handleDeliverFailure(sessionId, foPhone, S, path, err, meta = {}) {
  // Read the code BEFORE filing this as a failure. A 131047 on the direct path
  // means the window closed between our check and the send; the report is not
  // lost, it just needs the invite route instead.
  if (path === 'direct'
      && err && err.metaErrorCode === RE_ENGAGEMENT_ERROR_CODE
      && meta.delivery && meta.delivery.teacher_phone) {
    const recovered = await _handleWindowClosedMidSend(
      sessionId, foPhone, S, meta.delivery, meta.foName || '', err);
    if (recovered) return;
    // Template also refused — fall through and record the failure honestly.
  }

  logToFile('❌ observe send: teacher delivery failed', {
    sessionId, path, template: meta.tpl && meta.tpl.name,
    metaErrorCode: err && err.metaErrorCode,
    error: err && err.message, stack: err && err.stack,
  });
  await mergeTeacherDelivery(sessionId, {
    status: 'send_failed',
    last_error: err && err.message,
    meta_error_code: (err && err.metaErrorCode) || null,
    failed_at: new Date().toISOString(),
  }).catch(() => {});
  await WhatsAppService.sendMessage(foPhone, S.send_failed_fo).catch(() => {});
}

async function processTeacherReport(sessionId, payload = {}) {
  const session = await _loadSession(sessionId);
  // `session.users` is joined off user_id, which on a bound observation is the
  // TEACHER — 98% of finished observations are bound. Reading it here sent the
  // coach's own confirmations to her teacher, addressed with the teacher's
  // name, and put the teacher's name in the report's "From" line. Resolve the
  // audience by name instead.
  const coach = await coachOf(session);
  const foPhone = payload.from && payload.phase !== 'teacher_tap'
    ? payload.from
    : (coach && coach.phone) || null;
  const foName = (coach && coach.name) || 'Afisa';
  // bd-dy7hs: two audiences, named. They are computed separately and stay
  // separate (spec 2.3) — the coach's acks ("preview sent", "queued") are hers,
  // only the teacher-bound artefacts follow the teacher.
  const lang = await languageFor('coach', session);
  const S = observeStrings(lang);
  const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};
  const teacherLang = await languageFor('teacher', session);
  const teacherS = observeStrings(teacherLang);

  if (delivery.status === 'sent') {
    logToFile('🔭 observe send: already sent — no-op', { sessionId });
    return;
  }

  const phase = payload.phase || 'preview';

  // The invite is already out with this teacher; the untapped planner owns what
  // happens next (one nudge, then it stops and tells the coach). A redelivery
  // of the deliver job must not put a second invite in front of her — which the
  // queue does routinely, and which the window-closed fallback below now makes
  // reachable on a path that previously dead-ended at send_failed. teacher_tap
  // is exempt by definition: that phase exists to serve the tap on that invite.
  if (phase === 'deliver' && delivery.status === 'awaiting_teacher_tap' && delivery.template_sent_at) {
    logToFile('🔭 observe send: invite already sent — the untapped planner owns this one', { sessionId });
    return;
  }

  if (phase === 'preview') {
    const { buildCompanionText } = require('./observe-teacher-report');
    const { generateHeroReport } = require('../coaching/report-v2/hero-report.service');
    const { heroBrandFor } = require('../coaching/report-renderers/renderer-registry');
    const { uploadImageBuffer } = require('../../storage/r2');

    const notes = await _extractNotes(session, foName, teacherLang);
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
    await WhatsAppService.sendInteractiveButtons(
      foPhone, buildSendConfirmButtons(sessionId, S));
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
      // `phase` decides whether the window-closed fallback is even available:
      // on a teacher_tap the window is open by definition.
      await _handleDeliverFailure(sessionId, foPhone, S,
        phase === 'deliver' ? 'direct' : 'direct_tap', sendErr, { delivery, foName });
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
    // bd-9rrd5: report sent — if the debrief is done too, the observation is
    // COMPLETE. Without this flip HITL sessions never left
    // observer_review_complete and every "completed" count read coaches as 0.
    {
      const { maybeCompleteObservation } = require('./observe-completion');
      await maybeCompleteObservation(sessionId);
    }
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
  fillPreviewComing,
  reportTemplateConfig,
  listKnownTeachers,
  buildTeacherPickPayload,
  buildTeacherManagePayload,
  handleTeacherPick,
  handleSendOther,
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
  processUntappedDelivery,
  processUndeliveredDelivery,
  clampToMarket,
  DETAILS_TEXT_STATES,
};
