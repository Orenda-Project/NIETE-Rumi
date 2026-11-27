/* quiz-duplicates — T83's judge: two questions on one quiz that ask the same thing with the same answer.
 *
 * Its own module so a unit test can load it without the shared engine (training-quiz-gen.cjs requires the
 * engine's stack-control at load, and CI has no engine).
 */
const short = (x, n = 160) => String(x == null ? '' : x).slice(0, n);
const normText = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const correctText = (q) => q && q['option_' + String(q.correct_option || '').toLowerCase()];
const words = (s) => new Set(normText(s).split(' ').filter((w) => w.length > 2));
// The numbers a stem states, Urdu / Arabic-Indic digits read as ASCII. Two stems with other numbers ask another
// question even when their words and answer match ("earnings 105, investment 40" vs "earnings 120, investment 55",
// both Rs 65): the spec keeps both ("the same question about another number … both stay").
const numbersOf = (s) => (String(s || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
  .match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))).sort().join(' ');
const overlap = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

/** Two questions that ask the same thing with the same answer (fill-in-the-blank folded in). */
const duplicates = (qs) => {
  const out = [];
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
    const a = qs[i], b = qs[j];
    const ca = normText(correctText(a)).replace(/ سے$/, ''), cb = normText(correctText(b)).replace(/ سے$/, '');
    if (!ca || ca !== cb) continue;
    if (numbersOf(a.question_text) !== numbersOf(b.question_text)) continue;
    const sa = normText(a.question_text).replace(/_+|ڈیش/g, ca), sb = normText(b.question_text).replace(/_+|ڈیش/g, cb);
    if (sa === sb || overlap(sa, sb) >= 0.85) out.push({ a: a.sort_order, b: b.sort_order, answer: short(correctText(a), 40), stemA: short(a.question_text, 70), stemB: short(b.question_text, 70) });
  }
  return out;
};

module.exports = { duplicates, normText, correctText, numbersOf };
