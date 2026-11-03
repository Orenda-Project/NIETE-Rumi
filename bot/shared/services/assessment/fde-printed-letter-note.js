'use strict';
/**
 * A common-error note that names a letter the paper already prints (bd-5jmnfj.4.58.2).
 * v26 G1 English Q11 iv: stem "l _ _ b", key note "Leaves out the silent letter b": the b is
 * printed, the child writes a and m. Pure: no I/O, never throws.
 */

const BLANK = /_+/;
// "the silent letter b", "letter 'b'", "the silent b"
const NAMED = /\b(?:silent|letters?)\s+(?:letter\s+)?['"‘“]?([a-z])\b/gi;

// Letters outside the blanks of a fill-the-letters stem; empty when the stem has no blank.
function printedLetters(question) {
  const stem = String(question == null ? '' : question);
  if (!BLANK.test(stem)) return new Set();
  return new Set(stem.replace(/_+/g, ' ').toLowerCase().match(/[a-z]/g) || []);
}

// True when the note names a letter the stem prints.
function namesPrintedLetter(question, note) {
  try {
    const printed = printedLetters(question);
    if (!printed.size) return false;
    const text = String(note == null ? '' : note);
    for (const m of text.matchAll(NAMED)) if (printed.has(m[1].toLowerCase())) return true;
    return false;
  } catch (_) {
    return false;
  }
}

module.exports = { namesPrintedLetter, printedLetters };
