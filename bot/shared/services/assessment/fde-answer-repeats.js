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
 *
 * v23 (bd-5jmnfj.4.51.3) widened what counts: a picture's name, sub-questions and answer text of other items
 * (answer text only for words of four letters or more); the words that tell a multiple-choice key from its
 * wrong options («salt» in "a jar with salt water"); the target words of a word-list question ("X: parts"
 * answer lines, or the list after a colon in the stem); and a crude stem (viruses/virus, salty/salt).
 */

const WORD = /[\p{L}\p{M}]+/gu;
// A grammar item keys these (are, she, under, اور); every other stem prints them, so they give nothing away.
const FUNCTION_WORDS = new Set(('are was were has have had she they you his her him them our their this that these those '
  + 'the and but with from for into over under near behind above below اور ہیں تھا تھی تھے').split(' '));
const wordsOf = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().match(WORD) || [];
const optionsOf = (q) => (Array.isArray(q.options) ? q.options : []);
// "الف) گاجر" -> "گاجر", as fde-early-prompt reads a choice.
const choice = (o) => String(o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();

// Crude plural / -y / -ed stem for the words a picture does not name: a picture item keeps exact words,
// since its key is spelt from the picture and «flower» is no give-away in "The flowers are red."
const stem = (w, loose = true) => {
  if (!loose || !/^[a-z]+$/.test(w) || w.length < 5) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/es$/.test(w) && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  if (/(y|ed)$/.test(w)) return w.slice(0, w.endsWith('y') ? -1 : -2);
  return w;
};
const GENERIC = new Set(['more', 'less', 'most', 'many', 'much', 'same', 'only']); // comparatives are not an answer
const longWord = (w) => [...w].length >= 4 && !FUNCTION_WORDS.has(w) && !GENERIC.has(w);
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter(Boolean) : []);

/** The item's one-word key, lower-cased; null for a sentence, a sum, a number or a single letter. */
function answerWord(q) {
  if (/\d/.test(String(q.answer == null ? '' : q.answer))) return null; // "6 + 5 = 11 pencils": the unit is not the key
  const w = wordsOf(choice(q.answer == null ? '' : q.answer));
  return w.length === 1 && [...w[0]].length >= 3 && !FUNCTION_WORDS.has(w[0]) ? w[0] : null;
}

const choiceSet = (q) => optionsOf(q).map((o) => wordsOf(choice(o)).join(' ')).sort().join('|');

// A multiple-choice key's own words: those no wrong option has («salt» in "a jar with salt water").
function distinctive(q) {
  const opts = optionsOf(q).map((o) => wordsOf(choice(o)));
  const key = wordsOf(choice(q.answer == null ? '' : q.answer)).join(' ');
  const at = opts.findIndex((w) => w.join(' ') === key);
  if (opts.length < 2 || at < 0 || opts[at].length < 3) return [];
  const others = new Set(opts.filter((_, k) => k !== at).flat());
  const own = opts[at].filter((w) => longWord(w) && !others.has(w));
  return own.length === 1 ? own : []; // a key that differs by one word; more than one is a different answer, not a word to hide
}

// The words a word-list question asks about: the list after the colon in the stem
// ("write in parts: A, B"). Answer-line leads are not read: they are speaker names and field labels.
function targets(q) {
  const out = new Set();
  const m = /[:：]([^:：]*)$/.exec(String(q.question == null ? '' : q.question));
  if (m) m[1].split(/[،,]/).forEach((p) => { const w = wordsOf(p); if (w.length === 1) out.add(w[0]); });
  return [...out].filter(longWord);
}

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

const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);

/** `{slot, reason:'giveaway', words, with, text}` for each question whose answer word another question gives away. */
function answerRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  // A bag of words: exact, and stemmed. A picture item's key is matched exactly (see `stem`).
  const bag = (texts) => {
    const raw = new Set(texts.flatMap(wordsOf));
    const st = new Set([...raw].map((w) => stem(w)));
    return { has: (w, loose) => (loose ? st.has(stem(w)) : raw.has(w)) };
  };
  const printed = list.map((q) => bag([q.question, ...optionsOf(q), q.picture && q.picture.name, ...subs(q).map((s) => s.question)]));
  // Answer text is checked by word of four letters or more: a key of three letters is no give-away there.
  const answered = list.map((q) => bag([q.answer, ...subs(q).map((s) => s.answer)].flatMap(wordsOf).filter(longWord)));
  const banks = list.map((q) => bag(Array.isArray(q.words) ? q.words : []));
  const keys = list.map(answerWord);
  const kws = list.map((q, i) => (keys[i] ? [{ w: keys[i], strict: false }]
    : distinctive(q).map((w) => ({ w, strict: true, printedOnly: true })).concat(targets(q).map((w) => ({ w, strict: true })))));
  // The oral sheet's words and questions, not its story: a story read aloud uses everyday words.
  const oral = ((examJson._layout && examJson._layout.oral && examJson._layout.oral.content) || [])
    .flatMap((t) => (t.items || []).map((it) => it && it.ask));
  const oralWords = bag(oral);
  const out = new Map();
  const flag = (slot, word, other, text) => {
    const r = out.get(slot) || { slot, reason: 'giveaway', words: [], with: [], text: [] };
    if (!r.words.includes(word)) r.words.push(word);
    if (!r.with.includes(other)) { r.with.push(other); r.text.push(text); }
    out.set(slot, r);
  };
  list.forEach((q, i) => kws[i].forEach(({ w, strict, printedOnly }) => {
    const loose = !q.picture;
    if (!strict && keys.filter((k, j) => k === w && list[j].slot === q.slot).length > 1) return;
    if (!strict && oralWords.has(w, loose)) flag(q.slot, w, 'oral', 'the oral sheet');
    list.forEach((o, j) => {
      if (j === i || (optionsOf(q).length && choiceSet(q) === choiceSet(o))) return;
      const other = o.slot !== q.slot;
      const hit = (printedOnly ? printed[j].has(w, loose) && answered[j].has(w, true) : printed[j].has(w, loose)) || (!printedOnly && ((other && banks[j].has(w, loose))
        || (loose && w.length > 3 && answered[j].has(w, true))
        || (keys[j] && (loose ? stem(keys[j]) === stem(w) : keys[j] === w)) || (other && kws[j].some((k) => (loose ? stem(k.w) === stem(w) : k.w === w)))));
      if (!hit || (strict && !other)) return;
      if (j > i) flag(o.slot, w, q.slot, excerpt(q)); else flag(q.slot, w, o.slot, excerpt(o));
    });
  }));
  return [...out.values()];
}

/** The flagged slots still giving an answer away once a section has been asked again. */
const stillGivenAway = (examJson) => answerRepeats(examJson);

/** A re-ask's note naming the answer words this section's flagged questions give away; null if none. */
function giveawayNote(shortfall) {
  const flags = shortfall.filter((f) => f.reason === 'giveaway');
  const words = [...new Set(flags.flatMap((f) => f.words))];
  if (!words.length) return null;
  const where = flags.flatMap((f) => (f.with || []).map((s, k) => `${s}${f.text && f.text[k] ? ` («${f.text[k]}»)` : ''}`));
  return `These answers already appear elsewhere on this paper: ${words.join(', ')}. `
    + `The other place${where.length > 1 ? 's' : ''}: ${[...new Set(where)].join('; ')}. `
    + 'Rewrite the items so that no answer word is printed in any other question, choice or word box, or is the answer to another item.';
}

module.exports = { answerRepeats, answerWord, giveawayNote, stillGivenAway };
