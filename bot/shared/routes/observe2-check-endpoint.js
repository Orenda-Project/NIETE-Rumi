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
 *                   COMBINED_THREE_COUNTS stands in for COMBINED_THREE when the form has both child counts and
 *                   the Flow has it (v6c 3): the count boxes start from the form (spec §7.4); the level stays blank.
 *   COMBINED_THREE → FIDELITY (a graded plan) or ADDED_DC_ONE → ADDED_DC_TWO → PRIORITY   Rumi's other 11 levels,
 *                   pre-filled; a changed level needs a reason. A v6 visit opened on a Flow without the v6 screens
 *                   (no `v6c` from HEARD_EXPLAIN) runs on the v5 screens and is marked v6_fallback.
 *   PRIORITY        final_levels as for v5 (one string per code), plus evidence_review.v6_levels: who set each
 *                   level (coach | rumi), why, and on which rubric.
 */

const supabase = require('../config/supabase');
const Store = require('../services/observe/observe2/field-form.store');
const Rules = require('../services/observe/observe2/rules');

const { addUp } = Rules;
const { CODES, PLAN_FOCUS, FOCUS, FOCUS_ORDER, ALSO_NONE, pickAlso } = require('../services/observe/observe2/fico17');
const {
  SLOTS, FIDELITY_SLOTS, HEARD_SCREENS, ADDED_SCREENS, COMBINED_SCREENS, COMBINED_COUNTS, D2_COUNT_INIT, ADDED6_SCREENS, MISSED_SLOTS,
  MISSED_WORDS_MAX, OVERRIDE_REASONS,
} = require('../services/observe/observe2/evidence-check.flow');
const { isV6 } = require('../services/observe/observe2/rubric');
const MomentTypes = require('../services/observe/observe2/moment-types');
const V6 = require('../services/coaching/frameworks/fico17-v6');
const { observe2Strings } = require('../services/observe/observe2/strings');
const { notesSection } = require('../services/observe/observe2/brief');
const { logToFile } = require('../utils/logger');

const HEARD_IDS = HEARD_SCREENS.map((h) => h.id);
const MOMENT_OF = Object.fromEntries(HEARD_SCREENS.map((h) => [h.id, h.moment]));
const ADDED_CODES = Object.fromEntries(ADDED_SCREENS.map((a) => [a.id, a.codes]));
const COMBINED_IDS = COMBINED_SCREENS.map((c) => c.id);
const COMBINED_CODES_OF = Object.fromEntries(COMBINED_SCREENS.map((c) => [c.id, c.codes]));
// COMBINED_THREE_COUNTS is COMBINED_THREE with D2's counts pre-filled: same codes, same place in the walk.
const combinedBase = (id) => (id === COMBINED_COUNTS.id ? COMBINED_COUNTS.of : id);
COMBINED_CODES_OF[COMBINED_COUNTS.id] = COMBINED_CODES_OF[COMBINED_COUNTS.of];
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
  // bd-ra8xu.43: the first screen's caption — the rubric this visit was stamped with, never the live switch.
  if (screenId === 'HEARD_ASK') data.scored_with = require('../services/coaching/rubric-label').rubricLabelText({ form });
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

// A v6 visit on a Flow without the v6 screens (v6_fallback): the six room levels are the coach's to set, so their rows
// start blank and give no reason; what the rules add up to for them is the hidden transcript-only result (CONTRACTS
// §11.4). A v5 visit shows every row as before.
function renderAdded(screenId, added, form = null) {
  const data = {};
  for (const code of ADDED_CODES[screenId]) {
    const r = (isV6(form) && V6.isCombined(code) ? null : (added || {})[code]) || {};
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

// The levels the sealed answers and the confirmed moments add up to, with the reason for each. On a v6 visit the
// moments the coach added (MISSED) count with the confirmed ones, and the rules run on the v6 rubric with the
// transcript's quality (rules-v6; an older rules.js ignores both). A v5 visit calls addUp exactly as before.
function addedLevels(form, review) {
  const v6 = isV6(form);
  const confirmed = [
    ...momentsOf(form).filter((m) => review[`heard_${m.id}`] === 'yes'),
    ...(v6 && Array.isArray(review.missed) ? review.missed : []),
  ];
  const counts = (form.rumi_moments && form.rumi_moments.counts) || {};
  const all = addUp({
    form: form.answers || {}, confirmed, heardCounts: counts,
    ...(v6 ? { rubric: V6.RUBRIC_KEY, transcriptQuality: (form.rumi_moments && form.rumi_moments.transcript_quality) || null } : {}),
  });
  const out = {};
  for (const [code, r] of Object.entries(all)) {
    out[code] = { level: r.level == null ? null : r.level, because: r.because || '', hole: Boolean(r.hole) };
    if (v6) out[code].dc_result = dcResultOf(r);
  }
  return out;
}

// A combined row's transcript-only result (CONTRACTS §5): rules-v6's dc_result; before it, the level the rules
// give the row, so the record is never empty.
const dcResultOf = (r) => {
  const v = r.dc_result !== undefined ? r.dc_result : r.level;
  return v == null ? null : v;
};

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

// "Saved. Debrief now or later?", as after /observe's form, then the child test offer
// (bd-s1oo0.4: gated inside sendOffer; never throws).
async function askDebrief(form, coach) {
  try {
    if (!coach || !coach.phone_number) {
      logToFile('[observe2] checked, but the coach could not be found to ask about the debrief', { formId: form.id }, 'error');
      return;
    }
    const Debrief = require('../services/observe/observe-debrief.service');
    const { observeStrings, observeLang } = require('../services/observe/observe-strings');
    await Debrief.acknowledgeFormSubmitted(coach.phone_number, form.coaching_session_id, observeStrings(observeLang(coach)));
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

// What the recording gave for one indicator, as the COMBINED screens show it (spec §7.2): the room evidence the
// moments job found for it (rumi_moments.room_evidence, CONTRACTS §4.3) and the moments that count for it (D4: the
// unsure answers), leaving out any the coach said did not happen; up to five, "MM:SS  "quote"". None when the
// recording could not show the indicator (the transcript gate's `broken`, a failed recording, or a transcript-only
// result of IE) or, for D3, found no child-to-child talk (NA): the screen says which instead.
function unusable(form) {
  const q = form && form.rumi_moments && form.rumi_moments.transcript_quality;
  return Boolean((q && q.status === 'broken') || (form && form.answers && form.answers.incident === 'tech'));
}

function shownEvidence(form, code, added) {
  const dc = ((added || {})[code] || {}).dc_result;
  if (dc === 'IE' || unusable(form)) return { items: [], line: 'v6_ev_ie' };
  if (dc === 'NA' && code === 'D3') return { items: [], line: 'v6_ev_na_d3' };
  const review = (form && form.evidence_review) || {};
  const room = (((form && form.rumi_moments) || {}).room_evidence || {})[code];
  const items = [
    ...(Array.isArray(room) ? room : []),
    ...momentsOf(form).filter((m) => TYPE_CODE[m.type] === code && review[`heard_${m.id}`] !== 'no'),
  ].slice(0, EV_MAX);
  return { items, line: items.length ? null : 'v6_ev_none' };
}

// D2: the Student lines the recording has in each half of the lesson (rumi_moments.d2_turns, spec §5.6, counted in
// code by the moments job; CONTRACTS §11.2), or null: none counted, or a recording that could not be used.
function d2Turns(form) {
  const t = form && form.rumi_moments && form.rumi_moments.d2_turns;
  const whole = (v) => Number.isInteger(v) && v >= 0;
  return t && whole(t.first_half) && whole(t.second_half) && !unusable(form) ? t : null;
}

function evidenceText(form, code, added) {
  const S = observe2Strings('en');
  const ind = V6.indicator(code);
  const { items, line } = shownEvidence(form, code, added);
  // D2 opens with the turns per half when the recording counted them; they are what it showed, so no "nothing" line.
  const turns = code === 'D2' ? d2Turns(form) : null;
  const shown = line ? (turns && line === 'v6_ev_none' ? '' : S[line]) : items.map((m) => `${m.minute}  "${clipCp(String(m.quote || ''), EV_QUOTE)}"`).join('\n');
  return [turns ? S.v6_d2_turns(turns.first_half, turns.second_half) : '', ind.definition, shown, S.v6_coach_adds(ind.coach_adds)]
    .filter(Boolean).join('\n\n');
}

const wholeNumber = (v) => (/^\d+$/.test(String(v == null ? '' : v).trim()) ? Number(String(v).trim()) : null);

// D2: what the coach typed on the live form (counts, not levels), shown above the two count boxes (spec §7.4
// pre-fills them on COMBINED_THREE_COUNTS; a visit without both counts gets the blank boxes and this line).
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

// D2's counts as typed on the live form, as numbers for the pre-filled boxes (spec §7.4): the children who spoke
// (p1_spoke + p2_new) and those who spoke first in Part 2 (p2_new). Null unless both are whole numbers.
function formCountsInit(form) {
  const a = (form && form.answers) || {};
  const p1 = wholeNumber(a.p1_spoke);
  const p2new = wholeNumber(a.p2_new);
  return p1 == null || p2new == null ? null : { d2_children: p1 + p2new, d2_quiet_later: p2new };
}

// The screen after COMBINED_TWO: the pre-filled copy when the form has both counts and the Flow has that screen
// (v6_check 3+, posted from HEARD_EXPLAIN); else COMBINED_THREE with blank boxes, as a '2' Flow knows it.
function renderThird(form) {
  const v6Check = Number(((form && form.evidence_review) || {}).v6_check || 0);
  const counts = v6Check >= 3 ? formCountsInit(form) : null;
  return counts ? renderCombined(COMBINED_COUNTS.id, form, { counts }) : renderCombined(COMBINED_COUNTS.of, form);
}

function renderCombined(screenId, form, { errors = {}, counts = null } = {}) {
  const data = { error_messages: errors };
  if (screenId === COMBINED_COUNTS.id) {
    const init = counts || formCountsInit(form) || {};
    for (const [field, key] of Object.entries(D2_COUNT_INIT)) data[key] = init[field] == null ? 0 : init[field];
  }
  const added = form ? addedLevels(form, form.evidence_review || {}) : {};
  for (const code of COMBINED_CODES_OF[screenId]) {
    const text = evidenceText(form, code, added);
    const counts = code === 'D2' ? formCounts(form) : '';
    data[`${code}_ev`] = counts ? `${text}\n\n${counts}` : text;
  }
  return { screen: screenId, data };
}


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
    // The transcript-only result (spec §8.4, kept, never shown): rules-v6's dc_result; until it lands, what the
    // rules add up to for the row (addedLevels). D2 has none (its counts are stored instead).
    dc_result: code === 'D2' || !(added && added[code]) ? null : added[code].dc_result,
    dc_evidence_ids: [...shownEvidence(form, code, added).items.map((m) => m.id), ...(code === 'D2' && d2Turns(form) ? ['d2_turns'] : [])],
    ...V6.stamp('coach'),
  };
}

async function onCombined(form, step, screenData) {
  const S = observe2Strings('en');
  const errors = validateCombined(step, screenData, S);
  if (Object.keys(errors).length) {
    // Back to the pre-filled screen with the coach's own numbers, not the form's.
    const typed = { d2_children: wholeNumber(screenData.d2_children), d2_quiet_later: wholeNumber(screenData.d2_quiet_later) };
    const counts = typed.d2_children != null && typed.d2_quiet_later != null ? typed : null;
    return renderCombined(step, form, { errors, counts });
  }
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
  const next = COMBINED_IDS.indexOf(combinedBase(step)) + 1;
  if (COMBINED_IDS[next] === COMBINED_COUNTS.of) return renderThird(current);
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

// The longest period a visit can have (field-form.store: 20-90 minutes), for a minute when the period is unknown.
const PERIOD_MAX = 90;

// Why the coach changed Rumi's levels on one screen (spec §9.1): on a check with the reasons list (v6_check 2+), a
// reason from it and, if given, a whole minute inside the period; on every check, the note of 20+ characters.
function overrideErrors(form, step, screenData, changed, S) {
  const { why, kind, min } = ADDED6_OF[step];
  const errors = {};
  if (!changed.length) return errors;
  if (listsReasons(form)) {
    if (!OVERRIDE_REASONS.includes(String(screenData[kind] || ''))) errors[kind] = S.v6_pick_reason;
    const raw = String(screenData[min] == null ? '' : screenData[min]).trim();
    const period = wholeNumber((form && form.period_minutes)) || PERIOD_MAX;
    const minute = wholeNumber(raw);
    if (raw !== '' && (minute == null || minute > period)) errors[min] = S.v6_minute_range(period);
  }
  if (!V6.isJustified(screenData[why])) errors[why] = S.v6_why_changed(changed.map((c) => V6.indicator(c).name));
  return errors;
}
const listsReasons = (form) => Number(((form && form.evidence_review) || {}).v6_check || 0) >= 2;

async function onAdded6(form, step, screenData) {
  const S = observe2Strings('en');
  const { codes, why, kind, min } = ADDED6_OF[step];
  const review = form.evidence_review || {};
  const prefilled = review.added || {};
  const chosen = Object.fromEntries(codes.map((c) => [c, String(screenData[`${c}_final`] == null ? '' : screenData[`${c}_final`])]));
  const changed = codes.filter((c) => (prefilled[c] || '') !== '' && chosen[c] !== String(prefilled[c]));
  const reason = String(screenData[why] || '').trim();
  const errors = overrideErrors(form, step, screenData, changed, S);
  if (Object.keys(errors).length) return renderAdded6(step, addedLevels(form, review), { errors, chosen });
  const listed = listsReasons(form);
  const at = new Date().toISOString();
  const patch = pickFields(screenData, [...codes.map((c) => `${c}_final`), kind, min]);
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
      // The change, with Rumi's level kept as `from` (spec §9.1, §13). A check without the reasons list could not ask.
      ...(isChange ? {
        override: {
          from: V6.normLevel(was),
          to: V6.normLevel(chosen[code]),
          reason: listed ? String(screenData[kind]) : null,
          minute: listed ? wholeNumber(screenData[min]) : null,
          by: 'coach',
          at,
        },
      } : {}),
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

// The N/A links (spec §8.4, Q7): when C1 is 1 (no real questions), C3 and D4 are NA, unless the coach set them,
// when the coach's level stands and the row says so (na_link_conflict). Pure; rows not touched are returned as
// they were. rules-v6 owns the rule (CONTRACTS §5): its export is used once it exists, this copy until then.
const NA_LINKED = ['C3', 'D4'];
function localApplyNaLinks(levels, coachSet = new Set()) {
  const out = { ...levels };
  if (V6.normLevel(((levels || {}).C1 || {}).level) !== 1) return out;
  for (const code of NA_LINKED) {
    const r = out[code] || {};
    out[code] = coachSet.has(code)
      ? { ...r, na_link_conflict: true }
      : { ...r, level: 'NA', because: 'no questions, so nobody could be chosen or try', source: 'pipeline' };
  }
  return out;
}
const applyNaLinks = (levels, coachSet) => (typeof Rules.applyNaLinks === 'function' ? Rules.applyNaLinks : localApplyNaLinks)(levels, coachSet);

// Submit on a v6 visit: the v6 record of the 17, with the N/A links applied once to the final levels.
function linkedV6(review, finalLevels) {
  const record = v6Levels(review);
  const coachSet = new Set(V6.COMBINED_CODES.filter((c) => review[`cmb_${c}_level`]));
  const rows = Object.fromEntries(V6.CODES.map((c) => [c, { level: V6.normLevel(finalLevels[c]) }]));
  const linked = applyNaLinks(rows, coachSet);
  for (const code of NA_LINKED) {
    const r = linked[code] || {};
    if (r.na_link_conflict) record[code] = { ...(record[code] || {}), na_link_conflict: true };
    else if (r.level !== rows[code].level) {
      finalLevels[code] = String(r.level);
      record[code] = { ...(record[code] || {}), level: r.level, because: r.because };
    }
  }
  return record;
}

// ------------------------------------------------------------------ MISSED (FICO6, spec §9.2)

// The types a coach can add, as "What happened" lists them: v6's when moments-v6 has them, else today's.
function missedTypes() {
  const types = MomentTypes.TYPES_V6 || MomentTypes.TYPES;
  return Object.values(types).flatMap((g) => Object.entries(g).map(([id, title]) => ({ id, title: clipCp(String(title), 30) })));
}

function renderMissed() {
  return { screen: 'MISSED', data: { missed_types: missedTypes() } };
}

/** The slots that count (a known type and words), as moments the coach confirmed (CONTRACTS §6.3). */
function missedOf(screenData) {
  const known = new Set(missedTypes().map((t) => t.id));
  const out = [];
  for (let i = 1; i <= MISSED_SLOTS; i += 1) {
    const type = String(screenData[`missed_${i}_type`] || '').trim();
    const quote = [...String(screenData[`missed_${i}_words`] || '').trim()].slice(0, MISSED_WORDS_MAX).join('');
    if (!known.has(type) || !quote) continue;
    out.push({ id: `missed_${i}`, type, minute: wholeNumber(screenData[`missed_${i}_min`]), quote, source: 'coach', confirmed: true });
  }
  return out;
}

async function onMissed(form, screenData) {
  const missed = missedOf(screenData);
  const saved = await Store.saveReview(form, { missed });
  const current = saved.ok ? saved.form : form;
  // Rumi's pre-filled levels now count the added moments too.
  const added = addedLevels(current, current.evidence_review || {});
  const again = await Store.saveReview(current, {
    added: Object.fromEntries(Object.entries(added).map(([c, r]) => [c, levelText(r.level)])),
    added_hole: holesOf(added),
  });
  logToFile('[observe2] coach-added moments saved', { formId: form.id, count: missed.length });
  return renderCombined('COMBINED_ONE', again.ok ? again.form : current);
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
    if (step === 'MISSED') return renderCombined('COMBINED_ONE', null);
    if (step === 'COMBINED_ONE' || step === 'COMBINED_TWO') return renderCombined(COMBINED_IDS[COMBINED_IDS.indexOf(step) + 1], null);
    if (combinedBase(step) === 'COMBINED_THREE') return renderAdded6('ADDED_DC_ONE', {});
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
    const v6Check = v6Flow ? Number(screenData.v6c) || 1 : 0;
    if (v6 && !v6Flow) {
      logToFile('[observe2] v6 visit opened on a Flow without the v6 screens; checking on the v5 screens', { formId: current.id }, 'warn');
    }
    await Store.saveReview(current, {
      added: Object.fromEntries(Object.entries(added).map(([c, r]) => [c, levelText(r.level)])),
      added_hole: holesOf(added),
      ...(v6 ? { v6_fallback: !v6Flow } : {}),
      ...(v6Flow ? { v6_check: v6Check } : {}),
    });
    if (v6Flow) return v6Check >= 2 ? renderMissed() : renderCombined('COMBINED_ONE', current);
    return gradedPlan(current) ? renderFidelity(current) : renderAdded('ADDED_ONE', added, current);
  }

  if (step === 'MISSED') return isV6(form) ? onMissed(form, screenData) : renderAdded('ADDED_ONE', addedLevels(form, form.evidence_review || {}));
  if (COMBINED_IDS.includes(combinedBase(step))) return onCombined(form, step, screenData);
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
    return renderAdded('ADDED_ONE', addedLevels(current, review), current);
  }

  if (step === 'ADDED_ONE' || step === 'ADDED_TWO') {
    const keys = ADDED_CODES[step].map((c) => `${c}_final`);
    const saved = await Store.saveReview(form, pickFields(screenData, keys));
    const current = saved.ok ? saved.form : form;
    if (step === 'ADDED_ONE') return renderAdded('ADDED_TWO', addedLevels(current, current.evidence_review || {}), current);
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
      patch.v6_levels = linkedV6(review, finalLevels);
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
  // For tests: the screens' evidence text and the N/A links rule, as the endpoint uses them.
  _evidenceText: evidenceText,
  _applyNaLinks: applyNaLinks,
};
