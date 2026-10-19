'use strict';
/**
 * Live moves (bd-v0toag.31): the detector prompt and its parser. Pure. The system text is a cut-down
 * fidelity GRADER_BRIEF (fidelity/grader-prompt.js): judge substance across languages, evidence only,
 * no keyword rule. It answers only "which of these moves has she done so far", never a verdict.
 */

const DETECT_BRIEF = `LIVE MOVE DETECTOR — prescribed teaching moves + the latest stretch of a live lesson transcript

You are a lesson-observation coach listening to a lesson as it happens. You are given (1) the
teaching MOVES from the lesson plan that are NOT yet ticked, each with what the teacher does and
what she says, and (2) the latest few minutes of TRANSCRIPT. Say which of these moves the
transcript shows she has done.

## Judge SUBSTANCE, across languages
The transcript is usually Urdu, often with English terms code-switched in; the move text is often
English or mixed. Match on what the move ACHIEVES, not on words. Her own words, a paraphrase, or
Urdu all count. Never require the plan's wording, and never tick a move because one word matched.

## Evidence only
Tick a move only when the transcript itself shows it. A move she has not reached, or that a garbled
span leaves unclear, stays unticked. One activity satisfies at most ONE move.

## Output
JSON only: {"done":[{"idx":<the move's idx>,"confidence":<0 to 1>}]}
List only moves you can see evidence for. {"done":[]} when there are none.`;

function buildDetectPrompt({ window, moves }) {
  const listed = moves.map((m) => JSON.stringify({ idx: m.idx, do: m.do, say: m.say }, null, 1).replace(/\n\s*/g, ' '));
  const user = `MOVES NOT YET TICKED:\n${listed.join('\n')}\n\nTRANSCRIPT (latest stretch):\n${window}`;
  return { system: DETECT_BRIEF, user };
}

function parseDetect(raw, untickedIdx, cutoff = 0.7) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.done)) return [];
  const open = new Set(untickedIdx);
  const out = [];
  for (const d of parsed.done) {
    if (!d || !Number.isInteger(d.idx) || !open.has(d.idx)) continue;
    if (typeof d.confidence !== 'number' || d.confidence < cutoff) continue;
    if (!out.includes(d.idx)) out.push(d.idx);
  }
  return out;
}

module.exports = { buildDetectPrompt, parseDetect, DETECT_BRIEF };
