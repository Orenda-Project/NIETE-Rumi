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
 * Pure except for the one LLM call: no DB, no WhatsApp, no R2.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { LANG_NAME, sloStatement } = require('./transcript-quiz-language');
const {
  languageRule, questionContract, SELECTED_BECAUSE_RULE, RELIGIOUS_CONTENT_RULE,
} = require('./transcript-quiz-contract');

/** At most this many questions may be repaired; more than that is a re-roll. */
const MAX_TARGETS = 3;

/**
 * A complaint one replacement question can answer: it names its question and it
 * is about that question's pedagogy or its picture.
 *
 * Deliberately NOT droppable-and-quiz-level: `FIGURE_SHARE`, `PEDAGOGY_LEVEL_MIX`,
 * `SLOs uncovered` and the script-ratio complaints are properties of the SET, and
 * rewriting three questions in isolation cannot be shown to fix them. A structural
 * complaint (`q0: 2 options`) is excluded for a different reason: it means the
 * reply itself was malformed, which is a re-roll, not a repair.
 */
const PER_QUESTION = /^q(\d+):\s*(PEDAGOGY_[A-Z_]+|FIGURE_[A-Z_]+)\b/;

/**
 * @param {string[]} errors the validator's complaints from the LAST full attempt
 * @returns {{indices:number[], byIndex:Object<number,string[]>}} indices is empty
 *          when this rejection is not one a targeted rewrite can repair
 */
function rewriteTargets(errors) {
  const none = { indices: [], byIndex: {} };
  const list = Array.isArray(errors) ? errors.filter((e) => typeof e === 'string') : [];
  if (!list.length || list.length !== (errors || []).length) return none;
  const byIndex = {};
  for (const e of list) {
    const m = PER_QUESTION.exec(e);
    if (!m) return none;                       // one non-per-question complaint disqualifies the whole set
    const i = Number(m[1]);
    (byIndex[i] = byIndex[i] || []).push(e);
  }
  const indices = Object.keys(byIndex).map(Number).sort((a, b) => a - b);
  if (!indices.length || indices.length > MAX_TARGETS) return none;
  return { indices, byIndex };
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
function buildRewritePrompt({ digest, language, questions, targets, gradeBand = null }) {
  const qs = Array.isArray(questions) ? questions : [];
  const { indices, byIndex } = targets;
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const sloLines = slos
    .map((s) => `- ${s.id} [taught at ${s.taught_level || 'understand'}] ${sloStatement(s, language)}`)
    .join('\n');
  const material = [
    digest && digest.topic_as_taught ? `topic as she taught it: ${digest.topic_as_taught}` : null,
    (digest && Array.isArray(digest.examples_used) && digest.examples_used.length)
      ? `her own examples: ${digest.examples_used.slice(0, 8).join('; ')}` : null,
    (digest && Array.isArray(digest.key_terms) && digest.key_terms.length)
      ? `the words she used: ${digest.key_terms.slice(0, 12).join(', ')}` : null,
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

  return `You are FIXING a short WhatsApp quiz written for the children who sat in ONE real lesson. ${indices.length} of its ${qs.length} questions were rejected by our checks. You are writing ONE replacement for each. Every other question is good and is staying exactly as it is — do not touch it, do not return it.

QUIZ LANGUAGE: ${LANG_NAME[language] || 'Urdu'}. ${languageRule(language)}

REWRITE THESE QUESTIONS: ${label(indices)}

WHAT THESE CHILDREN WERE MEANT TO LEARN. A replacement stays on its own question's SLO, at its own question's level.
${sloLines || '(no SLOs recorded)'}

THE LESSON'S OWN MATERIAL — dress the replacement in it, so a child recognises the class in the quiz.
${material || '(none recorded)'}

THE QUESTIONS THAT ARE STAYING. A replacement must not ask one of these again, and must not have the same answer as one of them.
${staying || '(none)'}

REJECTED — write one new question for each.

${rejected}

A RE-WORDING OF A REJECTED QUESTION IS REJECTED AGAIN. Change WHAT is asked, not how it is phrased: same SLO, same level, same lesson material, a different question — one any child who understood the idea can answer.

NO NEW PICTURES. Every replacement is a text question: leave "figure" and "figure_role" null. A replacement that carries a figure is thrown away and its rejected question is dropped from the quiz instead, so the child loses a question.

${questionContract({ gradeBand })}

${SELECTED_BECAUSE_RULE}
${RELIGIOUS_CONTENT_RULE}

Return ONLY this JSON object, with exactly ${indices.length} entr${indices.length === 1 ? 'y' : 'ies'} and nothing else. "index" is the number after the q above, and must be one of: ${indices.join(', ')}.
{ "questions": [
  { "index": ${indices[0]}, "slo_id": "${(qs[indices[0]] || {}).slo_id || 'S1'}", "level": "${(qs[indices[0]] || {}).level || 'understand'}",
    "question": "", "options": ["", "", ""], "correct_index": 0,
    "explanation": "", "selected_because": "", "distractor_misconceptions": { "1": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } },
    "figure": null, "figure_role": null } ] }
(In that example the correct option is index 0, so the wrong keys are "1" and "2". If correct_index is 1 the keys are "0" and "2"; if it is 2 the keys are "0" and "1".)`;
}

/**
 * Put the replacements back at their own positions.
 *
 * A replacement is taken only when it names (or is positionally matched to) a
 * target index AND carries no figure; anything else leaves the original
 * question in place, where the validator will reject it again and the salvage
 * will drop that one — one question lost instead of the repair.
 *
 * @returns {{questions:object[], replaced:number[]}|null} null when nothing was replaced
 */
function mergeReplacements(questions, json, targets) {
  const qs = Array.isArray(questions) ? questions : [];
  const list = Array.isArray(json && json.questions) ? json.questions : [];
  const { indices } = targets;
  const chosen = new Map();
  list.forEach((r, pos) => {
    if (!r || typeof r !== 'object') return;
    const named = Number(r.index);
    const idx = Number.isInteger(named) && indices.includes(named) ? named : indices[pos];
    if (idx === undefined || chosen.has(idx) || !indices.includes(idx)) return;
    if (r.figure) return;                       // the no-picture contract, asserted
    if (!String(r.question || '').trim()) return;
    chosen.set(idx, r);
  });
  if (!chosen.size) return null;
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
  return { questions: out, replaced: [...chosen.keys()].sort((a, b) => a - b) };
}

/**
 * ONE call. Never throws: a rewrite that cannot be made is a rewrite that did
 * not happen, and the salvage behind it is unchanged.
 *
 * @returns {Promise<{attempted:boolean, indices:number[], merged:object[]|null,
 *   replaced:number[], model?:string, costUsd?:number, latencyMs?:number, error?:string}>}
 */
async function rewriteRejected({
  questions, errors, digest, language, gradeBand = null,
  // quizId is accepted and ignored here on purpose: the outcome event is emitted
  // by the caller, which is the only place that knows whether the merged set
  // validated.
  quizId = null,
}) {  // eslint-disable-line no-unused-vars
  const targets = rewriteTargets(errors);
  if (!targets.indices.length) return { attempted: false, indices: [], merged: null, replaced: [] };
  const prompt = buildRewritePrompt({ digest, language, questions, targets, gradeBand });
  try {
    const { json, model, costUsd, latencyMs } = await completeJson({
      prompt, maxTokens: 8000, label: 'transcript_quiz.rewrite',
    });
    const merged = mergeReplacements(questions, json, targets);
    return {
      attempted: true,
      indices: targets.indices,
      merged: merged ? merged.questions : null,
      replaced: merged ? merged.replaced : [],
      model,
      costUsd,
      latencyMs,
    };
  } catch (err) {
    return {
      attempted: true, indices: targets.indices, merged: null, replaced: [], costUsd: 0, error: err.message,
    };
  }
}

module.exports = {
  rewriteTargets, buildRewritePrompt, mergeReplacements, rewriteRejected, MAX_TARGETS, PER_QUESTION,
};
