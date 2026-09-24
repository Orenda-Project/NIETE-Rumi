'use strict';
/**
 * Transcript quiz — the TARGETED REWRITE, between the last full attempt and
 * the salvage.
 *
 * WHY THIS EXISTS. Two live generations shipped 7 and 6 questions of 8 on the
 * same afternoon. In both, the last attempt was rejected on ONE or TWO
 * questions, the full re-roll had already written the same rejected question a
 * second time, and the last-attempt salvage then dropped it. The rules were
 * right; the recovery was wrong. A full re-roll asks the model to write eight
 * questions again and it re-runs the same habit on question 1; dropping the
 * question ships a short quiz.
 *
 * WHAT IT DOES INSTEAD. When every remaining complaint belongs to a single
 * question (a `q<i>: PEDAGOGY_…` or `q<i>: FIGURE_…` code) and at most three
 * questions are involved, ONE small call carries only those questions, their
 * complaints verbatim, the SLOs, the stems that are staying, and the quiz's
 * language rule stated first — and asks for a replacement per question at the
 * same slo_id and level. The merged set goes back through the full validator;
 * the salvage runs only if that also fails, and it runs on the MERGED set, so a
 * rewrite that repaired one of two rejections still ships one more question
 * than it would have.
 *
 * TWO CONTRACTS ASSERTED IN CODE, not left to the prompt (root rule 24c):
 *   - a replacement that carries a "figure" is DISCARDED and its original is
 *     kept. The picture rules are what several of these questions failed, a
 *     replacement gets no second attempt at drawing, and silently stripping a
 *     figure the model did draw would leave a stem like "which shape is this?"
 *     pointing at nothing.
 *   - a replacement keeps its question's slo_id and level unless it names its
 *     own, so SLO coverage and the level mix cannot be broken by the repair.
 *
 * ROUND 6 ADDED ONE QUIZ-LEVEL FIELD: `lesson_summary`. It is the field the
 * operator caught a gendered "She" on, and it is the only quiz-level complaint
 * a single small call can answer — the summary is one paragraph, written from
 * the digest, and rewriting it changes no question. So a
 * `PEDAGOGY_GENDERED_TEACHER` complaint with no `q<i>:` prefix is a repair
 * target of its own (`targets.summary`), and may arrive alone or beside up to
 * three question complaints. Every other quiz-level complaint still
 * disqualifies the whole set: FIGURE_SHARE, PEDAGOGY_LEVEL_MIX and "SLOs
 * uncovered" are properties of the SET and no small call can be shown to fix
 * them.
 *
 * Pure except for the one LLM call: no DB, no WhatsApp, no R2.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { LANG_NAME, sloStatement } = require('./transcript-quiz-language');
const {
  languageRule, languageAgain, questionContract, SELECTED_BECAUSE_RULE, RELIGIOUS_CONTENT_RULE,
  GENDER_NEUTRAL_RULE, LP_SUMMARY_VOICE,
} = require('./transcript-quiz-contract');

/** At most this many questions may be repaired; more than that is a re-roll. */
// Five, not three, since 2026-09-07: a production quiz died on FOUR length faults
// that one small call would have fixed. Six or more is most of the set — a re-roll.
const MAX_TARGETS = 5;

/**
 * A complaint one replacement question can answer: it names its question and it
 * is about that question's pedagogy, its picture, or its religious marks
 * (bd-mg9c7.95 — a name written without its honorific is one question's text to
 * rewrite; RELIGIOUS_CONTENT_RULE is already restated in the prompt below).
 *
 * Deliberately NOT droppable-and-quiz-level: `FIGURE_SHARE`, `PEDAGOGY_LEVEL_MIX`,
 * `SLOs uncovered` and the script-ratio complaints are properties of the SET, and
 * rewriting three questions in isolation cannot be shown to fix them. A structural
 * complaint (`q0: 2 options`) is excluded for a different reason: it means the
 * reply itself was malformed, which is a re-roll, not a repair.
 */
const PER_QUESTION = /^q(\d+):\s*(PEDAGOGY_[A-Z_]+|FIGURE_[A-Z_]+|RELIGIOUS_[A-Z_]+)\b/;

/**
 * ANY complaint that names one question is one question's text to rewrite —
 * whatever its code.
 *
 * This was an ALLOW-LIST of codes, and the allow-list was the bug. It cost a
 * teacher a quiz three times in one morning (2026-09-07): a multi-select fault
 * was not on it, then an over-long STEM was not on it, while an over-long
 * OPTION was. Each time the list was extended by one code and the next
 * un-listed code cost the next teacher. The rule is now the shape of the
 * complaint, not its vocabulary: `q<i>: …` names a question, so one small
 * rewrite can answer it, and `MAX_TARGETS` — not the code — is what separates a
 * repair from a re-roll. A reply that is broadly malformed complains about more
 * than five questions and falls back to a full attempt on its own; and every
 * rewritten set goes through the whole validator again, so a bad repair cannot
 * ship.
 */
const PER_QUESTION_STRUCTURAL = /^q(\d+):\s*\S/;
/**
 * A question rejected for PEDAGOGY_GENDERED_CHILD is a GOOD question with a
 * verb that guesses the child's gender. Re-asking it would throw the question
 * away over one verb, so this is a repair IN PLACE: the same question, the same
 * options' meanings, the same answer, and only the verbs change. The neutral
 * forms themselves are the contract's rule (questionContract, above in the
 * prompt); this adds what is specific to a repair.
 *
 * It used to recommend «سمجھ سکتے ہیں» — itself masculine.
 */
const CHILD_ADDRESS_REPAIR = 'THE CHILD HAS NO GENDER — REPAIR IN PLACE. A question rejected for PEDAGOGY_GENDERED_CHILD is a good question whose verbs guess whether the child is a boy or a girl. Keep the SAME question: the same idea, the same three options in meaning, the same correct answer, the same explanation and feedback in meaning. Change ONLY the gendered verbs, in every field its complaint names — «کون سی علامت لگائیں گے؟» → «کون سی علامت لگانی چاہیے؟»; «آپ اسے حوصلہ کیسے دیں گے؟» → «آپ اسے حوصلہ کیسے دیں؟»; the option «آخر میں «یں» لگائیں گے» → «آخر میں «یں» لگانا»; the feedback «آپ سوچ رہے ہیں کہ …» → «شاید آپ نے سمجھا کہ …». No masculine and no feminine form for the child, anywhere.';
/**
 * A question rejected for URDU_ADJACENT_TERMS is a GOOD question whose words
 * are in an order the phone reads backwards: two separate English terms side
 * by side are one left-to-right run in a right-to-left line. Re-asking it would
 * throw a sound question away over word order, so this is a repair IN PLACE,
 * like the child's gender: the same question, the same answer, only those
 * words moved apart.
 */
const ADJACENT_TERMS_REPAIR = 'TWO ENGLISH TERMS SIDE BY SIDE — REPAIR IN PLACE. A question rejected for URDU_ADJACENT_TERMS is a good question in which two SEPARATE English terms sit next to each other in an Urdu sentence; the phone shows them as one left-to-right phrase, so a child reading right to left meets the second term first and reads the meaning backwards. Keep the SAME question: the same idea, the same options in meaning, the same correct answer, the same explanation and feedback in meaning. Change ONLY the fields its complaint names: put an Urdu word between the two terms or rephrase so they do not touch — «جب numerator denominator سے چھوٹا ہو» → «جب numerator کی قیمت denominator سے کم ہو»; «Brother کا feminine noun Sister ہے» → «Brother کے لیے feminine noun کا جواب Sister ہے». A single English term of two words ("cross multiplication", "place value") is ONE term and stays together.';
const ADJACENT_TERMS = /^q\d+: URDU_ADJACENT_TERMS\b/;
const TEACHER_FIELDS_RULE = 'TEACHER FIELDS. "selected_because" and every "distractor_misconceptions" entry are printed on the TEACHER\'s Urdu page: write them in Urdu script (English technical terms in English letters are fine). For a question rejected ONLY for this, keep the question and rewrite those two fields in Urdu.';
// The model rewrote a question with two identical options three times in one
// production run (2026-09-07, quiz f5d625e9) — the complaint was in front of it
// each time and the rule never was. Every other repeated fault this week was
// answered by stating its rule in the prompt.
const DISTINCT_OPTIONS_RULE = 'DISTINCT OPTIONS. The three options must all be different from each other — no two the same word, number or phrase, not even with different spacing or spelling, and under a picture of parts never two fractions of the same amount (2/8 and 1/4 both read a bar of 2 in 8 right). Exactly one is correct, and "correct_index" is its position (0, 1 or 2). Every option is a real, plausible answer a child might pick; never a filler, never blank.';
const OPTIONS_FAULT = /^q\d+: (duplicate options|empty option|bad correct_index|\d+ options\b|wrong-feedback keys)/;
const STRUCTURAL_MULTI_RULE = 'MULTI-SELECT. A "select all that apply" question (answer_mode "multi") names at least 2 and at most (options − 1) correct options in "correct_indices", and every option is at most 30 characters. If the lesson gives it only ONE right answer, write it as an ordinary single-answer question instead: 3 options, one "correct_index", no "correct_indices", no answer_mode.';
/** The set-level line the validator writes NEXT TO its per-question PEDAGOGY_LEVEL_ABOVE lines; those lines are the targets, this one is their headline. */
const LEVEL_SUMMARY = /^(only \d+\/\d+ at\/below taught level|PEDAGOGY_LEVEL_MIX — only \d+ of \d+|feminine-stem address$)/;
/**
 * An lp_v8 item whose KEY contradicts the lesson (the key check in
 * lp-quiz-key-check.service): the model made the lesson's planted mistake the
 * right answer. Stated only when that complaint is present, so every other
 * rewrite prompt — and the whole transcript path — is unchanged.
 */
const KEY_CONFLICT_RULE = 'KEY CONFLICT. A question rejected for KEY_CONFLICT marked as correct an answer the lesson itself contradicts — usually the very mistake the lesson warns children about, quoted in its complaint. The correct option must say what the lesson says; the lesson\'s mistake may be a WRONG option, never the correct one. This is the one fault where you may keep the same question: fix the options and "correct_index" so the answer the lesson teaches is the one marked correct, and make "explanation" and "option_feedback" say the lesson\'s answer.';
const KEY_CONFLICT = /^q\d+: KEY_CONFLICT\b/;
/**
 * A question rejected for its MATHS NOTATION (MATH_TEX — an unmatched "$", a
 * word inside the dollars, TeX KaTeX cannot parse). The question itself was
 * fine; re-asking a different one would throw good work away, so this is the
 * other fault — beside length and a key conflict — where the question may stay.
 * The notation rule itself is already in the question contract above it.
 */
const MATH_TEX_RULE = 'MATHS NOTATION. For a question rejected ONLY for MATH_TEX, keep the same question, the same options and the same answer, and rewrite only the notation: each expression between single dollars ($\\frac{2}{9}$), words and Urdu outside them, nothing but the maths inside, and every backslash doubled in the JSON you return.';
const MATH_TEX = /^q\d+: MATH_TEX\b/;
/**
 * An item the BLIND SOLVE (transcript-quiz-key-verify.service) could not agree
 * with: a solver not shown the key answered differently, or found two (or no)
 * correct options. Stated only when that complaint is present, so every other
 * rewrite prompt is unchanged.
 */
const KEY_DISAGREEMENT_RULE = 'KEY CHECK. A question rejected for KEY_DISAGREEMENT, KEY_AMBIGUOUS or KEY_NONE_CORRECT was answered by a solver who was NOT shown its answer, and the solver did not arrive at the answer marked correct. Check the fact itself before you write — the spelling, the letters of a word, the sum, the definition. Exactly one option must be correct beyond doubt (for a "select all" question, exactly the options in "correct_indices"), and "correct_index" must point at it; every other option must be clearly wrong — never the right answer in another order or other words. This is a fault where you may keep the same question: fix the options and "correct_index", and make "explanation" and "option_feedback" say the right answer.';
const KEY_DISAGREEMENT = /^q\d+: KEY_(DISAGREEMENT|AMBIGUOUS|NONE_CORRECT)\b/;
const STRUCTURAL_CAPS_RULE = 'LENGTH. Every question STEM is at most 200 code points (characters) and every OPTION at most 72 — anything longer is cut off on the phone, so write a shorter one that says the same thing. Every "selected_because" is at most 15 words. For a question rejected ONLY for length, keep the same question and shorten the text.';

/**
 * The ONE quiz-level complaint a small call can answer: a gendered reference to
 * the teacher in `lesson_summary`. It is a single paragraph written from the
 * digest, so a replacement can be asked for and checked on its own.
 */
const QUIZ_LEVEL_REPAIRABLE = /^PEDAGOGY_GENDERED_TEACHER\b/;

/**
 * @param {string[]} errors the validator's complaints from the LAST full attempt
 * @returns {{indices:number[], byIndex:Object<number,string[]>, summary:string[]}}
 *          `indices` and `summary` are both empty when this rejection is not one
 *          a targeted rewrite can repair
 */
function rewriteTargets(errors) {
  const none = { indices: [], byIndex: {}, summary: [] };
  const list = Array.isArray(errors) ? errors.filter((e) => typeof e === 'string') : [];
  if (!list.length || list.length !== (errors || []).length) return none;
  const byIndex = {};
  const summary = [];
  for (const e of list) {
    const m = PER_QUESTION.exec(e) || PER_QUESTION_STRUCTURAL.exec(e);
    if (!m) {
      // one non-per-question complaint disqualifies the whole set, unless it is
      // the quiz-level field this call can rewrite on its own
      if (QUIZ_LEVEL_REPAIRABLE.test(e)) { summary.push(e); continue; }
      if (LEVEL_SUMMARY.test(e)) continue;   // explained by the per-question lines beside it
      return none;
    }
    const i = Number(m[1]);
    (byIndex[i] = byIndex[i] || []).push(e);
  }
  const indices = Object.keys(byIndex).map(Number).sort((a, b) => a - b);
  if (indices.length > MAX_TARGETS) return none;
  if (!indices.length && !summary.length) return none;
  return { indices, byIndex, summary };
}

/** "q0, q7" */
const label = (indices) => indices.map((i) => `q${i}`).join(', ');

function optionLine(q) {
  return (Array.isArray(q && q.options) ? q.options : []).map((o) => String(o ?? '').trim()).join(' | ');
}

/**
 * The small prompt. It carries the language rule FIRST (a retry that is
 * appended after a page of picture rules is where a whole quiz once flipped
 * script), the SLOs, the lesson's own material, the stems that are staying so a
 * replacement cannot duplicate one, and — for each rejected question — the
 * question being thrown away with its complaints quoted verbatim.
 */
function buildRewritePrompt({
  digest, language, questions, targets, gradeBand = null, lessonSummary = null,
  // An lp_v8 quiz: the lesson was PLANNED, so its summary is rewritten in the
  // plan's voice (LP_SUMMARY_VOICE), never as "what you taught".
  planned = false,
}) {
  const qs = Array.isArray(questions) ? questions : [];
  const { indices, byIndex } = targets;
  const summaryErrors = Array.isArray(targets && targets.summary) ? targets.summary : [];
  const nQ = indices.length;
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const sloLines = slos
    .map((s) => `- ${s.id} [taught at ${s.taught_level || 'understand'}] ${sloStatement(s, language)}`)
    .join('\n');
  const material = [
    digest && digest.topic_as_taught ? `topic as the teacher named it: ${digest.topic_as_taught}` : null,
    (digest && Array.isArray(digest.examples_used) && digest.examples_used.length)
      ? `the lesson's own examples: ${digest.examples_used.slice(0, 8).join('; ')}` : null,
    (digest && Array.isArray(digest.key_terms) && digest.key_terms.length)
      ? `the words used in class: ${digest.key_terms.slice(0, 12).join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const staying = qs
    .map((q, i) => (indices.includes(i) ? null : `  q${i}: ${String((q && q.question) || '').trim()}`))
    .filter(Boolean).join('\n');
  const rejected = indices.map((i) => {
    const q = qs[i] || {};
    return `q${i} · slo_id "${q.slo_id || 'S?'}" · level "${q.level || 'understand'}"
  the question being thrown away: "${String(q.question || '').trim()}"
  its options were: ${optionLine(q)}
  why it was rejected:
${(byIndex[i] || []).map((e) => `    - ${e}`).join('\n')}`;
  }).join('\n\n');

  // The sections are composed rather than written out once, because round 6
  // added a target this call can be asked for ALONE: the quiz-level
  // `lesson_summary`. A summary-only call must not carry the question contract,
  // the picture rule or the "questions that are staying" list — none of it
  // applies, and every line of a prompt that does not apply is a line the model
  // can answer instead of the one that does.
  const opening = nQ && summaryErrors.length
    ? `You are FIXING a short WhatsApp quiz written for the children who sat in ONE real lesson. ${nQ} of its ${qs.length} questions were rejected by our checks, and so was its lesson summary. You are writing ONE replacement for each rejected question, and a new "lesson_summary". Every other question is good and is staying exactly as it is — do not touch it, do not return it.`
    : (nQ
      ? `You are FIXING a short WhatsApp quiz written for the children who sat in ONE real lesson. ${nQ} of its ${qs.length} questions were rejected by our checks. You are writing ONE replacement for each. Every other question is good and is staying exactly as it is — do not touch it, do not return it.`
      : 'You are FIXING the LESSON SUMMARY of a short WhatsApp quiz written for the children who sat in ONE real lesson. Every question is good and is staying exactly as it is — do not touch one, do not return one. You are rewriting the summary only.');

  const questionSections = nQ ? [
    `REWRITE THESE QUESTIONS: ${label(indices)}`,
    `THE QUESTIONS THAT ARE STAYING. A replacement must not ask one of these again, and must not have the same answer as one of them.\n${staying || '(none)'}`,
    `REJECTED — write one new question for each.\n\n${rejected}`,
    'A RE-WORDING OF A REJECTED QUESTION IS REJECTED AGAIN (except a question rejected ONLY for length, ONLY for how it speaks to the child, or ONLY for two English terms side by side — see LENGTH, THE CHILD HAS NO GENDER and TWO ENGLISH TERMS SIDE BY SIDE below). Change WHAT is asked, not how it is phrased: same SLO, same level, same lesson material, a different question — one any child who understood the idea can answer.',
    'NO NEW PICTURES. Every replacement is a text question: leave "figure" and "figure_role" null. A replacement that carries a figure is thrown away and its rejected question is dropped from the quiz instead, so the child loses a question.',
    questionContract({ gradeBand }),
    SELECTED_BECAUSE_RULE,
    STRUCTURAL_CAPS_RULE,
    ...(indices.some((i) => (byIndex[i] || []).some((e) => /MULTI_[A-Z_]+/.test(e))) ? [STRUCTURAL_MULTI_RULE] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => OPTIONS_FAULT.test(e))) ? [DISTINCT_OPTIONS_RULE] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => /PEDAGOGY_GENDERED_CHILD/.test(e))) ? [CHILD_ADDRESS_REPAIR] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => ADJACENT_TERMS.test(e))) ? [ADJACENT_TERMS_REPAIR] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => /URDU_TEACHER_FIELDS/.test(e))) ? [TEACHER_FIELDS_RULE] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => KEY_CONFLICT.test(e))) ? [KEY_CONFLICT_RULE] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => MATH_TEX.test(e))) ? [MATH_TEX_RULE] : []),
    ...(indices.some((i) => (byIndex[i] || []).some((e) => KEY_DISAGREEMENT.test(e))) ? [KEY_DISAGREEMENT_RULE] : []),
  ] : [];

  const summarySection = summaryErrors.length ? [
    `THE LESSON SUMMARY — rewrite it, and nothing else about it.
  the summary being thrown away: "${String(lessonSummary || '').trim() || '(not recorded)'}"
  why it was rejected:
${summaryErrors.map((e) => `    - ${e}`).join('\n')}

${planned
    ? `Write a new "lesson_summary": 2-3 sentences, in the quiz language, written TO THE TEACHER (not the child). ${LP_SUMMARY_VOICE} Do not summarise the quiz — summarise the LESSON PLAN.`
    : 'Write a new "lesson_summary": 2-3 sentences, in the quiz language, written TO THE TEACHER (not the child), in the SECOND PERSON — "you": say what you taught and in the order you taught it, naming your own examples and numbers from the lesson. Do not summarise the quiz — summarise the LESSON.'} Keep everything the old summary got right about the lesson; change only what was rejected.`,
  ] : [];

  const shape = `  { "index": ${indices[0]}, "slo_id": "${(qs[indices[0]] || {}).slo_id || 'S1'}", "level": "${(qs[indices[0]] || {}).level || 'understand'}",
    "question": "", "options": ["", "", ""], "correct_index": 0,
    "explanation": "", "selected_because": "", "distractor_misconceptions": { "1": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } },
    "figure": null, "figure_role": null }`;

  const returnBlock = nQ
    ? `Return ONLY this JSON object, with exactly ${nQ} question entr${nQ === 1 ? 'y' : 'ies'}${summaryErrors.length ? ' and the new summary' : ''} and nothing else. "index" is the number after the q above, and must be one of: ${indices.join(', ')}.
{ ${summaryErrors.length ? '"lesson_summary": "",\n  ' : ''}"questions": [
${shape} ] }
(In that example the correct option is index 0, so the wrong keys are "1" and "2". If correct_index is 1 the keys are "0" and "2"; if it is 2 the keys are "0" and "1".)`
    : `Return ONLY this JSON object and nothing else.
{ "lesson_summary": "" }`;

  return [
    opening,
    `QUIZ LANGUAGE: ${LANG_NAME[language] || 'Urdu'}. ${languageRule(language)}`,
    ...questionSections.slice(0, 1),
    `WHAT THESE CHILDREN WERE MEANT TO LEARN. A replacement stays on its own question's SLO, at its own question's level.\n${sloLines || '(no SLOs recorded)'}`,
    `THE LESSON'S OWN MATERIAL — dress the replacement in it, so a child recognises the class in the quiz.\n${material || '(none recorded)'}`,
    ...questionSections.slice(1),
    ...summarySection,
    GENDER_NEUTRAL_RULE,
    RELIGIOUS_CONTENT_RULE,
    returnBlock,
  ].join('\n\n');
}

/**
 * Put the replacements back at their own positions.
 *
 * A replacement is taken only when it names (or is positionally matched to) a
 * target index AND carries no figure; anything else leaves the original
 * question in place, where the validator will reject it again and the salvage
 * will drop that one — one question lost instead of the repair.
 *
 * The quiz-level `lesson_summary` follows the same rule as a question: it is
 * taken ONLY when it was asked for. A model that volunteers a summary on a
 * question-only repair is ignored — the summary that shipped through the last
 * full attempt is the one the validator judged, and silently swapping it would
 * replace a field nobody complained about.
 *
 * @returns {{questions:object[], replaced:number[], lessonSummary:string|null}|null}
 *          null when nothing at all was replaced
 */
function mergeReplacements(questions, json, targets) {
  const qs = Array.isArray(questions) ? questions : [];
  const list = Array.isArray(json && json.questions) ? json.questions : [];
  const { indices } = targets;
  const wantSummary = Array.isArray(targets && targets.summary) && targets.summary.length > 0;
  const summary = wantSummary && typeof (json && json.lesson_summary) === 'string'
    && json.lesson_summary.trim() ? json.lesson_summary.trim() : null;
  // A reply with no index anywhere is matched by POSITION, and that is only
  // meaningful when it carries exactly the replacements we asked for. A reply
  // of a different length is the model answering a different question — most
  // often the full author shape, all eight questions, none of them addressed to
  // an index — and mapping its first entries onto our targets would ship a
  // question copied from elsewhere in the same quiz. Refuse it; the salvage and
  // the next attempt are behind this.
  const anyNamed = list.some((r) => r && typeof r === 'object' && Number.isInteger(Number(r.index)));
  if (!anyNamed && list.length && list.length !== indices.length) {
    return summary ? { questions: qs, replaced: [], lessonSummary: summary } : null;
  }
  const chosen = new Map();
  list.forEach((r, pos) => {
    if (!r || typeof r !== 'object') return;
    // A replacement that NAMES an index we did not ask about is discarded, not
    // relocated: the model was given the only valid indices, and quietly moving
    // a question written for q2 onto q0 would ship a repair for a question that
    // was never broken. Positional matching is only for a reply with no index
    // at all.
    const named = Number(r.index);
    const idx = Number.isInteger(named)
      ? (indices.includes(named) ? named : undefined)
      : indices[pos];
    if (idx === undefined || chosen.has(idx)) return;
    if (r.figure) return;                       // the no-picture contract, asserted
    if (!String(r.question || '').trim()) return;
    chosen.set(idx, r);
  });
  if (!chosen.size && !summary) return null;
  const out = qs.map((q, i) => {
    if (!chosen.has(i)) return q;
    const { index, ...rest } = chosen.get(i);
    return {
      ...rest,
      slo_id: rest.slo_id || q.slo_id,
      level: rest.level || q.level,
      figure: null,
      figure_role: null,
    };
  });
  return { questions: out, replaced: [...chosen.keys()].sort((a, b) => a - b), lessonSummary: summary };
}

/**
 * ONE call. Never throws: a rewrite that cannot be made is a rewrite that did
 * not happen, and the salvage behind it is unchanged.
 *
 * @returns {Promise<{attempted:boolean, indices:number[], merged:object[]|null,
 *   replaced:number[], lessonSummary:string|null, model?:string, costUsd?:number,
 *   latencyMs?:number, error?:string}>}
 */
async function rewriteRejected({
  questions, errors, digest, language, gradeBand = null, lessonSummary = null, planned = false,
  // quizId is accepted and ignored here on purpose: the outcome event is emitted
  // by the caller, which is the only place that knows whether the merged set
  // validated.
  quizId = null,
}) {  // eslint-disable-line no-unused-vars
  const targets = rewriteTargets(errors);
  if (!targets.indices.length && !targets.summary.length) {
    return { attempted: false, indices: [], merged: null, replaced: [], lessonSummary: null };
  }
  const prompt = buildRewritePrompt({
    digest, language, questions, targets, gradeBand, lessonSummary, planned,
  });
  try {
    const { json, model, costUsd, latencyMs } = await completeJson({
      prompt, maxTokens: 8000, label: 'transcript_quiz.rewrite',
    });
    const merged = mergeReplacements(questions, json, targets);
    return {
      attempted: true,
      indices: targets.indices,
      // A summary-only repair returns the questions UNCHANGED rather than null:
      // the caller re-validates `merged` with the new summary, and there was
      // never anything wrong with the questions.
      merged: merged ? merged.questions : null,
      replaced: merged ? merged.replaced : [],
      lessonSummary: merged ? merged.lessonSummary : null,
      model,
      costUsd,
      latencyMs,
    };
  } catch (err) {
    return {
      attempted: true, indices: targets.indices, merged: null, replaced: [], lessonSummary: null, costUsd: 0, error: err.message,
    };
  }
}

// ─── THE TEACHER FIELDS, REPAIRED IN PLACE ──────────────────────────────────
// On an Urdu quiz the model writes "selected_because" and the distractor
// meanings in English on the FIRST attempt more often than not (production,
// 2026-09-07: two of two Urdu quizzes, 8/8 questions each; one of them again
// on its third attempt with the complaint in front of it). Those two fields
// are printed on the teacher's page and never reach a child — a fault in them
// is not a fault in the question, so the question is never re-rolled for it.
// ONE small call rewrites exactly those fields, in Urdu, for every question
// named, at any count; the merged set goes through the whole validator again.
const TEACHER_FIELDS_ONLY = /^q(\d+): URDU_TEACHER_FIELDS\b/;

/** The indices whose teacher fields were rejected, in order. */
function teacherFieldTargets(errors) {
  const idx = new Set();
  (Array.isArray(errors) ? errors : []).forEach((e) => { const m = TEACHER_FIELDS_ONLY.exec(String(e)); if (m) idx.add(Number(m[1])); });
  return [...idx].sort((a, b) => a - b);
}

function buildTeacherFieldsPrompt({ digest, questions, indices }) {
  const qs = Array.isArray(questions) ? questions : [];
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const sloLines = slos.map((s) => `- ${s.id}: ${s.statement_ur || s.statement || ''}`).join('\n');
  const items = indices.map((i) => {
    const q = qs[i] || {};
    const misc = q.distractor_misconceptions || {};
    return `q${i} · slo_id "${q.slo_id || 'S?'}"
  question (for the child, stays as it is): "${String(q.question || '').trim()}"
  options: ${(Array.isArray(q.options) ? q.options : []).map((o, k) => `[${k}] ${String(o)}`).join('  ')}   correct: ${q.correct_index}
  current "selected_because" (wrong language): "${String(q.selected_because || '').trim()}"
  current "distractor_misconceptions" (wrong language): ${JSON.stringify(misc)}`;
  }).join('\n\n');
  return [
    'REWRITE THE TEACHER FIELDS of an Urdu quiz. The questions are fine and stay exactly as they are; ONLY two fields per question were written in the wrong language. These two fields are printed on the TEACHER\'s Urdu page and never shown to a child.',
    TEACHER_FIELDS_RULE,
    '"selected_because": at most 15 words, in Urdu script, naming the moment of the lesson this question tests (the example, the board, the thing the class did). "distractor_misconceptions": the SAME keys as now, each value one short Urdu phrase naming the misconception a child holds when they pick that wrong option. English technical terms stay in English letters. Never a gendered word for the teacher (write «استاد نے …» or «سبق میں …»).',
    `THE LESSON'S OBJECTIVES\n${sloLines || '(none recorded)'}`,
    `THE QUESTIONS\n${items}`,
    `Return ONLY this JSON object, with exactly ${indices.length} entr${indices.length === 1 ? 'y' : 'ies'}, "index" being one of: ${indices.join(', ')}.
{ "fields": [ { "index": ${indices[0]}, "selected_because": "", "distractor_misconceptions": { "1": "", "2": "" } } ] }`,
  ].join('\n\n');
}

/** Replace only the two fields, only on the named indices, keeping the misconception keys the question already has. */
function mergeTeacherFields(questions, json, indices) {
  const qs = Array.isArray(questions) ? questions : [];
  const list = Array.isArray(json && json.fields) ? json.fields : [];
  const merged = qs.map((q) => (q && typeof q === 'object' ? { ...q } : q));
  const replaced = [];
  list.forEach((f) => {
    const i = Number(f && f.index);
    if (!indices.includes(i) || !merged[i]) return;
    const q = merged[i];
    if (typeof f.selected_because === 'string' && f.selected_because.trim()) q.selected_because = f.selected_because.trim();
    const cur = q.distractor_misconceptions && typeof q.distractor_misconceptions === 'object' ? q.distractor_misconceptions : {};
    const next = { ...cur };
    Object.keys(cur).forEach((k) => {
      const v = f.distractor_misconceptions && f.distractor_misconceptions[k];
      if (typeof v === 'string' && v.trim()) next[k] = v.trim();
    });
    q.distractor_misconceptions = next;
    replaced.push(i);
  });
  return { questions: merged, replaced };
}

async function rewriteTeacherFields({ questions, errors, digest, language, quizId = null }) {  // eslint-disable-line no-unused-vars
  const indices = language === 'ur' ? teacherFieldTargets(errors) : [];
  if (!indices.length) return { attempted: false, indices: [], merged: null, replaced: [] };
  const prompt = buildTeacherFieldsPrompt({ digest, questions, indices });
  try {
    const { json, model, costUsd, latencyMs } = await completeJson({ prompt, maxTokens: 6000, label: 'transcript_quiz.teacher_fields' });
    const m = mergeTeacherFields(questions, json, indices);
    return { attempted: true, indices, merged: m.questions, replaced: m.replaced, model, costUsd, latencyMs };
  } catch (err) {
    return { attempted: true, indices, merged: null, replaced: [], costUsd: 0, error: err.message };
  }
}

// ─── ADD PICTURES — the one rewrite that may ADD a figure ───────────────────
// A grade 1-5 maths quiz that came back with too few pictures (FIGURE_FEW, see
// the validator's figureDensity) gets ONE call that adds a picture to the
// questions a picture helps most. It is the mirror of the rewrite above, which
// must never add one: here the picture is the point, and the QUESTION is what
// must not move. Asserted in code (root rule 24c), not left to the prompt:
//   - only a candidate index is taken, at most `need` of them, each once;
//   - an entry without a figure object is discarded;
//   - an entry that changes the options, their order or the key is discarded —
//     the question was already checked, and a picture must not re-key it;
//   - only the stem (to point at the picture), the figure and its role are
//     taken; explanation, feedback, SLO and level stay as they were.
// The merged set then goes through the whole validator like every rewrite.
//
// OR IT MAY REPLACE ONE. On a live grade 4 lesson on comparing unlike
// fractions the author wrote eight questions about the METHOD (the cross
// products, the rewritten fractions) and no picture; the repair bolted bars
// onto three of them and all three were rightly refused — two bars of 2/3 and
// 3/5 cannot produce "2 × 5 = 10" (FIGURE_MISMATCH) — so the quiz shipped with
// no picture at all. No picture shows the answer to a step of a working. So an
// entry marked "replace" brings a NEW question on the same objective that the
// child answers by READING its picture ("what fraction of the bar is shaded?",
// "which bar shows 2/3?"). What that may be is asserted here too:
//   - never the easy first question (q0 stays the nervous child's first win);
//   - a whole question: a stem, as many options as the one it replaces, a key
//     among them, an explanation and feedback;
//   - figure_role "read_off" or "count_compare" — never "model": a new
//     question is built around its picture, it does not decorate a sum;
//   - the objective is the replaced question's own, and the level never rises
//     (nor drops to recall from a higher-order one), so SLO coverage and the
//     level mix stay as the validator already passed them.
// It runs before the key check and the blind solve, so a replaced key is
// checked like every other.

/** How many questions are offered to the call, best first. */
const ADD_PICTURE_CANDIDATES = 5;

/** Words that mark a question a picture can carry: counting, comparing, sharing, place, parts. */
const PICTURE_WORDS = /\b(how many|more|fewer|less|count|groups?|share[ds]?|equal|shaded|fractions?|half|tens?|ones?|hundreds?|larger|smaller|bigger|greatest|smallest|compare|order|total|altogether|left|add|take away|subtract|times)\b|کتن|زیادہ|کم|حص|گروپ|دہائ|اکائ|سینکڑ|برابر|باقی|کل\s|بڑا|بڑی|بڑے|چھوٹا|چھوٹی|چھوٹے|موازن|ترتیب|رنگ/i;
const COLUMN_SUM_TEX = /\\begin\{array\}/;

/** The maths types a young class can be drawn with (the word types are for language lessons). */
const ADD_PICTURE_TYPES = [
  'count_objects', 'base_ten', 'fraction_bar', 'grid', 'numberline', 'count_frame', 'money', 'clock', 'compare_size', 'pattern', 'geometry',
];

/**
 * The questions a picture would help most, best first: no question that
 * already has one, no select-all question (its Flow draws no image), no column
 * sum (arithmetic is typeset, never drawn). A question with numbers and a
 * counting / comparing word ranks first; the easy first question ranks last.
 * @returns {number[]}
 */
function pictureCandidates(questions, { limit = ADD_PICTURE_CANDIDATES } = {}) {
  const Multi = require('./transcript-quiz-multi');
  const qs = Array.isArray(questions) ? questions : [];
  const scored = [];
  qs.forEach((q, i) => {
    if (!q || typeof q !== 'object' || q.figure) return;
    if (Multi.isMultiQuestion(q)) return;
    const stem = String(q.question || '');
    if (COLUMN_SUM_TEX.test(stem)) return;
    const all = [stem, ...(Array.isArray(q.options) ? q.options : [])].join(' ');
    let score = 0;
    if (/\d|\$/.test(all)) score += 2;
    if (PICTURE_WORDS.test(stem)) score += 2;
    if (q.level === 'understand' || q.level === 'apply') score += 1;
    if (i === 0) score -= 1;
    scored.push({ i, score });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((s) => s.i);
}

function buildAddPicturePrompt({
  digest, language, questions, indices, need, gradeBand = null, lessonDrew = '', refused = [],
}) {
  const { minimalSpecBlock } = require('./transcript-quiz-figure');
  const { names: pictogramNames } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
  const qs = Array.isArray(questions) ? questions : [];
  const figured = qs.filter((q) => q && q.figure).length;
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const items = indices.map((i) => {
    const q = qs[i] || {};
    const opts = (Array.isArray(q.options) ? q.options : []).map((o, k) => `[${k}] ${String(o)}`).join('  ');
    return `q${i} · slo "${q.slo_id || 'S?'}" · level "${q.level || 'understand'}"${i === 0 ? ' · the easy first question: add only, never replace' : ''}
  stem: "${String(q.question || '').trim()}"
  options: ${opts}   correct: ${q.correct_index}`;
  }).join('\n\n');
  const others = qs.map((q, i) => (indices.includes(i) || !q ? null : `q${i}: ${String(q.question || '').trim()}`)).filter(Boolean);
  const wrongKeys = '"1" and "2" when correct_index is 0; "0" and "2" when it is 1; "0" and "1" when it is 2';
  return [
    `You are ADDING PICTURES to a short WhatsApp maths quiz for the children of ONE grade ${gradeBand || digest?.grade_band || '1-5'} class. A young class learns maths through the picture — the objects first, then the picture of them, then the sum — and this quiz carries only ${figured} picture(s) in ${qs.length} questions. Give exactly ${need} of the questions below a picture: the ${need} a picture helps most.`,
    `QUIZ LANGUAGE: ${LANG_NAME[language] || 'Urdu'}. ${languageRule(language)}`,
    `TWO WAYS TO GIVE A QUESTION A PICTURE:
1. ADD — keep the question and draw its picture. Its options, their order and its correct answer do not change — never return different ones. You write only "figure", "figure_role" and, when the question must now point at the picture, a new "question" stem in the quiz language.
2. REPLACE — when NO picture can produce the question's answer, write a NEW question in its place. A step of a procedure is such a question: a cross product ("what is 2 × 5?"), a fraction rewritten over a new denominator, a carried ten, the next line of a working. Two fraction bars beside "what is 2 × 5?" do not show 10, and that picture is thrown away. So set "replace": true and write a whole new question on the SAME objective that the child answers by READING the picture, with "figure_role" "read_off" (or "count_compare" for counting objects) — never "model". Return every field: "question", "options" (three), "correct_index", "explanation", "selected_because", "distractor_misconceptions" and "option_feedback" (the wrong keys are ${wrongKeys}), all in the quiz language, with maths in the stem and options as TeX between single dollars ($\\frac{3}{5}$) and never in the figure. Its correct answer must be right: it is checked again, blind. Never replace q0, and do not ask what another question in the quiz already asks.`,
    `A REPLACEMENT IS A NEW QUESTION: a new stem, new options and a new correct answer, and that answer is what the child READS off the picture — the fraction shaded, the bar that shows a fraction, the number the sticks make. Never the old question with a picture over it: its old answer ("20", "10") is still not on the picture, and it is refused again. A replacement is held to every rule below, exactly as the quiz's author was.`,
    `QUESTIONS A CHILD ANSWERS BY READING A PICTURE — reach for these when you replace:
- A fraction: one bar, some parts shaded, no label — "What fraction of the bar is shaded?", the options three fractions of DIFFERENT amounts: never 2/8 beside 1/4, because both read a bar of 2 in 8 right. {"type":"fraction_bar","bars":[{"parts":5,"shaded":3}]}
- Which picture shows a fraction: three bars named "P", "Q", "R" — "Which bar shows $\\frac{2}{3}$?", the options "P", "Q", "R", and the three bars show three DIFFERENT amounts, never 1/2 beside 3/6 (every option is on the picture, so nothing is given away; in the feedback say "bar P", «پٹی P»). {"type":"fraction_bar","bars":[{"parts":3,"shaded":2,"label":"P"},{"parts":5,"shaded":2,"label":"Q"},{"parts":4,"shaded":1,"label":"R"}]}
- An improper fraction or a mixed number: whole bars and a part bar — 7/4 is {"parts":4,"shaded":4} then {"parts":4,"shaded":3} — never one bar with more shaded than parts, and never inside a "which bar shows" set.
- Comparing: two bars of the same length, no labels — "Both bars are the same length. What fraction of the bar with MORE shaded is shaded?", the options fractions. The stem names no fraction, so the child reads both off the picture. (A stem that names the two fractions makes it a "model" question, which is an ADD, never a replacement.)
- Place value: {"type":"base_ten","tens":3,"ones":4} — "What number do the sticks show?" or "How many tens are there?"
- Counting, adding, taking away: {"type":"count_objects","rows":[{"picto":"counter","count":4},{"picto":"counter","count":3}]} — "How many counters are there altogether?"
- A part of a set: the part is its own row that LOOKS different — {"type":"count_objects","rows":[{"picto":"pencil","count":2,"color":"warn"},{"picto":"pencil","count":3}]} — "What fraction of the pencils are coloured?"; rows that look alike cannot show a part.
- Sharing and times: {"type":"count_objects","picto":"counter","count":12,"group":4} — "How many groups of 4 are there?"`,
    `TWO KINDS OF PICTURE:
- "figure_role":"model" — the picture SHOWS the numbers the stem already states, the way the lesson drew them: two fraction bars beside "which is larger, 2/3 or 3/5?", two rows of counters beside "3 + 4 = ?", bundles and sticks beside "34 + 12". Keep the stem as it is.
- "figure_role":"read_off" (or "count_compare" for counting and comparing objects) — the child reads the question's numbers OFF the picture ("How many counters are in the picture?"). The stem then says so and must NOT also state those numbers.`,
    `HARD RULES — a picture that breaks one is thrown away and its question stays as it was:
- The picture must NOT contain the answer: no option's text anywhere in it, no total, no result. A jump arc never lands on the answer; a fraction bar carries no label.
- Labels are written in the quiz language; numerals stay 0-9. Never TeX or "$" inside a figure — its fractions are plain ("3/4"). A term may stay in English letters, but a person's name in a label is written in the quiz language (حرا کی بوتل, not Hira کی بوتل).
- The simplest spec that shows the idea. count_objects draws 2 to 30 things; base_ten up to 20 of each place (9 thousands).
- Column arithmetic is never a picture.
- A picture of a thing comes ONLY from the pictogram names below; "counter" and "tile" are the round and square counters a maths class uses.`,
    ...(lessonDrew ? [lessonDrew] : []),
    `THE LESSON'S OBJECTIVES\n${slos.map((s) => `- ${s.id}: ${sloStatement(s, language)}`).join('\n') || '(none recorded)'}`,
    // A replacement is a whole question, so it is held to the author's own
    // rules — live, one kept the method question's key under a new bar and
    // another ran its selected_because to 34 words; both were refused.
    questionContract({ gradeBand }),
    SELECTED_BECAUSE_RULE,
    // every field in the quiz language, the teacher's fields included
    languageAgain(language).trim(),
    GENDER_NEUTRAL_RULE,
    `THE TYPES — nothing else is accepted:\n${minimalSpecBlock(ADD_PICTURE_TYPES)}`,
    `PICTOGRAM NAMES: ${pictogramNames().join(', ')}`,
    ...(Array.isArray(refused) && refused.length ? [`REFUSED LAST TIME — these pictures were thrown away by our checks, and their questions are as they were:\n${refused.map((r) => `- q${r.index}: ${String(r.error || '').replace(/^q\d+:\s*/, '')}`).join('\n')}\nDo not send the same picture again. A question refused because the picture cannot produce its answer (FIGURE_MISMATCH) is a step no picture shows: REPLACE it, or give another question the picture. A picture refused for giving the answer away (FIGURE_LEAK) needs its labels taken off.`] : []),
    `THE QUESTIONS YOU MAY GIVE A PICTURE (q is its number in the quiz):\n\n${items}`,
    ...(others.length ? [`THE OTHER QUESTIONS IN THE QUIZ (not yours to change — a replacement must not ask any of these again):\n${others.join('\n')}`] : []),
    `Return ONLY this JSON object, with exactly ${need} entr${need === 1 ? 'y' : 'ies'}, "index" being one of: ${indices.join(', ')}. An ADD entry:
{ "index": ${indices[0]}, "question": "", "figure": { "type": "count_objects", "rows": [ { "picto": "counter", "count": 3 }, { "picto": "counter", "count": 4 } ] }, "figure_role": "model" }
(leave "question" empty to keep the stem exactly as it is). A REPLACE entry:
{ "index": ${indices[indices.length - 1]}, "replace": true, "level": "understand", "question": "", "options": ["", "", ""], "correct_index": 0, "explanation": "", "selected_because": "", "distractor_misconceptions": { "1": "", "2": "" }, "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } }, "figure": { "type": "fraction_bar", "bars": [ { "parts": 5, "shaded": 3 } ] }, "figure_role": "read_off" }
{ "pictures": [ …your ${need} entr${need === 1 ? 'y' : 'ies'}… ] }`,
  ].join('\n\n');
}

const sameOptions = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((o, k) => String(o ?? '').trim() === String(b[k] ?? '').trim());

/** The roles a replacement may carry: it is READ off its picture, never decorated by one. */
const REPLACE_ROLES = new Set(['read_off', 'count_compare']);
const LEVEL_RANK = { recall: 0, understand: 1, apply: 2 };
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The level a replacement keeps: the one it asks for when that is no higher
 * than the replaced question's and not bare recall in place of a higher-order
 * one, else the replaced question's own — so the level mix the validator
 * already passed cannot move.
 */
function replacementLevel(origLevel, asked) {
  const o = LEVEL_RANK[origLevel];
  const a = LEVEL_RANK[asked];
  if (o === undefined || a === undefined || a > o || (o > 0 && a === 0)) return origLevel;
  return asked;
}

/** A whole new read-off question in the replaced one's place, or null. */
function replacementFor(orig, r, idx) {
  if (idx === 0 || !REPLACE_ROLES.has(r.figure_role)) return null;
  const stem = text(r.question);
  const opts = Array.isArray(r.options) ? r.options.map(text) : [];
  const n = Array.isArray(orig.options) ? orig.options.length : 3;
  const key = Number(r.correct_index);
  if (!stem || opts.length !== n || opts.some((o) => !o)) return null;
  if (!Number.isInteger(key) || key < 0 || key >= n) return null;
  if (!text(r.explanation) || !isObject(r.option_feedback) || !text(r.option_feedback.correct)) return null;
  return {
    ...orig,
    level: replacementLevel(orig.level, r.level),
    question: stem,
    options: opts,
    correct_index: key,
    explanation: text(r.explanation),
    selected_because: text(r.selected_because) || orig.selected_because,
    distractor_misconceptions: isObject(r.distractor_misconceptions) ? r.distractor_misconceptions : {},
    option_feedback: r.option_feedback,
    figure: r.figure,
    figure_role: r.figure_role,
  };
}

/**
 * @returns {{questions:object[], added:number[], replaced:number[]}|null} null
 *   when nothing was added; `replaced` ⊆ `added` names the questions that are new
 */
function mergeAddedPictures(questions, json, { indices, need }) {
  const qs = Array.isArray(questions) ? questions : [];
  const list = Array.isArray(json && json.pictures) ? json.pictures : [];
  const chosen = new Map();
  const replaced = [];
  list.forEach((r) => {
    if (!r || typeof r !== 'object' || chosen.size >= need) return;
    const idx = Number(r.index);
    if (!indices.includes(idx) || chosen.has(idx)) return;
    const orig = qs[idx];
    if (!orig) return;
    if (!r.figure || typeof r.figure !== 'object' || Array.isArray(r.figure) || typeof r.figure.type !== 'string') return;
    if (r.replace === true) {
      const fresh = replacementFor(orig, r, idx);
      if (!fresh) return;
      chosen.set(idx, fresh);
      replaced.push(idx);
      return;
    }
    if (r.options !== undefined && !sameOptions(r.options, orig.options)) return;
    if (r.correct_index !== undefined && Number(r.correct_index) !== Number(orig.correct_index)) return;
    const stem = typeof r.question === 'string' && r.question.trim() ? r.question.trim() : orig.question;
    chosen.set(idx, {
      ...orig, question: stem, figure: r.figure, figure_role: typeof r.figure_role === 'string' ? r.figure_role : null,
    });
  });
  if (!chosen.size) return null;
  return {
    questions: qs.map((q, i) => (chosen.has(i) ? chosen.get(i) : q)),
    added: [...chosen.keys()].sort((a, b) => a - b),
    replaced: replaced.sort((a, b) => a - b),
  };
}

/**
 * ONE call. Never throws: a repair that cannot be made is a repair that did not
 * happen, and the quiz ships as it was.
 * @returns {Promise<{attempted:boolean, indices:number[], merged:object[]|null, added:number[],
 *   replaced:number[], model?:string, costUsd?:number, latencyMs?:number, error?:string}>}
 */
async function addPictures({
  questions, digest, language, gradeBand = null, lessonDrew = '', need, refused = [],
  // accepted and ignored: the outcome event belongs to the caller, which is the
  // only place that knows whether the merged set validated
  quizId = null, // eslint-disable-line no-unused-vars
}) {
  const indices = Number(need) > 0 ? pictureCandidates(questions) : [];
  if (!indices.length) return { attempted: false, indices: [], merged: null, added: [], replaced: [] };
  const n = Math.min(Number(need), indices.length);
  const prompt = buildAddPicturePrompt({
    digest, language, questions, indices, need: n, gradeBand, lessonDrew, refused,
  });
  try {
    const { json, model, costUsd, latencyMs } = await completeJson({ prompt, maxTokens: 8000, label: 'transcript_quiz.add_pictures' });
    const m = mergeAddedPictures(questions, json, { indices, need: n });
    return {
      attempted: true, indices, merged: m ? m.questions : null, added: m ? m.added : [], replaced: m ? m.replaced : [], model, costUsd, latencyMs,
    };
  } catch (err) {
    return {
      attempted: true, indices, merged: null, added: [], replaced: [], costUsd: 0, error: err.message,
    };
  }
}

module.exports = {
  pictureCandidates, buildAddPicturePrompt, mergeAddedPictures, addPictures,
  rewriteTargets, buildRewritePrompt, mergeReplacements, rewriteRejected, MAX_TARGETS, PER_QUESTION, PER_QUESTION_STRUCTURAL,
  QUIZ_LEVEL_REPAIRABLE, DISTINCT_OPTIONS_RULE, OPTIONS_FAULT, KEY_CONFLICT_RULE, KEY_CONFLICT, MATH_TEX_RULE, MATH_TEX,
  KEY_DISAGREEMENT_RULE, KEY_DISAGREEMENT,
  teacherFieldTargets, buildTeacherFieldsPrompt, mergeTeacherFields, rewriteTeacherFields, TEACHER_FIELDS_ONLY,
};
