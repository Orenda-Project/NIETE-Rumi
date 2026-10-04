'use strict';
/**
 * Child test (bd-s1oo0.5) — comprehension answers from the transcript.
 * Gemini 3 Flash text grader on the diarised question window (§4: within one
 * answer of the enumerator for 79% of children at ~$0.001), now with each
 * question's accept/reject list and rubric.
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { renderTurns } = require('./stt');
const { clean } = require('./text-norm');
const { STUDY_AGREEMENT, clamp01 } = require('./thresholds');

const VERDICT = { correct: 'correct', wrong: 'wrong', no_answer: 'none', none: 'none' };

function mentions(heard, list) {
  const h = ` ${String(heard || '').split(/\s+/).map(clean).join(' ')} `;
  return (list || []).some((a) => { const k = String(a).split(/\s+/).map(clean).join(' '); return k && h.includes(` ${k} `); });
}

async function scoreQuestions({ lang, spec, words, window, calls }) {
  const questions = spec.questions || [];
  if (!questions.length) return { ok: true, part: [] };
  const model = modelFor('comprehension');
  const transcript = renderTurns(words, window.start, window.end + 5);
  const r = await chatJSON({
    model, job: 'child_test.comprehension', maxTokens: 3000,
    prompt: prompts.COMPREHENSION({ lang, passage: spec.story ? spec.story.text : '', questions, transcript }),
  });
  calls.push({ job: 'comprehension', model, cost: r.cost, seconds: r.seconds, error: r.error });
  if (!r.json) return { ok: false, error: r.error || 'no_json' };
  const byId = new Map(); const rows = (r.json.questions || []);
  rows.forEach((q, i) => byId.set(q.id || (questions[i] && questions[i].id), q));
  const part = questions.map((q) => {
    const a = byId.get(q.id);
    if (!a) return { id: q.id, verdict: 'none', heard: '', confidence: 0, asked: true };
    const verdict = VERDICT[a.verdict] || 'none';
    const self = Number.isFinite(Number(a.confidence)) ? clamp01(Number(a.confidence)) : 0.7;
    let c = 0.6 * self + 0.4 * STUDY_AGREEMENT.comprehension_within1;
    // the deterministic check the bank makes possible: the heard answer names an accepted / rejected answer
    if (verdict === 'correct' && mentions(a.answer, q.accept)) c += 0.1;
    if (verdict === 'wrong' && mentions(a.answer, q.reject)) c += 0.1;
    if (verdict === 'correct' && mentions(a.answer, q.reject) && !mentions(a.answer, q.accept)) c -= 0.25;
    // CONTRACT §20: the grader says whether the coach asked it; a reply without the flag reads as asked
    const asked = !(a.asked === false || a.asked === 'false');
    return { id: q.id, verdict, heard: String(a.answer || ''), confidence: Math.round(clamp01(c) * 100) / 100, asked };
  });
  return { ok: true, part, modelVersion: model };
}

module.exports = { scoreQuestions, mentions };
