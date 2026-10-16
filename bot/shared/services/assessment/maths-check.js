'use strict';
/**
 * Checking the arithmetic in a maths marking scheme.
 *
 * A model writing a key gets a product or a quotient wrong often enough that a
 * teacher cannot trust it, and a wrong key marks every right child wrong. Most
 * written items in a Grade 5 paper are plain computations, so this module
 * recognises the common forms, works the answer out exactly (BigInt fractions,
 * never floats), and compares it with the last number in the key.
 *
 * Agreeing keys are marked `checked: 'ok'`. A disagreeing key is corrected in
 * place, never flagged: the number is swapped for the computed one, written the
 * way the key wrote numbers, and a note is left for the scheme's last page.
 * Anything not recognised is `checked: null` and left exactly as it was.
 *
 * Pure: no I/O, no logging, never throws, and the paper passed in is not touched.
 */

// Grade 5 numbers are short; anything longer is not a school sum.
const MAX_DIGITS = 30;
// Longer text is not a single computation, and the scan is not free.
const MAX_TEXT = 4000;

const VULGAR = {
  '½': [1n, 2n], '⅓': [1n, 3n], '⅔': [2n, 3n], '¼': [1n, 4n], '¾': [3n, 4n],
  '⅕': [1n, 5n], '⅖': [2n, 5n], '⅗': [3n, 5n], '⅘': [4n, 5n], '⅙': [1n, 6n],
  '⅚': [5n, 6n], '⅛': [1n, 8n], '⅜': [3n, 8n], '⅝': [5n, 8n], '⅞': [7n, 8n],
};
const V = `[${Object.keys(VULGAR).join('')}]`;

// An ASCII slash only with no spaces (a spaced one divides); the typeset slashes either way.
const SLASH = String.raw`(?:\/|\s*[⁄∕]\s*)`;
// Pakistani grouping (3,56,123), then Western (4,567,098), then plain digits.
const INT = String.raw`(?:\d{1,2}(?:,\d{2})+,\d{3}(?!\d)|\d{1,3}(?:,\d{3})+(?!\d)|\d+)`;
// A combining bar or dot over a digit marks it as recurring.
const MARK = String.raw`[̄̅̇]`;

// One number: mixed (7 1/3, 7⅓), fraction (1/3), integer or decimal, a lone vulgar fraction.
const NUM = String.raw`(?:${INT}\s+\d+${SLASH}\d+(?!\d)|${INT}\s*${V}|\d+${SLASH}\d+(?!\d)|${INT}(?:\.(?:\d${MARK}?)+)?(?!\d)|${V})`;
const READ = new RegExp(
  String.raw`^(?:(${INT})\s+(\d+)${SLASH}(\d+)|(${INT})\s*(${V})|(\d+)${SLASH}(\d+)|(${INT})((?:\.(?:\d${MARK}?)+)?)|(${V}))$`,
);
const START = String.raw`(?<!\d)(?<!\d\.)`;
const SCAN = new RegExp(`${START}${NUM}`, 'g');

const EXPR = new RegExp(
  String.raw`${START}(${NUM})(?:\s*([×xX*÷+\-−–])\s*|\s+(\/)\s+)(${NUM})(?!\d)`, 'g',
);
// What may follow a bare computation: blanks, an equals sign, "show your working".
const TAIL_OK = /^[\s=?.!_…:,;()[\]\-–—]*(?:(?:and\s+)?show\s+(?:all\s+)?(?:your\s+|the\s+)?(?:working|work|steps)[\s.!]*)?$/i;
const DIGITISH = new RegExp(String.raw`[\d${Object.keys(VULGAR).join('')}]`);

const LIST = String.raw`${INT}(?:\s*,\s*${INT})*(?:\s*,?\s*and\s+${INT})?`;
const DEC = String.raw`${INT}(?:\.\d+)?`;
const DLIST = String.raw`${DEC}(?:\s*,\s*${DEC})*(?:\s*,?\s*and\s+${DEC})?`;
const LIST_END = String.raw`(?!\d)(?![.,]\d)`;

const HCF = String.raw`h\.?\s?c\.?\s?f\b\.?|highest\s+common\s+factor`;
const LCM = String.raw`l\.?\s?c\.?\s?m\b\.?|l(?:owest|east)\s+common\s+multiple`;
const HCF_WORD = new RegExp(`(?<![a-z])(?:${HCF})`, 'i');
const LCM_WORD = new RegExp(`(?<![a-z])(?:${LCM})`, 'i');
const FACTOR = new RegExp(
  String.raw`(?<![a-z])(${HCF}|${LCM})\s+of\s+(?:the\s+numbers\s+)?(${LIST})${LIST_END}`, 'i',
);
const AVERAGE = new RegExp(
  String.raw`(?<![a-z])(?:average|mean)\s+of\s+(?:the\s+(?:numbers|values|following)\s*:?\s*)?(${DLIST})${LIST_END}`, 'i',
);
const PERCENT = new RegExp(
  String.raw`${START}(${DEC})\s*%\s*(?:into|as|to)\s+(?:an?\s+)?decimals?\b`, 'i',
);
const TO_DECIMAL = new RegExp(
  String.raw`${START}(${NUM})\s+(?:into|as|to)\s+(?:an?\s+)?decimals?\b`, 'i',
);
const PERCENT_WORD = String.raw`(?:percentages?|per\s*cents?)\b`;
const TO_PERCENT = new RegExp(
  String.raw`${START}(${NUM})\s+(?:into|as|to)\s+(?:an?\s+)?${PERCENT_WORD}`, 'i',
);
const PERCENT_OF = new RegExp(String.raw`${START}(${DEC})\s*%\s*of\s+(${NUM})(?!\d)`, 'i');
// What marks a number in a key as a percentage: 45%, 45 %, 45 percent.
const PERCENT_SIGN = new RegExp(String.raw`^\s*(?:%|${PERCENT_WORD})`, 'i');
const EXPANDED_WORD = /expanded\s+(?:form|notation)/i;
const EXPANDED_OF = new RegExp(
  String.raw`expanded\s+(?:form|notation)\s+of\s+(?:the\s+number\s+)?(${INT})${LIST_END}`, 'i',
);
const EXPANDED_IN = new RegExp(
  String.raw`${START}(${INT})\s+in\s+(?:its\s+|the\s+)?expanded\s+(?:form|notation)`, 'i',
);
// An expanded form in a key: 4,000,000 + 200,000 + … or 4 × 1,000,000 + 2 × 100,000 + …
const TERM = String.raw`${INT}(?:\s*[×xX*]\s*${INT})?`;
const CHAIN = new RegExp(String.raw`${START}${TERM}(?:\s*\+\s*${TERM})+(?!\d)`, 'g');
const REMAINDER = /remainder|\brem\b|\bR\s*[=:]?\s*\d/i;

// ── Exact fractions ────────────────────────────────────────────────────────

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
}

function frac(num, den = 1n) {
  if (den === 0n) return null;
  const sign = den < 0n ? -1n : 1n;
  const n = num * sign;
  const d = den * sign;
  const g = gcd(n, d);
  return g > 1n ? { num: n / g, den: d / g } : { num: n, den: d };
}

const add = (a, b) => frac(a.num * b.den + b.num * a.den, a.den * b.den);
const sub = (a, b) => frac(a.num * b.den - b.num * a.den, a.den * b.den);
const mul = (a, b) => frac(a.num * b.num, a.den * b.den);
const div = (a, b) => (b.num === 0n ? null : frac(a.num * b.den, a.den * b.num));
const same = (a, b) => a.num === b.num && a.den === b.den;
const pow10 = (k) => 10n ** BigInt(k);
const HUNDRED = { num: 100n, den: 1n };

function twosAndFives(den) {
  let d = den;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) { d /= 2n; twos += 1; }
  while (d % 5n === 0n) { d /= 5n; fives += 1; }
  return { rest: d, places: Math.max(twos, fives) };
}

const terminates = (v) => twosAndFives(v.den).rest === 1n;
const exactPlaces = (v) => twosAndFives(v.den).places;
const floorScaled = (v, k) => (v.num * pow10(k)) / v.den;
const roundScaled = (v, k) => (2n * v.num * pow10(k) + v.den) / (2n * v.den);

function withinTolerance(a, b) {
  const diff = a.num * b.den - b.num * a.den;
  return (diff < 0n ? -diff : diff) * 200n <= a.den * b.den;
}

// ── Reading numbers ────────────────────────────────────────────────────────

const toInt = (raw) => BigInt(raw.replace(/,/g, ''));
const digitCount = (raw) => raw.replace(/\D/g, '').length;

function groupingOf(intRaw) {
  if (!intRaw.includes(',')) return null;
  return /^\d{1,2}(?:,\d{2})+,\d{3}$/.test(intRaw) ? 'pk' : 'western';
}

function token(kind, value, raw, intRaw, places = 0) {
  if (!value) return { invalid: true };
  return { kind, value, raw, places, grouping: groupingOf(intRaw), intDigits: digitCount(intRaw), digits: digitCount(raw) };
}

function readDecimal(raw, intRaw, fracRaw) {
  const whole = toInt(intRaw);
  if (!fracRaw) return token('integer', frac(whole), raw, intRaw);
  const digits = [];
  let firstMarked = -1;
  for (const ch of fracRaw.slice(1)) {
    if (/\d/.test(ch)) digits.push(ch);
    else if (firstMarked < 0) firstMarked = digits.length - 1;
  }
  if (firstMarked < 0) {
    const value = frac(whole * pow10(digits.length) + BigInt(digits.join('')), pow10(digits.length));
    return token('decimal', value, raw, intRaw, digits.length);
  }
  // 0.16̅ → non-repeating "1", repeating "6": (16 − 1) / (10 × 9).
  const fixed = digits.slice(0, firstMarked).join('');
  const repeat = digits.slice(firstMarked).join('');
  const top = BigInt(fixed + repeat) - BigInt(fixed || '0');
  const bottom = pow10(fixed.length) * (pow10(repeat.length) - 1n);
  return token('recurring', add(frac(whole), frac(top, bottom)), raw, intRaw, digits.length);
}

/** Read one number written alone; `improper` asks the caller to split "7 4/3". */
function readOne(raw) {
  const m = READ.exec(raw);
  if (!m) return null;
  if (m[1] !== undefined) {
    const n = BigInt(m[2]);
    const d = BigInt(m[3]);
    if (d === 0n || n === 0n || n >= d) return { improper: true, wholeRaw: m[1] };
    return token('mixed', frac(toInt(m[1]) * d + n, d), raw, m[1]);
  }
  if (m[4] !== undefined) {
    const [n, d] = VULGAR[m[5]];
    return token('mixed', frac(toInt(m[4]) * d + n, d), raw, m[4]);
  }
  if (m[6] !== undefined) return token('fraction', frac(BigInt(m[6]), BigInt(m[7])), raw, '');
  if (m[8] !== undefined) return readDecimal(raw, m[8], m[9]);
  const [n, d] = VULGAR[m[10]];
  return token('fraction', frac(n, d), raw, '');
}

function numbersIn(text) {
  const out = [];
  if (typeof text !== 'string' || text.length > MAX_TEXT) return out;
  const re = new RegExp(SCAN.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = readOne(m[0]);
    if (t && t.improper) {
      const whole = readOne(t.wholeRaw);
      if (whole && !whole.invalid) out.push({ ...whole, index: m.index });
      re.lastIndex = m.index + t.wholeRaw.length;
    } else if (t && !t.invalid) {
      out.push({ ...t, index: m.index });
    }
  }
  return out;
}

/** The last number in a key: `{ raw, value: {num, den}, index }` (BigInt), or null. */
function lastNumber(answerText) {
  try {
    const all = numbersIn(answerText);
    return all.length ? all[all.length - 1] : null;
  } catch (_) {
    return null;
  }
}

// ── Recognising a question ─────────────────────────────────────────────────

const usable = (t) => Boolean(t && !t.invalid && !t.improper && t.digits <= MAX_DIGITS);
const isFractional = (t) => t.kind === 'fraction' || t.kind === 'mixed';
const isDecimal = (t) => t.kind === 'decimal' || t.kind === 'recurring';

// The matched words must be the only numbers in the question.
function aloneIn(text, start, end) {
  return !DIGITISH.test(text.slice(0, start) + text.slice(end));
}

function hintFor(tokens, decimalForm = false) {
  if (tokens.some(isFractional)) return 'fraction';
  if (decimalForm || tokens.some(isDecimal)) return 'decimal';
  return 'integer';
}

function listOf(raw, kinds) {
  const items = numbersIn(raw);
  if (items.length < 2) return null;
  if (!items.every((t) => usable(t) && kinds.includes(t.kind))) return null;
  return items;
}

function expandedForm(text) {
  if (!EXPANDED_WORD.test(text)) return undefined;
  const m = EXPANDED_OF.exec(text) || EXPANDED_IN.exec(text);
  if (!m || !aloneIn(text, m.index, m.index + m[0].length)) return null;
  const t = readOne(m[1]);
  if (!usable(t) || t.value.num <= 0n) return null;
  const digits = t.value.num.toString();
  const addends = [];
  for (let i = 0; i < digits.length; i += 1) {
    const d = BigInt(digits[i]);
    if (d) addends.push(d * pow10(digits.length - 1 - i));
  }
  const grouping = t.grouping === 'pk' ? 'pk' : 'western';
  return {
    form: 'expanded',
    value: t.value,
    addends,
    expected: addends.map((a) => formatInt(a, grouping)).join(' + '),
    operands: [t.value],
    hint: 'integer',
  };
}

function toDecimalForm(text) {
  const p = PERCENT.exec(text);
  if (p) {
    if (!aloneIn(text, p.index, p.index + p[0].length)) return null;
    const t = readOne(p[1]);
    if (!usable(t)) return null;
    return { form: 'percent-decimal', value: div(t.value, frac(100n)), operands: [t.value, frac(100n)], hint: 'decimal' };
  }
  const f = TO_DECIMAL.exec(text);
  if (!f) return undefined;
  const t = readOne(f[1]);
  if (!usable(t) || !isFractional(t)) return undefined;
  if (!aloneIn(text, f.index, f.index + f[0].length)) return null;
  return {
    form: 'fraction-decimal',
    value: t.value,
    operands: [t.value, frac(t.value.num), frac(t.value.den)],
    hint: 'decimal',
  };
}

// 0.45 → 45%, 3/4 → 75%; 20% of 150 → 30. The first is checked as the number before the %.
function percentForm(text) {
  const p = TO_PERCENT.exec(text);
  if (p) {
    if (!aloneIn(text, p.index, p.index + p[0].length)) return null;
    const t = readOne(p[1]);
    if (!usable(t)) return null;
    return {
      form: 'to-percent',
      value: mul(t.value, frac(100n)),
      operands: [t.value, frac(100n)],
      hint: 'decimal',
      percent: true,
    };
  }
  const o = PERCENT_OF.exec(text);
  if (!o) return undefined;
  const end = o.index + o[0].length;
  if (!aloneIn(text, o.index, end) || FURTHER.test(text.slice(end))) return null;
  const rate = readOne(o[1]);
  const whole = readOne(o[2]);
  if (!usable(rate) || !usable(whole)) return null;
  return {
    form: 'percent-of',
    value: div(mul(rate.value, whole.value), frac(100n)),
    operands: [rate.value, whole.value, frac(100n)],
    hint: hintFor([rate, whole]),
  };
}

function factorForm(text) {
  const hcf = HCF_WORD.test(text);
  const lcm = LCM_WORD.test(text);
  if (!hcf && !lcm) return undefined;
  if (hcf && lcm) return null;
  const m = FACTOR.exec(text);
  if (!m || !aloneIn(text, m.index, m.index + m[0].length)) return null;
  const items = listOf(m[2], ['integer']);
  if (!items || items.some((t) => t.value.num <= 0n)) return null;
  const nums = items.map((t) => t.value.num);
  const value = hcf
    ? nums.reduce((a, b) => gcd(a, b))
    : nums.reduce((a, b) => (a / gcd(a, b)) * b);
  return { form: hcf ? 'hcf' : 'lcm', value: frac(value), operands: items.map((t) => t.value), hint: 'integer' };
}

function averageForm(text) {
  const m = AVERAGE.exec(text);
  if (!m) return /(?<![a-z])(?:average|mean)\s+of\b/i.test(text) ? null : undefined;
  if (!aloneIn(text, m.index, m.index + m[0].length)) return null;
  const items = listOf(m[1], ['integer', 'decimal']);
  if (!items) return null;
  const sum = items.reduce((acc, t) => add(acc, t.value), frac(0n));
  return {
    form: 'average',
    value: div(sum, frac(BigInt(items.length))),
    operands: items.map((t) => t.value),
    hint: hintFor(items),
  };
}

const OPERATORS = {
  '×': 'multiply', x: 'multiply', X: 'multiply', '*': 'multiply',
  '÷': 'divide', '/': 'divide',
  '+': 'add',
  '-': 'subtract', '−': 'subtract', '–': 'subtract',
};
const APPLY = { multiply: mul, divide: div, add, subtract: sub };

function operatorForm(text) {
  const matches = [...text.matchAll(EXPR)];
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return null;
  const m = matches[0];
  const end = m.index + m[0].length;
  if (!aloneIn(text, m.index, end) || !TAIL_OK.test(text.slice(end))) return null;
  const a = readOne(m[1]);
  const b = readOne(m[4]);
  if (!usable(a) || !usable(b)) return null;
  const sign = m[2] || m[3];
  if (sign === '/' && (a.kind !== 'integer' || b.kind !== 'integer')) return null;
  return operation(OPERATORS[sign], a, b);
}

function operation(form, a, b) {
  const value = APPLY[form](a.value, b.value);
  if (!value || value.num < 0n) return null;
  return {
    form,
    value,
    operands: [a.value, b.value],
    hint: hintFor([a, b]),
    wholeDivision: form === 'divide' && a.kind === 'integer' && b.kind === 'integer',
  };
}

// The same four operations in words. `swap` puts the operands in sum order.
const verb = (words) => new RegExp(String.raw`(?<![a-z])${words}${LIST_END}`, 'i');
const VERBS = [
  { re: verb(String.raw`divide:?\s+(${NUM})\s+by\s+(${NUM})`), form: 'divide' },
  { re: verb(String.raw`multiply:?\s+(${NUM})\s+by\s+(${NUM})`), form: 'multiply' },
  { re: verb(String.raw`subtract:?\s+(${NUM})\s+from\s+(${NUM})`), form: 'subtract', swap: () => true },
  { re: verb(String.raw`add:?\s+(${NUM})\s+and\s+(${NUM})`), form: 'add' },
  { re: verb(String.raw`sum\s+of\s+(${NUM})\s+and\s+(${NUM})`), form: 'add' },
  { re: verb(String.raw`product\s+of\s+(${NUM})\s+and\s+(${NUM})`), form: 'multiply' },
  {
    re: verb(String.raw`difference\s+(?:between|of)\s+(${NUM})\s+and\s+(${NUM})`),
    form: 'subtract',
    swap: (a, b) => a.value.num * b.value.den < b.value.num * a.value.den,
  },
];
// Words after the sum that ask for more than one step.
const FURTHER = /\b(?:then|double|twice|half|halve|times|square|again|add|subtract|multiply|divide|sum|product|difference)\b/i;

function verbForm(text) {
  for (const { re, form, swap } of VERBS) {
    const m = re.exec(text);
    if (!m) continue;
    const end = m.index + m[0].length;
    if (!aloneIn(text, m.index, end) || FURTHER.test(text.slice(end))) return null;
    const a = readOne(m[1]);
    const b = readOne(m[2]);
    if (!usable(a) || !usable(b)) return null;
    return swap && swap(a, b) ? operation(form, b, a) : operation(form, a, b);
  }
  return undefined;
}

const FAMILIES = [expandedForm, toDecimalForm, percentForm, factorForm, averageForm, verbForm, operatorForm];

/**
 * Recognise a question as one computation and work it out exactly.
 * Returns `{ form, value: {num, den} }` (BigInt, lowest terms) or null.
 * Each family answers undefined (not mine), null (mine but unusable) or a result.
 */
function parseForm(questionText) {
  try {
    if (typeof questionText !== 'string' || !questionText.trim() || questionText.length > MAX_TEXT) return null;
    for (const family of FAMILIES) {
      const result = family(questionText);
      if (result !== undefined) return result;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ── Comparing and writing ──────────────────────────────────────────────────

function agrees(value, t) {
  if (!isDecimal(t) || t.kind === 'recurring') return same(value, t.value);
  // A value that terminates has one right decimal: the key must equal it (44.0 = 44).
  // The tolerance is only for a recurring quotient rounded to the asked places.
  if (terminates(value)) return same(value, t.value);
  // A recurring value written to three or more places must get those places right.
  if (t.places >= 3) {
    const written = floorScaled(t.value, 3);
    return written === floorScaled(value, 3) || written === roundScaled(value, 3);
  }
  return withinTolerance(value, t.value);
}

function formatInt(n, grouping) {
  const s = n.toString();
  if (!grouping || s.length <= 3) return s;
  if (grouping === 'western') return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
}

function formatDecimal(v, places, grouping) {
  const scaled = roundScaled(v, places);
  if (places === 0) return formatInt(scaled, grouping);
  const unit = pow10(places);
  return `${formatInt(scaled / unit, grouping)}.${(scaled % unit).toString().padStart(places, '0')}`;
}

function formatMixed(v, grouping) {
  const whole = v.num / v.den;
  const rest = v.num % v.den;
  if (rest === 0n) return formatInt(whole, grouping);
  if (whole === 0n) return `${rest}/${v.den}`;
  return `${formatInt(whole, grouping)} ${rest}/${v.den}`;
}

// Enough places to be exact when the value ends; never fewer than asked.
function placesFor(v, asked) {
  return terminates(v) ? Math.max(asked, exactPlaces(v)) : Math.max(asked, 2);
}

// Commas only if the key used them, in the style it used.
function groupingFor(t, all) {
  if (t.grouping) return t.grouping;
  if (t.intDigits >= 4) return null;
  const other = all.find((o) => o.grouping);
  return other ? other.grouping : null;
}

function formatLike(value, t, form, all) {
  const grouping = groupingFor(t, all);
  // A whole answer is printed whole, whatever the key wrote: 44.5 → 44, not 44.0.
  if (value.den === 1n) return formatInt(value.num, grouping);
  if (t.kind === 'fraction') return `${value.num}/${value.den}`;
  if (t.kind === 'mixed') return formatMixed(value, grouping);
  if (isDecimal(t)) return formatDecimal(value, placesFor(value, t.places), grouping);
  if (form.hint === 'fraction') return formatMixed(value, grouping);
  return formatDecimal(value, placesFor(value, 2), grouping);
}

const isNumberChar = (ch) => ch !== undefined && (/\d/.test(ch) || ch in VULGAR || /[̄̅̇]/.test(ch));

// The last place `old` stands as a whole number in `text`, or -1.
function lastStandalone(text, old) {
  let at = text.lastIndexOf(old);
  while (at >= 0) {
    const before = text[at - 1];
    const after = text[at + old.length];
    const joinedBefore = isNumberChar(before) || (/[.,/⁄]/.test(before || '') && isNumberChar(text[at - 2]));
    const joinedAfter = isNumberChar(after) || (/[.,/⁄]/.test(after || '') && isNumberChar(text[at + old.length + 1]));
    if (!joinedBefore && !joinedAfter) return at;
    at = at > 0 ? text.lastIndexOf(old, at - 1) : -1;
  }
  return -1;
}

function lastAPoint(scheme) {
  if (!Array.isArray(scheme.points)) return null;
  for (let i = scheme.points.length - 1; i >= 0; i -= 1) {
    const p = scheme.points[i];
    if (p && typeof p === 'object' && p.kind === 'A') return p;
  }
  return null;
}

function replaceKey(q, exam, answer, at, old, computed, index) {
  const nextAnswer = answer.slice(0, at) + computed + answer.slice(at + old.length);
  const point = lastAPoint(q.scheme);
  let nextPoint = null;
  if (point && typeof point.text === 'string') {
    const i = lastStandalone(point.text, old);
    if (i >= 0) nextPoint = point.text.slice(0, i) + computed + point.text.slice(i + old.length);
  }
  const note = {
    slot: q.slot || null,
    n: q.n || null,
    index: Number.isInteger(index) ? index : null,
    text_en: `key corrected by code; the model wrote ${old}`,
    text_ur: `کلید کوڈ نے درست کی؛ ماڈل نے ${old} لکھا`, // needs fluent-Urdu review
    computed,
    model: old,
  };

  q.answer = nextAnswer;
  if (nextPoint !== null) point.text = nextPoint;
  const layout = exam._layout;
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    if (!Array.isArray(layout.notes)) layout.notes = [];
    layout.notes.push(note);
  }
  return 'replaced';
}

function checkExpanded(q, answer, form, exam, index) {
  const chains = [...answer.matchAll(CHAIN)];
  if (!chains.length) {
    const last = lastNumber(answer);
    return form.addends.length === 1 && last && same(last.value, form.value) ? 'ok' : null;
  }
  const chain = chains[chains.length - 1];
  const got = new Set();
  for (const term of chain[0].split('+')) {
    const factors = numbersIn(term);
    if (!factors.length || factors.some((f) => f.kind !== 'integer')) return null;
    const product = factors.reduce((acc, f) => acc * f.value.num, 1n);
    if (product !== 0n) got.add(product.toString());
  }
  const want = new Set(form.addends.map(String));
  if (got.size === want.size && [...want].every((a) => got.has(a))) return 'ok';
  return replaceKey(q, exam, answer, chain.index, chain[0], form.expected, index);
}

// ── A key that shows its own working ──────────────────────────────────────
//
// A word problem is not a form parseForm knows, but its key often carries the
// sum: «85000 - 24567 = Rs. 60,433.». The working is evaluated exactly and the
// result the key states is checked against it. Every stage of a chain must agree
// («2/3 x 3/4 = 6/12 = 1/2»); a stage in words («2/5 of 15000») is passed over.
// Used only on a board-pattern paper, and only when parseForm has no answer.

// Units and currency around a number in a key: "Rs. 60,433", "5.20 km", "72 seconds".
const KEY_UNITS = /(?<![a-z])(?:rs|rupees?|paisas?|(?:cm|mm|km|m)(?:2|²|\^2)?|kg|g|ml|l|sq|units?|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|litres?|liters?|metres?|meters?|grams?|kilograms?|kilometres?|kilometers?|centimetres?|centimeters?|books?|boxes?|people|students?|children|pages?)(?![a-z])\.?/gi;
const STAGE_CHARS = new RegExp(String.raw`^[\d\s.,()+\-−–×xX*÷/${Object.keys(VULGAR).join('')}̄̅̇]+$`);

// One stage of working as a list of number / operator / bracket tokens, or null.
function stageTokens(text) {
  const s = text.replace(KEY_UNITS, ' ').replace(/[.\s]+$/, '').trim();
  if (!s || !STAGE_CHARS.test(s)) return null;
  const num = new RegExp(`${NUM}`, 'y');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '(' || ch === ')') { out.push({ paren: ch }); i += 1; continue; }
    const prevIsNumber = out.length && (out[out.length - 1].number || out[out.length - 1].paren === ')');
    // A spaced "/" divides; "3/4" with no spaces is a fraction and is read as a number.
    if (prevIsNumber && (ch in OPERATORS)) {
      if (ch === '/' && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) return null;
      out.push({ op: OPERATORS[ch] });
      i += 1;
      continue;
    }
    num.lastIndex = i;
    const m = num.exec(s);
    if (!m) return null;
    const t = readOne(m[0]);
    if (!usable(t)) return null;
    out.push({ number: t });
    i += m[0].length;
  }
  return out.length ? out : null;
}

// Exact value of a token list with the usual precedence; null when it is not one sum.
function evaluate(tokens) {
  let at = 0;
  const peek = () => tokens[at];
  function primary() {
    const t = peek();
    if (!t) return null;
    if (t.number) { at += 1; return t.number.value; }
    if (t.paren === '(') {
      at += 1;
      const v = sum();
      if (!v || !peek() || peek().paren !== ')') return null;
      at += 1;
      return v;
    }
    return null;
  }
  function product() {
    let v = primary();
    while (v && peek() && (peek().op === 'multiply' || peek().op === 'divide')) {
      const op = peek().op;
      at += 1;
      const r = primary();
      if (!r) return null;
      v = APPLY[op](v, r);
    }
    return v;
  }
  function sum() {
    let v = product();
    while (v && peek() && (peek().op === 'add' || peek().op === 'subtract')) {
      const op = peek().op;
      at += 1;
      const r = product();
      if (!r) return null;
      v = APPLY[op](v, r);
    }
    return v;
  }
  const v = sum();
  return v && at === tokens.length ? v : null;
}

// The unit words in a piece of a key, one spelling each ("Rs." = "rupees", "litre" = "litres").
function unitsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(KEY_UNITS)) {
    let u = m[0].toLowerCase().replace(/\.$/, '');
    if (/^rupees?$/.test(u)) u = 'rs';
    if (u.length > 3 && u.endsWith('s')) u = u.slice(0, -1);
    out.add(u);
  }
  return out;
}

function checkWorking(q, answer, exam, index) {
  if (answer.length > MAX_TEXT || !answer.includes('=')) return null;
  const parts = answer.split('=');
  const last = parts.pop();
  const lastStart = answer.length - last.length;
  // The stated result: one number, with nothing but units and a full stop round it.
  const stated = numbersIn(last);
  if (stated.length !== 1) return null;
  // Before the number: units only ("Rs."). After it: at most two words ("360 girls.").
  const before = last.slice(0, stated[0].index).replace(KEY_UNITS, ' ');
  const after = last.slice(stated[0].index + stated[0].raw.length).replace(KEY_UNITS, ' ');
  if (!/^\s*$/.test(before) || !/^\s*(?:[A-Za-z]+(?:\s+[A-Za-z]+)?)?\s*[.!]?\s*$/.test(after)) return null;
  const target = { ...stated[0], index: lastStart + stated[0].index };

  // The working is the run of arithmetic stages right before the result; a stage
  // in words ends it, so "= 280. Average = 280 divided by 5 = 56" has none.
  let value = null;
  const values = [];
  const used = [];
  const units = unitsIn(last);
  let stageUnits = false;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    let tokens = stageTokens(parts[i]);
    let text = parts[i];
    // "Total: 120.75 + 60.50": a label before a colon starts the working; it ends the run.
    const labelled = !tokens && parts[i].includes(':');
    if (labelled) {
      text = parts[i].slice(parts[i].lastIndexOf(':') + 1);
      tokens = stageTokens(text);
    }
    if (!tokens) break;
    for (const u of unitsIn(text)) { units.add(u); stageUnits = true; }
    const v = evaluate(tokens);
    if (!v) return null;
    values.push(v);
    if (tokens.some((t) => t.op)) {
      value = v;
      used.push(...tokens.filter((t) => t.number).map((t) => t.number));
    }
    if (labelled) break;
  }
  // At least one stage must be a sum; every stage must agree with it.
  if (!value || value.num < 0n || !values.every((v) => same(v, value))) return null;
  // A change of unit ("750 g = 0.75 kg", "100 cm = 1 m") is a conversion, not a slip:
  // never checked. Nor is a result in a word ("girls") after working in units.
  if (units.size > 1) return null;
  if (stageUnits && !/^\s*[.!]?\s*$/.test(last.slice(stated[0].index + stated[0].raw.length).replace(KEY_UNITS, ' '))) return null;
  if (agrees(value, target)) return 'ok';
  // "4 × 250 = 1000 = 1 kg", "3 × 12 = 36 = 3 dozen": the stage before the result only
  // restates a number, and the result differs from it, so the result converts it into
  // some other measure, whatever word names it. Left unchecked.
  const restated = stageTokens(parts[parts.length - 1]);
  if (!stageUnits && restated && !restated.some((t) => t.op)) return null;
  const all = numbersIn(answer);
  // A result rounded to the places it shows: right for a recurring value ("10 ÷ 3 = 3.3");
  // for one that ends, the question may have asked to round, so it is left unchecked.
  const decimalOrWhole = target.kind === 'integer' || target.kind === 'decimal';
  if (decimalOrWhole) {
    const p = target.places || 0;
    const shown = (target.value.num * pow10(p)) / target.value.den;
    if (roundScaled(value, p) === shown) return terminates(value) ? null : 'ok';
  }
  const form = { hint: hintFor([...used, target]) };
  const computed = target.kind === 'decimal' && target.places > 0 && !terminates(value)
    ? formatDecimal(value, target.places, groupingFor(target, all))
    : formatLike(value, target, form, all);
  if (computed === target.raw) return 'ok';
  return replaceKey(q, exam, answer, target.index, target.raw, computed, index);
}

// "68,970 ÷ 45 = 1,532 remainder 10": a whole-number division with its quotient and remainder.
const WHOLE = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+)`;
const QUOTIENT_REMAINDER = new RegExp(String.raw`${WHOLE}\s*÷\s*${WHOLE}\s*=\s*${WHOLE}\s*,?\s*(?:remainder|rem\.?|\bR\b)\s*[=:]?\s*${WHOLE}`, 'gi');
const wholeOf = (raw) => (/^\d{1,3}(?:,\d{2,3})*$|^\d+$/.test(raw) ? BigInt(raw.replace(/,/g, '')) : null);

/**
 * Board-pattern papers: the last "a ÷ b = q remainder r" in a key. The remainder is
 * corrected when the quotient is right; a wrong quotient is left unchecked (the slip
 * could be in either number). Returns undefined when the key has no such stage.
 */
function checkRemainder(q, answer, exam, index) {
  const all = [...answer.matchAll(QUOTIENT_REMAINDER)];
  if (!all.length) return undefined;
  const m = all[all.length - 1];
  const [a, b, quotient, remainder] = [m[1], m[2], m[3], m[4]].map(wholeOf);
  if ([a, b, quotient, remainder].some((v) => v === null) || b === 0n) return null;
  if (quotient !== a / b) return null;
  const right = a % b;
  if (remainder === right) return 'ok';
  const raw = m[4];
  const at = m.index + m[0].length - raw.length;
  const computed = raw.includes(',') ? Number(right).toLocaleString('en-US') : String(right);
  return replaceKey(q, exam, answer, at, raw, computed, index);
}

function checkQuestion(q, exam, index) {
  if (isObject(exam._layout) && typeof q.answer === 'string' && q.answer.length <= MAX_TEXT) {
    const verdict = checkRemainder(q, q.answer, exam, index);
    if (verdict !== undefined) return verdict;
  }
  const form = parseForm(q.question);
  if (!form) {
    // Board-pattern papers only: a plain paper's checks stay exactly as they were.
    if (!isObject(exam._layout)) return null;
    const answer = typeof q.answer === 'string' ? q.answer : null;
    return answer ? checkWorking(q, answer, exam, index) : null;
  }
  const answer = typeof q.answer === 'number' && Number.isFinite(q.answer) ? String(q.answer) : q.answer;
  if (typeof answer !== 'string' || answer.length > MAX_TEXT) return null;
  if (form.form === 'expanded') return checkExpanded(q, answer, form, exam, index);

  const all = numbersIn(answer);
  if (!all.length) return null;
  // "994 remainder 1" is a different kind of answer from 994.25.
  if (form.wholeDivision && form.value.den !== 1n && REMAINDER.test(answer)) return null;

  let target = all[all.length - 1];
  if (agrees(form.value, target)) return 'ok';
  // "4 is the HCF of 8 and 12": a key that ends by restating the question.
  const isOperand = (t) => form.operands.some((o) => same(o, t.value));
  if (isOperand(target)) {
    const earlier = [...all].reverse().find((t) => !isOperand(t));
    if (earlier) {
      target = earlier;
      if (agrees(form.value, target)) return 'ok';
    }
  }
  // Board-pattern papers: a stem that asks for a decimal "and then a percentage" ends on
  // the percentage (3/4 = 0.75 = 75%). A key with its own % sign on a stem read as a
  // decimal agrees when it is the value written as a percent, and is otherwise left
  // unchecked: it is never rewritten to the decimal with a % ("0.75%").
  if (isObject(exam._layout) && (form.form === 'fraction-decimal' || form.form === 'percent-decimal') && PERCENT_SIGN.test(answer.slice(target.index + target.raw.length))) {
    return same(mul(form.value, HUNDRED), target.value) ? 'ok' : null;
  }
  const computed = formatLike(form.value, target, form, all);
  if (computed === target.raw) return 'ok';
  // A percentage key keeps its own %; one written without it gains it.
  if (form.percent && !PERCENT_SIGN.test(answer.slice(target.index + target.raw.length))) {
    return replaceKey(q, exam, answer, target.index, target.raw, `${computed}%`, index);
  }
  return replaceKey(q, exam, answer, target.index, target.raw, computed, index);
}

// ── One right option ───────────────────────────────────────────────────────
//
// "Which number is divisible by 11?" with 4,213 and 5,148 among the options has
// two right answers; the equality check never sees it, because the options
// differ in value. For a stem that names a property, every option is tested
// against it. A stem this cannot read with certainty is left unchecked.

const INDIC = /[۰-۹٠-٩]/g;
const westernDigits = (s) => s.replace(INDIC, (d) => String(('۰۱۲۳۴۵۶۷۸۹'.indexOf(d) + 1 || '٠١٢٣٤٥٦٧٨٩'.indexOf(d) + 1) - 1));
const OPTION_LETTER = /^\s*\(?([a-h])\s*[).]\s*/i;
const WHOLE_NUMBER = /^\d{1,3}(?:,\d{3})+$|^\d+$/;

function optionParts(options) {
  return options.map((opt, i) => {
    const text = westernDigits(String(opt)).trim();
    const m = OPTION_LETTER.exec(text);
    return { letter: m ? m[1].toLowerCase() : 'abcdefgh'[i], body: (m ? text.slice(m[0].length) : text).trim() };
  });
}

const wholeValue = (body) => (WHOLE_NUMBER.test(body) ? Number(body.replace(/,/g, '')) : NaN);

// A whole number, decimal, fraction or mixed number and nothing else.
function plainValue(body) {
  const s = body.replace(/,/g, '');
  let m;
  if ((m = /^\d+(?:\.\d+)?$/.exec(s))) return Number(s);
  if ((m = /^(\d+)\/(\d+)$/.exec(s)) && Number(m[2])) return Number(m[1]) / Number(m[2]);
  if ((m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s)) && Number(m[3])) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  return NaN;
}

function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;
  return true;
}

const PLACE_WORDS = { ten: 10, hundred: 100, thousand: 1000, 'ten thousand': 10000, 'hundred thousand': 100000 };
const PLACE_NAMES = ['ones', 'tens', 'hundreds', 'thousands', 'ten thousands', 'hundred thousands', 'millions', 'ten millions', 'hundred millions'];
const placeName = (body) => body.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().replace(/^(?:the )?(.*?)(?: place)?$/, '$1').replace(/(?<!s)$/, 's');

const SUPERLATIVE = /\b(greatest|largest|biggest|highest|smallest|least|lowest)\b/;
const ASKS_WHICH = /\b(?:which|choose|select|pick)\b|کون/;
// Words that turn the question round, add a second condition or ask about
// more than one number: "divisible by 2 and 3", "between 12 and 20", "neither
// prime nor composite", "rounds to 500", "which is wrong", "face value".
const NOT_READ = new RegExp([
  String.raw`\b(?:not|except|never|common|hcf|lcm|gcd|how many|estimate|both|all)\b`,
  String.raw`\b(?:and|or|nor|neither|but|also|than|between|greater|less|besides|apart)\b`,
  String.raw`\b(?:wrong|incorrect|false|face value|rounds|when rounded)\b`,
  String.raw`نہیں|مشترک|(?:^|\s)(?:اور|یا)(?=\s|$)`,
].join('|'));

// Each property: the stem it reads, and the test an option's whole number must pass.
const PROPERTIES = [
  { re: /\bdivisible by (\d+)\b|(\d+)\s*سے\s*(?:پورا|پوری|مکمل)?\s*تقسیم/, test: (n, d) => d > 1 && n % d === 0 },
  { re: /\bfactor of (\d+)\b/, test: (n, d) => n > 0 && d % n === 0 },
  { re: /\bmultiple of (\d+)\b/, test: (n, d) => d > 0 && n % d === 0 },
  { re: /\bprime\b|مفرد/, test: (n) => isPrime(n) },
  { re: /\b(?:is|are) (?:an )?even\b|\beven number\b|جفت/, test: (n) => n % 2 === 0 },
  { re: /\b(?:is|are) (?:an )?odd\b|\bodd number\b|طاق/, test: (n) => n % 2 === 1 },
];

function verdictOf(parts, passes) {
  const passing = parts.filter(passes).map((p) => p.letter);
  return passing.length === 1 ? { ok: true } : { ok: false, passing };
}

function propertyVerdict(stem, parts) {
  const hit = PROPERTIES.map((p) => ({ p, m: p.re.exec(stem) })).filter((x) => x.m);
  if (!hit.length) return null;
  // "the smallest prime", "prime factor of": two asks in one stem.
  if (hit.length > 1 || SUPERLATIVE.test(stem) || /\bprime factor/.test(stem) || !ASKS_WHICH.test(stem)) return { ok: null };
  const values = parts.map((p) => wholeValue(p.body));
  if (values.some(Number.isNaN)) return { ok: null };
  const { p, m } = hit[0];
  const d = Number(m.slice(1).find((g) => g !== undefined));
  return verdictOf(parts, (_, i) => p.test(values[i], d));
}

const ONLY_SUPERLATIVE = /^which (?:(?:one|number|fraction|decimal|of these(?: numbers| fractions| decimals)?|of the following(?: numbers| fractions| decimals)?) )?is (?:the )?(greatest|largest|biggest|highest|smallest|least|lowest)(?: (?:number|fraction|decimal|one))?(?: of (?:these|them|the following))?\s*[?.]?$/;

function superlativeVerdict(stem, parts) {
  const m = ONLY_SUPERLATIVE.exec(stem);
  if (!m) return null;
  const values = parts.map((p) => plainValue(p.body));
  if (values.some(Number.isNaN)) return { ok: null };
  const best = /greatest|largest|biggest|highest/.test(m[1]) ? Math.max(...values) : Math.min(...values);
  return verdictOf(parts, (_, i) => Math.abs(values[i] - best) < 1e-9);
}

function roundingVerdict(stem, parts) {
  const m = /\bto the nearest (hundred thousand|ten thousand|thousand|hundred|ten|100,000|10,000|1,000|1000|100|10)\b/.exec(stem);
  if (!m || !/\bround(?:ed)?\b/.test(stem)) return null;
  const place = PLACE_WORDS[m[1]] || Number(m[1].replace(/,/g, ''));
  const rest = stem.slice(0, m.index) + ' ' + stem.slice(m.index + m[0].length);
  const numbers = rest.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  if (numbers.length !== 1 || !WHOLE_NUMBER.test(numbers[0])) return { ok: null };
  const values = parts.map((p) => wholeValue(p.body));
  if (values.some(Number.isNaN)) return { ok: null };
  const n = Number(numbers[0].replace(/,/g, ''));
  const rounded = Math.floor((n + place / 2) / place) * place;
  return verdictOf(parts, (_, i) => values[i] === rounded);
}

function placeValueVerdict(stem, parts) {
  const m = /\bvalue of (?:the )?digit (\d) in (\d[\d,]*)/.exec(stem);
  if (!m) return null;
  const digits = m[2].replace(/,/g, '');
  if (digits.split(m[1]).length !== 2) return { ok: null };
  const k = digits.length - 1 - digits.indexOf(m[1]);
  const values = parts.map((p) => wholeValue(p.body));
  if (!values.some(Number.isNaN)) return verdictOf(parts, (_, i) => values[i] === Number(m[1]) * 10 ** k);
  const names = parts.map((p) => placeName(p.body));
  if (!/\bplace value\b/.test(stem) || !names.every((n) => PLACE_NAMES.includes(n))) return { ok: null };
  return verdictOf(parts, (_, i) => names[i] === PLACE_NAMES[k]);
}

/**
 * mcqPropertyVerdict(item) → { ok: true } | { ok: false, passing: [letters] } | { ok: null }
 *
 * For an MCQ whose stem asks for a property (divisible by n, prime, factor of n,
 * multiple of n, even, odd, the greatest/smallest option, rounded to the nearest
 * 10/100/1000, the place value of a digit): ok when exactly one option has it,
 * otherwise the letters of the options that do. Any other stem, or options
 * that are not plain numbers, is `{ ok: null }` (unchecked). Never throws.
 */
function mcqPropertyVerdict(item) {
  try {
    if (!isObject(item) || typeof item.question !== 'string' || !Array.isArray(item.options) || item.options.length < 2) return { ok: null };
    if (item.options.some((o) => typeof o !== 'string' && typeof o !== 'number')) return { ok: null };
    const stem = westernDigits(item.question).toLowerCase().replace(/\s+/g, ' ').trim();
    if (NOT_READ.test(stem)) return { ok: null };
    const parts = optionParts(item.options);
    for (const read of [roundingVerdict, placeValueVerdict, propertyVerdict, superlativeVerdict]) {
      const verdict = read(stem, parts);
      if (verdict) return verdict;
    }
  } catch (_) {
    // Unreadable is unchecked.
  }
  return { ok: null };
}

// ── The paper ──────────────────────────────────────────────────────────────

const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

function isMaths(subject) {
  if (typeof subject !== 'string') return false;
  return ['math', 'maths', 'mathematics'].includes(subject.toLowerCase().replace(/[^a-z]/g, ''));
}

function hasOptions(q) {
  return Array.isArray(q.options) ? q.options.length > 0 : Boolean(q.options);
}

function writtenQuestions(exam) {
  const out = [];
  const seen = new Map();
  for (const section of ['seen', 'unseen']) {
    if (!isObject(exam[section])) continue;
    for (const part of ['objective', 'subjective']) {
      const types = exam[section][part];
      if (!isObject(types)) continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        for (const q of list) {
          // Position within its slot, counting removed items too, so the scheme
          // can find this question again and print its number.
          const key = isObject(q) ? String(q.slot || '') : '';
          const index = seen.get(key) || 0;
          seen.set(key, index + 1);
          if (isObject(q) && q.removed !== true && !hasOptions(q)) out.push({ q, index });
        }
      }
    }
  }
  return out;
}

/**
 * Check every written maths item's key. Returns a corrected deep copy and
 * `{ checked, replaced, unparsed }` counts; a non-maths paper comes back as an
 * untouched copy with zero counts.
 */
function mathsCheck(examJson, options = {}) {
  const counts = { checked: 0, replaced: 0, unparsed: 0 };
  let exam;
  try {
    exam = JSON.parse(JSON.stringify(examJson));
  } catch (_) {
    return { examJson, ...counts };
  }
  try {
    if (!isObject(exam)) return { examJson: exam, ...counts };
    const asked = options && typeof options === 'object' ? options.subject : undefined;
    const subject = asked != null && asked !== '' ? asked : isObject(exam._layout) ? exam._layout.subject : undefined;
    if (!isMaths(subject)) return { examJson: exam, ...counts };

    for (const { q, index } of writtenQuestions(exam)) {
      // A key the model gave no scheme is still a key a child is marked against.
      if (!isObject(q.scheme)) q.scheme = {};
      // A board-pattern key already checked keeps its verdict: a second pass must not turn
      // "replaced" into "ok" (normaliseScheme resets it to null before the first pass).
      const before = q.scheme.checked;
      if (isObject(exam._layout) && (before === 'ok' || before === 'replaced')) {
        counts[before === 'ok' ? 'checked' : 'replaced'] += 1;
        continue;
      }
      let verdict = null;
      try {
        verdict = checkQuestion(q, exam, index);
      } catch (_) {
        verdict = null;
      }
      q.scheme.checked = verdict;
      if (verdict === 'ok') counts.checked += 1;
      else if (verdict === 'replaced') counts.replaced += 1;
      else counts.unparsed += 1;
    }
  } catch (_) {
    // A shape nothing above expected: return what was done so far.
  }
  return { examJson: exam, ...counts };
}

module.exports = {
  mathsCheck,
  mcqPropertyVerdict,
  parseForm,
  lastNumber,
};
