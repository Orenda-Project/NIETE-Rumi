'use strict';
/**
 * Model paragraph length (bd-5jmnfj.4.58.2). v26 G5 Urdu Q8 (میرا وطن) asked ten to twelve
 * sentences and keyed seven. A paragraph's model answer outside the asked range is returned as a
 * `length` flag, so the writer asks its section again with lengthNote.
 *
 * Pure: exam JSON in, flags out; never throws.
 */

// Slot -> asked sentence range, as the paper prints it (urdu.C.Q8: «دس سے بارہ جملے»).
const RANGES = { 'urdu.C.Q8': { min: 10, max: 12 } };
const DIALOGUE = /مکالمہ/;

/** Sentences in `text`: runs ended by ۔ ؟ ! ? or a full stop, plus a last one with no stop. */
function countSentences(text) {
  if (typeof text !== 'string') return 0;
  return text.split(/[۔؟!?]+|\.(?=\s|$)/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

function eachItem(examJson, fn) {
  ['seen', 'unseen'].forEach((branch) => Object.values((examJson && examJson[branch]) || {}).forEach((types) => {
    Object.values(types || {}).forEach((list) => { if (Array.isArray(list)) list.forEach((q) => q && fn(q)); });
  }));
}

/** Paragraph answers off their range, as `{slot, reason:'length', items:[line]}` (one flag per slot). */
function paragraphLength(examJson) {
  const out = new Map();
  eachItem(examJson, (q) => {
    const range = RANGES[q.slot];
    if (!range || typeof q.answer !== 'string' || DIALOGUE.test(String(q.question))) return;
    const n = countSentences(q.answer);
    if (n >= range.min && n <= range.max) return;
    const flag = out.get(q.slot) || { slot: q.slot, reason: 'length', range, items: [] };
    flag.items.push(`${String(q.question).trim()}: the model answer has ${n} sentences`);
    out.set(q.slot, flag);
  });
  return [...out.values()];
}

/** The re-ask note for the length flags, or null. */
function lengthNote(flags) {
  const mine = (flags || []).filter((f) => f && f.reason === 'length');
  if (!mine.length) return null;
  const lines = mine.flatMap((f) => f.items.map((i) => `- ${i} (asked: ${f.range.min} to ${f.range.max})`));
  const r = mine[0].range;
  return `A model paragraph answer must have ${r.min} to ${r.max} sentences, each ending ۔. These did not:\n${lines.join('\n')}\n`
    + `Write the answer again with ${r.min} to ${r.max} sentences.`;
}

module.exports = { countSentences, paragraphLength, lengthNote };
