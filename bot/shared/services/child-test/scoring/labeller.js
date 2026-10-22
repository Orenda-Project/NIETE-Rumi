'use strict';
/**
 * Child test (bd-s1oo0.5) — fallback window labeller for sections whose cue
 * phrase was not found. Gemini 3 Flash on the timestamped transcript (§5: a
 * text labeller only has to name turns; the clock stays Soniox's).
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { renderTurns } = require('./stt');
const { timedSecondsFor } = require('./windows');

function itemsHint(block, spec) {
  if (block === 'maths') {
    return [`numbers: ${(spec.numbers || []).map((n) => n.value).join(', ')}`,
      `quick sums: ${(spec.quick_sums || []).slice(0, 6).map((q) => q.prompt).join(', ')}`,
      `word problem: ${spec.word_problem ? spec.word_problem.prompt_ur : ''}`].join('\n');
  }
  return [`story: ${spec.story ? String(spec.story.text).split(/\s+/).slice(0, 12).join(' ') : ''} …`,
    `questions: ${(spec.questions || []).map((q) => q.prompt).join(' | ')}`,
    spec.first_sounds ? `first-sound words: ${spec.first_sounds.map((f) => f.word).join(', ')}` : '',
    spec.nonwords ? `made-up words: ${spec.nonwords.map((n) => n.text).join(', ')}` : ''].filter(Boolean).join('\n');
}

/** Fill `missing` sections of `cut.windows` in place; returns the call record. */
async function labelMissing({ block, spec, words, cut, durationSec, calls }) {
  const model = modelFor('labeller');
  const r = await chatJSON({
    model, job: 'child_test.labeller', maxTokens: 2000,
    prompt: prompts.LABELLER({ block, sections: cut.missing, items: itemsHint(block, spec), transcript: renderTurns(words) }),
  });
  calls.push({ job: 'labeller', model, cost: r.cost, seconds: r.seconds, error: r.error });
  const got = (r.json && r.json.sections) || {};
  const filled = [];
  for (const s of cut.missing) {
    const w = got[s];
    if (!w || !Number.isFinite(Number(w.start_s)) || !Number.isFinite(Number(w.end_s))) continue;
    let start = Math.max(0, Number(w.start_s)); let end = Math.min(durationSec || Infinity, Number(w.end_s));
    if (s === 'story' || s === 'quick_sums') end = Math.min(end, start + timedSecondsFor(s, spec));
    if (end <= start) continue;
    cut.windows[s] = { start, end, source: 'labeller' };
    filled.push(s);
  }
  cut.missing = cut.missing.filter((s) => !filled.includes(s));
  return { ok: !!r.json, filled, modelVersion: model };
}

module.exports = { labelMissing };
