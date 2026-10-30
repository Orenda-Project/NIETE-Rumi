'use strict';
/**
 * Asks in one section that hand another section its answer (bd-5jmnfj.4.58.34), the three v29 G5 language cases:
 *  - WORD BOX: Urdu Q3 «دیے گئے الفاظ کے معنی» and English Q4 «use the words» test words; v29 Urdu Q1 item 17 asked
 *    «کس لقب سے پکارا جاتا ہے» while Q3 asks the meaning of «لقب». A box word printed in another slot's question is flagged
 *    on that slot. Only the two meaning slots count: a picture's word box is a hint list.
 *  - EXCLAMATORY: an MCQ keyed «exclamatory» on a paper with a punctuation item that scores an exclamation mark
 *    (English Q1(a) 17 'What a lovely garden this is!' against Q3). The MCQ's slot is flagged.
 *  - QUOTED KEY: a quoted sentence of 3 or more content words that is 80% inside another question's answer
 *    (English Q2 ii(b) «The fox collected five coins.», the key of Q2 i(d) «How many coins did the fox collect?»).
 *
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, choice, content } = require('./fde-near-repeats');

const MARKS = /[ً-ٰٟـ]/g;
const norm = (s) => String(s == null ? '' : s).replace(MARKS, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
const tokens = (s) => norm(s).toLowerCase().match(/[\p{L}]+/gu) || [];
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70);
const BOX_SLOTS = new Set(['urdu.C.Q3', 'english.C.Q4']);

/** Every written ask in paper order as {slot, text, answer, item}: an item, its questions, then each part's questions. */
function asks(examJson) {
  const out = [];
  if (!examJson) return out;
  itemsInOrder(examJson).forEach((q) => {
    out.push({ slot: q.slot, text: q.question, answer: q.answer, item: q });
    (Array.isArray(q.questions) ? q.questions : []).filter(Boolean).forEach((s) => out.push({ slot: q.slot, text: s.question, answer: s.answer, item: q }));
    (Array.isArray(q.parts) ? q.parts : []).forEach((p) => ((p && p.questions) || []).filter(Boolean)
      .forEach((s) => out.push({ slot: q.slot, text: s.question, answer: s.answer, item: q })));
  });
  return out;
}

const add = (out, slot, word, withSlot, text) => {
  const r = out.get(slot) || { slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
  if (!r.words.includes(word)) r.words.push(word);
  r.with.push(withSlot);
  r.text.push(text);
  out.set(slot, r);
};

function boxWords(examJson, list, out) {
  list.filter((a) => BOX_SLOTS.has(a.slot) && Array.isArray(a.item.words)).forEach((box) => {
    const boxList = [...new Set(box.item.words.map((w) => norm(w).trim().toLowerCase()).filter((w) => w.length >= 3))];
    list.filter((a) => a.slot !== box.slot && a.text).forEach((a) => {
      const said = new Set(tokens(a.text));
      boxList.filter((w) => said.has(w)).forEach((w) => add(out, a.slot, w, box.slot,
        `the word box of ${box.slot}, which asks its meaning; «${excerpt(a.text)}» prints «${w}»`));
      // v37 G5 Urdu: a box word printed in the Q6 poem hands over its meaning; the box (not the book's verses) is asked again.
      const poem = new Set(tokens(a.item && a.item.passage));
      boxList.filter((w) => poem.has(w) && !said.has(w)).forEach((w) => add(out, box.slot, w, a.slot,
        `the word box of ${box.slot} holds «${w}», which the poem of ${a.slot} prints: choose another word`));
    });
  });
}

const mentionsExclamation = (a) => /exclamation|!/.test(`${a.text || ''} ${a.answer || ''} ${((a.item.scheme && a.item.scheme.points) || []).map((p) => p && p.text).join(' ')} ${(a.item.scheme && a.item.scheme.pts || []).join(' ')}`);

function exclamatory(list, out) {
  const punct = list.filter((a) => !(Array.isArray(a.item.options) && a.item.options.length > 1) && a.slot !== 'none' && mentionsExclamation(a));
  list.filter((a) => Array.isArray(a.item.options) && a.item.options.length > 1 && /exclamatory/i.test(choice(a.item.answer))).forEach((a) => {
    const other = punct.find((p) => p.slot !== a.slot);
    if (other) add(out, a.slot, 'exclamatory', other.slot, `${other.slot} scores an exclamation mark («${excerpt(other.text)}»)`);
  });
}

function quotedKeys(list, out) {
  list.forEach((a, i) => {
    const quoted = String(a.text || '').match(/["“«]([^"”»]{12,})["”»]/);
    if (!quoted) return;
    const mine = content(quoted[1]);
    if (mine.length < 3) return;
    list.forEach((o, j) => {
      if (j === i || !o.answer || o.text === a.text) return;
      const theirs = new Set(content(o.answer));
      if (mine.filter((w) => theirs.has(w)).length >= Math.ceil(0.8 * mine.length)) {
        add(out, a.slot, mine.find((w) => theirs.has(w)), o.slot, `«${excerpt(o.text)}» is answered by the sentence this item quotes`);
      }
    });
  });
}

/** One flag per slot that hands another section an answer. */
function crossAskFlags(examJson) {
  if (!examJson) return [];
  const out = new Map();
  const list = asks(examJson);
  boxWords(examJson, list, out);
  exclamatory(list, out);
  quotedKeys(list, out);
  return [...out.values()];
}

module.exports = { crossAskFlags, asks };
