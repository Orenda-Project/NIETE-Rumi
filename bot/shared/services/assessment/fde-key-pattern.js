/**
 * bd-5jmnfj.4.50.7: an MCQ key strip a child can read without the questions. Letters are option
 * indexes (0 = a); -1 is a key that cannot be read and never makes a pattern. For each period p
 * of 2 to 5 there are three tells:
 *   - a cycle run: p different letters, then the same p again over six keys or more («a b c d a b c d»,
 *     «b d a c b d a c», «a b a b a b»);
 *   - a fixed place: every p-th key on one letter, at least four times (every fourth key (d));
 *   - a fixed period: the strip repeating at p on every key, or, on a long strip, on half of them
 *     (chance is a quarter).
 */
const PERIODS = [2, 3, 4, 5];

// A run spans six keys at least, so «a b a b» alone (common by chance) is not one; «a b a b a b» is.
function cycleRun(letters, p) {
  const span = Math.max(2 * p, 6);
  for (let s = 0; s + span <= letters.length; s += 1) {
    const head = letters.slice(s, s + p);
    const run = letters.slice(s, s + span);
    if (head.every((x) => x >= 0) && new Set(head).size === p && run.every((x, i) => i < p || x === run[i - p])) return true;
  }
  return false;
}

function fixedPlace(letters, p) {
  for (let r = 0; r < p; r += 1) {
    const at = letters.filter((_, i) => i % p === r);
    if (at.length >= 4 && at[0] >= 0 && at.every((x) => x === at[0])) return true;
  }
  return false;
}

function fixedPeriod(letters, p) {
  const span = letters.length - p;
  if (span < p) return false;
  const same = letters.filter((x, i) => i >= p && x >= 0 && x === letters[i - p]).length;
  return same === span || (span >= 8 && same * 2 >= span);
}

// The first period whose tell the strip shows; 0 when it shows none.
function keyPattern(letters) {
  return PERIODS.find((p) => cycleRun(letters, p) || fixedPlace(letters, p) || fixedPeriod(letters, p)) || 0;
}

// An option that is itself a letter («a» in «a / an / the»): a bare-letter key written on it again
// reads as that option's text, so its item is never turned.
const LETTER_TEXT = /^\(?(?:[a-dA-D]|الف|ب|ج|د)\)?\s*[.):۔]?$/;
const letterOption = (texts) => texts.some((t) => LETTER_TEXT.test(t));

module.exports = { keyPattern, letterOption };
