'use strict';
/**
 * Transcript quiz — pass 2, the AUTHOR.
 *
 * Writes N three-option questions from the digest plus the transcript
 * passages around each SLO's evidence. Every rule the prompt states is ALSO
 * enforced by transcript-quiz-validator.js; the prompt exists to make the
 * first attempt pass, the validator exists because it sometimes will not.
 *
 * On a retry the validator's complaints are appended, so the model fixes
 * what actually failed instead of re-rolling blind.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { LANG_NAME } = require('./transcript-quiz-language');
const { logEvent } = require('../../utils/structured-logger');

const DEFAULT_QUESTIONS = 8;

/** The opening, the passages around each SLO's evidence, and the close. */
function excerptsFor(transcript, digest, width = 1200) {
  const t = String(transcript || '');
  const parts = [t.slice(0, 1500)];
  (digest?.slos || []).slice(0, 6).forEach((s) => {
    const q = String(s.evidence_quote || '').slice(0, 60);
    const needle = q.slice(0, 30);
    const i = needle ? t.indexOf(needle) : -1;
    if (i >= 0) parts.push(t.slice(Math.max(0, i - width / 2), i + width / 2));
  });
  parts.push(t.slice(-1200));
  return parts.join('\n---\n');
}

function buildAuthorPrompt({ digest, excerpts, language, n = DEFAULT_QUESTIONS, gradeBand, previousErrors = null }) {
  const rule = language === 'ur'
    ? 'Write EVERYTHING in Urdu script; keep English technical terms in English letters exactly as the teacher used them.'
    : 'Write everything in English.';
  const retry = previousErrors && previousErrors.length
    ? `\n\nA PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one of them this time:\n- ${previousErrors.slice(0, 12).join('\n- ')}\n`
    : '';
  return `You are writing a short WhatsApp quiz for the children who sat in ONE real lesson. You have the lesson digest and excerpts of the transcript. The quiz is taken one question at a time on a phone: a stem, three tappable options, then feedback.

QUIZ LANGUAGE: ${LANG_NAME[language] || 'Urdu'}. ${rule}

WHAT TO WRITE — exactly ${n} questions.
- Cover EVERY SLO in the digest at least once (tag each question with the SLO's exact "id"). Spread the rest across the SLOs the lesson spent most time on.
- Match the level the teacher taught: at least 60% of questions at or below each SLO's "taught_level"; never more than one level above; never test something the lesson did not teach.
- Question 1 must be the easiest, so a nervous child gets one right first.
- Use the lesson's OWN examples, numbers, words, objects and stories (from "examples_used" and the excerpts). A child should recognise the class in the quiz.
- Exactly 3 options. One correct. The two wrong options are DISTRACTORS: each must look right to a child holding a specific, named misconception (the ones surfaced in the lesson first, then the classic ones for this topic). The two misconceptions must be different. No silly options. The three options must be different from each other.
- Stem ≤ 160 characters; each option ≤ 60 characters (they render as tappable rows).
- "explanation": one sentence, why the correct answer is correct — tied to how the teacher explained it.
- "option_feedback.correct": one warm sentence that says WHY it is right (never just "correct!" — name the idea).
- "option_feedback.wrong": an object whose KEYS are the two indices that are NOT "correct_index" (as strings), each with one or two sentences that (a) name the confusion that option represents, in plain child language, (b) point back to the lesson's own example, (c) end with the correct idea. Never say "wrong", never scold.
- NEVER refer to options by letter ("option B", "the answer is C") anywhere — the letters are shuffled before display.
- Tag every question with its "slo_id" and its "level".

STYLE RULES FOR URDU (when quiz language is Urdu): proper, well-written Urdu in Urdu script — never Roman Urdu; English technical/subject terms are written IN ENGLISH LETTERS inside the Urdu sentence (e.g. "proper fraction", "numerator", "denominator", "noun", "photosynthesis") — NEVER transliterated into Urdu script ("فیکشن", "نیومریٹر", "ڈینومینیٹر" are wrong even if the transcript spells them that way); use the SAME spelling of a term in every question; NEVER begin a question, explanation or feedback sentence with the English word — start with an Urdu word ("ایک fraction میں…", not "fraction میں…") because a sentence that opens with English is displayed left-to-right on the phone; simple, spoken, child-level Urdu; gender-neutral throughout: address the child as "آپ" with plural-respectful verbs (کریں، دیکھیں، سوچیں), NEVER a feminine or masculine singular guess (no "کرتی ہیں", "سکتی ہیں", "کریں گی", "کرتے ہو").
STYLE RULES FOR ENGLISH: short sentences a Grade ${gradeBand || '3-5'} child in Pakistan reads comfortably; no idioms.
RELIGIOUS CONTENT (Islamiyat / سیرت / any mention of the Prophet, companions, Qur'an): every mention of the Prophet carries ﷺ immediately after the name; companions carry رضی اللہ عنہ / عنہا; اللہ and all sacred names in Urdu/Arabic script only; NEVER invent or paraphrase a hadith or an ayah — quote only what the lesson quoted, and only with the reference the teacher gave; no question may ask a child to guess what the Prophet ﷺ "would say".${retry}

Return ONLY this JSON object:
{ "questions": [ { "slo_id": "S1", "level": "recall|understand|apply", "question": "", "options": ["", "", ""], "correct_index": 0,
    "explanation": "", "distractor_misconceptions": { "1": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } } } ] }
(In this example the correct option is index 0, so the wrong keys are "1" and "2". If correct_index is 1 the keys are "0" and "2"; if it is 2 the keys are "0" and "1".)

LESSON DIGEST:
${JSON.stringify(digest, null, 0)}

TRANSCRIPT EXCERPTS (the passages around each SLO's evidence, plus the opening and closing of the lesson):
${excerpts}`;
}

/**
 * @returns {Promise<{questions:object[], model:string, costUsd:number|null, latencyMs:number}>}
 */
async function author({ digest, transcript, language, n = DEFAULT_QUESTIONS, gradeBand = null, previousErrors = null, quizId = null }) {
  const excerpts = excerptsFor(transcript, digest);
  const prompt = buildAuthorPrompt({ digest, excerpts, language, n, gradeBand, previousErrors });
  const { json, model, costUsd, latencyMs } = await completeJson({ prompt, label: 'transcript_quiz.author' });
  const questions = Array.isArray(json?.questions) ? json.questions : [];
  logEvent('transcript_quiz.author_done', {
    quizId, model, costUsd, latencyMs, questions: questions.length, language, retry: Boolean(previousErrors),
  });
  return { questions, model, costUsd, latencyMs };
}

module.exports = { author, buildAuthorPrompt, excerptsFor, DEFAULT_QUESTIONS };
