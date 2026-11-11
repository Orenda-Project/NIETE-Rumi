'use strict';

/**
 * /observe2 — the check's endpoint (POST /api/flows/observe2-check).
 *
 * Token: <coachUserId>:observe2-check:<recordId>. Every request re-reads the record and checks
 * that it belongs to the coach in the token; the record must be sealed.
 *
 *   INIT / HEARD_*  the moments from the recording for one part of the lesson, each its minute,
 *                   what it is and the words; the coach says whether it happened. Each screen's
 *                   answers are saved as it is submitted.
 *   HEARD_EXPLAIN → FIDELITY   only when a plan was picked in the form and graded: each step the plan
 *                   asked for, pre-rated from the recording; the coach's corrections are re-scored by
 *                   /observe's scorer and kept beside the recording's own grading.
 *   HEARD_EXPLAIN or FIDELITY → ADDED_ONE, ADDED_TWO   every level pre-filled with what the sealed answers and the
 *                   confirmed moments add up to (rules.addUp), with the reason; the recording's
 *                   own levels are never sent to any screen.
 *   ADDED_TWO → PRIORITY   the picks sealed before any moment was seen: "Work on first" and up to two
 *                   more (R14), any of the 17, the plan's steps or a coaching focus area (R20, R21). A check
 *                   opened on an older Flow (its `cv`, or none) gets its own screen's data, and only picks its
 *                   lists have; a sealed pick it could not show is kept as an "Also work on" at Submit.
 *   PRIORITY → DONE      the record is checked once; the brief follows in the chat.
 *
 * FICO17 v6 visits (rubric_version 'fico17_v6', stamped when the visit was made; bd-ra8xu.38):
 *   HEARD_EXPLAIN → COMBINED_ONE → COMBINED_TWO → COMBINED_THREE   the coach sets C3 C5 C7 D3 D4 D2 from the room, each
 *                   from blank with a reason of 20+ characters; D2 with the two child counts. Refused (the same
 *                   screen, a message under the field) until each is set.
 *   COMBINED_THREE → FIDELITY (a graded plan) or ADDED_DC_ONE → ADDED_DC_TWO → PRIORITY   Rumi's other 11 levels,
 *                   pre-filled; a changed level needs a reason. A v6 visit opened on a Flow without the v6 screens
 *                   (no `v6c` from HEARD_EXPLAIN) runs on the v5 screens and is marked v6_fallback.
 *   PRIORITY        final_levels as for v5 (one string per code), plus evidence_review.v6_levels: who set each
 *                   level (coach | rumi), why, and on which rubric.
 */

const supabase = require('../config/supabase');
const Store = require('../services/observe/observe2/field-form.store');
const { addUp } = require('../services/observe/observe2/rules');
const { CODES, PLAN_FOCUS, FOCUS, FOCUS_ORDER, ALSO_NONE, pickAlso } = require('../services/observe/observe2/fico17');
const { SLOTS, FIDELITY_SLOTS, HEARD_SCREENS, ADDED_SCREENS, COMBINED_SCREENS, ADDED6_SCREENS } = require('../services/observe/observe2/evidence-check.flow');
const { isV6 } = require('../services/observe/observe2/rubric');
const V6 = require('../services/coaching/frameworks/fico17-v6');
const { observe2Strings } = require('../services/observe/observe2/strings');
const { notesSection } = require('../services/observe/observe2/brief');
const { logToFile } = require('../utils/logger');

const HEARD_IDS = HEARD_SCREENS.map((h) => h.id);
const MOMENT_OF = Object.fromEntries(HEARD_SCREENS.map((h) => [h.id, h.moment]));
const ADDED_CODES = Object.fromEntries(ADDED_SCREENS.map((a) => [a.id, a.codes]));
const COMBINED_IDS = COMBINED_SCREENS.map((c) => c.id);
const COMBINED_CODES_OF = Object.fromEntries(COMBINED_SCREENS.map((c) => [c.id, c.codes]));
const ADDED6_OF = Object.fromEntries(ADDED6_SCREENS.map((a) => [a.id, a]));

function parseToken(flowToken) {
  const [userId, marker, recordId] = String(flowToken || '').split(':');
  if (!userId || marker !== 'observe2-check' || !recordId) return null;
  return { userId, recordId };
}

function clock(iso) {
  let timeZone = 'UTC';
  try {
    timeZone = require('../services/observe/observe-debrief.service').displayTimeZone() || 'UTC';
  } catch (err) {
    logToFile('[observe2] display time zone unavailable, using UTC', { error: err.message }, 'warn');
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
  } catch (_) {
    return String(iso || '').slice(11, 16);
  }
}

async function loadForm(flowToken) {
  const t = parseToken(flowToken);
  if (!t) return null;
  const got = await Store.getForm(t.recordId);
  if (!got.ok || !got.form) return null;
  const f = got.form;
  return f.observer_user_id === t.userId && f.sealed_at ? f : null;
}

const momentsOf = (form) => ((form && form.rumi_moments && form.rumi_moments.moments) || []);

// ------------------------------------------------------------------ screens

// The line that opens each moments screen. A part with no moment says so: a question over nothing is
// what coaches met on 14 Oct (pilot sheet R8, R9; bd-eal7zn.3). Explaining moments feed no level by a
// rule (rules.js PICK_CODES), so that screen says the coach picks those levels.
const HEARD_INTRO = Object.freeze({
  some: 'These moments were picked from the recording as evidence for this part of the lesson. Say whether each one happened as written. What you confirm counts toward the levels on the next screens; a "No" counts for nothing.',
  explain: 'These moments were picked from the recording as evidence of how the teacher explains. Say whether each one happened as written. They help you choose the explaining levels on the next screens; they are not added up for you.',
  none: 'No clear moment for this question was found in the recording, so there is nothing to check here. Your own answers from the form still count. Tap Next.',
  unavailable: 'This check is not available. Tap Next to close it.',
});

function introFor(moment, form, count) {
  if (!form) return HEARD_INTRO.unavailable;
  if (!count) return HEARD_INTRO.none;
  return moment === 'explain' ? HEARD_INTRO.explain : HEARD_INTRO.some;
}

// A slot's description: the quote, then why Rumi picked it (pilot sheet R15), within WhatsApp's 300
// code points. The why is never cut; the quote gives way. A moment from before v2 has no why.
const DESCRIPTION_MAX = 300;
const WHY_SHOWN_MAX = 120;
const clipCp = (text, max) => { const cps = [...text]; return cps.length > max ? `${cps.slice(0, Math.max(0, max - 1)).join('')}…` : text; };

function describe(m) {
  const why = clipCp(String(m.why || '').trim(), WHY_SHOWN_MAX);
  const room = DESCRIPTION_MAX - 2 - (why ? [...why].length + 1 : 0);
  const quote = clipCp(String(m.quote || ''), room);
  return why ? `"${quote}"\n${why}` : `"${quote}"`;
}

function renderHeard(screenId, form) {
  const moment = MOMENT_OF[screenId];
  const list = momentsOf(form).filter((m) => m.moment === moment);
  const data = { [`${screenId.toLowerCase()}_intro`]: introFor(moment, form, list.length) };
  for (let i = 1; i <= SLOTS; i += 1) {
    const k = `${screenId.toLowerCase()}_${i}`;
    const m = list[i - 1];
    data[`${k}_t`] = m ? [...`${m.minute} · ${m.label || m.type}`].slice(0, 30).join('') : '';
    data[`${k}_d`] = m ? describe(m) : '';
    data[`${k}_v`] = Boolean(m);
  }
  return { screen: screenId, data };
}

const levelText = (lv) => (lv == null ? '' : String(lv));

// The check's version (`cv`), posted from ADDED_TWO and PRIORITY: none on the first published check, 2 on
// round 6's ("Also work on"), 3 since the coaching focus areas (evidence-check.flow.js CHECK_VERSION). Each
// entry below is keyed by the version that brought it, never by CHECK_VERSION, so a later bump keeps a
// version-3 check on its own lists.
const checkVersion = (screenData) => Number((screenData && screenData.cv) || 0);
// What each published check's PRIORITY lists hold: the 17; then the plan's steps (cv 2, R14); then the
// coaching focus areas (cv 3, R20/R21). A Dropdown is never sent a value its own list cannot show.
const LISTED = [
  [3, new Set(FOCUS_ORDER)],
  [2, new Set([...CODES, PLAN_FOCUS])],
  [0, new Set(CODES)],
];
const listedOn = (version) => LISTED.find(([since]) => version >= since)[1];
// The sealed picks a check's lists could not show the coach.
const unshown = (a, shown) => [a.priority, a.also_1, a.also_2].map((v) => String(v || '')).filter((v) => FOCUS[v] && !shown.has(v));

// The coach's notes from the visit, read-only above the picks (pilot sheet R23): the conversation with the
// teacher usually runs while this check is open (24 of 47 debriefs on prod since 16 Oct), before the brief
// that also carries them. The brief's own section, without "Why you changed", which is typed on this
// screen. Sent to every check that posts a `cv` (2 and 3); a check opened on a Flow published before the
// block was declared ignores the two keys.
function notesData(form) {
  const body = notesSection(form, { except: ['why'], plain: true }).join('\n');
  return { notes_v: Boolean(body), notes_body: body };
}

// The PRIORITY screen, pre-filled with the sealed picks its own lists have. A pick an older check cannot
// show is left for the coach to choose there, and kept at Submit (below).
function renderPriority(form, screenData) {
  const a = (form && form.answers) || {};
  const version = checkVersion(screenData);
  const shown = listedOn(version);
  const first = String(a.priority || '');
  const firstShown = shown.has(first) ? first : '';
  if (version < 2) return { screen: 'PRIORITY', data: { priority_level: firstShown } };
  const also = pickAlso([a.also_1, a.also_2], first).filter((id) => shown.has(id));
  return {
    screen: 'PRIORITY',
    data: { priority_level: firstShown, also_level_1: also[0] || ALSO_NONE, also_level_2: also[1] || ALSO_NONE, ...notesData(form) },
  };
}

function renderAdded(screenId, added) {
  const data = {};
  for (const code of ADDED_CODES[screenId]) {
    const r = (added || {})[code] || {};
    data[`${code}_because`] = r.because || '';
    data[`${code}_level`] = levelText(r.level);
  }
  return { screen: screenId, data };
}

// ------------------------------------------------------------------ fidelity

const DONE_VERDICTS = new Set(['executed', 'substituted_equivalent', 'substituted_better']);
// The grader's phase names (the move lists'), plus the older long names some plans still carry.
const PHASE = {
  warm_up: 'Warm-up', hook: 'Hook', recall: 'Recall', announce: 'Lesson aim', explain: 'Explaining',
  guided: 'Practice together', independent: 'Practice alone', peer_review: 'Pairs check each other',
  exit: 'Exit check', homework: 'Homework',
  introduction: 'Introduction', direct_instruction: 'Explaining', guided_practice: 'Practice together',
  independent_practice: 'Practice alone', assessment: 'Exit check', closure: 'Closing',
};
const STEP_TEXT_CAP = 700;

/** The recording's grading of the plan, when there is one to check. */
function gradedPlan(form) {
  const lp = form && form.rumi_moments && form.rumi_moments.fidelity;
  return lp && lp.status === 'ok' && lp.fidelity_pct != null && Array.isArray(lp.moves) && lp.moves.length ? lp : null;
}

function planTally(lp) {
  const counted = (lp.moves || []).filter((m) => m.counted);
  return {
    total: lp.prescribed_count != null ? lp.prescribed_count : counted.length,
    done: counted.filter((m) => DONE_VERDICTS.has(m.verdict)).length,
    partly: counted.filter((m) => m.verdict === 'partial').length,
    missed: counted.filter((m) => m.verdict === 'not_done').length,
  };
}

function renderFidelity(form) {
  const lp = gradedPlan(form);
  const { composeEditableFidelity, clipWords } = require('../services/observe/observe-draft.service');
  const slots = (composeEditableFidelity(lp) || { slots: [] }).slots;
  const t = planTally(lp);
  const n = lp.moves.length;
  // Homework, and extras the plan offers, are listed but not counted: say so, or "7 steps" sits over a list of 8.
  const header = [
    t.total === n ? `The plan has ${n} steps.` : `The plan has ${n} steps; ${t.total} count toward the result.`,
    `From the recording: ${t.done} done${t.partly ? `, ${t.partly} partly` : ''}${t.missed ? `, ${t.missed} not done` : ''} (${Math.round(lp.fidelity_pct)}%).`,
    'Check each step below and change any you saw differently; the result follows your answers.',
  ];
  if (lp.moves.length > FIDELITY_SLOTS) header.push(`Steps after the ${FIDELITY_SLOTS}th keep the recording's rating.`);
  if (lp.moderators && lp.moderators.truncation_inconsistent) header.push('The recording may have stopped before the lesson ended: check the later steps.');
  const data = { fid_header: header.join('\n') };
  for (let k = 1; k <= FIDELITY_SLOTS; k += 1) {
    const m = lp.moves[k - 1];
    const slot = slots[k - 1];
    const why = m ? String(m.rationale || '').trim() : '';
    const label = m ? `Step ${k} of ${n}${PHASE[m.phase] ? ` · ${PHASE[m.phase]}` : ''}${m.counted ? '' : ' (not counted)'}` : '';
    data[`mv_${k}`] = m
      ? `${clipWords(`${label}: ${m.text}`, STEP_TEXT_CAP)}${why ? `\nFrom the recording: ${clipWords(why, 250)}` : ''}`
      : '';
    data[`mv_${k}_v`] = Boolean(m);
    data[`fr_${k}`] = slot ? slot.verdict : '';
    data[`fe_${k}`] = slot ? slot.evidence : '';
  }
  return { screen: 'FIDELITY', data };
}

// The coach's corrections, re-scored by the scorer /observe's Section B uses.
function confirmedPlan(lp, edits) {
  const { rescoreFidelityFromEdits } = require('../services/observe/observe-draft.service');
  const r = rescoreFidelityFromEdits(lp, edits);
  const out = r.lp;
  return {
    fidelity_pct: out.fidelity_pct,
    band: out.band || null,
    prescribed_count: out.prescribed_count != null ? out.prescribed_count : null,
    observer_edited: Boolean(r.verdictsChanged || r.evidenceChanged),
    verdicts_changed: r.verdictsChanged,
    evidence_changed: r.evidenceChanged,
    moves: (out.moves || []).map((m) => ({ move_id: m.move_id, text: m.text, verdict: m.verdict, evidence: m.evidence || '', counted: Boolean(m.counted) })),
  };
}

function renderDone(form, lines) {
  const l = lines || {
    done_line: `Saved at ${clock(form.checked_at)}`,
    next_line: 'Next, in the chat: the debrief with the teacher.',
  };
  return { screen: 'DONE', data: { ...l, record_id: String((form && form.id) || '') } };
}

const NOT_AVAILABLE = {
  done_line: 'Nothing to save',
  next_line: 'This check is not available. Send /observe2 in the chat to start a new visit.',
};

// The levels the sealed answers and the confirmed moments add up to, with the reason for each.
function addedLevels(form, review) {
  const confirmed = momentsOf(form).filter((m) => review[`heard_${m.id}`] === 'yes');
  const counts = (form.rumi_moments && form.rumi_moments.counts) || {};
  const all = addUp({ form: form.answers || {}, confirmed, heardCounts: counts });
  const out = {};
  for (const [code, r] of Object.entries(all)) {
    out[code] = { level: r.level == null ? null : r.level, because: r.because || '', hole: Boolean(r.hole) };
  }
  return out;
}

// For the brief: what was seen behind a level the rule only puts in place "for now".
const holesOf = (added) => Object.fromEntries(Object.entries(added).filter(([, r]) => r.hole).map(([c, r]) => [c, String(r.because).split(':')[0]]));

function pickFields(screenData, keys) {
  const out = {};
  for (const k of keys) {
    const v = screenData[k];
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}

// ------------------------------------------------------------------ after Submit

/**
 * The checked record joins /observe's end. The session is saved the way /observe saves a submitted
 * form: status observer_review_complete and the analysis its debrief, coach card and teacher report
 * read (observe2/analysis.js), with the brief as this visit's debrief guide and the seal's photos
 * as the report's classroom photos. Guarded like /observe's own write: never over a cancelled visit.
 * @returns {Promise<{ok:boolean, coach?:object}>}
 */
async function handOver(form) {
  const sessionId = form.coaching_session_id;
  if (!sessionId) return { ok: false };
  const { buildBrief } = require('../services/observe/observe2/brief');
  const { buildAnalysis } = require('../services/observe/observe2/analysis');
  const { TERMINAL_IN_FILTER } = require('../services/coaching/session-terminal');
  const { data: coach } = await supabase.from('users')
    .select('id, phone_number, preferred_language, name').eq('id', form.observer_user_id).maybeSingle();
  const { data: row, error: readErr } = await supabase.from('coaching_sessions')
    .select('analysis_data, user_id').eq('id', sessionId).maybeSingle();
  if (readErr) {
    logToFile('[observe2] checked, but the session could not be read for the hand-off', { formId: form.id, sessionId, error: readErr.message }, 'error');
    return { ok: false, coach };
  }
  // The teacher: the form's, or the one the coach named after the recording ("who did you observe?").
  const teacherId = form.teacher_user_id
    || (row && row.user_id && row.user_id !== form.observer_user_id ? row.user_id : null);
  let teacherName = null;
  if (teacherId) {
    const { data: t } = await supabase.from('users').select('name').eq('id', teacherId).maybeSingle();
    teacherName = (t && t.name) || null;
  }
  const brief = buildBrief(form, { teacherName, lang: coach && coach.preferred_language });
  const analysis = buildAnalysis(form, { brief });
  const photos = Array.isArray(form.photos) ? form.photos.filter(Boolean) : [];
  const patch = {
    status: 'observer_review_complete',
    analysis_data: { ...((row && row.analysis_data) || {}), ...analysis },
    ...(photos.length ? { classroom_photos: photos.map((url) => ({ url })) } : {}),
  };
  const { data, error } = await supabase.from('coaching_sessions')
    .update(patch).eq('id', sessionId).not('status', 'in', TERMINAL_IN_FILTER).select('id');
  if (error || !(data || []).length) {
    logToFile('[observe2] checked, but the session was not handed to the debrief', {
      formId: form.id, sessionId, error: error && error.message, noRow: !error,
    }, 'error');
    return { ok: false, coach };
  }
  logToFile('[observe2] checked record handed to the debrief', {
    formId: form.id, sessionId, pct: analysis.scores && analysis.scores.overall_percentage, sectionB: analysis.lp_fidelity.status,
  });
  return { ok: true, coach };
}

// Was the visit already handed over (a repeat Submit)? Read failures count as not yet, so the hand-off
// is tried again: it is safe to repeat (the analysis is merged, the status write is guarded).
async function handedOver(form) {
  if (!form.coaching_session_id) return true;
  const { data } = await supabase.from('coaching_sessions').select('status').eq('id', form.coaching_session_id).maybeSingle();
  return Boolean(data && ['observer_review_complete', 'completed', 'cancelled', 'abandoned'].includes(data.status));
}

const NOT_HANDED = {
  done_line: 'Saved',
  next_line: 'Your answers are saved, but the next step did not start. Open this check again from the chat and tap Submit.',
};

// "Saved. Debrief now or later?", as after /observe's form.
async function askDebrief(form, coach) {
  try {
    if (!coach || !coach.phone_number) {
      logToFile('[observe2] checked, but the coach could not be found to ask about the debrief', { formId: form.id }, 'error');
      return;
    }
    const Debrief = require('../services/observe/observe-debrief.service');
    const WhatsAppService = require('../services/whatsapp.service');
    const { observeStrings, observeLang } = require('../services/observe/observe-strings');
    const S = observeStrings(observeLang(coach));
    // As /observe acknowledges its submitted form on this branch: the saved line, then
    // "Debrief now or later?" with its two buttons.
    await WhatsAppService.sendMessage(coach.phone_number, S.submitted_ack);
    if (form.coaching_session_id) {
      await WhatsAppService.sendInteractiveButtons(coach.phone_number, Debrief.buildDebriefChoiceButtons(form.coaching_session_id, S));
    }
    logToFile('[observe2] debrief offered', { formId: form.id, sessionId: form.coaching_session_id });
    const ChildTestOffer = require('../services/child-test/conversation/offer');
    await ChildTestOffer.sendOffer({ coachUserId: form.observer_user_id, kind: 'f', id: form.id });
  } catch (err) {
    logToFile('[observe2] asking about the debrief failed', { formId: form.id, error: err.message }, 'error');
  }
}

// ------------------------------------------------------------------ FICO17 v6 (bd-ra8xu.38)

const { TYPE_CODE } = require('../services/observe/observe2/brief');
const EV_MAX = 5;
const EV_QUOTE = 120;

// The recording's moments for one indicator, as the COMBINED screens show them: up to five, "MM:SS  "quote"",
// leaving out any the coach said did not happen.
function evidenceItems(form, code) {
  const review = (form && form.evidence_review) || {};
  return momentsOf(form)
    .filter((m) => TYPE_CODE[m.type] === code && review[`heard_${m.id}`] !== 'no')
    .slice(0, EV_MAX);
}

function evidenceText(form, code) {
  const ind = V6.indicator(code);
  const items = evidenceItems(form, code);
  const shown = items.length
    ? items.map((m) => `${m.minute}  "${clipCp(String(m.quote || ''), EV_QUOTE)}"`).join('\n')
    : 'The recording showed nothing for this.';
  return `${ind.definition}\n\n${shown}\n\nCoach adds: ${ind.coach_adds}`;
}

// D2: what the coach typed on the live form (counts, not levels), shown above the two count boxes (spec §7.4
// pre-fills them; Meta types a number box's init-value as a number, which a visit with no count cannot give).
function formCounts(form) {
  const a = (form && form.answers) || {};
  const n = (v) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? Number(String(v).trim()) : null);
  const p1 = n(a.p1_spoke);
  const p2new = n(a.p2_new);
  if (p1 == null && p2new == null) return '';
  const parts = [];
  if (p1 != null) parts.push(`${p1} spoke in Part 1`);
  if (p2new != null) parts.push(`${p2new} spoke for the first time in Part 2`);
  const total = p1 != null && p2new != null ? ` (${p1 + p2new} in all)` : '';
  return `On your form: ${parts.join(', ')}${total}.`;
}

function renderCombined(screenId, form, { errors = {} } = {}) {
  const data = { error_messages: errors };
  for (const code of COMBINED_CODES_OF[screenId]) {
    const text = evidenceText(form, code);
    const counts = code === 'D2' ? formCounts(form) : '';
    data[`${code}_ev`] = counts ? `${text}\n\n${counts}` : text;
  }
  return { screen: screenId, data };
}

const wholeNumber = (v) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? Number(String(v).trim()) : null);

/** D2's level from the two counts (spec §7.4). */
function d2Expected(children, quietLater) {
  if (children === 0) return 1;
  if (children <= 2) return 2;
  if (children <= 5) return 3;
  return quietLater >= 2 ? 4 : 3;
}

function validateCombined(screenId, screenData, S) {
  const errors = {};
  for (const code of COMBINED_CODES_OF[screenId]) {
    const level = V6.normLevel(screenData[`cmb_${code}_level`]);
    const allowed = V6.levelOptions(code).map((o) => o.id);
    if (level == null || !allowed.includes(String(level))) errors[`cmb_${code}_level`] = S.v6_choose_level;
    if (!V6.isJustified(screenData[`cmb_${code}_why`])) errors[`cmb_${code}_why`] = S.v6_write_why;
  }
  if (COMBINED_CODES_OF[screenId].includes('D2')) {
    const children = wholeNumber(screenData.d2_children);
    const quiet = wholeNumber(screenData.d2_quiet_later);
    if (children == null || quiet == null || quiet > children) {
      errors.d2_children = S.v6_check_numbers;
    } else if (!errors.cmb_D2_level && !errors.cmb_D2_why) {
      const level = V6.normLevel(screenData.cmb_D2_level);
      if (level !== d2Expected(children, quiet) && !/\d/.test(String(screenData.cmb_D2_why || ''))) errors.cmb_D2_why = S.v6_d2_mismatch;
    }
  }
  return errors;
}

// The coach's v6 record for one combined indicator, as stored (spec §7.7).
function combinedRecord(form, code, screenData, added) {
  return {
    level: V6.normLevel(screenData[`cmb_${code}_level`]),
    because: String(screenData[`cmb_${code}_why`] || '').trim(),
    source: 'coach',
    set_by: 'coach',
    // What today's rules add up to from the coach's form and confirmed moments: kept, never shown. There is no
    // transcript-only scorer for /observe2 yet (spec Phase 1b), so this is not the DC's own level.
    rule_result: added && added[code] ? (added[code].level == null ? null : added[code].level) : null,
    dc_evidence_ids: evidenceItems(form, code).map((m) => m.id),
    ...V6.stamp('coach'),
  };
}

async function onCombined(form, step, screenData) {
  const S = observe2Strings('en');
  const errors = validateCombined(step, screenData, S);
  if (Object.keys(errors).length) return renderCombined(step, form, { errors });
  const review = form.evidence_review || {};
  const added = addedLevels(form, review);
  const patch = {};
  for (const code of COMBINED_CODES_OF[step]) {
    patch[`cmb_${code}_level`] = String(screenData[`cmb_${code}_level`]);
    patch[`cmb_${code}_why`] = String(screenData[`cmb_${code}_why`] || '').trim();
    patch[`v6_${code}`] = combinedRecord(form, code, screenData, added);
  }
  if (COMBINED_CODES_OF[step].includes('D2')) {
    patch.d2_counts = { children: wholeNumber(screenData.d2_children), quiet_later: wholeNumber(screenData.d2_quiet_later) };
  }
  const saved = await Store.saveReview(form, patch);
  const current = saved.ok ? saved.form : form;
  const next = COMBINED_IDS.indexOf(step) + 1;
  if (next < COMBINED_IDS.length) return renderCombined(COMBINED_IDS[next], current);
  return gradedPlan(current) ? renderFidelity(current) : renderAdded6('ADDED_DC_ONE', addedLevels(current, current.evidence_review || {}));
}

function renderAdded6(screenId, added, { errors = {}, chosen = null } = {}) {
  const data = { error_messages: errors };
  for (const code of ADDED6_OF[screenId].codes) {
    const r = (added || {})[code] || {};
    data[`${code}_because`] = r.because || '';
    data[`${code}_level`] = chosen && chosen[code] !== undefined ? chosen[code] : levelText(r.level);
  }
  return { screen: screenId, data };
}

async function onAdded6(form, step, screenData) {
  const S = observe2Strings('en');
  const { codes, why } = ADDED6_OF[step];
  const review = form.evidence_review || {};
  const prefilled = review.added || {};
  const chosen = Object.fromEntries(codes.map((c) => [c, String(screenData[`${c}_final`] == null ? '' : screenData[`${c}_final`])]));
  const changed = codes.filter((c) => (prefilled[c] || '') !== '' && chosen[c] !== String(prefilled[c]));
  const reason = String(screenData[why] || '').trim();
  if (changed.length && !V6.isJustified(reason)) {
    const errors = { [why]: S.v6_why_changed(changed.map((c) => V6.indicator(c).name)) };
    return renderAdded6(step, addedLevels(form, review), { errors, chosen });
  }
  const patch = pickFields(screenData, codes.map((c) => `${c}_final`));
  if (reason) patch[why] = reason;
  for (const code of codes) {
    const was = String(prefilled[code] || '');
    const isChange = was !== '' && chosen[code] !== was;
    patch[`v6_${code}`] = {
      level: V6.normLevel(chosen[code]),
      because: isChange ? reason : '',
      source: isChange || was === '' ? 'coach' : 'rumi',
      set_by: isChange || was === '' ? 'coach' : 'rumi',
      rumi_level: V6.normLevel(was),
      ...V6.stamp('coach'),
    };
  }
  const saved = await Store.saveReview(form, patch);
  const current = saved.ok ? saved.form : form;
  if (step === 'ADDED_DC_ONE') return renderAdded6('ADDED_DC_TWO', addedLevels(current, current.evidence_review || {}));
  return renderPriority(current, screenData);
}

// The v6 record of every level at Submit, from what each screen saved.
function v6Levels(review) {
  const out = {};
  for (const code of V6.CODES) if (review[`v6_${code}`]) out[code] = review[`v6_${code}`];
  return out;
}

// ------------------------------------------------------------------ handlers

async function handleObserve2CheckInit(flowToken) {
  const form = await loadForm(flowToken);
  if (!form) {
    logToFile('[observe2] check opened with a token that matches no sealed record of this coach', {}, 'warn');
  }
  // The entry screen, named here: INIT may only answer with a screen that has no incoming route.
  return { screen: 'HEARD_ASK', data: renderHeard('HEARD_ASK', form).data };
}

async function handleObserve2CheckDataExchange(flowToken, screen, screenData = {}) {
  const step = (screenData && screenData.screen) || screen;
  const form = await loadForm(flowToken);
  const idx = HEARD_IDS.indexOf(step);

  if (!form) {
    // Nothing to save; walk the coach through to the end so the Flow can close.
    if (idx >= 0 && idx < HEARD_IDS.length - 1) return renderHeard(HEARD_IDS[idx + 1], null);
    if (step === 'HEARD_EXPLAIN' || step === 'FIDELITY') return renderAdded('ADDED_ONE', {});
    if (step === 'ADDED_ONE') return renderAdded('ADDED_TWO', {});
    if (step === 'ADDED_TWO') return renderPriority(null, screenData);
    if (step === 'COMBINED_ONE' || step === 'COMBINED_TWO') return renderCombined(COMBINED_IDS[COMBINED_IDS.indexOf(step) + 1], null);
    if (step === 'COMBINED_THREE') return renderAdded6('ADDED_DC_ONE', {});
    if (step === 'ADDED_DC_ONE') return renderAdded6('ADDED_DC_TWO', {});
    if (step === 'ADDED_DC_TWO') return renderPriority(null, screenData);
    return renderDone(null, NOT_AVAILABLE);
  }

  if (idx >= 0) {
    const keys = Array.from({ length: SLOTS }, (_, i) => `${step.toLowerCase()}_${i + 1}`);
    const saved = await Store.saveReview(form, pickFields(screenData, keys));
    const current = saved.ok ? saved.form : form;
    if (idx < HEARD_IDS.length - 1) return renderHeard(HEARD_IDS[idx + 1], current);
    const added = addedLevels(current, current.evidence_review || {});
    const v6 = isV6(current);
    const v6Flow = v6 && String(screenData.v6c || '') !== '';
    if (v6 && !v6Flow) {
      logToFile('[observe2] v6 visit opened on a Flow without the v6 screens; checking on the v5 screens', { formId: current.id }, 'warn');
    }
    await Store.saveReview(current, {
      added: Object.fromEntries(Object.entries(added).map(([c, r]) => [c, levelText(r.level)])),
      added_hole: holesOf(added),
      ...(v6 ? { v6_fallback: !v6Flow } : {}),
    });
    if (v6Flow) return renderCombined('COMBINED_ONE', current);
    return gradedPlan(current) ? renderFidelity(current) : renderAdded('ADDED_ONE', added);
  }

  if (COMBINED_IDS.includes(step)) return onCombined(form, step, screenData);
  if (ADDED6_OF[step]) return onAdded6(form, step, screenData);

  if (step === 'FIDELITY') {
    const lp = gradedPlan(form);
    let current = form;
    if (lp) {
      const keys = [];
      for (let k = 1; k <= FIDELITY_SLOTS; k += 1) keys.push(`fid_r_${k}`, `fid_e_${k}`);
      const edits = {};
      for (const k of keys) if (typeof screenData[k] === 'string') edits[k] = screenData[k];
      const fidelity = confirmedPlan(lp, edits);
      const saved = await Store.saveReview(form, { ...pickFields(screenData, keys), fidelity });
      if (saved.ok) current = saved.form;
      logToFile('[observe2] plan steps checked', { formId: form.id, pct: fidelity.fidelity_pct, changed: fidelity.verdicts_changed });
    }
    const review = current.evidence_review || {};
    if (isV6(current) && review.v6_fallback === false) return renderAdded6('ADDED_DC_ONE', addedLevels(current, review));
    return renderAdded('ADDED_ONE', addedLevels(current, review));
  }

  if (step === 'ADDED_ONE' || step === 'ADDED_TWO') {
    const keys = ADDED_CODES[step].map((c) => `${c}_final`);
    const saved = await Store.saveReview(form, pickFields(screenData, keys));
    const current = saved.ok ? saved.form : form;
    if (step === 'ADDED_ONE') return renderAdded('ADDED_TWO', addedLevels(current, current.evidence_review || {}));
    return renderPriority(current, screenData);
  }

  if (step === 'PRIORITY') {
    if (form.checked_at) {
      // A repeat Submit: if the first one saved the answers but could not hand the visit over, try again.
      if (!(await handedOver(form))) {
        const again = await handOver(form);
        if (again.ok) {
          setImmediate(() => { askDebrief(form, again.coach); });
          return renderDone(form);
        }
        return renderDone(form, NOT_HANDED);
      }
      return renderDone(form);
    }
    const review = form.evidence_review || {};
    const added = review.added || {};
    const finalLevels = {};
    for (const code of CODES) finalLevels[code] = review[`${code}_final`] || added[code] || '';
    const patch = pickFields(screenData, ['priority_final', 'why']);
    if (isV6(form) && review.v6_fallback === false) {
      // The six room levels are the coach's (COMBINED); the record says who set each of the 17 and why.
      for (const code of V6.COMBINED_CODES) if (review[`cmb_${code}_level`]) finalLevels[code] = review[`cmb_${code}_level`];
      patch.v6_levels = v6Levels(review);
    }
    // "Also work on": as submitted on a check that has it; on the first check, the picks sealed in the form.
    // A sealed pick the check's lists could not show (a newer choice on an older check) is kept, first:
    // the coach never saw it there to drop it. Never the first pick again, never twice (fico17.pickAlso).
    const a = form.answers || {};
    const first = patch.priority_final || a.priority || '';
    const version = checkVersion(screenData);
    const chosen = version >= 2 ? [screenData.also_final_1, screenData.also_final_2] : [a.also_1, a.also_2];
    patch.also_final = pickAlso([...unshown(a, listedOn(version)), ...chosen], first);
    const checked = await Store.markChecked(form, finalLevels, patch);
    if (!checked.ok) {
      if (checked.alreadyChecked) {
        const again = await Store.getForm(form.id);
        return renderDone((again.ok && again.form) || form);
      }
      return renderDone(form, { done_line: 'Not saved', next_line: 'Something went wrong. Close this and open the check again from the chat.' });
    }
    logToFile('[observe2] record checked', { formId: form.id });
    let handed = { ok: false };
    try {
      handed = await handOver(checked.form);
    } catch (err) {
      logToFile('[observe2] the hand-off to the debrief threw', { formId: form.id, error: err.message }, 'error');
    }
    if (!handed.ok) return renderDone(checked.form, { ...NOT_HANDED, done_line: `Saved at ${clock(checked.form.checked_at)}` });
    setImmediate(() => { askDebrief(checked.form, handed.coach); });
    return renderDone(checked.form);
  }

  logToFile('[observe2] unknown screen in the check', { screen: step }, 'warn');
  return renderHeard('HEARD_ASK', form);
}

module.exports = {
  parseToken,
  handleObserve2CheckInit,
  handleObserve2CheckDataExchange,
  d2Expected,
};
