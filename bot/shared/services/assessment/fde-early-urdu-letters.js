'use strict';
/**
 * Grade 1 Urdu letter items keyed against the letters (v34 blocker, bd-5jmnfj.4.58). v34 Q1 had a middle-letter
 * MCQ with two right answers («تتلی»: ت and ل are both middle letters), two blank-letter MCQs whose keyed letter
 * did not make the word («گ_ڑیا» keyed د; «ہ_تی» keyed ا for ہاتھی), and a Join Letters item that spelt پنگھا and
 * keyed پنکھا. Letters are compared after NFC and with the Urdu diacritics stripped; «ھ» is its own letter.
 *
 * letterShortfall flags each as `{slot, reason:'answer', items}` so the writer asks the section again.
 * Pure: exam JSON, pattern and book text in, flags out; never throws.
 */

const URDU_SLOT = /\.urdu\./;
const MIDDLE_STEM = /لفظ\s*[«"“]\s*([^»"”]+?)\s*[»"”]\s*کا\s+درمیانی\s+حرف/u;
const TARGET_STEM = /لفظ\s+([\p{L}]+)\s+بنے/u;
const BLANK_WORD = /[\p{L}]*_+[\p{L}]*/gu;
const JOIN_RUN = /(?:\p{L}\s*\+\s*)+\p{L}/u;

const norm = (s) => String(s == null ? '' : s).normalize('NFC').replace(/[ً-ْٰ]/g, '');
const letters = (s) => Array.from(norm(s)).filter((c) => /\p{L}/u.test(c));
const label = (o) => norm(o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim();
const word = (s) => letters(s).join('');

/** Every letter of `w` except the first and the last. */
function middleLetters(w) { return letters(w).slice(1, -1); }

/** The stem's joined letters, plus signs and spaces dropped. */
function joinedLetters(stem) {
  const run = norm(stem).match(JOIN_RUN);
  return run ? run[0].replace(/[\s+]/g, '') : '';
}

/** The word with its blank (one or more underscores) filled by `letter`. */
function fillBlank(w, letter) { return norm(w).replace(/_+/, norm(letter)); }

function middleFlag(q) {
  const m = norm(q.question).match(MIDDLE_STEM);
  if (!m || !Array.isArray(q.options)) return null;
  const mid = new Set(middleLetters(m[1]));
  const key = word(label(q.answer));
  const right = q.options.map((o) => word(label(o))).filter((l) => mid.has(l));
  const spell = [...mid].join(' ');
  if (!mid.has(key)) return `${key} is not a middle letter of ${m[1]}; the middle letters are ${spell}`;
  if (right.length > 1) return `two options are middle letters of ${m[1]} (${right.join(', ')}); only the key may be one`;
  return null;
}

function bookWords(bookText) {
  return new Set(norm(bookText).split(/[^\p{L}]+/u).filter(Boolean));
}

function blankFlag(q, book) {
  if (!Array.isArray(q.options) || !q.options.length) return null;
  const stem = norm(q.question);
  const blank = (stem.match(BLANK_WORD) || []).find((t) => /\p{L}/u.test(t));
  if (!blank) return null;
  const opts = q.options.map((o) => word(label(o)));
  if (opts.some((o) => Array.from(o).length !== 1)) return null;
  const target = (stem.match(TARGET_STEM) || [])[1];
  const fits = target ? (w) => w === word(target) : (w) => book.has(w);
  if (!target && !book.size) return null;
  const filled = opts.map((o) => word(fillBlank(blank, o)));
  const key = word(label(q.answer));
  const keyFill = word(fillBlank(blank, key));
  if (!fits(keyFill)) return `the key ${key} makes ${keyFill}, which is not ${target ? `the word ${target}` : 'a word in the book'}`;
  const clash = filled.filter((w, i) => opts[i] !== key && fits(w));
  return clash.length ? `another option also makes a right word (${clash.join(', ')}); only the key may` : null;
}

function joinFlag(q) {
  const spelt = joinedLetters([q.question, q.main_question].filter(Boolean).join(' '));
  if (!spelt) return null;
  const accept = [].concat((q.scheme && q.scheme.accept) || q.accept || []);
  const bad = [q.answer].concat(accept).filter((a) => a != null && String(a).trim() && word(a) !== spelt);
  return bad.length ? `the letters join to ${spelt}, not ${bad.map(word).join(' / ')}` : null;
}

/** Letter items keyed wrongly or fillable two ways, as `{slot, reason:'answer', items}`. */
function letterShortfall(examJson, P, bookText) {
  const book = bookWords(bookText);
  const bySlot = new Map();
  ['seen', 'unseen'].forEach((branch) => Object.values((examJson && examJson[branch]) || {}).forEach((types) => {
    Object.entries(types || {}).forEach(([group, list]) => {
      if (!Array.isArray(list)) return;
      list.forEach((q) => {
        if (!q || !URDU_SLOT.test(String(q.slot || ''))) return;
        const why = middleFlag(q) || blankFlag(q, book) || (/join/i.test(group) ? joinFlag(q) : null);
        if (!why) return;
        if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
        bySlot.get(q.slot).push(`${String(q.question).trim()} → ${String(q.answer).trim()} (${why})`);
      });
    });
  }));
  return [...bySlot].map(([slot, items]) => ({ slot, reason: 'answer', items }));
}

module.exports = { letterShortfall, middleLetters, joinedLetters, fillBlank };
