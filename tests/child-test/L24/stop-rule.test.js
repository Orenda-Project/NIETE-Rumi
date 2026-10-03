'use strict';
/**
 * Child test L24 (bd-s1oo0.42), CR-2 — the stop rule does not hide a child who reads.
 *
 * The rule (CONTRACT §9.2): fewer than 5 words right in line 1 → the letters + words fallback, and the
 * check Flow then hides the story count. It counts line 1 from the model's per-word verdicts, and the
 * model sometimes marks line 1 `skipped` while counting 20–53 words right in the same reply. L23 found
 * 12 such blocks (golive/lanes/L23/stop_rule_cases.json); in 11 the enumerator counted 30 or more.
 *
 * The fix: a child whose own counted total is at least twice line 1's length read on past line 1, so
 * the coach did not stop them. The shapes below are L23's replies by id: the AI's total, the length of
 * the bank's line 1 (English 6 words, Urdu 11) and how the model marked it. Counts only, no words.
 */

const itemBank = require('../../../bot/shared/services/child-test/item-bank');
const { needsFallback } = require('../../../bot/shared/services/child-test/scoring/story');

/** A story part in the reply's shape: `correct` right of `attempted`, line 1 marked as `line1`. */
function part({ correct, attempted, line1 }, lineLen) {
  const flagged = [];
  let k = 0;
  for (const [verdict, n] of Object.entries(line1)) for (let j = 0; j < n; j += 1) flagged.push({ idx: k++, verdict });
  // the other wrong/skipped words after line 1, so the total stays `correct`
  const others = attempted - correct - flagged.length;
  for (let i = 0; i < others; i += 1) flagged.push({ idx: lineLen + 1 + i * 2, verdict: 'wrong' });
  return { words_correct: correct, words_attempted: attempted, flagged };
}

// [id, block, bank grade, AI words correct, AI words attempted, line-1 verdicts, enumerator's count]
const STOPPED_READERS = [
  ['AA_bd035dbb', 'english', 3, 53, 60, { skipped: 3 }, 55],
  ['AA_5536eaa7', 'english', 5, 52, 55, { wrong: 2 }, 58],
  ['AA_a5440eb3', 'english', 5, 44, 60, { wrong: 3 }, 54],
  ['AA_b11dfafb', 'english', 3, 39, 52, { skipped: 3 }, 0],
  ['AA_2a65f1d9', 'english', 5, 37, 60, { skipped: 6 }, 57],
  ['AA_a17b3477', 'english', 5, 34, 60, { skipped: 6 }, 34],
  ['AA_b2abea24', 'english', 3, 33, 57, { skipped: 6 }, 60],
  ['AA_271887cf', 'urdu', 3, 31, 60, { wrong: 7 }, 32],
  ['AA_e2237f3f', 'english', 3, 29, 60, { skipped: 6 }, 56],
  ['AA_fb785d2a', 'english', 3, 28, 60, { skipped: 6 }, 53],
  ['AA_a2bda34a', 'urdu', 5, 23, 43, { skipped: 11 }, 60],
  ['AA_df7b47e1', 'english', 5, 20, 43, { skipped: 6 }, 50],
];

const lineOf = (block, grade) => itemBank.getForm(grade, 'A')[block].story.lines[0];

describe('CR-2: a child whose own count shows reading is not sent to letters + words', () => {
  test('the bank\'s line 1 is 6 words in English and 11 in Urdu, at both grades', () => {
    for (const g of [3, 5]) {
      expect(lineOf('english', g)).toMatchObject({ from: 0, to: 5 });
      expect(lineOf('urdu', g)).toMatchObject({ from: 0, to: 10 });
    }
  });

  test.each(STOPPED_READERS)('%s (%s): %#', (id, block, grade, correct, attempted, line1) => {
    const spec = itemBank.getForm(grade, 'A')[block].story;
    const line = spec.lines[0];
    const p = part({ correct, attempted, line1 }, line.to - line.from + 1);
    expect(p.words_correct).toBe(correct);
    expect(needsFallback(p, spec)).toBe(false);
  });

  test('a child who genuinely could not read line 1 is still stopped (the real stop rule)', () => {
    const en = itemBank.getForm(3, 'A').english.story;
    const ur = itemBank.getForm(5, 'A').urdu.story;
    // 4 right of 6, nothing past line 1
    expect(needsFallback(part({ correct: 4, attempted: 6, line1: { wrong: 2 } }, 6), en)).toBe(true);
    // the whole first line skipped, a word or two later: below twice the line's length
    expect(needsFallback(part({ correct: 11, attempted: 18, line1: { skipped: 6 } }, 6), en)).toBe(true);
    expect(needsFallback(part({ correct: 21, attempted: 30, line1: { skipped: 9 } }, 11), ur)).toBe(true);
    expect(needsFallback({ words_correct: 0, words_attempted: 0, flagged: [] }, ur)).toBe(true);
  });

  test('exactly twice line 1\'s length right is reading', () => {
    const en = itemBank.getForm(3, 'A').english.story;
    expect(needsFallback(part({ correct: 12, attempted: 18, line1: { skipped: 6 } }, 6), en)).toBe(false);
  });
});
