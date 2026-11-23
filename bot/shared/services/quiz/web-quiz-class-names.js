'use strict';
/**
 * Two pure helpers that the standing class link, its evening round and the reminder payload all use, kept in a leaf
 * module so those three never require each other in a circle:
 *
 *   classLabels(gradeCode, section) -> { en, ur }   ONE class label form wherever a parent or child sees the class:
 *                                                   "Class 3 A" / «کلاس ۳ A» (Urdu digits; the section only when the
 *                                                   class has one; at most 24 code points); nulls without a grade.
 *   firstNameOf(name) -> { canon, shown }            the canon first name (first token; the second when the first is a
 *                                                   Muhammad form) and the word shown on the chip (the name's own word).
 */
const Identity = require('./web-quiz-identity');

const LABEL_MAX = 24;
const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);
const cut = (s) => [...String(s)].slice(0, LABEL_MAX).join('');

/** "Class 3 A" / «کلاس ۳ A» from classes.grade_code ('grade_3') and section; nulls without a numeric grade. */
function classLabels(gradeCode, section) {
  const m = /(\d+)/.exec(String(gradeCode || ''));
  if (!m) return { en: null, ur: null };
  const sec = String(section || '').trim();
  const tail = sec ? ` ${sec}` : '';
  return { en: cut(`Class ${m[1]}${tail}`), ur: cut(`کلاس ${urDigits(m[1])}${tail}`) };
}

function firstNameOf(name) {
  const words = String(name || '').normalize('NFKC').trim().split(/[\s.\-_,/]+/).filter(Boolean);
  const toks = Identity.tokens(name);
  if (!toks.length) return { canon: '', shown: '' };
  const i = toks[0] === 'muhammad' && toks.length > 1 && words.length > 1 ? 1 : 0;
  return { canon: toks[i], shown: words[i] || words[0] };
}

module.exports = { classLabels, firstNameOf, LABEL_MAX };
