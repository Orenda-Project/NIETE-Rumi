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

// Alignment scores for quick sums. A wrong answer (0) beats skipping a sum and dropping a
// heard number (-1.0), so re-lining up only wins when it recovers more than one right answer.
const QS = { match: 1, sub: 0, extra: -0.4, skip: -0.6, readAloud: 0.1 };

/**
 * Quick sums: a 60-s run through the sums in order, scored by aligning the
 * numbers heard to the item answers (run 3: pairing by position lost every
 * answer after the first stray number). What the alignment absorbs:
 *  - the child reads the sum aloud before answering ("تین جمع چار، سات"), even
 *    when STT mishears one of the two operands;
 *  - an echoed or repeated number ("6، 6");
 *  - STT joining two one-digit answers into one token ("48" for 4 then 8);
 *  - a skipped sum: attempted and wrong, the answers after it still line up.
 */
function scoreQuickSums(childWords, items, window) {
  const heard = spokenNumbers(childWords).filter((h) => !window || (h.start >= window.start - 0.2 && h.start < window.end));
  const n = items.length; const m = heard.length;
  const NEG = -Infinity;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(NEG));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  dp[0][0] = 0;
  const relax = (i, j, s, step) => { if (s > dp[i][j]) { dp[i][j] = s; back[i][j] = step; } };
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const s = dp[i][j];
      if (s === NEG) continue;
      if (j < m) relax(i, j + 1, s + QS.extra, { from: [i, j], t: 'extra' });
      if (i === n) continue;
      const ans = Number(items[i].answer);
      const ops = operands(items[i].prompt);
      const score = (h) => (heard[h].value === ans ? QS.match : QS.sub);
      if (j < m) relax(i + 1, j + 1, s + score(j), { from: [i, j], t: 'answer', h: j });
      if (j + 2 < m && ops.length >= 2 && (heard[j].value === ops[0] || heard[j + 1].value === ops[1])) {
        relax(i + 1, j + 3, s + score(j + 2) + QS.readAloud, { from: [i, j], t: 'answer', h: j + 2 });
      }
      if (j < m && i + 1 < n && String(heard[j].value) === `${ans}${Number(items[i + 1].answer)}`) {
        relax(i + 2, j + 1, s + 2 * QS.match, { from: [i, j], t: 'joined', h: j });
      }
      relax(i + 1, j, s + QS.skip, { from: [i, j], t: 'skip' });
    }
  }
  let bi = 0;
  for (let i = 0; i <= n; i += 1) if (dp[i][m] > dp[bi][m]) bi = i;
  const verdicts = new Array(n).fill(null);
  for (let i = bi, j = m; back[i][j];) {
    const st = back[i][j]; const [pi] = st.from;
    if (st.t === 'answer') {
      const h = heard[st.h]; const it = items[pi];
      verdicts[pi] = { id: it.id, verdict: h.value === Number(it.answer) ? 'correct' : 'wrong', heard: String(h.value), t: h.start };
    } else if (st.t === 'joined') {
      const h = heard[st.h];
      verdicts[pi] = { id: items[pi].id, verdict: 'correct', heard: String(items[pi].answer), t: h.start };
      verdicts[pi + 1] = { id: items[pi + 1].id, verdict: 'correct', heard: String(items[pi + 1].answer), t: h.start };
    } else if (st.t === 'skip') {
      verdicts[pi] = { id: items[pi].id, verdict: 'wrong', heard: '', t: null, skipped: true };
    }
    [i, j] = st.from;
  }
  let last = -1;
  verdicts.forEach((v, i) => { if (v && !v.skipped) last = i; });
  const out = verdicts.slice(0, last + 1);
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
