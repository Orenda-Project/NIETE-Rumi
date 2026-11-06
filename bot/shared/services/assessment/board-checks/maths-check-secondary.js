'use strict';
/**
 * maths-check-secondary (contract 8 §8): recognises stems the primary maths-check.js leaves unchecked
 * (algebra, trig, surds, matrices, stoichiometry) from the item text alone, and compares the key.
 * It compares and fails; it never replaces a key. Unrecognised items pass silently.
 * Hard MISMATCH only when a recogniser matched and every given parsed; soft UNPARSED when the key cannot be read.
 * design_pending: whether the primary mathsCheck can run on a board _layout as a compare-only second opinion.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const T = require('./option-text');
const { evaluate } = require('./numeric-resolve');
const { recognise } = require('./maths-recognisers');

const ID = 'maths-secondary';
const CODES = ['maths', 'chemistry', 'physics', 'biology'];
const LIMITS = {
  relTol: 1e-6, // numeric equality when the key states no decimals (exact forms such as 1/3 or √3/2)
};

const keyNorm = (s) => String(s == null ? '' : s).replace(/[−–]/g, '-').replace(/[×]/g, '*').replace(/⁻¹/g, '^-1')
  .replace(/(?:sqrt|√)\s*\(?\s*(\d+)\s*\)?/gi, 'sqrt($1)').replace(/(\d|\))\s*sqrt/g, '$1*sqrt');

function decimalsOf(text) {
  const m = /\d\.(\d+)/.exec(text);
  return m ? m[1].length : 0;
}
function close(v, k, decimals) {
  const tol = decimals > 0 ? 0.5 * 10 ** -decimals + 1e-12 : LIMITS.relTol * Math.max(1, Math.abs(v));
  return Math.abs(v - k) <= tol;
}

/** Every value the key states: "x = 2, x = 3", "-1 ± √3", "5/3", "0.25 mol"; null if any part is unreadable. */
function keyValues(text) {
  const parts = keyNorm(text).split(/[,;]|\band\b|\bor\b/i).map((p) => p.trim()).filter(Boolean);
  const vals = [];
  for (const p0 of parts) {
    const p = p0.split('=').pop().trim().replace(/\s*[a-zA-Zµ°%^-]*\s*(?:mol|g|kg|cm|m|s)?\s*$/i, (u) => (/sqrt|pi/.test(u) ? u : ''));
    const variants = /±/.test(p) ? [p.replace('±', '+'), p.replace('±', '-')] : [p];
    for (const v of variants) {
      const e = evaluate(v.replace(/(\d)\s*\*?\s*$/, '$1'));
      if (e === null) return null;
      vals.push(e);
    }
  }
  return vals.length ? vals : null;
}

function polyOf(text) {
  const s = String(text).replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/\s+/g, '').replace(/^.*=/, '');
  const out = { c2: 0, c1: 0, c0: 0 };
  const re = /([+-]?)(\d*\.?\d*)(x\^2|x)?/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m || m[0] === '') return null;
    if (m[2] === '' && !m[3]) return null;
    const c = (m[1] === '-' ? -1 : 1) * (m[2] === '' ? 1 : parseFloat(m[2]));
    if (m[3] === 'x^2') out.c2 += c; else if (m[3] === 'x') out.c1 += c; else out.c0 += c;
    pos = re.lastIndex;
  }
  return pos === s.length && s.length ? out : null;
}

/** 'ok' | 'mismatch' | 'unparsed', plus a readable `want`. */
function compare(exp, text) {
  const dec = decimalsOf(text);
  if (exp.kind === 'surd') {
    const t = keyNorm(text);
    const m = /^(?:.*=)?\s*(-?\d*)\s*\*?\s*sqrt\((\d+)\)\s*$/.exec(t.trim());
    const want = exp.m === 1 ? String(exp.k) : `${exp.k === 1 ? '' : exp.k}√${exp.m}`;
    if (m) return { r: (m[1] === '' || m[1] === '-' ? (m[1] === '-' ? -1 : 1) : parseInt(m[1], 10)) === exp.k && parseInt(m[2], 10) === exp.m ? 'ok' : 'mismatch', want };
    const v = keyValues(text);
    return v && v.length === 1 ? { r: close(exp.k * Math.sqrt(exp.m), v[0], dec) && exp.m === 1 ? 'ok' : 'mismatch', want } : { r: 'unparsed', want };
  }
  if (exp.kind === 'poly') {
    const p = polyOf(text);
    const want = `x^2 + ${exp.c1}x + ${exp.c0}`;
    return p ? { r: p.c2 === exp.c2 && p.c1 === exp.c1 && p.c0 === exp.c0 ? 'ok' : 'mismatch', want } : { r: 'unparsed', want };
  }
  if (exp.kind === 'matrix') {
    const ns = (String(text).replace(/[−–]/g, '-').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const want = `[${exp.entries.join(', ')}]`;
    return ns.length === 4 ? { r: ns.every((n, i) => close(exp.entries[i], n, dec)) ? 'ok' : 'mismatch', want } : { r: 'unparsed', want };
  }
  const want = exp.kind === 'number' ? exp.value : exp.values;
  const vals = keyValues(text);
  if (!vals) return { r: 'unparsed', want: String(want) };
  const need = (exp.kind === 'number' ? [exp.value] : exp.values).slice().sort((a, b) => a - b);
  const got = vals.slice().sort((a, b) => a - b);
  const same = need.length === got.length && need.every((v, i) => close(v, got[i], dec));
  return { r: same ? 'ok' : 'mismatch', want: String(want) };
}

function run(examJson, ctx) {
  const out = [];
  const code = ctx && ctx.subjectConfig && ctx.subjectConfig.code;
  if (!CODES.includes(code)) return { ok: true, issues: out };
  leaves(examJson).forEach(({ item, ref, slot }) => {
    const stem = [item.main_question, item.question].filter((x) => typeof x === 'string').join(' ');
    if (!stem) return;
    const hit = recognise(stem, code);
    if (!hit) return;
    let text = item.answer;
    if (Array.isArray(item.options)) { const k = T.keyIndex(item); if (k < 0) return; text = T.stripLabel(item.options[k]); }
    if (text == null || String(text).trim() === '') return;
    const { r, want } = compare(hit.expected, text);
    const s = slot == null ? undefined : slot;
    if (r === 'mismatch') out.push({ ...issue(ID, 'MISMATCH', ref, `${hit.id}: the key says "${String(text).slice(0, 40)}", the stem works out to ${want}`, true, s), recogniser: hit.id });
    else if (r === 'unparsed') out.push({ ...issue(ID, 'UNPARSED', ref, `${hit.id}: the key "${String(text).slice(0, 40)}" could not be read`, false, s), recogniser: hit.id });
  });
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'maths-check-secondary', hard: true, modes: ['free', 'board'], LIMITS, run };
