'use strict';
/**
 * Round 20 (switch sa_r20_level, default OFF; read in app/level-switch.js): the child's level in each subject, for
 * the coach's Results page and the results dashboard. Pure: block rows and session events in, one line per subject out.
 *
 *   levelsOf(rows, events, { itemsOf, titleOf })  → [{ subject, reached, level, pending, stop }]
 *
 * subject   ur | en | ma: a task id's prefix. A subject gets a line only when the child's rows hold at least one of
 *           its ladder parts below (the RDF auto / manual parts); any other block gets none.
 * reached   { taskId, title }: the last part of that subject the child actually did (not skipped, not "no microphone");
 *           from the phone's results, so it is known at once, before any score. null when every part was skipped.
 * level     the highest rung whose cut-off is met, walking up in order and stopping at the first that is not;
 *           'beginner' when the first rung is not met; null when the first rung is still waiting for its score.
 * pending   the walk stopped on a rung whose spoken part is not scored yet: the level may still rise.
 * stop      'coach' (End this section: end_section / skipped_end_section), 'no_answer' (a silence stop: an
 *           incomplete_move_on with reason 'silence', a part ended by early_stop_silence, or a part marked silent),
 *           else null. The coach's end wins when both happened.
 *
 * The level words and every cut-off below are the ones sent to the content owner for review (a first cut from the
 * real RDF auto tests, to adjust as more data comes in; the same for every grade).
 * Shares are of the part's items (so a changed item count keeps the meaning); the story floor is a count of words.
 */

const SUBJECTS = ['ur', 'en', 'ma'];
const BEGINNER = 'beginner';

// The story rung's floor: correct words read in the minute.
const STORY_FLOOR_WORDS = 20;

// Cut-offs, as shares of the part's items.
const LETTERS_SHARE = 0.8; // 4 of 5 letters (names or sounds)
const WORDS_SHARE = 0.75; // 3 of 4 words
const COMPREHENSION_SHARE = 0.5; // half the story questions
const MCQ_SHARE = 0.67; // round 28 B (sa_r28_mcq): 4 of the 6 questions picked from four (a guesser reaches it 3.8% of the time)
const MCQ_QUESTIONS = 6; // the story questions picked from four: of 6, less the questions whose clip was lost (B.5)
const LETTER_PICK_SHARE = 0.8; // round 28 A (sa_r28_letter_pick): 8 of 10 letters picked by their sound
const NUMBERS_SHARE = 0.75; // 6 of 8 numbers
const COMPARING_SHARE = 0.75; // which is bigger + missing number, together
const ADD_SHARE = 0.5; // half the addition sums
const SUB_MUL_SHARE = 0.5; // half the subtraction and multiplication sums, together

/**
 * The rungs, in order. `parts` are task-id suffixes; `rule` is how the parts decide:
 *   any     met when one part meets the share on its own
 *   pooled  the parts' correct answers together, over their items together
 *   floor   the part's correct count reaches `min`
 * The one-minute quick sums (ma.fluency1m) are not a rung: a rate, not a step on the ladder.
 */
const LADDERS = {
  reading: [
    { level: 'letters', parts: ['letter_names5', 'letter_sounds5', 'letter_pick10'], rule: 'any', share: LETTERS_SHARE, shares: { letter_pick10: LETTER_PICK_SHARE } },
    { level: 'words', parts: ['words4'], rule: 'pooled', share: WORDS_SHARE },
    { level: 'story', parts: ['story_w3'], rule: 'floor', min: STORY_FLOOR_WORDS },
    { level: 'comprehension', parts: ['story_comp_w3', 'story_mcq_w3'], rule: 'pooled', share: COMPREHENSION_SHARE, shares: { story_mcq_w3: MCQ_SHARE } },
  ],
  maths: [
    { level: 'numbers', parts: ['number_id8'], rule: 'pooled', share: NUMBERS_SHARE },
    { level: 'comparing', parts: ['discrimination2', 'missing4'], rule: 'pooled', share: COMPARING_SHARE },
    { level: 'add', parts: ['add2i'], rule: 'pooled', share: ADD_SHARE },
    { level: 'sub_mul', parts: ['sub2i', 'mul2i'], rule: 'pooled', share: SUB_MUL_SHARE },
  ],
};

/**
 * Whether `correct` of `of` reaches `share`. The MCQ share 0.67 is the reviewed shorthand for two thirds (4 of 6), and
 * 4 / 6 = 0.6666… is below 0.67 in floating point, so it is compared exactly as correct × 3 ≥ of × 2.
 */
function meets(correct, of, share) {
  if (!(of > 0)) return false;
  if (share === MCQ_SHARE) return correct * 3 >= of * 2;
  return correct / of >= share;
}
/** A part's own share on its rung (rung.shares, by task-id suffix), else the rung's. */
const shareOf = (rung, part) => (rung.shares && rung.shares[part] != null ? rung.shares[part] : rung.share);

const ladderOf = (subject) => (subject === 'ma' ? LADDERS.maths : LADDERS.reading);
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const resultOf = (r) => (Array.isArray(r.responses) && r.responses.find((x) => x && x.kind === 'result')) || {};
const subjectOf = (taskId) => {
  const s = String(taskId || '').split('.')[0];
  return SUBJECTS.includes(s) ? s : null;
};
const NOT_DONE = /^(skipped|mic_unavailable|assets_unavailable)/;
const COACH_STOPS = new Set(['end_section', 'skipped_end_section']);

function stopOf(r) {
  const res = resultOf(r);
  const m = r.ai_marks || {};
  return (typeof res.stop_reason === 'string' && res.stop_reason) || (typeof m.stop_reason === 'string' && m.stop_reason) || '';
}

/**
 * One part's state: { state: 'scored', correct, of } | { state: 'pending' } | { state: 'unmet' } | null (unrated,
 * round 28: a picker / picked-from-four part with too few items presented is ABSENT from the ladder, never pending).
 * Spoken parts count from the scorer's marks; tap / keypad parts from the phone's own count.
 */
function partOf(r, itemsOf, mcqFloor = false) {
  const res = resultOf(r);
  const m = r.ai_marks || null;
  const stop = stopOf(r);
  if (NOT_DONE.test(stop)) return { state: 'unmet' };
  const mode = r.response_mode || res.mode || null;
  const phone = mode === 'tap' || mode === 'keypad' || mode === 'keyboard';
  const items = itemsOf ? num(itemsOf(r.block)) : null;
  if (phone) {
    if (res.unrated === true) return null;
    const correct = num(m && (m.tap_correct ?? m.keypad_correct)) ?? num(res.correct);
    const attempted = num(m && (m.tap_attempted ?? m.keypad_attempted)) ?? num(res.attempted);
    if (correct === null) return { state: 'unmet' };
    // round 28 B (SPEC v2.1, B.5): the questions picked from four are read out of 6 less the questions whose clip was
    // lost; a question the reading gate did not ask counts as not right, as the oral part today
    if (/\.story_mcq_w3$/.test(String(r.block || ''))) {
      // sa_r28_mcq (the reading floor): pending until the scorer has applied the passage's gate to it
      if (mcqFloor && !floorChecked(m)) return { state: 'pending' };
      const all = num(res.of_all) ?? items ?? MCQ_QUESTIONS;
      return { state: 'scored', correct, of: Math.max(0, all - (num(res.unavailable) || 0)) || null };
    }
    // round 28 A: the picker is read as correct of presented
    const presented = Array.isArray(res.presented) ? res.presented.length : num(res.presented);
    if (presented !== null && presented > 0) return { state: 'scored', correct, of: presented };
    return { state: 'scored', correct, of: Math.max(items || 0, attempted || 0) || null };
  }
  const scored = m && r.ai_status === 'scored' && num(m.correct) !== null;
  if (!scored) return { state: 'pending' };
  const detail = m.detail || {};
  // sa_r28_ceiling (C-8): an extended timed task is judged on today's first N items (the scorer's fixed anchor)
  if (num(detail.of_base) !== null && num(detail.correct_base) !== null) return { state: 'scored', correct: detail.correct_base, of: detail.of_base };
  const of = num(detail.of_all) ?? num(m.of) ?? (Array.isArray(detail.items) && detail.items.length ? detail.items.length : null) ?? items;
  return { state: 'scored', correct: m.correct, of };
}

/** sa_r28_mcq: the scorer has evaluated the MCQ's reading floor (gated, or checked and passed). */
function floorChecked(m) {
  const d = (m && m.detail) || {};
  return typeof d.gate_checked === 'boolean' || typeof d.stop_why === 'string';
}

/** 'met' | 'unmet' | 'pending' for one rung, given the subject's parts by task id. */
function rungOf(rung, subject, parts) {
  const named = rung.parts.map((p) => [p, parts.get(`${subject}.${p}`)]).filter(([, x]) => x);
  const got = named.map(([, x]) => x);
  if (!got.length) return 'unmet';
  if (rung.rule === 'any') {
    if (named.some(([n, p]) => p.state === 'scored' && p.of && meets(p.correct, p.of, shareOf(rung, n)))) return 'met';
    return got.some((p) => p.state === 'pending') ? 'pending' : 'unmet';
  }
  if (got.some((p) => p.state === 'pending')) return 'pending';
  if (rung.rule === 'floor') return got.every((p) => p.state === 'scored' && p.correct >= rung.min) ? 'met' : 'unmet';
  let correct = 0;
  let of = 0;
  // pooled over the parts present (the oral and the picked-from-four questions never run in one session); a part with
  // its own share sets the bar, the strictest when more than one is present
  let share = null;
  for (const [n, p] of named) {
    if (p.state !== 'scored') continue;
    correct += p.correct;
    of += p.of || 0;
    const s = shareOf(rung, n);
    if (share === null || s > share) share = s;
  }
  return of > 0 && meets(correct, of, share === null ? rung.share : share) ? 'met' : 'unmet';
}

function stopLine(subject, rows, events) {
  const mine = (taskId) => subjectOf(taskId) === subject;
  const evs = (Array.isArray(events) ? events : []).filter((e) => e && mine(e.task_id));
  if (rows.some((r) => COACH_STOPS.has(stopOf(r))) || evs.some((e) => e.type === 'end_section')) return 'coach';
  const silenceEvent = evs.some((e) => (e.type === 'incomplete_move_on' && e.data && e.data.reason === 'silence') || e.type === 'early_stop_silence');
  if (silenceEvent || rows.some((r) => stopOf(r) === 'early_stop_silence' || resultOf(r).silent === true)) return 'no_answer';
  return null;
}

/** One line per subject that has a ladder part, in the order Urdu, English, Maths. Rows in the order the child took them. */
function levelsOf(rows, events, { itemsOf = null, titleOf = null, mcqFloor = false } = {}) {
  const out = [];
  for (const subject of SUBJECTS) {
    const mine = (rows || []).filter((r) => r && subjectOf(r.block) === subject);
    const ladder = ladderOf(subject);
    const ids = new Set(ladder.flatMap((g) => g.parts.map((p) => `${subject}.${p}`)));
    if (!mine.some((r) => ids.has(r.block))) continue;
    const graded = mine.filter((r) => ids.has(r.block)).map((r) => [r.block, partOf(r, itemsOf, mcqFloor)]);
    // round 28: an unrated part is absent; a subject whose ladder parts are all unrated has no level and waits for none
    const allUnrated = graded.every(([, p]) => p === null);
    const parts = new Map(graded.filter(([, p]) => p !== null));
    const done = mine.filter((r) => !NOT_DONE.test(stopOf(r)));
    const last = done.length ? done[done.length - 1].block : null;
    let level = BEGINNER;
    let pending = false;
    for (const rung of ladder) {
      const v = rungOf(rung, subject, parts);
      if (v === 'met') { level = rung.level; continue; }
      if (v === 'pending') { pending = true; if (level === BEGINNER) level = null; }
      break;
    }
    out.push({
      subject,
      reached: last ? { taskId: last, title: (titleOf && titleOf(last)) || null } : null,
      level: allUnrated ? null : level,
      pending: allUnrated ? false : pending,
      stop: stopLine(subject, mine, events),
      ...(allUnrated ? { unrated: true } : {}),
    });
  }
  return out;
}

module.exports = { levelsOf, LADDERS, BEGINNER, STORY_FLOOR_WORDS, SUBJECTS, MCQ_SHARE };
