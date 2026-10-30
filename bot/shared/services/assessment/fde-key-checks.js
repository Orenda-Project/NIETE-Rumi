'use strict';
/**
 * Keys a teacher would mark against wrongly (bd-5jmnfj.4.57). v25 G2 Urdu Q3 iv keyed «ٹانگیں», a
 * word not in the box above it, and Q1 viii asked «کس نے» (who) and keyed a whole sentence beside
 * two names. Each is returned as an answer flag, so the writer asks the section again with
 * answerNote; the reason is written into the item's line.
 *
 * Pure: exam JSON and pattern in, flags out; never throws.
 */

const { boxClashes } = require('./fde-early-urdu-wordbox');
const { letterShortfall } = require('./fde-early-urdu-letters');
const { supplicationShortfall } = require('./fde-religious-terms');
const { earlyDupeShortfall } = require('./fde-early-dupes');
const { alternativeShortfall } = require('./fde-accept-alternatives');
const { boxWordRepeats, mcqRepeats } = require('./fde-early-urdu-repeat');
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
function keyShortfall(examJson, P, bookText) {
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
  // v29 G1 Urdu Q5: a box word that fits two blanks is asked again (fde-early-urdu-wordbox, bd-5jmnfj.4.58).
  const clashes = boxClashes(examJson, { ...P, sections: ((P && P.sections) || []).map((s) => ({ ...s, slots: (s.slots || []).filter((sl) => /\.urdu\./.test(sl.slot)) })) });
  // v34 G1 Urdu letter items and an authored supplication (bd-5jmnfj.4.58): asked again like the rest.
  // v34 accept-line prose and a target word or sentence asked twice (fde-early-dupes, bd-5jmnfj.4.58).
  // v35 round 6: a second listed choice that also fits (bd-5jmnfj.4.58.9.1); an Urdu Q5 box word handed to Q10, two Q1
  // MCQs with one option set and key (fde-early-urdu-repeat).
  const urduRepeats = boxWordRepeats(examJson).concat(mcqRepeats(examJson)).filter((r) => /\.urdu\./.test(r.slot));
  return out.concat(clashes, letterShortfall(examJson, P, bookText), supplicationShortfall(examJson, P), earlyDupeShortfall(examJson, P),
    alternativeShortfall(examJson, P), urduRepeats);
}

module.exports = { keyShortfall };
