'use strict';
/**
 * The coach's Feedback Report shows the coach-debrief rubric (ur/en): the marks are COMPUTED HERE from the judge's
 * booleans, never taken from anything the model wrote, so a card can never say "rehearsed" when the judge said no.
 *
 *  - eight behaviour marks, in the rubric's order: the seven the judge has always scored plus rehearsed_the_step
 *    (judged by the ur/en prompt since it was added). A row judged before then has no rehearsal key: it shows seven
 *    marks, never a made-up miss.
 *  - Respect is not a mark: it is a standing rule (the harm gate, disparaged_teacher), shown on its own line.
 *  - the next focus is the behaviour the judge says the "try" targets, if it is one it judged false; else the first
 *    miss in rubric order; with nothing missed, the full debrief. Its Coach Training module is the card's one link.
 *
 * Pure: no I/O. The words (names, why-it-matters lines, labels) are in observe-strings.js.
 */

const { moduleFor, moduleByNumber, moduleUrl, FULL_DEBRIEF_MODULE } = require('../../config/coach-training-modules');

/** The eight behaviours, in the rubric's (and the report's) order. */
const BEHAVIOUR_KEYS = Object.freeze([
  'opened_with_specific_praise',
  'anchored_in_real_moment',
  'asked_and_waited',
  'one_improvement_only',
  'moves_not_teacher',
  'elicited_if_then',
  'righting_reflex_held',
  'rehearsed_the_step',
]);

/**
 * @param {object} rubric the judge's booleans
 * @returns {{marks: {key: string, done: boolean}[], done: number, total: number, respectHeld: boolean|null}}
 */
function rubricMarks(rubric) {
  const r = rubric || {};
  const marks = BEHAVIOUR_KEYS.filter((k) => typeof r[k] === 'boolean').map((k) => ({ key: k, done: r[k] === true }));
  return {
    marks,
    done: marks.filter((m) => m.done).length,
    total: marks.length,
    respectHeld: typeof r.disparaged_teacher === 'boolean' ? r.disparaged_teacher === false : null,
  };
}

/** The behaviours judged false, in rubric order (a key the judge never scored is not a miss). */
function missedBehaviours(rubric) {
  return rubricMarks(rubric).marks.filter((m) => !m.done).map((m) => m.key);
}

/** A focus key the model gave, kept only if it is a behaviour the judge scored false. */
function validFocus(fb) {
  const f = fb && fb.focus;
  return typeof f === 'string' && missedBehaviours(fb.rubric).includes(f) ? f : null;
}

/** The behaviour the next focus is about, or null when nothing was missed. */
function nextFocusKey(fb) {
  return validFocus(fb) || missedBehaviours(fb && fb.rubric)[0] || null;
}

/** The Coach Training module the card links: the next focus's, or the full debrief when nothing was missed. */
function focusModule(fb) {
  const key = nextFocusKey(fb);
  return key ? moduleFor(key) : moduleByNumber(FULL_DEBRIEF_MODULE);
}

/** "★★★★★☆☆☆" — one star per mark, filled when done. */
function stars(m) {
  return '★'.repeat(m.done) + '☆'.repeat(m.total - m.done);
}

/** The module line in the coach's words: "Coach Training, Module 8: Rehearse it aloud". */
function moduleLine(mod, S, lang) {
  if (!mod || !S.coach_card_module_line) return '';
  const title = (mod.title && (mod.title[lang] || mod.title.en)) || '';
  return S.coach_card_module_line.replace('{n}', String(mod.n)).replace('{title}', title);
}

/**
 * bd-ewbzns.4.3 — a win's name. Since the 3 Nov rubric the judge writes `behaviour` as the rubric KEY; shown as written
 * the coach read "opened_with_specific_praise". A key is named from observe-strings coach_rubric_names (in S's language);
 * a free-text behaviour (the older judge) is shown as written.
 * @param {string} behaviour
 * @param {object} S  observeStrings(lang)
 */
function winName(behaviour, S) {
  const names = (S && S.coach_rubric_names) || {};
  return Object.prototype.hasOwnProperty.call(names, behaviour) ? names[behaviour] : behaviour;
}

module.exports = {
  winName,
  BEHAVIOUR_KEYS, rubricMarks, missedBehaviours, validFocus, nextFocusKey, focusModule, stars, moduleLine, moduleUrl,
};
