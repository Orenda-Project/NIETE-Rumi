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
 *   ADDED_TWO → PRIORITY   the pick sealed before any moment was seen.
 *   PRIORITY → DONE      the record is checked once; the brief follows in the chat.
 */

const supabase = require('../config/supabase');
const Store = require('../services/observe/observe2/field-form.store');
const { addUp } = require('../services/observe/observe2/rules');
const { CODES } = require('../services/observe/observe2/fico17');
const { SLOTS, FIDELITY_SLOTS, HEARD_SCREENS, ADDED_SCREENS } = require('../services/observe/observe2/evidence-check.flow');
const { logToFile } = require('../utils/logger');

const HEARD_IDS = HEARD_SCREENS.map((h) => h.id);
const MOMENT_OF = Object.fromEntries(HEARD_SCREENS.map((h) => [h.id, h.moment]));
const ADDED_CODES = Object.fromEntries(ADDED_SCREENS.map((a) => [a.id, a.codes]));

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

function renderHeard(screenId, form) {
  const moment = MOMENT_OF[screenId];
  const list = momentsOf(form).filter((m) => m.moment === moment);
  const data = {};
  for (let i = 1; i <= SLOTS; i += 1) {
    const k = `${screenId.toLowerCase()}_${i}`;
    const m = list[i - 1];
    data[`${k}_t`] = m ? [...`${m.minute} · ${m.label || m.type}`].slice(0, 30).join('') : '';
    data[`${k}_d`] = m ? `"${m.quote}"` : '';
    data[`${k}_v`] = Boolean(m);
  }
  return { screen: screenId, data };
}

const levelText = (lv) => (lv == null ? '' : String(lv));

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
    next_line: 'Your brief for the conversation with the teacher is in the chat.',
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

async function sendBrief(form) {
  try {
    const { buildBrief } = require('../services/observe/observe2/brief');
    const WhatsAppService = require('../services/whatsapp.service');
    const { data: coach } = await supabase.from('users')
      .select('phone_number, preferred_language').eq('id', form.observer_user_id).maybeSingle();
    if (!coach || !coach.phone_number) {
      logToFile('[observe2] checked, but the coach could not be found for the brief', { formId: form.id }, 'error');
      return;
    }
    let teacherName = null;
    if (form.teacher_user_id) {
      const { data: t } = await supabase.from('users').select('name').eq('id', form.teacher_user_id).maybeSingle();
      teacherName = (t && t.name) || null;
    }
    await WhatsAppService.sendMessage(coach.phone_number, buildBrief(form, { teacherName, lang: coach.preferred_language }));
    logToFile('[observe2] brief sent', { formId: form.id });
    // The child test (bd-s1oo0.4): "Test 5 children now?", carrying this visit so the school and
    // the observed class are pre-filled. Gated inside sendOffer (flag + coach role + ICT); never throws.
    const ChildTestOffer = require('../services/child-test/conversation/offer');
    await ChildTestOffer.sendOffer({ coachUserId: form.observer_user_id, kind: 'f', id: form.id });
  } catch (err) {
    logToFile('[observe2] the brief failed', { formId: form.id, error: err.message }, 'error');
  }
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
    if (step === 'ADDED_TWO') return { screen: 'PRIORITY', data: { priority_level: '' } };
    return renderDone(null, NOT_AVAILABLE);
  }

  if (idx >= 0) {
    const keys = Array.from({ length: SLOTS }, (_, i) => `${step.toLowerCase()}_${i + 1}`);
    const saved = await Store.saveReview(form, pickFields(screenData, keys));
    const current = saved.ok ? saved.form : form;
    if (idx < HEARD_IDS.length - 1) return renderHeard(HEARD_IDS[idx + 1], current);
    const added = addedLevels(current, current.evidence_review || {});
    await Store.saveReview(current, {
      added: Object.fromEntries(Object.entries(added).map(([c, r]) => [c, levelText(r.level)])),
      added_hole: holesOf(added),
    });
    return gradedPlan(current) ? renderFidelity(current) : renderAdded('ADDED_ONE', added);
  }

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
    return renderAdded('ADDED_ONE', addedLevels(current, current.evidence_review || {}));
  }

  if (step === 'ADDED_ONE' || step === 'ADDED_TWO') {
    const keys = ADDED_CODES[step].map((c) => `${c}_final`);
    const saved = await Store.saveReview(form, pickFields(screenData, keys));
    const current = saved.ok ? saved.form : form;
    if (step === 'ADDED_ONE') return renderAdded('ADDED_TWO', addedLevels(current, current.evidence_review || {}));
    return { screen: 'PRIORITY', data: { priority_level: String((current.answers || {}).priority || '') } };
  }

  if (step === 'PRIORITY') {
    if (form.checked_at) return renderDone(form);
    const review = form.evidence_review || {};
    const added = review.added || {};
    const finalLevels = {};
    for (const code of CODES) finalLevels[code] = review[`${code}_final`] || added[code] || '';
    const patch = pickFields(screenData, ['priority_final', 'why']);
    const checked = await Store.markChecked(form, finalLevels, patch);
    if (!checked.ok) {
      if (checked.alreadyChecked) {
        const again = await Store.getForm(form.id);
        return renderDone((again.ok && again.form) || form);
      }
      return renderDone(form, { done_line: 'Not saved', next_line: 'Something went wrong. Close this and open the check again from the chat.' });
    }
    logToFile('[observe2] record checked', { formId: form.id });
    if (form.coaching_session_id) {
      const Moments = require('../services/observe/observe2/moments');
      await Moments.setStatus(form.coaching_session_id, 'observe2_checked');
    }
    setImmediate(() => { sendBrief(checked.form); });
    return renderDone(checked.form);
  }

  logToFile('[observe2] unknown screen in the check', { screen: step }, 'warn');
  return renderHeard('HEARD_ASK', form);
}

module.exports = {
  parseToken,
  handleObserve2CheckInit,
  handleObserve2CheckDataExchange,
};
