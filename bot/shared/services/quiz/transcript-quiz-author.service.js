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
const { ALLOWED_TYPES, minimalSpecBlock } = require('./transcript-quiz-figure');
const { logEvent } = require('../../utils/structured-logger');

const DEFAULT_QUESTIONS = 8;

/**
 * The FIGURE contract.
 *
 * A figure is a diagram SPEC, not a picture: the model picks a type from the
 * allowlist and fills its numbers, and a deterministic engine draws it. The
 * allowlist and every minimal spec below are GENERATED from the engine's own
 * manifest at require time — a hand-copied list drifts the day a type changes
 * its required fields, and the model is then taught a shape the validator
 * rejects on every attempt.
 *
 * Every rule here is also enforced deterministically in
 * transcript-quiz-validator.js. The prompt exists to make attempt 1 pass.
 */
function figureContract({ subject, gradeBand } = {}) {
  const drawable = ['maths', 'science', 'genk', 'other'].includes(String(subject || '').toLowerCase());
  const young = /^(1|2|3)/.test(String(gradeBand || ''));
  const requirement = drawable
    ? `THIS LESSON IS DRAWABLE (${subject}). Write at least ONE picture question — two or three when the lesson has fractions, a number line, shapes, measurement, a graph, a circuit, counting, a sequence of steps, parts of a cell, atoms or an equation. Build the question AROUND the picture: decide the drawing first, then ask what it shows. Zero pictures is acceptable only when nothing in the lesson can be drawn with the allowed types.`
    : `This subject (${subject || 'language'}) rarely needs a picture; ${young ? 'for a young class a counting or comparing picture is welcome when the lesson counted real objects, otherwise ' : ''}leave "figure" null.`;
  return `PICTURE QUESTIONS.
A question may carry a "figure": a diagram SPEC that a deterministic drawing engine renders into the picture the child sees ABOVE the stem, with the options under it. You are choosing a shape and its numbers, not describing an image.

${requirement}

WHEN a figure is right:
  (a) the child must READ something off the picture to answer: a position, a shaded part, a shape, a plotted point, a circuit, a sequence of steps. Use "figure_role": "read_off".
  (b) the class is grade 1–5 and the question asks the child to count or compare objects. Use "figure_role": "count_compare".
WHEN a figure is wrong: a definition, recall of a word or term, or decoration. If the question can be answered without looking at the picture, there is no figure.

HARD RULES
- The figure must NOT contain the answer. No option's text may appear in the picture — UNLESS every option's appears (a "which point is at −3? A / B / C" number line is fine, because naming all three gives nothing away). Do not write the fraction, the total, the percentage or the result anywhere in the spec (no "title" or "caption" that states it).
- At most half of the questions may carry a figure.
- Labels are written in the quiz language; numerals, units, formulae and chemical species stay in English letters and read left-to-right (LTR) even in an Urdu figure.
- A stem that promises a picture must carry one. If the stem says "in the picture" or "تصویر میں", the question needs a "figure".
- Use the SIMPLEST spec that answers the question. Long labels and crowded scales collide and the whole question is thrown away.
- The engine draws MATHEMATICS AND SCIENCE, never pictures of things: never draw a scene, an object, an animal, a person or a place with geometry shapes (a "farm" of rectangles and circles renders as a blank). If the question needs a photo of a real thing, there is no figure.
- A jump arc must not land on the answer: "3 + 4 = ?" with an arc from 3 to 7 shows the child the 7. Draw the dot at 3 and ask where a jump of 4 lands, with no arc — or draw the arc and ask how long the jump was.
- Colours: use only the tokens named in the minimal specs; never invent one (var(--sand), var(--brown) do not exist and render as nothing).

WORKED EXAMPLES (spec next to the question it serves):
1. fraction_bar, read_off — stem "تصویر میں روٹی کا کتنا حصہ رنگا ہوا ہے؟", options ["3/4", "1/4", "4/3"], correct 0,
   "figure": {"type":"fraction_bar","bars":[{"parts":4,"shaded":3}]}   (no label on the bar — the label would be the answer)
2. numberline, read_off — stem "Which point is at −3?", options ["A", "B", "C"], correct 0,
   "figure": {"type":"numberline","from":-5,"to":5,"step":1,"points":[{"at":-3,"label":"A"},{"at":1,"label":"B"},{"at":4,"label":"C"}]}
3. grid, count_compare — stem "تصویر میں کتنے خانے رنگے ہوئے ہیں؟", options ["12", "8", "20"], correct 0,
   "figure": {"type":"grid","rows":4,"cols":5,"shaded":12}

ALLOWED TYPES — nothing else is accepted (${ALLOWED_TYPES.join(', ')}):
${minimalSpecBlock()}`;
}

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
RELIGIOUS CONTENT (Islamiyat / سیرت / any mention of the Prophet, companions, Qur'an): every mention of the Prophet carries ﷺ immediately after the name; companions carry رضی اللہ عنہ / عنہا; اللہ and all sacred names in Urdu/Arabic script only; NEVER invent or paraphrase a hadith or an ayah — quote only what the lesson quoted, and only with the reference the teacher gave; no question may ask a child to guess what the Prophet ﷺ "would say".

${figureContract({ subject: digest && digest.subject, gradeBand })}${retry}

Return ONLY this JSON object:
{ "questions": [
  { "slo_id": "S1", "level": "recall|understand|apply", "question": "", "options": ["", "", ""], "correct_index": 0,
    "explanation": "", "distractor_misconceptions": { "1": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } },
    "figure": null, "figure_role": null },
  { "slo_id": "S2", "level": "understand", "question": "…تصویر میں…", "options": ["", "", ""], "correct_index": 1,
    "explanation": "", "distractor_misconceptions": { "0": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "0": "", "2": "" } },
    "figure": { "type": "fraction_bar", "bars": [ { "parts": 4, "shaded": 3 } ] }, "figure_role": "read_off" } ] }
(In this example the correct option is index 0, so the wrong keys are "1" and "2". If correct_index is 1 the keys are "0" and "2"; if it is 2 the keys are "0" and "1".)
Omit "figure" and "figure_role", or leave them null, on every question that does not need a picture. When a question does carry one, "figure" is a spec object of the form shown in ALLOWED TYPES — e.g. "figure": {"type":"fraction_bar","bars":[{"parts":4,"shaded":3}]}, "figure_role": "read_off".

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
