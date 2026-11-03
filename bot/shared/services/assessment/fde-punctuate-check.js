'use strict';
/**
 * v28 G5 English Q3 (Punctuation) printed «...asked her friends where the library was they walked...» and keyed
 * «asked her friends, "Where is the library?"», with a mark for a question mark the printed words cannot carry
 * (bd-5jmnfj.4.58.4). The model answer is the printed words with capitals and punctuation added, nothing else.
 * A model answer whose words differ from the printed passage is a shortfall the writer is re-asked for once;
 * a paper that still carries one fails closed. A correction would have to invent punctuation, so none is made.
 *
 * Pure: exam JSON in, shortfall rows out in the shape fde-placeholder-check uses; never throws.
 */

const words = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/** `[{slot, reason:'punctuate_words', items:['<printed> → <model>']}]`; [] when every model matches its passage. */
function punctuateShortfall(examJson) {
  try {
    const slots = ((examJson && examJson._layout && examJson._layout.sections) || []).flatMap((s) => s.slots || []);
    const punct = new Set(slots.filter((s) => s.type === 'Punctuation').map((s) => s.slot));
    const bySlot = new Map();
    for (const types of Object.values((examJson && examJson.unseen) || {})) {
      for (const list of Object.values(types || {})) {
        for (const q of Array.isArray(list) ? list : []) {
          if (!q || q.removed === true || !punct.has(q.slot) || typeof q.answer !== 'string' || typeof q.question !== 'string') continue;
          if (words(q.question).join(' ') === words(q.answer).join(' ')) continue;
          const row = bySlot.get(q.slot) || { slot: q.slot, reason: 'punctuate_words', items: [] };
          row.items.push(`${q.question.trim()} → ${q.answer.trim()}`);
          bySlot.set(q.slot, row);
        }
      }
    }
    return [...bySlot.values()];
  } catch (err) {
    return [];
  }
}

/** The re-ask's note; null when the shortfall holds no punctuate_words row. */
function punctuateNote(shortfall) {
  const items = (Array.isArray(shortfall) ? shortfall : []).filter((r) => r && r.reason === 'punctuate_words').flatMap((r) => r.items || []);
  if (!items.length) return null;
  return `These punctuation items have a model answer that is not the printed passage: ${items.join('; ')}. `
    + 'The answer is exactly the printed words, with only capitals and punctuation added: never reword, add or drop a word, '
    + 'never turn a reported question into direct speech, and pay a mark only for punctuation the printed words can carry.';
}

module.exports = { punctuateShortfall, punctuateNote };
