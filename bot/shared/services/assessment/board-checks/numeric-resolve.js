'use strict';
/**
 * D16 numeric-resolve (contract 8 §7): the arithmetic the key claims (`calc.expr`) against the key's number.
 * Hard NUMERIC_MISMATCH; soft UNIT_MISSING and UNRESOLVED (the rubric routes unparseable ones to the judge).
 * The expression is read by a small hand-written parser: no eval, no Function.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const T = require('./option-text');

const LIMITS = {
  defaultSig: 3, // design_pending: used only when calc.sig is absent; the contract has no default
};
const ID = 'D16';

/** Recursive-descent over decimals, + - * / ^, parentheses, sqrt(), pi. Returns a finite number or null. */
function evaluate(expr) {
  const src = String(expr == null ? '' : expr);
  const tok = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|(sqrt|pi)|([-+*/^()]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) return null;
    tok.push(m[1] !== undefined ? { n: parseFloat(m[1]) } : { s: m[2] || m[3] });
    pos = re.lastIndex;
  }
  let i = 0;
  const peek = () => tok[i];
  const isOp = (s) => peek() && peek().s === s;
  let bad = false;
  function primary() {
    const t = tok[i++];
    if (!t) { bad = true; return 0; }
    if (t.n !== undefined) return t.n;
    if (t.s === 'pi') return Math.PI;
    if (t.s === 'sqrt') {
      if (!isOp('(')) { bad = true; return 0; }
      i += 1; const v = add();
      if (!isOp(')')) { bad = true; return 0; }
      i += 1; return Math.sqrt(v);
    }
    if (t.s === '(') {
      const v = add();
      if (!isOp(')')) { bad = true; return 0; }
      i += 1; return v;
    }
    bad = true; return 0;
  }
  function power() { const b = primary(); if (isOp('^')) { i += 1; return b ** unary(); } return b; }
  function unary() { if (isOp('-')) { i += 1; return -unary(); } if (isOp('+')) { i += 1; return unary(); } return power(); }
  function mul() {
    let v = unary();
    while (isOp('*') || isOp('/')) { const op = tok[i++].s; const r = unary(); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function add() {
    let v = mul();
    while (isOp('+') || isOp('-')) { const op = tok[i++].s; const r = mul(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  if (!tok.length) return null;
  const v = add();
  if (bad || i !== tok.length || !Number.isFinite(v)) return null;
  return v;
}

const roundSig = (x, sig) => (x === 0 ? 0 : Number(x.toPrecision(Math.max(1, Math.min(21, sig)))));

/** Last number in a key text (a/b read as a fraction); null when none or when a decimal comma makes it ambiguous. */
function lastNumber(text) {
  // A unit power (m/s^2, m s^-2) is never the answer number.
  const s = String(text == null ? '' : text).replace(/\^\s*[-+]?\d+(?:\.\d+)?/g, '');
  if (/\d,\d{1,2}(?!\d)/.test(s)) return null;
  const all = s.match(/-?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g);
  if (!all) return null;
  return T.parseNumber(all[all.length - 1].replace(/\s+/g, ''));
}

/**
 * bd-qyi45h.10: every answer the key states on its final line — the last number plus each number right after an
 * "=" ("Solution: x = -3, y = 2", "Length = 24 feet, Width = 10 feet"). Earlier lines are working, not answers.
 */
function finalAnswers(text) {
  const lines = String(text == null ? '' : text).split('\n').map((l) => l.trim()).filter(Boolean);
  const last = (lines[lines.length - 1] || '').replace(/\^\s*[-+]?\d+(?:\.\d+)?/g, '');
  const out = [];
  const re = /=\s*(-?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/g;
  let m;
  while ((m = re.exec(last))) { const n = T.parseNumber(m[1].replace(/\s+/g, '')); if (n !== null && Number.isFinite(n)) out.push(n); }
  const tail = lastNumber(last);
  if (tail !== null) out.push(tail);
  return out.concat(exactAnswers(last));
}

/**
 * bd-qyi45h.10: answers on the final line written exactly, in pi or surds ("5π inches", "121π/360 radians",
 * "Height = 12 + 4√3 m"), read through evaluate(). Each comma part, after its last "=", units dropped.
 */
function exactAnswers(last) {
  const out = [];
  String(last).split(/,|;/).forEach((part) => {
    if (!/[π√]/.test(part)) return;
    const expr = part.slice(part.lastIndexOf('=') + 1)
      .replace(/(\d|\))\s*(?=[π√(])/g, '$1*')
      .replace(/π/g, ' pi ')
      .replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)')
      .replace(/√/g, 'sqrt')
      .replace(/\b(?!pi\b|sqrt\b)[A-Za-z]+\b/g, '')
      .replace(/[×x]/g, '*');
    const v = evaluate(expr);
    if (v !== null) out.push(v);
  });
  return out;
}

/** A degrees-minutes-seconds answer ("60° 7' 30\"") is not one number the calc can be compared with. */
const isDms = (text) => /\d\s*°\s*\d+(?:\.\d+)?\s*['′]/.test(String(text == null ? '' : text));

function keyText(item) {
  if (!Array.isArray(item.options)) return String(item.answer == null ? '' : item.answer);
  const k = T.keyIndex(item);
  return k < 0 ? null : T.stripLabel(item.options[k]);
}

function run(examJson) {
  const out = [];
  leaves(examJson).forEach(({ item, ref, slot }) => {
    const numerical = item.type === 'numerical' || item.kind === 'numerical';
    if (!item.calc && !numerical) return;
    const push = (rule, msg, hard) => out.push(issue(ID, rule, ref, msg, hard, slot == null ? undefined : slot));
    if (!item.calc) { push('UNRESOLVED', 'numerical item has no calc to check its key against', false); return; }
    const v = evaluate(item.calc.expr);
    if (v === null) { push('UNRESOLVED', `calc.expr "${String(item.calc.expr).slice(0, 40)}" is not plain arithmetic`, false); return; }
    const text = keyText(item);
    if (isDms(text)) { push('UNRESOLVED', 'the key is in degrees, minutes and seconds', false); return; }
    const k = text == null ? null : lastNumber(text);
    if (k === null) { push('UNRESOLVED', 'the key has no single readable number', false); return; }
    const sig = Number.isInteger(item.calc.sig) ? item.calc.sig : LIMITS.defaultSig;
    const stated = [k, ...finalAnswers(text)];
    if (!stated.some((n) => roundSig(v, sig) === roundSig(n, sig))) push('NUMERIC_MISMATCH', `calc gives ${roundSig(v, sig)}, the key says ${roundSig(k, sig)}`, true);
    const unit = String(item.calc.unit || '').trim();
    if (unit && !T.fold(text).includes(T.fold(unit))) push('UNIT_MISSING', `the key does not carry the unit "${unit}"`, false);
  });
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'numeric-resolve', hard: true, modes: ['free', 'board'], LIMITS, run, evaluate, lastNumber };
