'use strict';
/**
 * A Maths MCQ's key is the arithmetic its stem asks for (bd-5jmnfj.33.2).
 * v30 G4 Maths Q1 ix: "What is 7,842 divided by 9?" keyed b) 871; 7,842 = 9 × 871 + 3, so no
 * option was right and mathsCheck's equality check never saw it (it reads "a op b = c" forms,
 * not a question stem against its options). computeStem reads the stem and computes exactly
 * (BigInt); mcqArithmetic keeps a right key, moves the key to the option that is right, or
 * reports the item for a re-ask and, on the final pass (`fix`), rewrites the keyed option.
 *
 * Pure: returns a new paper; never throws.
 */

const N = String.raw`\d+(?:,\d{3})*`;
const big = (s) => BigInt(String(s).replace(/,/g, ''));
const LABEL = /^(\s*(?:[a-dA-D]|[ivx]+|الف|ب|ج|د)\)\s*)/;
const SKIP = /\b(?:estimat|round|nearest|approx|place\s+value|digit|how\s+many\s+(?:digits|times\s+(?:greater|bigger|smaller)))/i;
const MUL = String.raw`(?:x|×|\*|times|multiplied\s+by)`;
const DIV = String.raw`(?:÷|/|divided\s+by)`;
const re = (s) => new RegExp(s, 'i');
const FORMS = [
  { op: 'mul', r: re(String.raw`(${N})\s*${MUL}\s*(${N})`) },
  { op: 'mul', r: re(String.raw`product\s+of\s+(${N})\s+and\s+(${N})`) },
  { op: 'quot', r: re(String.raw`multiplied\s+by\s+(${N})\s+(?:gives|equals|makes|is)\s+(${N})`), swap: true },
  { op: 'rem', r: re(String.raw`remainder\s+when\s+(${N})\s+is\s+${DIV}\s+(${N})`) },
  { op: 'div', r: re(String.raw`(${N})\s*${DIV}\s*(${N})`) },
  { op: 'add', r: re(String.raw`(${N})\s*(?:\+|plus)\s*(${N})`) },
  { op: 'add', r: re(String.raw`(?:sum\s+of|add)\s+(${N})\s+(?:and|to)\s+(${N})`) },
  { op: 'sub', r: re(String.raw`(${N})\s*(?:-|−|–|minus)\s*(${N})`) },
  { op: 'sub', r: re(String.raw`difference\s+between\s+(${N})\s+and\s+(${N})`) },
  { op: 'sub', r: re(String.raw`subtract\s+(${N})\s+from\s+(${N})`), swap: true },
];

/**
 * computeStem(stem) → { value } (digits only), { value: null, quotient, remainder } for an
 * inexact division with no remainder ask, or null when the stem is not two whole numbers and
 * one operation (a property, a place value, rounding, an estimate, three numbers).
 */
function computeStem(stem) {
  const s = String(stem ?? '');
  if (SKIP.test(s) || /\d\.\d/.test(s)) return null;
  if ((s.match(new RegExp(N, 'g')) || []).length !== 2) return null;
  for (const f of FORMS) {
    const m = f.r.exec(s);
    if (!m) continue;
    let a = big(m[1]);
    let b = big(m[2]);
    if (f.swap) [a, b] = [b, a];
    if (f.op === 'mul') return { value: String(a * b) };
    if (f.op === 'add') return { value: String(a + b) };
    if (f.op === 'sub') return a >= b ? { value: String(a - b) } : null;
    if (b === 0n) return null;
    if (f.op === 'rem') return { value: String(a % b) };
    if (f.op === 'quot') return a % b === 0n ? { value: String(a / b) } : null;
    return a % b === 0n ? { value: String(a / b) } : { value: null, quotient: String(a / b), remainder: String(a % b) };
  }
  return null;
}

const label = (opt) => (LABEL.exec(String(opt)) || ['', ''])[1];
const body = (opt) => String(opt).replace(LABEL, '').trim();
/** An option as { value } or { quotient, remainder }; digits only, commas and units dropped. */
function optionValue(opt) {
  const t = body(opt);
  const qr = /^(\d[\d,]*)\s*(?:remainder|rem\.?|r)\s*(\d+)$/i.exec(t);
  if (qr) return { quotient: qr[1].replace(/,/g, ''), remainder: qr[2] };
  const digits = t.replace(/\D/g, '');
  return digits ? { value: digits } : null;
}
function matches(ov, computed) {
  if (!ov) return false;
  if (computed.value != null) return ov.value === computed.value;
  return ov.quotient === computed.quotient && ov.remainder === computed.remainder;
}
const group = (digits) => String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function shown(computed, options) {
  const commas = options.some((o) => /\d,\d{3}/.test(String(o)));
  const fmt = (d) => (commas ? group(d) : String(d));
  return computed.value != null ? fmt(computed.value) : `${fmt(computed.quotient)} remainder ${computed.remainder}`;
}
function keyIndex(answer, options) {
  const a = String(answer ?? '').trim();
  let i = options.findIndex((o) => String(o).trim() === a);
  if (i >= 0) return i;
  const lab = label(a);
  if (lab) i = options.findIndex((o) => label(o).trim().toLowerCase() === lab.trim().toLowerCase());
  if (i >= 0) return i;
  return options.findIndex((o) => body(o).toLowerCase() === body(a).toLowerCase());
}

function mcqSlots(paper) {
  const ids = new Set();
  const sections = paper._layout && Array.isArray(paper._layout.sections) ? paper._layout.sections : [];
  sections.forEach((sec) => (Array.isArray(sec && sec.slots) ? sec.slots : [])
    .forEach((s) => { if (s && s.shape === 'mcq' && typeof s.slot === 'string') ids.add(s.slot); }));
  return ids;
}

function checkItem(q, n, fix, notes, shortfall) {
  const computed = computeStem(q.question);
  if (!computed) return;
  const options = q.options.map(String);
  const right = options.findIndex((o) => matches(optionValue(o), computed));
  const key = keyIndex(q.answer, options);
  const asShown = shown(computed, options);
  if (right >= 0) {
    if (key === right) return;
    const from = q.answer;
    q.answer = options[right];
    notes.push({ slot: q.slot, n, kind: 'key_moved', from, to: options[right], computed: asShown });
    return;
  }
  if (!fix) {
    shortfall.push({ slot: q.slot, reason: 'mcq_no_correct_option', n, stem: q.question, computed: asShown });
    return;
  }
  const at = key >= 0 ? key : 0;
  const to = `${label(options[at])}${asShown}`;
  q.options[at] = to;
  q.answer = to;
  notes.push({ slot: q.slot, n, kind: 'option_rewritten', to, computed: asShown });
}

const MATHS = (subject) => ['math', 'maths', 'mathematics'].includes(String(subject ?? '').toLowerCase().replace(/[^a-z]/g, ''));

/**
 * mcqArithmetic(examJson, { subject, fix }) → { examJson, notes, shortfall }.
 * Notes: { slot, n, kind: 'key_moved', from, to, computed } | { slot, n, kind: 'option_rewritten', to, computed }.
 * Shortfall: { slot, reason: 'mcq_no_correct_option', n, stem, computed } (only when fix is false).
 */
function mcqArithmetic(examJson, options = {}) {
  const none = { examJson, notes: [], shortfall: [] };
  try {
    const subject = options.subject != null ? options.subject : examJson && examJson._layout && examJson._layout.subject;
    if (!examJson || typeof examJson !== 'object' || !MATHS(subject)) return none;
    const slots = mcqSlots(examJson);
    if (!slots.size) return none;
    const out = JSON.parse(JSON.stringify(examJson));
    const notes = [];
    const shortfall = [];
    const seen = new Map();
    ['seen', 'unseen'].forEach((part) => {
      const cats = out[part];
      if (!cats || typeof cats !== 'object') return;
      Object.values(cats).forEach((types) => {
        if (!types || typeof types !== 'object') return;
        Object.values(types).forEach((list) => {
          if (!Array.isArray(list)) return;
          list.forEach((q) => {
            if (!q || typeof q !== 'object' || !slots.has(q.slot) || q.removed === true) return;
            if (typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length < 2) return;
            const n = Number.isInteger(q.n) ? q.n : (seen.get(q.slot) || 0);
            seen.set(q.slot, (seen.get(q.slot) || 0) + 1);
            checkItem(q, n, Boolean(options.fix), notes, shortfall);
          });
        });
      });
    });
    return { examJson: out, notes, shortfall };
  } catch (_) {
    return none;
  }
}

const ROMAN = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function roman(n) {
  let k = n;
  return ROMAN.reduce((s, [v, r]) => { while (k >= v) { s += r; k -= v; } return s; }, '');
}
/** "Q1" from the slot's label in the layout or pattern (label_en without its full stop), else its ordinal, else its id. */
function labelOf(slotId, layout) {
  const sections = layout && Array.isArray(layout.sections) ? layout.sections : [];
  const all = sections.flatMap((sec) => (Array.isArray(sec && sec.slots) ? sec.slots : []));
  const i = all.findIndex((s) => s && s.slot === slotId);
  if (i < 0) return slotId;
  const lab = all[i].label_en || all[i].label;
  return typeof lab === 'string' && lab.trim() ? lab.trim().replace(/[.:]\s*$/, '') : `Q${i + 1}`;
}

/** mcqNote(shortfall, layout) → the re-ask note for the section, or null when nothing was reported. */
function mcqNote(shortfall, layout) {
  const flags = (Array.isArray(shortfall) ? shortfall : []).filter((f) => f && f.reason === 'mcq_no_correct_option');
  if (!flags.length) return null;
  return flags.map((f) => `${labelOf(f.slot, layout)} item ${roman((Number.isInteger(f.n) ? f.n : 0) + 1)} "${f.stem}" has no correct option `
    + `(the answer is ${f.computed}). Replace it with a stem whose answer is exact and make one option that answer.`).join('\n');
}

module.exports = { mcqArithmetic, mcqNote, computeStem };
