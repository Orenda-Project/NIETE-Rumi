'use strict';
/**
 * v3 `ma.number_id`, `ma.add1`, `ma.sub1` — 20 items, 60 s, no stop rule (EGMA Toolkit pp.10–12, 46).
 * R8: add/sub level 1 is AI-only with Gemini 3.8 Flash and the 20 printed sums (89% item agreement, ±3 for
 * 88% of children); it goes to the coach only when the task is not found in the note. Number identification
 * is `ai_review` (unsettled or conf < 0.65), with the EGMA "hundred" rule in its prompt.
 */
const P = require('./prompts');
const { timedTask } = require('./engine');

const OP_OF = { add1: '+', sub1: '-' };

function raw(json, n) {
  const out = new Array(n).fill(null);
  (json.items || []).forEach((it, j) => { const k = (Number(it.i) || j + 1) - 1; if (k >= 0 && k < n && !out[k]) out[k] = it; });
  return out;
}

function refOf(it) {
  if (it && typeof it === 'object') return it.id || P.sumText(it);
  return String(it);
}

async function score(ctx) {
  const { spec, grade, kind } = ctx;
  const items = spec.items;
  const isNum = kind === 'number_id';
  const prompt = isNum
    ? P.NUMBER_ID({ grade, items: items.map((x) => (typeof x === 'object' ? String(x.value != null ? x.value : x.text) : String(x))) })
    : P.FLUENCY_SUMS({ grade, op: OP_OF[kind], items: items.map((x) => ({ ...x, op: x.op || OP_OF[kind] })) });
  const m = await timedTask(ctx, {
    refs: items.map(refOf),
    firstItems: [],
    variants: [{ name: '', prompt, schema: isNum ? P.NUMBER_ID_SCHEMA : P.FLUENCY_SCHEMA, parse: (j) => raw(j, items.length) }],
  });
  if (m.flags.includes('task_not_found') && m.quality !== 'provisional') m.count_flag = { reason: 'task_not_found' };
  return m;
}

module.exports = { score };
