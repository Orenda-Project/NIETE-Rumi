'use strict';
/**
 * Cross-item repeats on the early Urdu papers (v37 round 6, G1 Urdu).
 *   boxWordRepeats  Q5 box word handed to Q10: «جھولے» was the Q5 iv answer and the spelling Q10 i pays for.
 *   mcqRepeats      Q1 vi and vii offered the same three letters with the same key (گ), so one carried the other.
 * Each returns rows {slot, reason:'answer', items:[...]} in the shape of fde-key-checks keyShortfall (the manager wires them
 * into the writer's re-ask). Pure.
 */

const { mapItems } = require('./fde-early-urdu-walk');

const BOX_TYPE = 'Fill in the Blanks';
const SENTENCE_TYPE = 'Picture Sentences';
const WORD = /[\p{L}\p{M}]+/gu;
const words = (s) => String(s == null ? '' : s).normalize('NFC').match(WORD) || [];
/** Stem of an Urdu word: its last vowel-ending letter dropped, so جھولا, جھولے and جھولی meet. */
const stem = (w) => (w.length > 3 && /[اےیہں]$/u.test(w) ? w.slice(0, -1) : w);

function itemsByType(examJson) {
  const byType = new Map();
  mapItems(examJson, (q, type) => { byType.set(type, (byType.get(type) || []).concat([q])); return q; });
  return byType;
}

function boxWordRepeats(examJson) {
  const byType = itemsByType(examJson);
  const box = ((byType.get(BOX_TYPE) || []).find((q) => Array.isArray(q.words) && q.words.length) || {}).words || [];
  const boxStems = new Map(box.flatMap((w) => words(w)).map((w) => [stem(w), w]));
  const rows = new Map();
  (byType.get(SENTENCE_TYPE) || []).forEach((q) => {
    const sentences = [q.answer].concat((q.scheme && q.scheme.accept) || []);
    const hit = sentences.flatMap(words).map((w) => boxStems.get(stem(w))).find(Boolean);
    if (!hit) return;
    const row = rows.get(q.slot) || { slot: q.slot, reason: 'answer', items: [] };
    row.items.push(`${String(q.answer).trim()} (the word «${hit}» is a Q5 box word; a picture sentence must not hand over the spelling of a word printed in Q5)`);
    rows.set(q.slot, row);
  });
  return [...rows.values()];
}

const optionKey = (q) => (q.options || []).map((o) => String(o).replace(/^[^)]*\)\s*/u, '').trim()).sort().join('|');
const keyOf = (q) => String(q.answer || '').replace(/^[^)]*\)\s*/u, '').trim();

function mcqRepeats(examJson) {
  const rows = new Map();
  const seen = new Map();
  (itemsByType(examJson).get('MCQs') || []).forEach((q) => {
    if (!Array.isArray(q.options) || !q.options.length) return;
    const sig = `${q.slot}#${optionKey(q)}#${keyOf(q)}`;
    if (!seen.has(sig)) { seen.set(sig, q); return; }
    const row = rows.get(q.slot) || { slot: q.slot, reason: 'answer', items: [] };
    row.items.push(`${String(q.question).trim()} (same three options and the same key «${keyOf(q)}» as «${String(seen.get(sig).question).trim()}»; no two items repeat one choice)`);
    rows.set(q.slot, row);
  });
  return [...rows.values()];
}

module.exports = { boxWordRepeats, mcqRepeats };
