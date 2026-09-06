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
const { ALLOWED_TYPES, EARLY_YEARS_TYPES, CORE_TYPES, minimalSpecBlock } = require('./transcript-quiz-figure');
const { names: pictogramNames } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
const { MOLECULE_DICTIONARY } = require('./transcript-quiz-figure-science');
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
/** Grade 1-5 (and KG/prep, however the band is spelled). */
function isEarlyYears(gradeBand) {
  const g = String(gradeBand || '').toLowerCase();
  if (/\b(kg|k|prep|nursery|ecce|katchi)\b/.test(g)) return true;
  const nums = (g.match(/\d+/g) || []).map(Number);
  return nums.length > 0 && nums.every((n) => n <= 5);
}

/**
 * The block that opens the option space for a young class (round 5).
 *
 * The fifteen 6-12 types draw quantity, structure and process; before round 5 a
 * grade-1 phonics, spelling, counting, time or pattern lesson could reach none
 * of them, and the prompt told a language teacher to leave "figure" null. The
 * operator: "the computation of pictures can come in handy at any stage… an
 * image of a cat is shown and then c _ t is written in big alphabets and the
 * child has to pick what goes in the fill in the blank." The eight early-years
 * types are that stage. This block is shown ONLY for a grade 1-5 lesson: on a
 * grade 9 chemistry quiz it would be tokens spent teaching a model shapes it
 * must not use.
 */
function earlyYearsBlock(pictogramRoster) {
  return `
EARLY YEARS (this class is grade 1-5, so these types are open to you as well).
A picture is worth far more to a six-year-old than to a fifteen-year-old: a child who cannot yet read a long stem can still count apples, read a clock, or see which letter is missing. Reach for one of these whenever the lesson counted, sounded out, spelled, timed, compared, sorted or continued something.
- word_blank — phonics and spelling. A pictogram of the thing, and its word with a letter hidden. English: {"type":"word_blank","word":"cat","blanks":[1],"picto":"cat"} draws a cat and "c _ t"; the options are the letters. URDU: pass the whole word, {"type":"word_blank","word":"کتاب","blanks":[2],"picto":"book"} — it is drawn as separate letter tiles with an empty tile where the letter is missing, because Nastaliq joins and an underscore inside a word reshapes its neighbours.
- count_objects — counting and comparing. {"type":"count_objects","picto":"apple","count":7}; two rows to compare: {"rows":[{"picto":"apple","count":5,"label":"سیب"},{"picto":"banana","count":3,"label":"کیلے"}]}; equal groups for sharing/multiplying: {"picto":"star","count":12,"group":4}.
- count_frame — a ten-frame ({"type":"count_frame","count":7}) or tally marks ({"model":"tally","count":12}).
- clock — telling the time. {"type":"clock","time":"3:30"}. The hands are geared correctly and the time is never printed.
- pattern — what comes next. {"type":"pattern","items":["circle","square","circle","square","?"]}, or numerals ({"text":"2"} …), or pictograms ({"picto":"sun"}). Exactly one "?".
- match — the child picks the pair. {"type":"match","left":[{"picto":"cat"},{"picto":"dog"}],"right":[{"text":"dog"},{"text":"cat"}]} draws A/B down one side and 1/2 down the other and JOINS NOTHING; your three options are the candidate pairings ("A-2", "A-1", "B-2").
- money — coins and notes. {"type":"money","currency":"Rs","items":[{"value":10,"kind":"coin"},{"value":5,"kind":"coin","count":2}]}. Each piece shows its own value, so never ask which piece is worth what — ask for the total, the number of pieces, or the swap.
- compare_size — longer/shorter, taller/shorter, heavier/lighter. {"type":"compare_size","model":"length","items":[{"label":"سرخ ربن","size":5},{"label":"ہرا ربن","size":8}]}, "height" for vertical bars, or {"model":"balance","left":{"picto":"apple","count":3},"right":{"picto":"apple","count":1}}. "size" is relative and is never printed.
PICTOGRAM NAMES — a picture of a thing comes from this fixed set and NOTHING ELSE. A name that is not on this list fails the question:
${pictogramRoster}
Reuse the older types for a young class too: numberline for before/after and ordering, fraction_bar and grid for part-whole, geometry for naming a shape, flow or timeline for a sequence of steps.
`;
}

function figureContract({ subject, gradeBand } = {}) {
  const drawable = ['maths', 'science', 'genk', 'other'].includes(String(subject || '').toLowerCase());
  const early = isEarlyYears(gradeBand);
  // A grade 1-5 lesson in ANY subject can now be drawn — the early-years types
  // are exactly the ones a language or general-knowledge lesson needs, and the
  // K-5 coverage count says so: `match` serves 360 of the corpus's segments and
  // `word_blank` 257, and both of those live in English and Urdu periods, not
  // in maths (the option-space study).
  // A grade 9 quiz is never shown the ten-frame; a grade 1 quiz is shown both
  // halves, because a young class still counts on a number line and shades a
  // grid.
  const offered = early ? ALLOWED_TYPES : CORE_TYPES;
  const requirement = drawable || early
    ? `THIS LESSON IS DRAWABLE (${subject || 'language'}${early ? ', grade 1-5' : ''}). Write at least ONE picture question — two or three when the lesson has ${early ? 'counting, letters or sounds, spelling, the clock, money, a pattern, a sorting or matching activity, shapes, ' : ''}fractions, a number line, shapes, measurement, a graph, a circuit, a sequence of steps, parts of a cell, atoms or an equation. Build the question AROUND the picture: decide the drawing first, then ask what it shows. Zero pictures is acceptable only when nothing in the lesson can be drawn with the allowed types.`
    : `This subject (${subject || 'language'}) rarely needs a picture; leave "figure" null unless the lesson genuinely asks the child to read something off a drawing.`;
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
- EARN THE FIGURE: the stem must not state the numbers the picture shows. "A bar has 4 parts and 1 is shaded — which fraction?" needs no picture; "تصویر میں کتنا حصہ رنگا ہوا ہے؟" does. The child must READ the picture to answer.
- geometry is for MATHEMATICS lessons only, and its kinds are exactly: triangle, polygon, circle (keys c, r), angle/rightangle (vertex, a, b), line/segment (from, to), point (at) — there is no "text", "rectangle" or "arrow" kind; a shape with the wrong keys vanishes.
- Column arithmetic, long division, a written sum: NO picture — write it in the stem with digits.
- A figure must be able to PRODUCE the answer: if the answer is 4 (12 shared into 3), the drawing shows 12 things in 3 equal groups, not 9 cells with 3 shaded. A science process is a flow; a sequence in time is a timeline; a comparison of amounts is a fraction_bar or a grid.
- Colours: use only the tokens named in the minimal specs; never invent one (var(--sand), var(--brown) do not exist and render as nothing).
- SCIENCE MUST BE TRUE. A drawing is checked against the world, not only against the engine: a chem_equation must BALANCE (set "balanced": false only when the question is asking the child to balance it); an atom's element must be one the engine knows (H to Ca, plus Fe, Cu, Zn, Br, I) or carry an explicit "Z" and "shells", because an unknown symbol is drawn as a different element wearing that label; a cell may only label parts the chosen kind has (an animal cell has no wall, no chloroplast, no large vacuole).
- A dot-and-cross bonding picture ("mode":"dot_cross") takes a "partner" OBJECT ({"element":"Cl"}) and a NUMERIC "transfer" — a string for either is silently dropped and the engine draws a different element, or a charge nobody chose. It is for MAIN-GROUP elements only: never Fe, Cu or Zn, whose shells in the engine are a simplification their real ion charge does not follow from. In an ionic pair the transfer is the donor's outer electrons AND what the acceptor needs to reach eight — the same number both ways (Na to Cl is 1; Mg to O is 2).
- molecule draws only these formulas, and you write ONLY the "formula" — the structure is filled in from a fixed table, never from a SMILES you write: ${Object.keys(MOLECULE_DICTIONARY).join(', ')}.

WORKED EXAMPLES (spec next to the question it serves):
1. fraction_bar, read_off — stem "تصویر میں روٹی کا کتنا حصہ رنگا ہوا ہے؟", options ["3/4", "1/4", "4/3"], correct 0,
   "figure": {"type":"fraction_bar","bars":[{"parts":4,"shaded":3}]}   (no label on the bar — the label would be the answer)
2. numberline, read_off — stem "Which point is at −3?", options ["A", "B", "C"], correct 0,
   "figure": {"type":"numberline","from":-5,"to":5,"step":1,"points":[{"at":-3,"label":"A"},{"at":1,"label":"B"},{"at":4,"label":"C"}]}
3. grid, count_compare — stem "تصویر میں کتنے خانے رنگے ہوئے ہیں؟", options ["12", "8", "20"], correct 0,
   "figure": {"type":"grid","rows":4,"cols":5,"shaded":12}

${early ? earlyYearsBlock(pictogramNames().join(', ')) : ''}
ALLOWED TYPES — nothing else is accepted (${offered.join(', ')}):
${minimalSpecBlock(offered)}`;
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
    : 'Write EVERYTHING in English — every stem, option, explanation and feedback — even though the lesson was taught in Urdu: translate the teacher\'s own words and keep her examples, numbers and names. An Urdu word may appear only when quoting a term the class used, in quotation marks.';
  const retry = previousErrors && previousErrors.length
    ? `\n\nA PREVIOUS ATTEMPT FAILED THESE CHECKS — fix every one of them this time (q0 is your FIRST question, q1 the second, and so on):\n- ${previousErrors.slice(0, 12).join('\n- ')}\n`
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
- "distractor_misconceptions": for each wrong option, the confusion it catches in AT MOST 10 words, as a phrase ("counts the unshaded parts instead of the shaded"), not a sentence about the child — in the quiz language (the same language as the questions; Urdu in Urdu script with English technical terms in Latin letters).
- "explanation": one sentence, why the correct answer is correct — tied to how the teacher explained it.
- "option_feedback.correct": one warm sentence that says WHY it is right (never just "correct!" — name the idea).
- "option_feedback.wrong": an object whose KEYS are the two indices that are NOT "correct_index" (as strings), each with one or two sentences that (a) name the confusion that option represents, in plain child language, (b) point back to the lesson's own example, (c) end with the correct idea. Never say "wrong", never scold.
- NEVER refer to options by letter ("option B", "the answer is C") anywhere — the letters are shuffled before display.
- NEVER ask about classroom logistics — which atom "your group" was asked to draw, who was called to the board, which page, what homework was set. Every question is about the CONTENT taught, answerable by any child who sat in the lesson.
- Tag every question with its "slo_id" and its "level".

STYLE RULES FOR URDU (when quiz language is Urdu): proper, well-written Urdu in Urdu script — never Roman Urdu; English technical/subject terms are written IN ENGLISH LETTERS inside the Urdu sentence (e.g. "proper fraction", "numerator", "denominator", "noun", "photosynthesis") — NEVER transliterated into Urdu script ("فیکشن", "نیومریٹر", "ڈینومینیٹر" are wrong even if the transcript spells them that way); use the SAME spelling of a term in every question; NEVER begin a question, explanation or feedback sentence with the English word — start with an Urdu word ("ایک fraction میں…", not "fraction میں…") because a sentence that opens with English is displayed left-to-right on the phone; simple, spoken, child-level Urdu; gender-neutral throughout: address the child as "آپ" with plural-respectful verbs (کریں، دیکھیں، سوچیں), NEVER a feminine or masculine singular guess (no "کرتی ہیں", "سکتی ہیں", "کریں گی", "کرتے ہو").
STYLE RULES FOR ENGLISH: short sentences a Grade ${gradeBand || '3-5'} child in Pakistan reads comfortably; no idioms.

LESSON SUMMARY. Also return a top-level "lesson_summary": 2-3 sentences, in the quiz language (follow the same Urdu/English style rules above), written TO THE TEACHER (not the child), saying what she taught and in the order she taught it, naming her own examples and numbers from the lesson. Do not summarise the quiz — summarise the LESSON.

SELECTED BECAUSE. Every question also carries a "selected_because": at most 15 words, naming the specific moment in the lesson this question was chosen from (e.g. "she counted 26 to 30 aloud with the class", "the fraction of the roti she drew on the board"). This is WHY the question was picked from the transcript, not why the answer is correct — never restate the answer and never repeat "explanation". Write selected_because in the quiz language (the same language as the questions), never in English on an Urdu quiz.
RELIGIOUS CONTENT (Islamiyat / سیرت / any mention of the Prophet, companions, Qur'an): every mention of the Prophet carries ﷺ immediately after the name; companions carry رضی اللہ عنہ / عنہا; اللہ and all sacred names in Urdu/Arabic script only; NEVER invent or paraphrase a hadith or an ayah — quote only what the lesson quoted, and only with the reference the teacher gave; no question may ask a child to guess what the Prophet ﷺ "would say".

${figureContract({ subject: digest && digest.subject, gradeBand })}${retry}

Return ONLY this JSON object:
{ "lesson_summary": "",
  "questions": [
  { "slo_id": "S1", "level": "recall|understand|apply", "question": "", "options": ["", "", ""], "correct_index": 0,
    "explanation": "", "selected_because": "", "distractor_misconceptions": { "1": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } },
    "figure": null, "figure_role": null },
  { "slo_id": "S2", "level": "understand", "question": "…تصویر میں…", "options": ["", "", ""], "correct_index": 1,
    "explanation": "", "selected_because": "", "distractor_misconceptions": { "0": "", "2": "" },
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
  const lessonSummary = typeof json?.lesson_summary === 'string' ? json.lesson_summary : '';
  logEvent('transcript_quiz.author_done', {
    quizId, model, costUsd, latencyMs, questions: questions.length, language, retry: Boolean(previousErrors),
    lessonSummary: Boolean(lessonSummary),
  });
  return {
    questions, model, costUsd, latencyMs, lessonSummary,
  };
}

module.exports = { author, buildAuthorPrompt, excerptsFor, DEFAULT_QUESTIONS };
