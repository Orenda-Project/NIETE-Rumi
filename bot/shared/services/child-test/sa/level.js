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
    { level: 'letters', parts: ['letter_names5', 'letter_sounds5'], rule: 'any', share: LETTERS_SHARE },
    { level: 'words', parts: ['words4'], rule: 'pooled', share: WORDS_SHARE },
    { level: 'story', parts: ['story_w3'], rule: 'floor', min: STORY_FLOOR_WORDS },
    { level: 'comprehension', parts: ['story_comp_w3'], rule: 'pooled', share: COMPREHENSION_SHARE },
  ],
  maths: [
    { level: 'numbers', parts: ['number_id8'], rule: 'pooled', share: NUMBERS_SHARE },
    { level: 'comparing', parts: ['discrimination2', 'missing4'], rule: 'pooled', share: COMPARING_SHARE },
    { level: 'add', parts: ['add2i'], rule: 'pooled', share: ADD_SHARE },
    { level: 'sub_mul', parts: ['sub2i', 'mul2i'], rule: 'pooled', share: SUB_MUL_SHARE },
  ],
};

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
 * One part's state: { state: 'scored', correct, of } | { state: 'pending' } | { state: 'unmet' }.
 * Spoken parts count from the scorer's marks; tap / keypad parts from the phone's own count.
 */
function partOf(r, itemsOf) {
  const res = resultOf(r);
  const m = r.ai_marks || null;
  const stop = stopOf(r);
  if (NOT_DONE.test(stop)) return { state: 'unmet' };
  const mode = r.response_mode || res.mode || null;
  const phone = mode === 'tap' || mode === 'keypad' || mode === 'keyboard';
  const items = itemsOf ? num(itemsOf(r.block)) : null;
  if (phone) {
    const correct = num(m && (m.tap_correct ?? m.keypad_correct)) ?? num(res.correct);
    const attempted = num(m && (m.tap_attempted ?? m.keypad_attempted)) ?? num(res.attempted);
    if (correct === null) return { state: 'unmet' };
    return { state: 'scored', correct, of: Math.max(items || 0, attempted || 0) || null };
  }
  const scored = m && r.ai_status === 'scored' && num(m.correct) !== null;
  if (!scored) return { state: 'pending' };
  const detail = m.detail || {};
  const of = num(detail.of_all) ?? num(m.of) ?? (Array.isArray(detail.items) && detail.items.length ? detail.items.length : null) ?? items;
  return { state: 'scored', correct: m.correct, of };
}

/** 'met' | 'unmet' | 'pending' for one rung, given the subject's parts by task id. */
function rungOf(rung, subject, parts) {
  const got = rung.parts.map((p) => parts.get(`${subject}.${p}`)).filter(Boolean);
  if (!got.length) return 'unmet';
  if (rung.rule === 'any') {
    if (got.some((p) => p.state === 'scored' && p.of && p.correct / p.of >= rung.share)) return 'met';
    return got.some((p) => p.state === 'pending') ? 'pending' : 'unmet';
  }
  if (got.some((p) => p.state === 'pending')) return 'pending';
  if (rung.rule === 'floor') return got.every((p) => p.state === 'scored' && p.correct >= rung.min) ? 'met' : 'unmet';
  let correct = 0;
  let of = 0;
  for (const p of got) {
    if (p.state !== 'scored') continue;
    correct += p.correct;
    of += p.of || 0;
  }
  return of > 0 && correct / of >= rung.share ? 'met' : 'unmet';
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
function levelsOf(rows, events, { itemsOf = null, titleOf = null } = {}) {
  const out = [];
  for (const subject of SUBJECTS) {
    const mine = (rows || []).filter((r) => r && subjectOf(r.block) === subject);
    const ladder = ladderOf(subject);
    const ids = new Set(ladder.flatMap((g) => g.parts.map((p) => `${subject}.${p}`)));
    if (!mine.some((r) => ids.has(r.block))) continue;
    const parts = new Map(mine.filter((r) => ids.has(r.block)).map((r) => [r.block, partOf(r, itemsOf)]));
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
      level,
      pending,
      stop: stopLine(subject, mine, events),
    });
  }
  return out;
}

module.exports = { levelsOf, LADDERS, BEGINNER, STORY_FLOOR_WORDS, SUBJECTS };
