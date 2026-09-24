'use strict';
/**
 * Lesson quiz — the BLIND SOLVE, the last check before a single row is stored.
 *
 * WHY THIS EXISTS. On sandbox a transcript quiz on a letters lesson went out
 * with «لفظ حال کے جوڑ توڑ میں کون سے حروف شامل ہیں؟» keyed «ہ، ا، ل» — حال is
 * spelled ح ا ل — and with «سلام» offering two options that hold the same four
 * letters, i.e. two right answers. The class report, which trusts the key, then
 * told the teacher the misspelling was right, explained that the children who
 * chose ح were wrong, and planned tomorrow's drill on «ہ، ا، ل». The validator
 * checks shape, language, level and pictures; the lp_v8 key check compares a key
 * with the lesson plan it was written from. Neither can see a SPELLING mistake —
 * no lesson source says how حال is spelled — and a transcript quiz had no key
 * check at all.
 *
 * WHAT IT DOES. One LLM call answers every item WITHOUT being shown its key: the
 * stem, the options (in a stable shuffled order, so an author's habit of putting
 * the right answer first cannot be read), the grade, the subject, the lesson's
 * objectives and summary. For each item it lists EVERY option that is correct.
 * Code — never the model — then compares that list with the key:
 *
 *   agree         the solver's set IS the key
 *   disagree      the solver chose something else (the حال case)
 *   ambiguous     the key AND another option are both correct (the سلام case)
 *   none_correct  the solver found no option correct
 *   unclear       the solver was unsure, skipped the item, or answered junk
 *
 * What the generate step does with a flagged item (re-author once through the
 * existing targeted rewrite, re-solve, drop, or fail as `key_disagreement`)
 * lives in `transcript-quiz-generate.service.js` (runKeyVerify), beside the
 * lp_v8 key check and every other recovery step.
 *
 * TWICE: WITH THE LESSON AND WITHOUT IT. The lesson summary is written from the
 * recording, so it repeats whatever was said in class — a mistake included. On
 * staging a Proper Fraction quiz keyed «کون سا Proper Fraction نہیں ہے؟ 1/4 ·
 * 4/8 · 2/5» to 4/8 (all three are proper) because the teacher had said so in
 * class; the summary said the same, and the solver, shown it, agreed. So every
 * item the first solve does not already flag is solved again with NO lesson at
 * all — only the grade, the subject and the item — and an item the subject
 * alone decides differently is a disagreement like any other (`pass: 'bare'`).
 * An item only the lesson can answer comes back `unsure` there and never blocks.
 *
 * THE SAME FACT TWICE, IN OTHER WORDS. The solve reads every item of the quiz
 * in this one call and works out every answer itself, so the FULL solve with
 * the lesson (never the solve without it, never a re-solve of a few items) is
 * also asked which questions test the same fact with the same answer
 * ("same_fact": pairs of item numbers). The word-for-word repeat check
 * (transcript-quiz-duplicates) cannot see "What is formed in a physical
 * change?" beside "What is true about a physical change?"; this can. The pairs
 * are an OPTIONAL part of the reply: a reply without them is still a good
 * solve, with no pairs. What is done with a pair — held to its contract in
 * code first — lives in runKeyVerify.
 *
 * THE MODEL. `quiz.keyVerify` in the model registry — TRANSCRIPT_QUIZ_VERIFY_MODEL,
 * default a DIFFERENT and stronger model than the author's (a solver that shares
 * the author's blind spots agrees with the author's mistakes).
 *
 * TWO CONTRACTS ASSERTED IN CODE (root rule 24c), not left to the prompt:
 *   - a reply with no `answers` array is a FAILED solve (the caller fails open
 *     and says so at error), never "every key is fine";
 *   - an item the reply skipped, marked unsure, or answered with anything but a
 *     list of option numbers it was shown is `unclear` — it neither blocks the
 *     quiz nor counts as agreement.
 *
 * Pure except for the one LLM call: no DB, no WhatsApp, no R2.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { LANG_NAME, sloStatement } = require('./transcript-quiz-language');
const Multi = require('./transcript-quiz-multi');
const { todaysModel } = require('../../config/model-registry');

const LABEL = 'transcript_quiz.key_verify';
/** The second solve, without the lesson: its own label in the logs, the same job and spend line. */
const BARE_LABEL = 'transcript_quiz.key_verify_bare';
/** The model-registry job: its own model, its own spend line. */
const JOB = 'quiz.keyVerify';
/** The verdicts that send an item back to the rewrite. `unclear` is never one of them. */
const FLAGGED = new Set(['disagree', 'ambiguous', 'none_correct']);
const SUMMARY_MAX = 600;
const FIGURE_MAX = 600;
const NOTE_MAX = 200;
const SLOS_MAX = 8;

/**
 * The question asked alongside the full solve. Measured read-only on 212
 * production quizzes: the solver names 60 of 71 reworded repeats a reader found,
 * but on its own only 61% of the pairs it names are repeats — it lists one
 * template on another item, and two questions on one topic with different
 * answers, despite being told not to. So runKeyVerify acts only on a pair that
 * also passes the contract in code (confirmsSameFact): 93% of those are repeats.
 */
const SAME_FACT_RULE = 'THE SAME FACT TWICE. After solving, compare the questions with each other. In "same_fact", list every pair of questions [i, j] (their q numbers, the earlier first) that test the SAME fact or skill and have the SAME correct answer, so that a child who has answered one has already answered the other: the same question in other words, the same question asked as a fill-in-the-blank and as a question, the same question over a picture and as text, or the same sum with the same numbers told as another story. Do NOT list: one question shape used again with different numbers or a different item (rounding 18, then rounding 16; the article before "kite", then before "tree"); a general question beside one about a specific example ("Which of these is a vowel?" beside "Which letter in CAT is a vowel?"); two questions whose correct answers differ. Most quizzes have no such pair — then give an empty list.';

const cp = (s) => [...String(s)].length;
const arr = (v) => (Array.isArray(v) ? v : []);
const cut = (s, n) => (cp(s) > n ? `${[...String(s)].slice(0, n - 1).join('')}…` : String(s));
/** One trimmed line, direction marks removed (they are layout, not text). */
const line = (v) => String(v ?? '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();

/** The model the solve runs on — read per call, so an env flip needs no deploy. */
function verifyModel() {
  return todaysModel(JOB);
}

/** FNV-1a over a string: a stable seed per quiz, item and wording. */
function seedOf(key) {
  let h = 2166136261;
  const s = String(key);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/**
 * The order the solver is SHOWN the options in: `order[shownPosition] = authoredIndex`.
 * Seeded on the quiz, the item and its wording, so the same item always shows the
 * same way (a re-solve of a rewritten item gets its own order).
 */
function shownOrder(n, key) {
  const order = Array.from({ length: n }, (_, k) => k);
  let s = seedOf(key);
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let k = n - 1; k > 0; k -= 1) {
    const j = Math.floor(rnd() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  return order;
}

/** The positions an item keys as correct: one for an ordinary question, a set for "select all". */
function keyedIndices(q) {
  if (Multi.isMultiQuestion(q)) return Multi.authoredCorrectIndices(q);
  const n = Number(q && q.correct_index);
  return Number.isInteger(n) ? [n] : [];
}

/** Options by authored index, as text — what the record shows and the rewrite is told. */
function optionText(q, indices) {
  const opts = arr(q && q.options);
  return arr(indices).map((i) => line(opts[i])).filter(Boolean).join(' + ');
}

/**
 * Everything the solve needs about one item, and nothing that gives its key
 * away: no correct index, no explanation, no feedback, no "selected_because".
 */
function itemFor(q, index, quizId = null) {
  const options = arr(q && q.options).map(line);
  return {
    index,
    question: line(q && q.question),
    options,
    order: shownOrder(options.length, `${quizId || ''}:${index}:${line(q && q.question)}`),
    keyed: keyedIndices(q).slice().sort((a, b) => a - b),
    multi: Multi.isMultiQuestion(q),
    figure: q && q.figure && typeof q.figure === 'object' ? q.figure : null,
  };
}

/**
 * THE SOLVER PROMPT. The context first (what the lesson was about — never an
 * answer), then the items with their options in the shown order, then the rule.
 * Written in English; the quiz stays in its own language, and the solver is told
 * to judge spelling and letters exactly as written.
 */
function buildVerifyPrompt({
  items, language, grade = null, subject = null, digest = null, lessonSummary = null, withLesson = true,
  // the full solve with the lesson also names the questions asked twice (verifyKeys decides)
  askSameFact = false,
}) {
  const lang = LANG_NAME[language] || 'the quiz\'s own language';
  // Without the lesson, nothing about it reaches the prompt — not the summary,
  // not the objectives: a mistake made in class cannot ride in on either.
  const slos = withLesson ? arr(digest && digest.slos).slice(0, SLOS_MAX)
    .map((s) => line(sloStatement(s, language)))
    .filter(Boolean) : [];
  const summary = withLesson ? line(lessonSummary) : '';
  const context = [
    summary ? `Lesson summary: ${cut(summary, SUMMARY_MAX)}` : null,
    slos.length ? `What the children were meant to learn:\n${slos.map((s) => `- ${s}`).join('\n')}` : null,
  ].filter(Boolean).join('\n');

  const blocks = arr(items).map((it) => {
    const shown = it.order.map((authored, pos) => `[${pos}] ${it.options[authored]}`).join(' | ');
    const kind = it.multi ? 'choose ALL that are correct' : 'one answer';
    const picture = it.figure
      ? `\n  the picture the child sees, as data: ${cut(JSON.stringify(it.figure), FIGURE_MAX)}` : '';
    return `q${it.index} (${kind}): ${it.question}\n  options: ${shown}${picture}`;
  }).join('\n\n');

  return [
    `You are SOLVING a short quiz for children${grade ? ` in grade ${line(grade)}` : ''}${subject ? `, subject ${line(subject)}` : ''}. You are NOT told which answers are right: work out every question yourself, the way a careful teacher who knows the subject would. The quiz is in ${lang}; read it in that language, and judge spelling, letters, word forms and numbers exactly as they are written.`,
    context
      ? `WHAT THE LESSON WAS ABOUT — context only. It tells you what the questions are about; a fact (a spelling, the letters of a word, a sum, a definition, a date) is decided by what is TRUE, not by this text.\n${context}`
      : null,
    withLesson ? null
      : 'You are told NOTHING about the lesson, on purpose. Decide every question from the subject alone — the definition, the rule, the sum, the spelling, the picture\'s data — exactly as a careful teacher who knows the subject would. An option is correct only if it is right by the subject; never pick the least wrong one — a name the subject does not use for the thing asked about, a wrong formula or a wrong meaning is not correct because the other options are worse. If a question can only be answered from what happened in that class (a story read there, the class\'s own example, what was said or done in the room), set "unsure": true for it.',
    `THE QUESTIONS\n\n${blocks}`,
    `For EACH question, list in "correct" EVERY option number that is a correct answer to the question exactly as it is asked — every option a careful teacher would mark right. If two options are both right (for example, the same letters in a different order when the question does not ask about their order), list both. If no option is right, give an empty list. Judge what is written, not what the question-writer probably meant. If you cannot decide without something you were not given (the lesson itself, or a picture you cannot read from its data), set "unsure": true. In "note", say in one short line why — for a wrong or doubled option, name the fact (for example: "قلم is spelled ق ل م, not ک ل م").`,
    askSameFact ? SAME_FACT_RULE : null,
    `Return ONLY this JSON object, one entry per question above, "index" being the number after its q:
{ "answers": [ { "index": ${arr(items)[0] ? items[0].index : 0}, "correct": [0], "unsure": false, "note": "" } ]${askSameFact ? ', "same_fact": []' : ''} }`,
  ].filter(Boolean).join('\n\n');
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** One item's verdict, from the solver's answer — the comparison is code, never the model's. */
function judge(item, a) {
  const base = { index: item.index, keyed: item.keyed };
  if (!a) return { ...base, verdict: 'unclear', blind: null, note: '', missing: true };
  const note = cut(line(a.note), NOTE_MAX);
  if (a.unsure === true || !Array.isArray(a.correct)) return { ...base, verdict: 'unclear', blind: null, note };
  const shown = a.correct.map(Number);
  if (shown.some((k) => !Number.isInteger(k) || k < 0 || k >= item.order.length)) {
    return { ...base, verdict: 'unclear', blind: null, note };
  }
  const blind = [...new Set(shown.map((k) => item.order[k]))].sort((x, y) => x - y);
  let verdict;
  if (!blind.length) verdict = 'none_correct';
  else if (sameSet(blind, item.keyed)) verdict = 'agree';
  else if (!item.multi && item.keyed.length === 1 && blind.includes(item.keyed[0])) verdict = 'ambiguous';
  else verdict = 'disagree';
  return { ...base, verdict, blind, note };
}

/**
 * The reply, held to its contract. Throws when there is no `answers` array —
 * the caller treats that as a failed solve, never as "all agree". One verdict
 * per REQUESTED item, in order; a skipped item is `unclear` with `missing: true`.
 *
 * @returns {{index:number, verdict:string, keyed:number[], blind:number[]|null, note:string, missing?:boolean}[]}
 */
function parseAnswers(json, items) {
  if (!json || !Array.isArray(json.answers)) throw new Error(`${LABEL}: the reply carries no "answers" array`);
  const wanted = new Set(arr(items).map((it) => it.index));
  const byIndex = new Map();
  json.answers.forEach((a) => {
    const i = Number(a && a.index);
    if (!Number.isInteger(i) || !wanted.has(i) || byIndex.has(i)) return;
    byIndex.set(i, a);
  });
  return arr(items).map((it) => judge(it, byIndex.get(it.index)));
}

/**
 * The pairs a reply names under "same_fact", held to their shape: two different
 * items the solver was shown, the earlier first, each pair once, in order. Junk
 * is dropped, never fatal — the field is optional.
 *
 * @returns {number[][]}
 */
function parseSameFact(json, items) {
  const shown = new Set(arr(items).map((it) => it.index));
  const seen = new Set();
  const pairs = [];
  arr(json && json.same_fact).forEach((p) => {
    if (!Array.isArray(p) || p.length !== 2) return;
    const [i, j] = p.map(Number).sort((a, b) => a - b);
    if (!Number.isInteger(i) || !Number.isInteger(j) || i === j || !shown.has(i) || !shown.has(j)) return;
    if (seen.has(`${i}:${j}`)) return;
    seen.add(`${i}:${j}`);
    pairs.push([i, j]);
  });
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * The complaint a flagged item carries into the targeted rewrite — the same
 * `q<i>: CODE — …` shape every validator complaint has, so the existing rewrite
 * takes it as one question's text to rewrite.
 */
function disagreementComplaint(verdict, q) {
  const i = verdict.index;
  const keyed = optionText(q, verdict.keyed) || '(none)';
  const blind = optionText(q, verdict.blind || []);
  const why = verdict.note ? ` (the solver's reason: ${verdict.note})` : '';
  // Solved from the subject alone: the lesson's own account agreed with the key,
  // so the rewrite must be told the fact is what decides, not the class.
  const bare = verdict.pass === 'bare' ? ' It was solved from the subject alone, without the lesson: what was said in class does not decide a fact.' : '';
  if (verdict.verdict === 'ambiguous') {
    return `q${i}: KEY_AMBIGUOUS — more than one option is a correct answer: "${blind}"${why}.${bare} Exactly one option may be correct: keep the right one marked correct and make every other option clearly wrong.`;
  }
  if (verdict.verdict === 'none_correct') {
    return `q${i}: KEY_NONE_CORRECT — a solver who was not shown the key found no option correct, not even the one marked correct ("${keyed}")${why}.${bare} Make exactly one option correct and mark it.`;
  }
  return `q${i}: KEY_DISAGREEMENT — a solver who was not shown the key answered "${blind}", but the option marked correct is "${keyed}"${why}.${bare} Check the fact itself and mark as correct only the option that is actually right.`;
}

/**
 * ONE call. Solves every item, or only `indices` (the re-solve after a
 * rewrite) — with the lesson as context, or (`withLesson: false`) with nothing
 * about it, each verdict then marked `pass: 'bare'`; `again: true` shows the
 * options in a different order (the confirming second look). Throws on an LLM failure
 * or an unusable reply — the caller decides what a failed solve means (it
 * fails open).
 *
 * The full solve with the lesson (every item, first look) also returns
 * `sameFact`, the pairs the solver says ask the same fact; every other solve
 * returns an empty list.
 *
 * @returns {Promise<{verdicts:object[], sameFact:number[][], model:string|null, costUsd:number,
 *   latencyMs:number, promptChars?:number, skipped?:string}>}
 */
async function verifyKeys({
  questions, indices = null, language, grade = null, subject = null, digest = null, lessonSummary = null, quizId = null,
  withLesson = true, again = false,
}) {
  const qs = arr(questions);
  const idx = Array.isArray(indices) ? indices.filter((i) => Number.isInteger(i) && qs[i]) : qs.map((_, i) => i);
  if (!idx.length) return { verdicts: [], sameFact: [], model: null, costUsd: 0, latencyMs: 0, skipped: 'nothing_to_solve' };
  // Only a look at the WHOLE quiz can see one question asked twice.
  const askSameFact = withLesson && !Array.isArray(indices) && !again;
  // `again`: the same items in a DIFFERENT shown order — a second look that a
  // solver's slip between an option's position and its text cannot survive.
  const items = idx.map((i) => itemFor(qs[i], i, again ? `${quizId || ''}:again` : quizId));
  const prompt = buildVerifyPrompt({
    items, language, grade, subject, digest, lessonSummary, withLesson, askSameFact,
  });
  const label = withLesson ? LABEL : BARE_LABEL;
  const requested = verifyModel();
  // 8000 like the key check: a reasoning model spends its budget thinking, and a
  // truncated reply here is a failed solve, not a verdict.
  const {
    json, model, costUsd, latencyMs,
  } = await completeJson({
    prompt, maxTokens: 8000, label, model: requested, job: JOB,
  });
  const verdicts = parseAnswers(json, items);
  if (!withLesson) verdicts.forEach((v) => { v.pass = 'bare'; });
  return {
    verdicts,
    sameFact: askSameFact ? parseSameFact(json, items) : [],
    model: model || requested,
    costUsd: Number(costUsd) || 0,
    latencyMs,
    promptChars: cp(prompt),
  };
}

module.exports = {
  verifyKeys, buildVerifyPrompt, parseAnswers, parseSameFact, disagreementComplaint, itemFor, shownOrder, keyedIndices, optionText,
  verifyModel, FLAGGED, LABEL, BARE_LABEL, JOB, SAME_FACT_RULE,
};
