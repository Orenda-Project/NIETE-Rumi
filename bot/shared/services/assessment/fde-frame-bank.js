'use strict';
/**
 * The instruction and word bank a label frame prints (bd-5jmnfj.4.50.4).
 *
 * The prompt asks a frame item for "the instruction and the labels/word bank"
 * (RULE.noPictures). A model writes them in `main_question`, the bank at its end
 * ("… on the lines in the frame. Word bank: lamp / bulb, wire, cell."), or the
 * bank in `words`. A frame whose pattern prints no `words` (the Science diagram)
 * printed neither: v22 G5 Science Q1 (b) was an empty frame, five numbered lines
 * and "Label the given Diagram", with nothing to label from.
 *
 * Pure: strings in, strings out.
 */

const BANK = /(?:word bank|مددگار الفاظ)\s*:\s*(.+?)\s*[.۔]?\s*$/i;
const wordsOf = (s) => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

/**
 * { line, words } for a frame item: `words` its bank (its own `words`, else the
 * list after "Word bank:"), `line` the instruction written before that bank less
 * any sentence that only repeats the slot's own instruction. Empty when the item
 * names no bank: an item without one (a map) prints as before.
 */
function frameBank(q, slotInstruction) {
  const text = String((q && q.main_question) || '').trim();
  const m = BANK.exec(text);
  const own = q && Array.isArray(q.words) ? q.words.map(String).map((w) => w.trim()).filter(Boolean) : [];
  const words = own.length ? own : (m ? m[1].split(/\s*[,،]\s*/).filter(Boolean) : []);
  const head = wordsOf(slotInstruction);
  const line = (m ? text.slice(0, m.index) : text).split(/(?<=[.!?۔])\s+/).map((s) => s.trim())
    .filter((s) => s && [...wordsOf(s)].some((w) => !head.has(w))).join(' ');
  return { line, words };
}

module.exports = { frameBank };
