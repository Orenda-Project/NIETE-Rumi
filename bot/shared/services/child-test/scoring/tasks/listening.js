'use strict';
/**
 * v3 `<lang>.listening` — the coach reads a short story aloud, then asks its questions (untimed, no stop
 * rule; EGRA Toolkit p.42). R8's arm "q": Gemini 3 Flash grades the Soniox transcript of the whole note with
 * the passage, the questions and their accepted answers (Urdu 72% item agreement, 80% on settled items).
 * A question the transcript does not show being asked ("s") is `none` and unsettled, not `not_reached`:
 * every listening question is asked, so it is the transcript that missed it.
 * Review (R8 §4): Urdu → unsettled or conf < 0.9. English listening is `provisional` (AI settles only 30%).
 */
const P = require('./prompts');
const { chatJSON } = require('../llm');
const { modelFor } = require('../models');
const C = require('./common');

async function score(ctx) {
  const { task, spec, media, lang, grade, calls } = ctx;
  const words = await C.wordsFor(media, lang, calls);
  const questions = spec.questions || [];
  const model = modelFor('comprehension');
  const r = await chatJSON({
    model, job: 'child_test.listening', maxTokens: 4000, schema: P.ORAL_SCHEMA,
    prompt: P.LISTENING({ lang, grade, passage: String((spec.story && spec.story.text) || '').replace(/\s+/g, ' ').trim(), questions, transcript: C.renderTurns(words) }),
  });
  calls.push({ job: 'listening', model, cost: r.cost, seconds: r.seconds, error: r.error });
  if (!r.json) throw new C.TaskError('listening_failed', r.error || 'no_json');
  const raw = C.byPosition(r.json.items, questions.length);
  const rows = questions.map((q, k) => {
    const it = raw[k] || {};
    const asked = it.v !== 's';
    const verdict = it.v === 'c' ? 'correct' : it.v === 'w' ? 'wrong' : 'none';
    return { i: k + 1, ref: q.id || q.prompt, verdict, heard: String(it.heard || ''), conf: C.confOf(it.conf), settled: verdict !== 'none', asked };
  });
  const score = { correct: rows.filter((x) => x.verdict === 'correct').length, of: rows.length, asked: rows.filter((x) => x.asked).length };
  const m = C.marks({ task, spec, score, items: rows, modelVersions: { comprehension: model, ...(media.sttModel ? { stt: media.sttModel } : {}) } });
  if (r.json.found === false) m.flags.push('task_not_found');
  return m;
}

module.exports = { score };
