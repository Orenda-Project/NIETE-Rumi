'use strict';
/**
 * Child test (bd-s1oo0.5) — spoken maths from the transcript and the item bank.
 *
 * The study's text grader worked without the item bank and was weak on number
 * identification (HARNESS_RESULTS §6: "number ID needs the bank"). With the
 * bank we know exactly which number or sum the child is looking at, so this is
 * deterministic: number words → values (number-grammar), aligned to the items.
 */

const { wordsToNumbers } = require('./number-grammar');
const { align } = require('./text-norm');

const NUMBERS_STOP_AFTER_WRONG = 4;

/** Numbers spoken in a word list, each with its time. */
function spokenNumbers(words) {
  const nums = wordsToNumbers(words.map((w) => w.raw || w.w));
  return nums.map((n) => ({ value: n.value, start: words[n.from].start, end: words[n.to].end }));
}

/**
 * Number identification: the child reads 8 numbers in order. Align heard values
 * to the item values; a substitution is `wrong` with what was heard; nothing
 * heard is `none`. Stop rule: after 4 wrong in a row the rest are `none`.
 */
function scoreNumbers(childWords, items) {
  const heard = spokenNumbers(childWords);
  const ref = items.map((it) => Number(it.value));
  const { status, hypIdx } = align(ref, heard.map((h) => h.value), (a, b) => a === b);
  let wrongRun = 0; let stopped = false;
  return items.map((it, i) => {
    if (stopped) return { id: it.id, verdict: 'none', heard: '', confidence: 0.5 };
    const h = hypIdx[i] >= 0 ? heard[hypIdx[i]] : null;
    let row;
    if (status[i] === 'correct') row = { id: it.id, verdict: 'correct', heard: String(h.value), confidence: 0.85 };
    else if (status[i] === 'sub') row = { id: it.id, verdict: 'wrong', heard: String(h.value), confidence: 0.6 };
    else row = { id: it.id, verdict: 'none', heard: '', confidence: 0.5 };
    wrongRun = row.verdict === 'correct' ? 0 : wrongRun + 1;
    if (wrongRun >= NUMBERS_STOP_AFTER_WRONG) stopped = true;
    return row;
  });
}

function operands(prompt) {
  return (String(prompt || '').match(/\d+/g) || []).map(Number);
}

/**
 * Quick sums: a 60-s run through the sums in order. The child may read the sum
 * aloud before answering ("تین جمع چار، سات"), so a heard pair equal to the
 * item's operands is skipped and the number after it is the answer.
 */
function scoreQuickSums(childWords, items, window) {
  const heard = spokenNumbers(childWords).filter((h) => !window || (h.start >= window.start - 0.2 && h.start < window.end));
  const out = [];
  let k = 0;
  for (const it of items) {
    if (k >= heard.length) break;
    const ops = operands(it.prompt);
    if (ops.length >= 2 && heard[k] && heard[k + 1] && heard[k].value === ops[0] && heard[k + 1].value === ops[1]) {
      k += 2;
      if (k >= heard.length) break; // read the sum but gave no answer before the minute ended
    }
    const ans = heard[k];
    k += 1;
    out.push({ id: it.id, verdict: ans.value === Number(it.answer) ? 'correct' : 'wrong', heard: String(ans.value), t: ans.start });
  }
  const correct = out.filter((x) => x.verdict === 'correct').length;
  const seconds = window ? Math.round((window.end - window.start) * 10) / 10 : 60;
  return { correct, attempted: out.length, seconds, items: out, confidence: out.length ? 0.7 : 0.4 };
}

/** The child's final spoken answer: the last number they say (counting aloud before it is not the answer). */
function spokenAnswer(childWords) {
  const nums = spokenNumbers(childWords);
  return nums.length ? nums[nums.length - 1].value : null;
}

module.exports = { scoreNumbers, scoreQuickSums, spokenAnswer, spokenNumbers, operands };
