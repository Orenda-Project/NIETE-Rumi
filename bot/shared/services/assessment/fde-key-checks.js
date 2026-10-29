'use strict';
/**
 * Keys a teacher would mark against wrongly (bd-5jmnfj.4.57). v25 G2 Urdu Q3 iv keyed «ٹانگیں», a
 * word not in the box above it, and Q1 viii asked «کس نے» (who) and keyed a whole sentence beside
 * two names. Each is returned as an answer flag, so the writer asks the section again with
 * answerNote; the reason is written into the item's line.
 *
 * Pure: exam JSON and pattern in, flags out; never throws.
 */

const BOX_TYPES = new Set(['Complete the Sentences', 'Fill in the Blanks']);
const WHO = /کس نے|\bwho\b/i;
const label = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim().normalize('NFC');
const bare = (w) => label(w).replace(/[۔.,،!؟?]+$/u, '');

function eachItem(examJson, fn) {
  ['seen', 'unseen'].forEach((branch) => Object.values((examJson && examJson[branch]) || {}).forEach((types) => {
    Object.values(types || {}).forEach((list) => { if (Array.isArray(list)) list.forEach((q) => q && fn(q)); });
  }));
}

/** Items keyed off the word box, or a who question keyed with a sentence, as `{slot, reason:'answer', items}`. */
function keyShortfall(examJson, P) {
  const types = new Map(((P && P.sections) || []).flatMap((s) => s.slots || []).map((sl) => [sl.slot, sl.type]));
  const bySlot = new Map();
  eachItem(examJson, (q) => {
    if (!types.has(q.slot)) return;
    if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
    bySlot.get(q.slot).push(q);
  });
  const out = [];
  bySlot.forEach((items, slot) => {
    const bad = [];
    const line = (q, why) => `${String(q.question).trim()} → ${String(q.answer).trim()} (${why})`;
    if (BOX_TYPES.has(types.get(slot))) {
      const box = (items.find((q) => Array.isArray(q.words) && q.words.length) || {}).words;
      if (box) {
        const words = new Set(box.map(bare));
        items.filter((q) => !words.has(bare(q.answer)))
          .forEach((q) => bad.push(line(q, `the answer is not in the word box: ${box.join(', ')}; every answer must be one of the box words`)));
      }
    }
    items.filter((q) => Array.isArray(q.options) && WHO.test(String(q.question)) && label(q.answer).split(/\s+/).length > 3)
      .forEach((q) => bad.push(line(q, 'a who question is answered with a name, not a sentence; every choice is a name')));
    if (bad.length) out.push({ slot, reason: 'answer', items: bad });
  });
  return out;
}

module.exports = { keyShortfall };
