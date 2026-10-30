'use strict';
/**
 * bd-5jmnfj.33 v33 BLOCKER — an MCQ stem that fuses two questions, or prints its own keyed option. G4 Urdu
 * ch8 Q1 x asked two questions in one stem and printed the key «زحل» in it. fde-answer-repeats and
 * fde-stem-repeats compare an answer with OTHER items and excuse an item's own stem, so this case had no check.
 *
 * Flags an MCQ with two or more question marks («؟» or «?») outside quoted text, and an MCQ whose stem holds the
 * keyed option as a whole word (label, diacritics and quotation marks stripped; keys under 3 characters, such as
 * a digit in an arithmetic stem, are not compared). Grade 3-4 only (`P.g5_rules === false`).
 * Pure: exam JSON in; `{slot, reason:'mcq_stem', why, text}` flags out.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const QUOTED = /"[^"]*"|“[^”]*”|«[^»]*»/g;
const MARKS = /[ً-ٰٟۖ-ۭ]/g;
const QUOTES = /["“”«»'‘’]/g;

const choice = (o) => String(o == null ? '' : o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '');
const norm = (s) => String(s == null ? '' : s).normalize('NFC').replace(MARKS, '').replace(QUOTES, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;

function printsKey(stem, key) {
  const k = norm(choice(key));
  if (k.length < 3 || !/\p{L}/u.test(k)) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${esc}($|[^\\p{L}\\p{M}\\p{N}])`, 'u').test(norm(stem));
}

/** Flags for each MCQ stem with two questions, or one that prints its keyed option. */
function mcqStemShortfall(examJson, P) {
  if (!examJson || !P || P.g5_rules !== false) return [];
  const out = [];
  itemsInOrder(examJson).filter(isMcq).forEach((q) => {
    const stem = String(q.question || '');
    const why = [];
    if ((stem.replace(QUOTED, ' ').match(/[؟?]/g) || []).length >= 2) why.push('two_questions');
    if (printsKey(stem, q.answer)) why.push('key_in_stem');
    if (why.length) out.push({ slot: q.slot, reason: 'mcq_stem', why, text: [stem.replace(/\s+/g, ' ').trim()] });
  });
  return out;
}

const SAY = {
  two_questions: 'asks two questions in one stem; ask one question',
  key_in_stem: 'prints its keyed answer in the stem; the stem must not contain the key',
};

/** The re-ask note for the mcq_stem flags in `shortfall`, or null. */
function mcqStemNote(shortfall) {
  const flags = (Array.isArray(shortfall) ? shortfall : []).filter((f) => f && f.reason === 'mcq_stem');
  if (!flags.length) return null;
  return `${flags.map((f) => `Item «${f.text[0]}» ${f.why.map((w) => SAY[w]).join(' and ')}.`).join('\n')}\n`
    + 'Rewrite each MCQ stem as one question that does not print the key answer.';
}

module.exports = { mcqStemShortfall, mcqStemNote };
