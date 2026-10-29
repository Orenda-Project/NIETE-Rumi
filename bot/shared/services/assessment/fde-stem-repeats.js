'use strict';
/**
 * Repeats the give-away check let past on the v31 Grade 3-4 papers (bd-5jmnfj.33.3). G4 Science asked
 * "What is a vacuum?" as an MCQ and again as a short answer; G3 GK asked one Urdu question twice with two
 * words changed; G4 English keyed "to the sea" and «Taleemabad» and printed them in later stems; G3 Urdu
 * keyed «کہانیاں» and a later stem printed its singular «کہانی».
 *
 * Three checks, each flagging the later item: the same stem twice (word for word, or an Urdu stem of six
 * or more words sharing four fifths of its words with a later one); a short MCQ key, or a proper noun in
 * an answer, printed in another stem; a one-word Urdu plural key whose singular another stem prints.
 *
 * Grade 3-4 papers only (every mid-pattern slot is `g3.` or `g4.`): Grades 1-2 and 5 keep the checks they had, and a
 * Grade 1 picture paper rightly asks "Write the name." under every picture.
 *
 * Pure: exam JSON in, `{slot, reason:'giveaway', words, with, text, printed}` flags out. fde-answer-repeats
 * merges them so the re-ask loop names them.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const WORD = /[\p{L}\p{M}]+/gu;
// Digits too, so "Multiply: 92 x 4" and "Multiply: 125 x 3" are two stems, not one.
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
const ARABIC = /[؀-ۿ]/;
const MID = /^g[34]\./;
const STOP = new Set(('the a an of in on at to for and or is are was were it its by with from this that these those what '
  + 'which who whom whose when where why how does did do will would can could should has have had be been being not '
  + 'no all any each one two three four five your our their his her they them you we he she').split(' '));
const SINGULARS = [[/یاں$/, 'ی'], [/یوں$/, 'ی'], [/وں$/, ''], [/یں$/, ''], [/ے$/, 'ا'], [/ے$/, 'ہ']];

const words = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().match(WORD) || [];
const tokens = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().match(TOKEN) || [];
const content = (s) => [...new Set(words(s).filter((w) => [...w].length >= 3 && !STOP.has(w)))];
// "a) to the sea" -> "to the sea", as fde-early-prompt reads a choice.
const choice = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();
const options = (q) => (Array.isArray(q.options) ? q.options : []);
const isMcq = (q) => options(q).length > 1;
const excerpt = (q) => String(q.question || '').replace(/\s+/g, ' ').trim().slice(0, 70);
// A crude English stem so "currents" meets "current" and "carried" meets "carry".
const stem = (w) => (/^[a-z]{5,}$/.test(w) ? w.replace(/(ies|es|s|ed|ing)$/, (m) => (m === 'ies' ? 'y' : '')) : w);
const shared = (a, b) => [...new Set(a)].filter((w) => b.includes(w)).length;
const distinct = (a) => new Set(a).size;

// The same stem twice: word for word, or an Urdu stem of six or more words four fifths the same.
function sameStems(list, flag) {
  const norm = list.map((q) => tokens(q.question));
  list.forEach((q, i) => list.forEach((o, j) => {
    if (j <= i || o.slot === q.slot || !norm[i].length) return;
    const [a, b] = [norm[i], norm[j]];
    const same = a.length === b.length && a.every((w, k) => w === b[k]);
    const urdu = ARABIC.test(String(q.question)) && a.length >= 6 && b.length >= 6
      && shared(a, b) >= 0.8 * Math.min(distinct(a), distinct(b));
    if (same || urdu) flag(j, i, content(q.question).length ? content(q.question) : a);
  }));
}

// The capitalised words of an answer that do not open a sentence («Taleemabad»), lower-cased.
function properNouns(answer) {
  const out = new Set();
  String(answer == null ? '' : answer).split(/[.!?؟۔]\s*|\n/).forEach((sentence) => {
    (sentence.match(WORD) || []).slice(1).forEach((t) => {
      if (/^\p{Lu}/u.test(t) && t.length >= 4 && !STOP.has(t.toLowerCase())) out.add(t.toLowerCase());
    });
  });
  return [...out];
}

// A key printed in another stem: an MCQ key of one or two content words (another slot), or a proper noun
// in a written answer (any slot).
function keyWords(list, flag) {
  const printed = list.map((q) => new Set([q.question, ...options(q).map(choice)].flatMap(words).map(stem)));
  list.forEach((q, i) => {
    // Only the item's own stem excuses a key word: its options always print the key.
    const own = new Set(words(q.question).map(stem));
    let targets = [];
    if (isMcq(q)) {
      const k = content(choice(q.answer)).map(stem).filter((w) => !own.has(w));
      if (k.length && k.length <= 2) targets = k;
    } else targets = properNouns(q.answer).map(stem).filter((w) => !own.has(w));
    targets.forEach((w) => list.forEach((o, j) => {
      if (j === i || (isMcq(q) && o.slot === q.slot) || !printed[j].has(w)) return;
      flag(Math.max(i, j), Math.min(i, j), [w]);
    }));
  });
}

const singulars = (w) => [...new Set(SINGULARS.filter(([re]) => re.test(w)).map(([re, to]) => w.replace(re, to))
  .filter((s) => s !== w && [...s].length >= 3))];

// A one-word Urdu key («کہانیاں») whose singular («کہانی») another slot's stem prints.
function urduPlurals(list, flag) {
  const stems = list.map((q) => new Set(words(q.question)));
  list.forEach((q, i) => {
    const ws = words(choice(q.answer));
    if (ws.length !== 1 || !ARABIC.test(ws[0])) return;
    singulars(ws[0]).forEach((s) => list.forEach((o, j) => {
      if (j === i || o.slot === q.slot || !stems[j].has(s)) return;
      flag(Math.max(i, j), Math.min(i, j), [s]);
    }));
  });
}

/** `{slot, reason:'giveaway', words, with, text, printed}` for each later item an earlier one gives away. */
function stemRepeats(examJson) {
  if (!examJson) return [];
  const list = itemsInOrder(examJson);
  if (!list.some((q) => MID.test(String(q.slot || '')))) return [];
  const out = new Map();
  const flag = (j, i, ws) => {
    const r = out.get(list[j].slot) || { slot: list[j].slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    ws.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
    if (!r.with.includes(list[i].slot)) { r.with.push(list[i].slot); r.text.push(excerpt(list[i])); }
    out.set(r.slot, r);
  };
  sameStems(list, flag);
  keyWords(list, flag);
  urduPlurals(list, flag);
  return [...out.values()];
}

module.exports = { stemRepeats };
