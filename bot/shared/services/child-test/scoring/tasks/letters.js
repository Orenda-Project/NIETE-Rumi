'use strict';
/**
 * v3 `<lang>.letters` — 100 letters, 60 s, nothing right in row 1 → stop (EGRA Toolkit p.188).
 * R8's best arm: Gemini 3.8 Flash with the exact grid, plus the row-by-row variant as a second opinion.
 * The variant that heard more letters right is the score (the model undercounts by dropping a row or
 * stopping near 70, R8 §3; on the May re-measure the higher of the two cut English MAE 7.5 → 7.0 and Urdu
 * 14.2 → 12.0, bias toward 0). When the two counts differ by more than the R8 tolerance
 * (English 3, Urdu 2) the count is flagged for the coach (en.letters is `ai_review`); per-letter flags are
 * never shown. Urdu letters are `provisional`: the disagreement is kept as a hidden audit only.
 */
const P = require('./prompts');
const { timedTask } = require('./engine');

const TOLERANCE = { en: 3, ur: 2 };

function gridRaw(json, n) {
  const out = new Array(n).fill(null);
  (json.items || []).forEach((it, j) => { const k = (Number(it.i) || j + 1) - 1; if (k >= 0 && k < n && !out[k]) out[k] = it; });
  return out;
}

function rowsRaw(json, n, perRow) {
  const out = new Array(n).fill(null);
  for (const r of json.rows || []) {
    const ri = (Number(r.row) || 0) - 1;
    (r.v || []).slice(0, perRow).forEach((v, j) => { const k = ri * perRow + j; if (ri >= 0 && k < n) out[k] = { v, heard: '', conf: r.conf }; });
  }
  return out;
}

async function score(ctx) {
  const { spec, lang, grade } = ctx;
  const items = spec.items.map(String);
  const perRow = Number(spec.per_row) || 10;
  const m = await timedTask(ctx, {
    refs: items,
    firstItems: items.slice(0, 2),
    pick: 'max_correct',
    variants: [
      { name: '', prompt: P.LETTERS({ grade, lang, items }), schema: P.LETTERS_SCHEMA, parse: (j) => gridRaw(j, items.length) },
      { name: 'rows', prompt: P.LETTER_ROWS({ grade, lang, items, perRow }), schema: P.ROWS_SCHEMA, parse: (j) => rowsRaw(j, items.length, perRow) },
    ],
  });
  const counts = m.second_opinion.map((x) => x.correct);
  if (Math.abs(counts[0] - counts[1]) > TOLERANCE[lang]) {
    m.flags.push('prompts_disagree');
    if (m.quality === 'ai_review') m.count_flag = { reason: 'prompts_disagree', counts };
  }
  return m;
}

module.exports = { score, TOLERANCE };
