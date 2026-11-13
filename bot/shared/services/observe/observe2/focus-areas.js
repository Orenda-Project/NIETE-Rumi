'use strict';

/**
 * /observe2 — what the brief and the record say about a coaching focus area picked as "Work on first" or
 * "Also work on" (FICO pilot sheet R20 and R21, two coaches, 16 Oct): wait time, classroom management,
 * classroom rules, the warm-up, the closure (fico17.js COACHING_FOCUS).
 *
 * They are not scored, so "what was seen" is read off the sealed answers and the checked levels that speak
 * to each, never a level of its own:
 *   wait     C1's and D1's checked levels (C1 level 1 is "without pausing for student responses")
 *   manage   C5's checked level, or that the class did not switch; and that only some children had a task
 *   rules    C5's checked level (C5 level 4: "states or signals the expectation before it's needed")
 *   warmup   the plan's warm-up, hook and recall steps, as the check left them
 *   close    the plan's exit steps, as the check left them
 * Empty when the form holds nothing for it: the brief then points to the coach's own notes.
 *
 * The indicator phrases are English for the pilot, as everywhere in the brief; the words around them are
 * the coach's (strings.js), and in Urdu each English phrase or plan step is a first-strong isolate.
 * Nothing here calls a model or writes anything.
 *
 * A FICO17 v6 visit (spec §9.3) reads its levels through levelOf: NA and IE are never a level, and when the
 * transcript was broken only the six levels the coach set in the room stand. Its rows are named by their v6
 * names. "Work on first" never lands on a row with no level (workOnPicks). A v5 visit reads exactly as before.
 */

const { CODES, ROW, isCoachingFocus } = require('./fico17');
const { TASK } = require('./rules');
const { isV6, plainOf } = require('./rubric');
const V6 = require('../../coaching/frameworks/fico17-v6');

const numeric = (v) => (/^[1-4]$/.test(String(v)) ? Number(v) : null);
const STEP_CAP = 100;
const MAX_STEPS = 2;
const clip = (text, n) => { const c = [...String(text)]; return c.length <= n ? c.join('') : `${c.slice(0, n - 1).join('')}…`; };

// The grader's verdicts, as the check's plan screen offers them, in the brief's words.
const VERDICT = {
  executed: 'done', substituted_equivalent: 'done', substituted_better: 'done',
  partial: 'partial', not_done: 'not_done', not_adjudicable: 'not_adjudicable',
};
// The plan's phases each lesson-structure area reads (the grader's names: lp-upload-extractor PHASES).
const PHASES = { warmup: ['warm_up', 'hook', 'recall'], close: ['exit'] };
// The confirmed moments worth bringing up for an area, by the four moments (fico17 MOMENTS).
const FOCUS_MOMENT = { wait: 'ask' };

/** v6: the recording could not be used (the quality gate's status, kept on the moments). */
function transcriptBroken(form) {
  return isV6(form) && ((form.rumi_moments || {}).transcript_quality || {}).status === 'broken';
}

/** The checked level of one row, 1-4, or null: NA, IE, blank, or (v6, broken transcript) a level not the coach's. */
function levelOf(form, code) {
  const lv = numeric((form.final_levels || {})[code]);
  return lv && transcriptBroken(form) && !V6.isCombined(code) ? null : lv;
}

/** A row's name as the coach and the teacher read it: the v6 name on a v6 visit. */
function rowOf(form, code) {
  return isV6(form) ? V6.indicator(code).name : ROW[code];
}

/**
 * "Work on first" and "also work on" as the brief tells them. v6: a row with no level (NA, IE, or a level the
 * broken recording gave) is never a pick; when the first pick is one, the next pick that has a level takes its
 * place. v5: as picked.
 */
function workOnPicks(form, priority, also) {
  if (!isV6(form)) return { priority, also };
  const ok = (id) => !CODES.includes(id) || levelOf(form, id) != null;
  if (!priority || ok(priority)) return { priority, also: also.filter(ok) };
  const kept = also.filter(ok);
  return { priority: kept[0] || null, also: kept.slice(1) };
}

function levelPhrase(form, code, S) {
  const lv = levelOf(form, code);
  return lv ? S.focus_atom(`${rowOf(form, code).toLowerCase()}: ${plainOf(form)[code][lv - 1].toLowerCase()}`) : '';
}

// The plan's steps of the given phases, each with the verdict the check left it with: the coach's, where
// the coach confirmed the plan at the check, else the recording's grading.
function planSteps(form, phases, S) {
  const graded = form.rumi_moments && form.rumi_moments.fidelity;
  if (!graded || graded.status !== 'ok' || !Array.isArray(graded.moves)) return [];
  const confirmed = new Map((((form.evidence_review || {}).fidelity || {}).moves || []).map((m) => [m.move_id, m]));
  return graded.moves
    .filter((m) => m && phases.includes(m.phase) && String(m.text || '').trim())
    .slice(0, MAX_STEPS)
    .map((m) => {
      const verdict = VERDICT[(confirmed.get(m.move_id) || m).verdict];
      const text = S.focus_atom(clip(String(m.text).trim(), STEP_CAP));
      return verdict ? S.focus_step(text, S.focus_verdict[verdict]) : text;
    });
}

const SEEN = {
  wait: (form, S) => [levelPhrase(form, 'C1', S), levelPhrase(form, 'D1', S)],
  manage: (form, S) => [
    String((form.final_levels || {}).C5 || '') === 'NA' ? S.focus_no_switch : levelPhrase(form, 'C5', S),
    (form.answers || {}).p2_task === 'some' ? S.focus_atom(TASK.some) : '',
  ],
  rules: (form, S) => [levelPhrase(form, 'C5', S)],
  warmup: (form, S) => planSteps(form, PHASES.warmup, S),
  close: (form, S) => planSteps(form, PHASES.close, S),
};

/**
 * @param {object} form observation_field_forms row after the check
 * @param {string} id a coaching focus area (fico17 COACHING_FOCUS)
 * @param {object} S observe2Strings(lang)
 * @returns {string} what the form shows for it, or '' when it holds nothing
 */
function focusSeen(form, id, S) {
  if (!isCoachingFocus(id)) return '';
  return SEEN[id](form || {}, S).filter(Boolean).join(S.focus_sep);
}

/** The next step for a coaching focus area, in the coach's language. */
function focusNext(id, S) {
  return isCoachingFocus(id) ? S.focus_next[id] : '';
}

module.exports = { focusSeen, focusNext, FOCUS_MOMENT, levelOf, rowOf, workOnPicks, transcriptBroken };
