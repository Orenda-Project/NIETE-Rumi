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
 *    miss in rubric order; with nothing missed, none. No Coach Training module after a debrief (queue #186): the one
 *    training recommendation is the Weekly Report's (coach-week.js `training`).
 *
 * Pure: no I/O. The words (names, why-it-matters lines, labels) are in observe-strings.js.
 */

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

/** "★★★★★☆☆☆" — one star per mark, filled when done. */
function stars(m) {
  return '★'.repeat(m.done) + '☆'.repeat(m.total - m.done);
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

/**
 * Queue #230 (the operator, 23 Nov: "on a report i am seeing in underscores one_improvement_only. why is that?") — no
 * rubric key ever reaches a page as text. The judge is asked to aim its "try" at "a rubric key you judged FALSE", and
 * in about 1 debrief in 6 it wrote the KEY itself as try.move ("one_improvement_only"), which the report printed as
 * its Key Focus Area; a few focus_why lines name keys mid-sentence ("feeds both elicited_if_then and …").
 *
 * keysToWords: a rubric key in a line becomes that behaviour's name (observe-strings coach_rubric_names, Urdu in an
 * Urdu line, else English; a bare key takes `lang`); any other snake_case word loses its underscores. Pure.
 */
const RESPECT_NAME = { en: 'Respect held', ur: 'احترام قائم رہا' };
const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const URDU_LETTERS = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN_LETTERS = /[A-Za-z]/g;

/**
 * Urdu when Urdu letters outnumber Latin ones, else English. Not "any Urdu letter": an English debrief quotes the
 * officer's Urdu speech ("You said 'شاباش' …"), and is still English. A key's own letters are not counted.
 */
function scriptOf(s) {
  const t = String(s == null ? '' : s).replace(SNAKE, '');
  return (t.match(URDU_LETTERS) || []).length > (t.match(LATIN_LETTERS) || []).length ? 'ur' : 'en';
}

function rubricNames(lang) {
  const { observeStrings } = require('./observe-strings');
  const names = (observeStrings(lang) || {}).coach_rubric_names || {};
  return { ...names, disparaged_teacher: RESPECT_NAME[lang] || RESPECT_NAME.en };
}

/** Does this text carry a raw snake_case key? */
function hasRawKey(s) {
  return typeof s === 'string' && new RegExp(SNAKE.source).test(s);
}

/**
 * @param {string} s     a line the model wrote
 * @param {'en'|'ur'} [lang] the language for a line that is nothing but a key (no script of its own to go by)
 */
function keysToWords(s, lang) {
  if (typeof s !== 'string' || !hasRawKey(s)) return s;
  const bare = /^\s*[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*$/.test(s);
  const { clampLanguage } = require('../../config/ux-strings');
  const l = bare ? clampLanguage(lang, ['en', 'ur']) : scriptOf(s);
  const names = rubricNames(l);
  const words = (k) => (Object.prototype.hasOwnProperty.call(names, k) ? names[k] : k.replace(/_/g, ' '));
  return bare ? words(s.trim()) : s.replace(SNAKE, words);
}

/** The language the judge wrote the feedback in: the script with more letters across all its lines (scriptOf). */
function feedbackLanguage(fb) {
  const f = fb || {};
  const lines = [f.praise_line, f.focus_why, f.reflection_question, (f.try || {}).evidence, (f.try || {}).instead,
    ...Object.values(f.concern || {}), ...Object.values(f.missed || {}), ...Object.values(f.did || {}),
    ...(Array.isArray(f.wins) ? f.wins.map((w) => w && w.evidence) : [])];
  return scriptOf(lines.filter((x) => typeof x === 'string').join(' '));
}

const mapValues = (o, fn) => (o && typeof o === 'object' && !Array.isArray(o)
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)])) : o);

/**
 * The judge's feedback with every line it wrote in words (keysToWords). What the code reads stays as it was: the
 * rubric, focus, the keys of missed/did, and each win's behaviour (named from coach_rubric_names where shown). Pure:
 * a new object, the input untouched; anything that is not an object comes back as it was.
 */
function feedbackInWords(fb) {
  if (!fb || typeof fb !== 'object') return fb;
  const lang = feedbackLanguage(fb);
  const W = (s) => keysToWords(s, lang);
  const out = { ...fb };
  for (const k of ['praise_line', 'focus_why', 'reflection_question']) if (k in out) out[k] = W(out[k]);
  if (out.try && typeof out.try === 'object') out.try = mapValues(out.try, W);
  if (out.concern && typeof out.concern === 'object') out.concern = mapValues(out.concern, W);
  if (out.missed) out.missed = mapValues(out.missed, W);
  if (out.did) out.did = mapValues(out.did, W);
  if (Array.isArray(out.wins)) out.wins = out.wins.map((w) => (w && typeof w === 'object' ? { ...w, evidence: W(w.evidence) } : w));
  return out;
}

module.exports = {
  winName,
  BEHAVIOUR_KEYS, rubricMarks, missedBehaviours, validFocus, nextFocusKey, stars,
  hasRawKey, keysToWords, feedbackLanguage, feedbackInWords,
};
