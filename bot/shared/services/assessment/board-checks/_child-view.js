'use strict';
/**
 * The child view: what `renderPaper(includeAnswerKey:false)` prints for one walker node.
 * main_question, question, options, passage, stimulus text, column_a, column_b, and `words`
 * only when the slot (or the item) sets `print_words` (assessment-generation.service.js:1988,
 * assessment-paper-fde.renderer.js:490). Never answer, scheme, tag, kind, calc.
 *
 * childFields(node, {inherit=true}) -> [{field, text}]. `inherit:false` leaves out a stimulus text
 * the node only inherits from a parent group (so a group's text is read once, at the group).
 */
const { str } = require('./_text-norm');
const { stimulusTextOf } = require('./_walk-local');

const list = (v) => (Array.isArray(v) ? v : [v]);

function childFields(node, { inherit = true } = {}) {
  const it = (node && node.item) || {};
  const out = [];
  const push = (field, v) => { if (v != null) list(v).forEach((x) => out.push({ field, text: str(x) })); };
  const stim = inherit ? node.stimulusText : stimulusTextOf(it);
  if (stim != null) out.push({ field: 'stimulus', text: str(stim) });
  push('main_question', it.main_question);
  push('question', it.question);
  push('options', it.options);
  push('passage', it.passage);
  push('column_a', it.column_a);
  push('column_b', it.column_b);
  if ((node.slotRow && node.slotRow.print_words) || it.print_words) push('words', it.words);
  return out;
}

module.exports = { childFields };
