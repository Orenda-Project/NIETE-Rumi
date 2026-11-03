'use strict';
/**
 * Grade 3-4 Maths key content that does not follow from the numbers (bd-5jmnfj.33.4, the v32 review):
 *  - a common error naming "forgetting the tens" of 43 x 3 printed 109, the slip gives 49 (G3 Q2 iii);
 *  - "gives 326 tens", "2488 hundreds", "33 tens and 2 ones" beside answers 326, 2428, 362 (G3 Q3 i, ii, Q4 i);
 *  - a division accept line naming the wrong count of first digits, and the correct start (51 for 5,100 / 14)
 *    listed as the slip (G4 Q2 iv); a "start with 5 alone" slip for 5,376 / 8 and "3 alone" for 3,672 / 24,
 *    digits smaller than the divisor, with figures no slip gives (G4 Q3 iii, iv);
 *  - a worked answer reading "24 does not go into 3 or 36 as first digit? It goes into 36 once" (G4 Q3 iv);
 *  - method marks (M) and "with a correct method" on items whose stem asks only for a number (G4 Q2 ii, v,
 *    Q3 i, Q4 i, ii; G3 Q2 i, iii): M becomes A, marks kept;
 *  - an MCQ whose stem asks for a multiplication sentence keyed to a bare number (G3 Q1 vii).
 * Pure: an item in, `{q, notes}` out; an item nothing touches is the same object.
 */

const { divisionOf, divisionSteps, firstDigits } = require('./fde-division-steps');

const { itemsInOrder } = require('./fde-near-repeats');
const MATHS = /^g[34]\.maths/;
const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const PRODUCT = /(\d[\d,]*)\s*[x×]\s*(\d[\d,]*)/;
const FORGET_TENS = /forgetting\s+(?:to\s+multiply\s+)?the\s+tens/i;
const PLACE = /((?:gives?|giving)\s+)(\d[\d,]*)\s+(tens|hundreds)(?=\s+and\s+(?:an\s+answer|\d+\s+ones))/gi;
const WRONG_START = /,?\s*(?:or\s+)?(?:starts?|starting)\s+(?:dividing\s+)?with\s+the\s+first\s+(one|two|three|four|five|six|seven|eight|nine)\s+digits?(?:\s+only)?/i;
const ALONE = /(?:using|starting\s+with|starts?\s+with|starts?\s+dividing\s+with)\s+(\d[\d,]*)\s+alone/i;
const GARBLED = /^[^.]*\?[^.]*\.\s*/;
// A stem that asks for steps, a named method, an explanation or a check pays method marks fairly.
const ASKS_WORK = /working|steps?\b|show\b|method|vertical|long division|place value|separately|written form|explain|check|expand|using\b|\bby (?:the )?(?:table|ones|tens|repeated)/i;
// An M point that really pays for method (a value check such as "Correct value of each side" is not one).
const METHOD_POINT = /method|aligning|multiply|multiplying|divid|carr|rule|partial|number sentence|steps?\b|bring down|digits used|goes into/i;
const BRACKET_METHOD = /\s*(?:with|using)\s+a\s+correct\s+method\b/i;
const MUL_SENTENCE = /multiplication\s+(?:sentence|fact)/i;
const MUL = /\d\s*[x×]\s*\d/;

const plain = (n) => String(n).replace(/,/g, '');
const withScheme = (q, patch) => ({ ...q, scheme: { ...q.scheme, ...patch } });

// "Writing 109 by ... forgetting the tens" on a 2-digit x 1-digit product: the figure the slip gives.
function slipFigure(q, notes) {
  const s = q.scheme;
  const m = PRODUCT.exec(String(q.question || ''));
  if (!m || typeof s.common_error !== 'string' || !FORGET_TENS.test(s.common_error)) return q;
  const [a, b] = [Number(plain(m[1])), Number(plain(m[2]))];
  const printed = /\d[\d,]*/.exec(s.common_error);
  if (!printed || a < 10 || a > 99) return q;
  const [ones, tens] = [a % 10, a - (a % 10)];
  const slip = ones * b + tens;
  if (Number(plain(printed[0])) === slip) return q;
  notes.push({ slot: q.slot, reason: 'slip_figure', from: printed[0], to: String(slip), sum: `${a} x ${b}` });
  return withScheme(q, { common_error: `Writing ${slip} by multiplying the ones (${ones} x ${b} = ${ones * b}) and adding the ${tens} without multiplying the tens.` });
}

// "gives 326 tens and an answer of 326" -> "gives 32 tens ..."; "33 tens and 2 ones ... answer of 362" -> "36 tens ...".
function placeText(text) {
  const fig = /answer of\s+(\d[\d,]*)/i.exec(text);
  if (!fig) return text;
  const n = Number(plain(fig[1]));
  return text.replace(PLACE, (all, lead, count, unit) => {
    const want = Math.floor(n / (unit.toLowerCase() === 'tens' ? 10 : 100));
    const ones = /^\s+and\s+(\d+)\s+ones/.exec(text.slice(text.indexOf(all) + all.length));
    if (Number(plain(count)) === want || (ones && Number(ones[1]) !== n % 10)) return all;
    return `${lead}${want} ${unit}`;
  });
}

function placeValue(q, notes) {
  const s = q.scheme;
  const fix = (t) => (typeof t === 'string' ? placeText(t) : t);
  const patch = { common_error: fix(s.common_error), accept: Array.isArray(s.accept) ? s.accept.map(fix) : s.accept };
  const answer = fix(q.answer);
  const same = patch.common_error === s.common_error && answer === q.answer
    && (!Array.isArray(s.accept) || patch.accept.every((t, i) => t === s.accept[i]));
  if (same) return q;
  notes.push({ slot: q.slot, reason: 'place_value_count' });
  return { ...withScheme(q, patch), answer };
}

function divisionStart(q, notes) {
  const d = divisionOf(q);
  const start = d && firstDigits(d.a, d.b);
  const s = q.scheme;
  if (!start) return q;
  let out = q;
  const proxy = { ...q, scheme: { points: (s.accept || []).map((text) => ({ text })), common_error: '' } };
  const accept = divisionSteps(proxy).q.scheme.points.map((p) => p.text);
  if (Array.isArray(s.accept) && accept.some((t, i) => t !== s.accept[i])) out = withScheme(out, { accept });
  const error = typeof s.common_error === 'string' ? s.common_error : '';
  const wrong = WRONG_START.exec(error);
  const alone = ALONE.exec(error);
  if (alone && Number(plain(alone[1])) < Number(plain(d.b))) {
    notes.push({ slot: q.slot, reason: 'impossible_start', start: alone[1], division: `${d.a} ÷ ${d.b}` });
    out = withScheme(out, { common_error: '' });
  } else if (wrong && COUNT[wrong[1].toLowerCase()] === start.count) {
    notes.push({ slot: q.slot, reason: 'correct_start_as_error', start: start.digits, division: `${d.a} ÷ ${d.b}` });
    out = withScheme(out, { common_error: error.replace(WRONG_START, '').replace(/[,\s]+$/, '').trim() });
  }
  const segment = GARBLED.exec(String(q.answer || ''));
  if (segment && start.count > 1 && segment[0].includes(start.digits)) {
    const n = Number(start.digits);
    const b = Number(plain(d.b));
    const first = `${plain(d.b)} does not go into ${plain(d.a).slice(0, start.count - 1)}, so start with ${start.digits}: ${start.digits} ÷ ${plain(d.b)} = ${Math.floor(n / b)} remainder ${n % b}. `;
    notes.push({ slot: q.slot, reason: 'garbled_working', division: `${d.a} ÷ ${d.b}` });
    out = { ...out, answer: String(q.answer).replace(GARBLED, first) };
  }
  return out;
}

function methodMarks(q, notes) {
  const s = q.scheme;
  if (!Array.isArray(s.points) || ASKS_WORK.test(String(q.question || ''))) return q;
  let changed = false;
  const points = s.points.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const text = typeof p.text === 'string' ? p.text.replace(BRACKET_METHOD, '') : p.text;
    const kind = p.kind === 'M' && METHOD_POINT.test(String(p.text)) ? 'A' : p.kind;
    if (text === p.text && kind === p.kind) return p;
    changed = true;
    return { ...p, text, kind };
  });
  if (!changed) return q;
  notes.push({ slot: q.slot, reason: 'method_unpaid' });
  return withScheme(q, { points });
}

const choiceText = (o) => String(o == null ? '' : o).replace(/^\s*\(?[a-z0-9]{1,2}\)\s*/i, '').trim();
const productOf = (t) => { const m = PRODUCT.exec(String(t)); return m ? Number(plain(m[1])) * Number(plain(m[2])) : null; };

function multiplicationKey(q, notes) {
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length < 2 || !MUL_SENTENCE.test(String(q.question || ''))) return q;
  const key = opts.find((o) => String(o).trim() === String(q.answer).trim()) || opts.find((o) => choiceText(o) === choiceText(q.answer));
  if (key && MUL.test(key)) return q;
  const muls = opts.filter((o) => MUL.test(o));
  const total = productOf(q.question);
  if (muls.length === 1 && total != null && productOf(muls[0]) === total) {
    notes.push({ slot: q.slot, reason: 'mcq_multiplication_key', action: 'rekeyed', from: q.answer, to: muls[0] });
    return { ...q, answer: muls[0] };
  }
  notes.push({ slot: q.slot, reason: 'mcq_multiplication_key', action: 're-ask', answer: q.answer });
  return q;
}

/** `{q, notes}` for a Grade 3-4 Maths item; any other item comes back as it was. */
function mathsSlips(q) {
  if (!q || !MATHS.test(String(q.slot || ''))) return { q, notes: [] };
  const notes = [];
  let out = multiplicationKey(q, notes);
  if (out.scheme && typeof out.scheme === 'object') {
    out = slipFigure(out, notes);
    out = placeValue(out, notes);
    out = divisionStart(out, notes);
    out = methodMarks(out, notes);
  }
  return { q: out, notes };
}

/**
 * Flags for a multiplication-sentence MCQ whose key is still no multiplication (midKeyFixes could not re-key it):
 * the shape answerRepeats carries into the generation service's `short`, so the section is asked again.
 */
function mcqKeyFlags(examJson) {
  return itemsInOrder(examJson).filter((q) => MATHS.test(String(q.slot || '')) && Array.isArray(q.options) && MUL_SENTENCE.test(String(q.question || '')))
    .filter((q) => !MUL.test(String(q.answer)) && !(q.options.find((o) => choiceText(o) === choiceText(q.answer)) && MUL.test(q.options.find((o) => choiceText(o) === choiceText(q.answer)))))
    .map((q) => {
      const m = PRODUCT.exec(String(q.question));
      return { slot: q.slot, reason: 'mcq_multiplication_key', words: [], with: [], text: [], stem: q.question, key: String(q.answer), product: m ? `${m[1]} x ${m[2]}` : null };
    });
}

/** The re-ask sentence for those flags; null if there are none. */
function mcqKeyNote(shortfall) {
  const flags = (shortfall || []).filter((f) => f.reason === 'mcq_multiplication_key');
  if (!flags.length) return null;
  return flags.map((f) => `Item "${f.stem}": the key ${f.key} is not a multiplication sentence${f.product ? ` equal to ${f.product}` : ''}. `
    + 'Write the item again with one option that is a multiplication sentence with that total (for example 6 x 4) and key that option.').join('\n');
}

module.exports = { mathsSlips, mcqKeyFlags, mcqKeyNote };
