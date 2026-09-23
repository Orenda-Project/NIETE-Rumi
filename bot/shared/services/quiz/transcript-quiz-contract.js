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
 * MATHS NOTATION (bd-mg9c7.159.19) — how an expression is written so the child
 * meets it typeset on a card, as the 6-12 lesson plans print it, instead of as
 * "2/9" in a line of text. Every language: the maths inside the dollars is the
 * same in an Urdu quiz, with Western digits, and the sentence around it is Urdu.
 *
 * Enforced deterministically by the validator's MATH_TEX checks (quiz-math.js
 * texFaults); stated here, inside the question contract, so the author prompt
 * and the targeted rewrite carry the one wording. The figure half is the same
 * split the LP authoring brief makes (its F5 rule): TeX in prose, plain Unicode
 * inside a diagram spec — the drawing engine converts TeX to Unicode and draws
 * its own stacked fractions, so TeX there prints as source.
 */
const MATH_NOTATION_RULE = 'MATHS NOTATION (every language). Write every mathematical expression in a stem or an option as inline TeX between single dollar signs, and it is typeset on the child\'s picture card exactly as a textbook prints it: a fraction $\\frac{2}{9}$, a mixed number $2\\frac{1}{3}$, a sum or product $3 \\times 4 = 12$, a division $12 \\div 3$, a power $5^2$, a comparison $\\frac{1}{2} > \\frac{1}{3}$, a unit $5\\,\\text{cm}$. '
  + 'Everything else stays plain text: a bare whole number is 12, never $12$; words stay OUTSIDE the dollars, and in an Urdu quiz the Urdu sentence is outside and only the maths, with digits 0-9, is inside; "$" is never money (write Rs); only single dollars — never $$…$$, \\( \\) or \\[ \\]; chemistry stays plain (H2O, CO2), never TeX. '
  + 'The explanation and the feedback may use the same $…$ for an expression; the phone shows it as plain text (2/9). '
  + 'In the JSON you return, every backslash is doubled, as JSON requires: "$\\\\frac{2}{9}$". '
  + 'NEVER TeX inside a "figure" spec: its labels are plain text ("3/4", "×"), because the drawing engine draws its own stacked fractions (a numberline with "labelFormat":"fraction").';

/**
 * THE CHILD HAS NO GENDER (Urdu) — stated inside the question contract, so the
 * author prompt and the targeted rewrite carry the one wording.
 *
 * About one production Urdu item in ten asked the child what they would do in
 * the masculine («کون سی علامت لگائیں گے؟», «آپ اسے حوصلہ کیسے دیں گے؟», feedback
 * opening «آپ سوچ رہے ہیں»). The old line asked for "plural-respectful verbs"
 * and a model reads «آپ کرتے ہیں» as exactly that — respectful, and masculine.
 * So the rule names the gendered forms of BOTH genders, and names the neutral
 * ones to write instead. The deterministic half is PEDAGOGY_GENDERED_CHILD
 * (transcript-quiz-address.js, wired in the validator).
 */
const CHILD_ADDRESS_RULE = 'THE CHILD HAS NO GENDER (Urdu): the class is boys and girls, so a verb that speaks TO the child — in the stem, the options, the explanation or the feedback — never carries a gender. '
  + 'Never «آپ … لگائیں گے» or «لگائیں گی», «آپ … جاتے ہیں» or «جاتی ہیں», «آپ … سوچ رہے ہیں» or «سوچ رہی ہیں», «آپ … کر سکتے ہیں» or «کر سکتی ہیں», and never «کون سی علامت لگائیں گے؟» with آپ left unsaid — the verb still guesses. '
  + 'Write instead: the آپ-imperative or subjunctive («بتائیں»، «چنیں»، «آپ کون سی علامت لگائیں؟»); the impersonal or obligative («کون سی علامت لگانی چاہیے؟»، «کون سا لفظ استعمال ہوگا؟»، «9 میں 7 جمع کیا جائے گا»); or آپ نے + a verb that agrees with its object («آپ نے کون سا لفظ چنا؟»). '
  + 'An option that answers "what would you do" is an infinitive or an imperative («آخر میں «یں» لگانا»), never «… لگائیں گے». Wrong-answer feedback opens «شاید آپ نے … سمجھا» or «یہ … کی الجھن ہے», never «آپ … سوچ رہے ہیں». '
  + 'Describing someone else is fine («بچے کھیل رہے ہیں»، «پودے خوراک بناتے ہیں»): the rule is about the child being spoken to.';

/**
 * COLUMN SUMS — a column addition or subtraction is ONE typeset expression, a
 * KaTeX array, so the card draws it the way the textbook sets it out: the
 * numbers right-aligned under each other, the operator in its own column, a
 * rule, and an empty answer row. Every text path flattens it to "452 − 137 = ?"
 * (quiz-math columnSumText); MATH_TEX names an array whose rows ran together.
 * Part of the question contract, so the author and the targeted rewrite carry
 * the one wording.
 */
const COLUMN_SUM_RULE = 'COLUMN SUMS. A column addition or subtraction — the way the textbook sets it out — is ONE expression in the stem: $\\begin{array}{rr} & 452 \\\\ - & 137 \\\\ \\hline & \\end{array}$. Each number is its own row, right-aligned so the places line up; the operator (+ or -) sits alone in the first column of the last number\'s row; \\hline draws the rule; the empty row after it is the answer space. Never write the answer in it. The stem\'s words stay outside the dollars ("Subtract:", «تفریق کریں:»). In the JSON you return, every backslash is doubled, so a row break is four: "$\\\\begin{array}{rr} & 452 \\\\\\\\ - & 137 \\\\\\\\ \\\\hline & \\\\end{array}$".';

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
- ${MATH_NOTATION_RULE}
- ${COLUMN_SUM_RULE}

STYLE RULES FOR URDU (when quiz language is Urdu): proper, well-written Urdu in Urdu script — never Roman Urdu; English technical/subject terms are written IN ENGLISH LETTERS inside the Urdu sentence (e.g. "proper fraction", "numerator", "denominator", "noun", "photosynthesis") — NEVER transliterated into Urdu script ("فیکشن", "نیومریٹر", "ڈینومینیٹر" are wrong even if the transcript spells them that way); use the SAME spelling of a term in every question; NEVER begin a question, explanation or feedback sentence with the English word — start with an Urdu word ("ایک fraction میں…", not "fraction میں…") because a sentence that opens with English is displayed left-to-right on the phone; simple, spoken, child-level Urdu.
${CHILD_ADDRESS_RULE}
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
 * THE LESSON SUMMARY OF A QUIZ WRITTEN FROM A LESSON PLAN — stated once, here,
 * and pasted into the author prompt and the targeted rewrite so the two cannot
 * drift.
 *
 * Nobody heard an lp_v8 lesson: the bot knows a PDF was delivered, nothing
 * about whether the class happened. The earlier rule asked for "you planned",
 * but the gender rule beside it offers «آپ نے … پڑھایا» as the neutral Urdu form
 * and the rewrite asked for "what you taught" outright; the live summary read
 * «آپ نے … سکھایا». Making the LESSON the subject ("Today's lesson plans …",
 * «آج کے سبق میں …») says what the plan covers, carries no gender, and leaves no
 * teacher-verb to put in the past tense.
 */
const LP_SUMMARY_VOICE = 'This lesson was PLANNED, not heard: the teacher took the plan and knows what '
  + 'actually happened in class, so the LESSON is the subject of every sentence, never the teacher. '
  + 'Say what today\'s lesson plans to teach and in the order the plan sets it out, naming the plan\'s '
  + 'own examples and numbers. Open with "Today\'s lesson plans …" in English and «آج کے سبق میں …» in '
  + 'Urdu. Never write "you taught", "you explained" or "you showed", and in Urdu never «آپ نے … پڑھایا»، '
  + '«آپ نے … سکھایا» or «آپ نے … بتایا» — each one says the lesson happened. For this field that '
  + 'overrides the «آپ نے … پڑھایا» form the gender rule allows.';

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
  languageRule, questionContract, retryNote, languageAgain, MATH_NOTATION_RULE, COLUMN_SUM_RULE,
  SELECTED_BECAUSE_RULE, RELIGIOUS_CONTENT_RULE, GENDER_NEUTRAL_RULE, LP_SUMMARY_VOICE, WRONG_SCRIPT_RE, DEFAULT_QUESTIONS,
};
