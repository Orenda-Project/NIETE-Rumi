'use strict';
/**
 * bd-snkn32.70 — no part of a grades 1–5 "Make my own" plan becomes rote drill (ROTE_LINE asks it; this checks it).
 * Pure. Same patterns and negations as her request (lp-own-edit-guard.isRote); choral sound and word practice passes.
 *
 * REPAIR-ONLY, not a hard refusal: on the 6,000 stored days it fired on 43 (0.7%), nearly all plans naming rote to warn
 * against it ("retell, not copy", "not by rote" in Urdu), so it goes back to the model once and is never the final
 * refusal on its own (lp-k5-own-author). Unit: tests/lp612/bd-snkn32-70-change-checks.test.js.
 */
const { SECTIONS } = require('./lp-k5-own');
const { isRote } = require('./lp-own-edit-guard');

function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** [] passes; else one reason for the repair round, quoting the line. */
function roteDrill(next) {
  const rote = SECTIONS.flatMap((k) => strings((next && next[k]) || {})).find(isRote);
  if (!rote) return [];
  return [`turns a part into rote drill ("${rote.slice(0, 80)}"): no learning answers, definitions or passages by heart or copying them word for word; choral sound and word practice is fine`];
}

module.exports = { roteDrill };
