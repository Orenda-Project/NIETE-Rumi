'use strict';
/**
 * Transcript quiz — the PROMPT CONTRACT shared by the author and the targeted
 * rewrite.
 *
 * These three pieces of prompt text are used by more than one caller, and a
 * caller writing its own copy is how a rewrite ends up asking for a shape the
 * validator rejects. They live in their own module rather than in
 * transcript-quiz-author.service.js for a second reason found the hard way:
 * several suites mock the author service wholesale, so a helper exported from
 * it is `undefined` inside any other module that required it — a green suite
 * and a runtime TypeError in production.
 */

const { LANG_NAME } = require('./transcript-quiz-language');

const DEFAULT_QUESTIONS = 8;

/**
 * The QUIZ LANGUAGE rule, one sentence, stated wherever the model is asked to
 * write. Shared with the targeted rewrite (transcript-quiz-rewrite.js): a live
 * quiz once came back with all eight questions in the wrong script because the
 * rule was stated once at the top and the retry note was appended at the very
 * end, after the whole figure contract.
 */
function languageRule(language) {
  return language === 'ur'
    ? 'Write EVERYTHING in Urdu script; keep English technical terms in English letters exactly as the teacher used them.'
    : 'Write EVERYTHING in English — every stem, option, explanation and feedback — even though the lesson was taught in Urdu: translate the teacher\'s own words and keep the lesson\'s own examples, numbers and names. An Urdu word may appear only when quoting a term the class used, in quotation marks.';
}

/**
 * WHAT ONE QUESTION MUST CONTAIN — shared verbatim by the author prompt and by
 * the targeted rewrite, so the two cannot drift about the shape of a question
 * the validator will accept. Changing a rule here changes it in both.
 */
function questionContract({ gradeBand } = {}) {
  return `- Exactly 3 options. One correct. The two wrong options are DISTRACTORS: each must look right to a child holding a specific, named misconception (the ones surfaced in the lesson first, then the classic ones for this topic). The two misconceptions must be different. No silly options. The three options must be different from each other.
- Stem ≤ 160 characters; each option ≤ 60 characters (they render as tappable rows).
- "distractor_misconceptions": for each wrong option, the confusion it catches in AT MOST 10 words, as a phrase ("counts the unshaded parts instead of the shaded"), not a sentence about the child — in the quiz language (the same language as the questions; Urdu in Urdu script with English technical terms in Latin letters).
- "explanation": one sentence, why the correct answer is correct — tied to how the teacher explained it.
- "option_feedback.correct": one warm sentence that says WHY it is right (never just "correct!" — name the idea).
- "option_feedback.wrong": an object whose KEYS are the two indices that are NOT "correct_index" (as strings), each with one or two sentences that (a) name the confusion that option represents, in plain child language, (b) point back to the lesson's own example, (c) end with the correct idea. Never say "wrong", never scold.
- NEVER refer to options by letter ("option B", "the answer is C") anywhere — the letters are shuffled before display.
- Tag every question with its "slo_id" and its "level".

STYLE RULES FOR URDU (when quiz language is Urdu): proper, well-written Urdu in Urdu script — never Roman Urdu; English technical/subject terms are written IN ENGLISH LETTERS inside the Urdu sentence (e.g. "proper fraction", "numerator", "denominator", "noun", "photosynthesis") — NEVER transliterated into Urdu script ("فیکشن", "نیومریٹر", "ڈینومینیٹر" are wrong even if the transcript spells them that way); use the SAME spelling of a term in every question; NEVER begin a question, explanation or feedback sentence with the English word — start with an Urdu word ("ایک fraction میں…", not "fraction میں…") because a sentence that opens with English is displayed left-to-right on the phone; simple, spoken, child-level Urdu; gender-neutral throughout: address the child as "آپ" with plural-respectful verbs (کریں، دیکھیں، سوچیں), NEVER a feminine or masculine singular guess (no "کرتی ہیں", "سکتی ہیں", "کریں گی", "کرتے ہو").
STYLE RULES FOR ENGLISH: short sentences a Grade ${gradeBand || '3-5'} child in Pakistan reads comfortably; no idioms.`;
}

/**
 * THE TEACHER HAS NO GENDER — stated once, here, and pasted verbatim into the
 * author prompt and the targeted rewrite so the two cannot drift.
 *
 * `users` has no gender column and nothing in the pipeline infers one, so a
 * gendered reference to the teacher is a coin toss printed on that teacher's
 * own document. The operator read one on the round-5 pre-send PDF ("She then
 * introduced the new topic…") and asked for it nowhere (PLAN_R6 D5). The rule
 * NAMES the banned words on purpose: a prompt that says "be gender-neutral"
 * without them was already in the digest prompt, and the model wrote "her
 * document" all the same. The deterministic half is
 * PEDAGOGY_GENDERED_TEACHER in transcript-quiz-pedagogy.js.
 */
const GENDER_NEUTRAL_RULE = 'THE TEACHER HAS NO GENDER. Never refer to the teacher with '
  + '"she", "he", "her", "his", "him", "herself" or "himself" in ANY field. The teacher is '
  + '"you" in "lesson_summary" — that field is written TO the teacher — and "the teacher" '
  + 'everywhere else. In Urdu: no gendered word for the teacher (never استانی، معلمہ، '
  + 'استاد صاحبہ، میڈم، مِس، باجی) and no gendered verb form about the teacher (never '
  + '«پڑھاتی ہیں» / «پڑھاتے ہیں»، «پڑھائیں گی» / «پڑھائیں گے») — use an imperative, an '
  + 'impersonal reframe, or «آپ نے … پڑھایا», where the verb agrees with the object and '
  + 'says nothing about the teacher. Naming the class, the children, a child by name or the '
  + 'lesson\'s own examples is always fine; a pronoun for the teacher never is.';

/**
 * THE RETRY NOTE. Two things it does beyond quoting the validator:
 *
 *  1. it RESTATES THE QUIZ LANGUAGE FIRST. The rule is stated once at the top
 *     of a prompt that then runs through the whole figure contract; the note
 *     used to be appended after all of it, and a live English quiz came back
 *     from the retry with all eight questions in Urdu after failing attempt 1
 *     on a single unrelated complaint.
 *  2. it NAMES an all-wrong-script attempt as what it is. Eight identical
 *     per-question script complaints read as eight separate faults; one
 *     sentence saying the whole reply was in the wrong script is what the model
 *     can act on, and the per-question list is still printed under it.
 */
const WRONG_SCRIPT_RE = /(must be written in English — the stem and options are mostly not Latin script|^urdu script ratio )/;

/**
 * THE QUIZ LANGUAGE, SAID AGAIN, in the tail of the prompt — on EVERY attempt.
 *
 * Found on production 2026-09-07: four of four real quizzes that morning had
 * attempt 1 rejected on a language fault and none of the four retries did.
 * English quizzes on Urdu-taught lessons came back with all eight stems in
 * Urdu script; the Urdu quiz came back with its teacher-facing fields in
 * English. The only difference between the two prompts was that the retry
 * restated the rule here, after the contracts. One teacher lost a quiz to it:
 * the language fault ate attempt 1, and the single remaining attempt tripped
 * the level gate.
 *
 * `retryNote` already opens with this line, so the author prompt emits this
 * block only when there is no retry note — attempt 2's prompt stays byte for
 * byte what production has proven.
 */
function languageAgain(language) {
  const name = LANG_NAME[language] || 'Urdu';
  return `\n\nQUIZ LANGUAGE, AGAIN: ${name}. ${languageRule(language)}\nThis holds for EVERY field you return — stem, options, explanation, option_feedback, "selected_because" and "distractor_misconceptions" — including the fields written for the teacher rather than the child. The lesson was recorded in whatever language the class was taught in; the quiz is written in ${name} regardless.\n`;
}

function retryNote(previousErrors, language, n = DEFAULT_QUESTIONS) {
  const errs = Array.isArray(previousErrors) ? previousErrors.filter(Boolean) : [];
  if (!errs.length) return '';
  const name = LANG_NAME[language] || 'Urdu';
  const wrongScript = errs.filter((e) => WRONG_SCRIPT_RE.test(String(e)));
  const allWrongScript = wrongScript.length >= Math.max(2, Math.ceil((n || DEFAULT_QUESTIONS) / 2));
  const named = allWrongScript
    ? `\nTHE WHOLE PREVIOUS ATTEMPT CAME BACK IN THE WRONG SCRIPT — it was not written in ${name} at all. That is one fault, not ${wrongScript.length}: write this quiz in ${name}, every stem, option, explanation and feedback.\n`
    : '';
  return `\n\nQUIZ LANGUAGE, AGAIN: ${name}. ${languageRule(language)}\n${named}\nA PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one of them this time (q0 is your FIRST question, q1 the second, and so on):\n- ${errs.slice(0, 16).join('\n- ')}\n`;
}

/**
 * The two rules that live OUTSIDE the per-question contract in the author
 * prompt but are enforced by the validator all the same: a missing or English
 * `selected_because` is Q_MISSING_WHY / URDU_TEACHER_FIELDS, and an unmarked
 * sacred name fails the whole quiz on an Islamiyat or Urdu lesson. Held as
 * strings, at the author prompt's own wording, so the targeted rewrite can
 * state them without the author prompt moving a single character.
 */
const SELECTED_BECAUSE_RULE = "SELECTED BECAUSE. Every question also carries a \"selected_because\": at most 15 words, naming the specific moment in the lesson this question was chosen from (e.g. \"the class counted 26 to 30 aloud\", \"the fraction of the roti drawn on the board\"). This is WHY the question was picked from the transcript, not why the answer is correct — never restate the answer and never repeat \"explanation\". Write selected_because in the quiz language (the same language as the questions), never in English on an Urdu quiz.";
const RELIGIOUS_CONTENT_RULE = "RELIGIOUS CONTENT (Islamiyat / سیرت / any mention of the Prophet, companions, Qur'an): every mention of the Prophet carries ﷺ immediately after the name; companions carry رضی اللہ عنہ / عنہا; اللہ and all sacred names in Urdu/Arabic script only; NEVER invent or paraphrase a hadith or an ayah — quote only what the lesson quoted, and only with the reference the teacher gave; no question may ask a child to guess what the Prophet ﷺ \"would say\".";

module.exports = {
  languageRule, questionContract, retryNote, languageAgain,
  SELECTED_BECAUSE_RULE, RELIGIOUS_CONTENT_RULE, GENDER_NEUTRAL_RULE, WRONG_SCRIPT_RE, DEFAULT_QUESTIONS,
};
