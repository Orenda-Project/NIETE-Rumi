'use strict';
/**
 * Key fixes a Grade 3-4 paper needs after the model has written it (bd-5jmnfj.33.3), the v31 review:
 *  - a match block of N pairs came back as N items each carrying all N pairs, the first keyed with every
 *    pair (G3 GK Q2): each item keeps its own column-A word, its partner and that partner as the key;
 *  - a part opened with its own label "Q5." and the lead read "(Q5, Q6, Q7)" (G3 Maths Q5);
 *  - a compare item keyed the wrong sign, "8 x 6 ___ 7 x 7" as ">" (G3 Maths Q2 iii);
 *  - an A point paid for "a check" the stem never asked for (G4 Maths Q3 i, Q4, Q5 i-ii);
 *  - a division point named "the first three digits" where two are used (G4 Maths Q3 iv, Q5 iii).
 * The last three run on Maths only. Pure: exam JSON in, `{examJson, notes}` out; an item nothing
 * touches is the same object.
 */

const { divisionSteps } = require('./fde-division-steps');
const { keyTruth } = require('./fde-key-truth'); // bd-5jmnfj.33.4: key-only terms, quoted accepts, form-only common errors
const { schemeShape } = require('./fde-scheme-shape'); // bd-5jmnfj.33.4: points that restate the stem, pay for form or for unasked content
const { mathsSlips } = require('./fde-maths-slips'); // bd-5jmnfj.33.4: slip figures, place-value counts, method marks

const PAIR = /([^،,:：]+?)\s*[:：]\s*([^،,]+)/g;
const LABEL = /^\s*Q\s*\d+[.)]\s*/i;
const LEAD_LABELS = /\s*\((?:Q\s*\d+(?:,\s*)?)+(?:\s*(?:and|or)\s+Q\s*\d+)?\)/i;
const COMPARE = /<,\s*>\s*(?:or|,)\s*=/;
const SIDES = /:\s*(.+?)\s*_{2,}\s*(.+?)\s*$/;
const SIGN = /^[<>=]$/;
const WRITING_SIGN = /\b(Writing\s*)([<>=])/;
const ASKS_CHECK = /\bcheck|\bverify|show that .*correct|test your/i;
const BRACKET_CHECK = /\s*\([^()]*\bcheck\b[^()]*\)/gi;
const TAIL_CHECK = /,?\s*(?:with|or)\s+a\s+check\b.*$/i;

const multi = (q) => q && Array.isArray(q.column_a) && q.column_a.length > 1;
const trim = (s) => String(s == null ? '' : s).trim();

// Every "A: B" pair the answers of a slot's match items state, keyed by A.
function matchPairs(items) {
  const pairs = new Map();
  items.forEach((q) => {
    for (const m of String(q.answer == null ? '' : q.answer).matchAll(PAIR)) if (!pairs.has(trim(m[1]))) pairs.set(trim(m[1]), trim(m[2]));
  });
  return pairs;
}

function splitMatch(q, i, list, notes) {
  const peers = list.filter((o) => o && o.slot === q.slot && multi(o));
  const at = peers.indexOf(q);
  const a = trim(q.column_a[at]);
  if (!a) return q;
  const pairs = matchPairs(peers);
  const b = pairs.get(a) || (Array.isArray(q.column_b) ? trim(q.column_b[at]) : '');
  if (!b) return q;
  notes.push({ slot: q.slot, reason: 'match_split', item: at + 1, pair: `${a}: ${b}` });
  return { ...q, column_a: [a], column_b: [b], answer: b };
}

function stripLabels(q, notes) {
  const question = typeof q.question === 'string' ? q.question.replace(LABEL, '') : q.question;
  const lead = typeof q.main_question === 'string' ? q.main_question.replace(LEAD_LABELS, '') : q.main_question;
  if (question === q.question && lead === q.main_question) return q;
  const [from, to] = question !== q.question ? [q.question, question] : [q.main_question, lead];
  notes.push({ slot: q.slot, reason: 'label', from, to });
  return { ...q, question, main_question: lead };
}

// "8 x 6" -> 48: integers with x, ×, *, ÷, / before + and −; null for anything else.
function value(side) {
  const toks = side.replace(/,/g, '').match(/\d+|[x×*÷/+\-−]/g);
  if (!toks || toks.join('') !== side.replace(/[,\s]/g, '') || !/^\d/.test(toks[0])) return null;
  const terms = [Number(toks[0])];
  const ops = [];
  for (let k = 1; k < toks.length; k += 2) {
    const op = toks[k]; const n = Number(toks[k + 1]);
    if (!Number.isFinite(n)) return null;
    if (/[x×*]/.test(op)) terms[terms.length - 1] *= n;
    else if (/[÷/]/.test(op)) terms[terms.length - 1] /= n;
    else { ops.push(op); terms.push(n); }
  }
  return terms.slice(1).reduce((sum, t, k) => (ops[k] === '+' ? sum + t : sum - t), terms[0]);
}

function fixCompare(q, notes) {
  const s = q.scheme;
  if (!s || !COMPARE.test(String(q.question || '')) || !SIGN.test(trim(q.answer))) return q;
  const m = SIDES.exec(String(q.question));
  const [l, r] = m ? [value(m[1]), value(m[2])] : [null, null];
  if (l == null || r == null) return q;
  const sign = l < r ? '<' : l > r ? '>' : '=';
  const wrong = trim(q.answer);
  if (sign === wrong) return q;
  const kept = (Array.isArray(s.accept) ? s.accept : []).filter((a) => !(SIGN.test(trim(a)) && trim(a) !== sign));
  const accept = kept.some((a) => trim(a) === sign) ? kept : [sign, ...kept];
  const error = String(s.common_error || '').replace(WRITING_SIGN, (all, w, named) => (named === sign ? `${w}${wrong}` : all));
  notes.push({ slot: q.slot, reason: 'compare_sign', from: wrong, to: sign, sides: `${l} ${sign} ${r}` });
  return { ...q, answer: sign, scheme: { ...s, accept, common_error: error } };
}

function unpaidCheck(q, notes) {
  const s = q.scheme;
  if (!s || !Array.isArray(s.points) || ASKS_CHECK.test(String(q.question || ''))) return q;
  let changed = false;
  const points = s.points.map((p) => {
    if (!p || typeof p.text !== 'string') return p;
    const text = p.text.replace(BRACKET_CHECK, '').replace(TAIL_CHECK, '').trim();
    if (text === p.text) return p;
    changed = true;
    return { ...p, text };
  });
  if (!changed) return q;
  notes.push({ slot: q.slot, reason: 'check_unpaid' });
  return { ...q, scheme: { ...s, points } };
}

/** `{examJson, notes}`: the paper with the fixes above applied; `subject` picks the Maths rules. */
function midKeyFixes(examJson, { subject } = {}) {
  const maths = /maths/i.test(String(subject || ''));
  const notes = [];
  const fixList = (list) => list.map((q, i) => {
    if (!q) return q;
    let out = multi(q) ? splitMatch(q, i, list, notes) : q;
    out = stripLabels(out, notes);
    if (!maths) return out;
    out = unpaidCheck(fixCompare(out, notes), notes);
    const steps = divisionSteps(out);
    notes.push(...steps.notes);
    const slips = mathsSlips(steps.q);
    notes.push(...slips.notes);
    return slips.q;
  });
  const unseen = Object.fromEntries(Object.entries((examJson && examJson.unseen) || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, list]) => [type, Array.isArray(list) ? fixList(list) : list]))]));
  const fixed = { ...examJson, unseen };
  if (maths) return { examJson: fixed, notes };
  const truth = keyTruth(fixed);
  const shape = schemeShape(truth.examJson);
  return { examJson: shape.examJson, notes: notes.concat(truth.notes, shape.notes) };
}

module.exports = { midKeyFixes };
