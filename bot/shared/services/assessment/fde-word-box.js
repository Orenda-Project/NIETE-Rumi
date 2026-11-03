'use strict';
/**
 * A fill-in-the-blanks word box must not give the answers away (bd-5jmnfj.33.5.2). v33 G3 General Knowledge Q3
 * boxed ten words for ten blanks and G4 Science Q2 five words for five blanks, in blank order: with no word left
 * over the last blank is free and the item tests nothing. The box is `words` on the first item of the fill slot.
 *
 * A box needs at least blanks + 1 words (one that fits no blank), and the box words that are answers must not
 * sit in blank order (a single blank has no order). Grade 3-4 only (`P.g5_rules === false`).
 *
 * Pure: exam JSON in, `{slot, reason:'word_box', why, line, text}` flags out; never throws.
 */

const { itemsInOrder } = require('./fde-near-repeats');

// Case, spaces and Arabic-script diacritics do not make two words different.
const bare = (s) => String(s == null ? '' : s).normalize('NFC').replace(/[ً-ٰٟۖ-ۭ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const boxOf = (q) => (Array.isArray(q.words) ? q.words.filter((w) => typeof w === 'string' && bare(w)) : []);
const isFill = (q) => q && q.slot && !Array.isArray(q.options);

const SAY = {
  no_distractor: 'the box needs at least one extra word that fits none of the blanks',
  box_in_order: 'the box lists the answers in the same order as the blanks; shuffle it',
};

/** One flag per fill slot whose word box has no distractor or lists the answers in blank order. */
function wordBoxShortfall(examJson, P) {
  if (!examJson || !P || P.g5_rules !== false) return [];
  const bySlot = new Map();
  itemsInOrder(examJson).filter(isFill).forEach((q) => {
    if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
    bySlot.get(q.slot).push(q);
  });
  const out = [];
  bySlot.forEach((items, slot) => {
    const carrier = items.find((q) => boxOf(q).length);
    if (!carrier) return;
    const box = boxOf(carrier);
    const answers = items.map((q) => bare(q.answer));
    const why = [];
    if (box.length < items.length + 1) why.push('no_distractor');
    const answerSet = new Set(answers);
    const inBox = box.map(bare).filter((w) => answerSet.has(w));
    if (items.length > 1 && inBox.length === answers.length && inBox.every((w, i) => w === answers[i])) why.push('box_in_order');
    if (!why.length) return;
    const question = String(carrier.question || '').replace(/\s+/g, ' ').trim();
    out.push({ slot, reason: 'word_box', why, line: `${question} → ${box.join(', ')} (${why.map((w) => SAY[w]).join('; ')})`, text: [question] });
  });
  return out;
}

/** The re-ask note for the word_box flags in `shortfall`, or null. */
function wordBoxNote(shortfall) {
  const flags = (Array.isArray(shortfall) ? shortfall : []).filter((f) => f && f.reason === 'word_box');
  if (!flags.length) return null;
  return `${flags.map((f) => `Word box of «${f.text[0]}»: ${f.why.map((w) => SAY[w]).join(' and ')}.`).join('\n')}\n`
    + 'Give each fill-in-the-blanks word box at least one extra word that fits none of the blanks, and shuffle the box so it is not in blank order.';
}

module.exports = { wordBoxShortfall, wordBoxNote };
