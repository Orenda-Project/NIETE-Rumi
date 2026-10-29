'use strict';
/**
 * Answer words the paper gives away elsewhere (bd-5jmnfj.4.50.8). v22 G1 Urdu keyed «بلی» in Q3 iv
 * and Q7 iii and printed it in Q1 i's stem; «گاجر» was a wrong choice in Q1 ii and the key to Q1 vi.
 *
 * An answer word is a one-word key of three letters or more (a sentence, a sum or a letter is not).
 * It is given away when another item prints it (stem, choices, a word box of another question, a word
 * or question on the oral sheet) or keys it too. Not a give-away: a word the slot keys more than once,
 * two items offering the same set of choices (is/are, has/have), or a function word any sentence uses.
 *
 * Each pair flags the question set later on the paper, as repeatedPictures does; one the oral sheet
 * gives away flags the written item. Pure: reads the exam JSON only.
 */

const WORD = /[\p{L}\p{M}]+/gu;
// A grammar item keys these (are, she, under, اور); every other stem prints them, so they give nothing away.
const FUNCTION_WORDS = new Set(('are was were has have had she they you his her him them our their this that these those '
  + 'the and but with from for into over under near behind above below اور ہیں تھا تھی تھے').split(' '));
const wordsOf = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().match(WORD) || [];
const optionsOf = (q) => (Array.isArray(q.options) ? q.options : []);
// "الف) گاجر" -> "گاجر", as fde-early-prompt reads a choice.
const choice = (o) => String(o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();

/** The item's one-word key, lower-cased; null for a sentence, a sum, a number or a single letter. */
function answerWord(q) {
  const w = wordsOf(choice(q.answer == null ? '' : q.answer));
  return w.length === 1 && [...w[0]].length >= 3 && !FUNCTION_WORDS.has(w[0]) ? w[0] : null;
}

const choiceSet = (q) => optionsOf(q).map((o) => wordsOf(choice(o)).join(' ')).sort().join('|');

function itemsInOrder(examJson) {
  const order = new Map();
  ((examJson._layout && examJson._layout.sections) || []).forEach((s) => (s.slots || []).forEach((sl) => order.set(sl.slot, order.size)));
  const list = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(examJson[branch] || {})) {
      for (const l of Object.values(types || {})) if (Array.isArray(l)) list.push(...l.filter(Boolean));
    }
  }
  const at = (q) => (order.has(q.slot) ? order.get(q.slot) : order.size);
  return list.map((q, i) => ({ q, i })).sort((a, b) => at(a.q) - at(b.q) || a.i - b.i).map((x) => x.q);
}

/** `{slot, reason:'giveaway', words, with}` for each question whose answer word another question gives away. */
function answerRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  const printed = list.map((q) => new Set([q.question, ...optionsOf(q)].flatMap(wordsOf)));
  const banks = list.map((q) => new Set((Array.isArray(q.words) ? q.words : []).flatMap(wordsOf)));
  const keys = list.map(answerWord);
  // The oral sheet's words and questions, not its story: a story read aloud uses everyday words.
  const oral = ((examJson._layout && examJson._layout.oral && examJson._layout.oral.content) || [])
    .flatMap((t) => (t.items || []).map((it) => it && it.ask));
  const oralWords = new Set(oral.flatMap(wordsOf));
  const out = new Map();
  const flag = (slot, word, other) => {
    const r = out.get(slot) || { slot, reason: 'giveaway', words: [], with: [] };
    if (!r.words.includes(word)) r.words.push(word);
    if (!r.with.includes(other)) r.with.push(other);
    out.set(slot, r);
  };
  list.forEach((q, i) => {
    const w = keys[i];
    if (!w || keys.filter((k, j) => k === w && list[j].slot === q.slot).length > 1) return;
    if (oralWords.has(w)) flag(q.slot, w, 'oral');
    list.forEach((o, j) => {
      if (j === i || (optionsOf(q).length && choiceSet(q) === choiceSet(o))) return;
      const hit = printed[j].has(w) || keys[j] === w || (o.slot !== q.slot && banks[j].has(w));
      if (hit) flag(j > i ? o.slot : q.slot, w, j > i ? q.slot : o.slot);
    });
  });
  return [...out.values()];
}

/** A re-ask's note naming the answer words this section's flagged questions give away; null if none. */
function giveawayNote(shortfall) {
  const words = [...new Set(shortfall.filter((f) => f.reason === 'giveaway').flatMap((f) => f.words))];
  if (!words.length) return null;
  return `These answers already appear elsewhere on this paper: ${words.join(', ')}. `
    + 'Rewrite the items so that no answer word is printed in any other question, choice or word box, or is the answer to another item.';
}

module.exports = { answerRepeats, answerWord, giveawayNote };
