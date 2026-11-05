'use strict';
/**
 * Stem recognisers for maths-check-secondary (contract 8 §8). Each looks at the stem text alone and, when it
 * matches and every given parses, returns what the key must equal:
 *   {kind:'values', values:[n..]} | {kind:'surd', k, m} | {kind:'poly', c2, c1, c0} | {kind:'number', value} | {kind:'matrix', entries:[4]}
 * English only; the Urdu forms are design_pending (no sample). Pure.
 */

const norm = (s) => String(s == null ? '' : s).replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/[×]/g, '*').replace(/⁻¹/g, '^-1');
const num = (s) => parseFloat(String(s).replace(/\s+/g, ''));
const coef = (sign, digits) => (sign === '-' ? -1 : 1) * (digits === '' || digits === undefined ? 1 : parseFloat(digits));

function linearEq(stem) {
  const s = norm(stem);
  if (!/\bsolve\b|value of x|find x/i.test(s) || /x\^2|x\s*\*\s*x/.test(s) || (s.match(/=/g) || []).length !== 1) return null;
  const m = /(?<![\w.^])([+-]?)\s*(\d*\.?\d*)\s*x\s*(?:([+-])\s*(\d+\.?\d*))?\s*=\s*([+-]?\s*\d+\.?\d*)/.exec(s);
  if (!m) return null;
  const a = coef(m[1], m[2]);
  const b = m[3] ? coef(m[3], m[4]) : 0;
  const c = num(m[5]);
  if (!a || [a, b, c].some((n) => !Number.isFinite(n))) return null;
  return { kind: 'values', values: [(c - b) / a] };
}

function quadRoots(stem) {
  const s = norm(stem);
  if (!/\bsolve\b|roots?\b|find x/i.test(s)) return null;
  const m = /(?<![\d.^])x\^2\s*(?:([+-])\s*(\d*\.?\d*)\s*x)?\s*(?:([+-])\s*(\d+\.?\d*))?\s*=\s*0/.exec(s);
  if (!m) return null;
  const b = m[1] ? coef(m[1], m[2]) : 0;
  const c = m[3] ? coef(m[3], m[4]) : 0;
  const d = b * b - 4 * c;
  if (!Number.isFinite(d) || d < 0) return null; // no real roots: not a provable numeric key
  const r = Math.sqrt(d);
  return { kind: 'values', values: d === 0 ? [-b / 2] : [(-b - r) / 2, (-b + r) / 2] };
}

function expandBinomial(stem) {
  const s = norm(stem);
  if (!/\bexpand\b/i.test(s)) return null;
  const m = /\(\s*x\s*([+-])\s*(\d+\.?\d*)\s*\)\s*\*?\s*\(\s*x\s*([+-])\s*(\d+\.?\d*)\s*\)/i.exec(s);
  if (!m) return null;
  const a = coef(m[1], m[2]); const b = coef(m[3], m[4]);
  return { kind: 'poly', c2: 1, c1: a + b, c0: a * b };
}

function squareFree(n) {
  let k = 1; let m = n;
  for (let f = 2; f * f <= m; f += 1) while (m % (f * f) === 0) { m /= f * f; k *= f; }
  return { k, m };
}

function surdSimplify(stem) {
  const s = norm(stem).replace(/sqrt\s*\(?\s*(\d+)\s*\)?/gi, '√$1');
  if (!/\bsimplify\b/i.test(s)) return null;
  const m = /√\s*\(?\s*(\d+)\s*\)?(?:\s*\*\s*√\s*\(?\s*(\d+)\s*\)?)?/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 10) * (m[2] ? parseInt(m[2], 10) : 1);
  if (!(n > 0) || !Number.isSafeInteger(n)) return null;
  return { kind: 'surd', ...squareFree(n) };
}

const TRIG = { sin: { 0: 0, 30: 0.5, 45: Math.SQRT1_2, 60: Math.sqrt(3) / 2, 90: 1 }, cos: { 0: 1, 30: Math.sqrt(3) / 2, 45: Math.SQRT1_2, 60: 0.5, 90: 0 }, tan: { 0: 0, 30: Math.sqrt(3) / 3, 45: 1, 60: Math.sqrt(3) } };
function trigExact(stem) {
  const s = norm(stem);
  const all = s.match(/\b(?:sin|cos|tan)\s*\(?\s*\d+\s*(?:°|deg)/gi) || [];
  if (all.length !== 1) return null;
  const m = /\b(sin|cos|tan)\s*\(?\s*(\d+)\s*(?:°|deg)\s*\)?/i.exec(s);
  const rest = s.replace(m[0], ' ').replace(/\b(?:find|evaluate|calculate|state|write|down|what|is|the|exact|value|of|give|determine)\b|[:?.=,]/gi, ' ').trim();
  if (rest) return null;
  const v = TRIG[m[1].toLowerCase()][m[2]];
  return v === undefined ? null : { kind: 'values', values: [v] };
}

const MAT = [
  /\[\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*,\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*\]/g,
  /\|\s*(-?[\d.]+)\s+(-?[\d.]+)\s*;\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\|/g,
];
function matrixOps(stem) {
  const s = norm(stem);
  const found = [];
  MAT.forEach((re) => { for (const m of s.matchAll(re)) found.push({ at: m.index, e: m.slice(1, 5).map(num) }); });
  found.sort((x, y) => x.at - y.at);
  if (found.some((f) => f.e.some((n) => !Number.isFinite(n)))) return null;
  const [A, B] = [found[0] && found[0].e, found[1] && found[1].e];
  if (/\bdeterminant\b|\bdet\b/i.test(s) && A && !B) return { kind: 'number', value: A[0] * A[3] - A[1] * A[2] };
  if (!A || !B || found.length !== 2) return null;
  if (/\bsum\b|\badd\b|\bplus\b/i.test(s)) return { kind: 'matrix', entries: A.map((v, i) => v + B[i]) };
  if (/\bproduct\b|\bmultipl/i.test(s)) {
    return { kind: 'matrix', entries: [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]] };
  }
  return null;
}

function stoichMoles(stem) {
  const s = norm(stem);
  const mm = /(?:\bM\s*=|molar mass[^\d]{0,30})\s*(\d+\.?\d*)\s*g\s*(?:mol\^-1|\/\s*mol|per mol)/i.exec(s);
  if (!mm) return null;
  const M = parseFloat(mm[1]);
  const rest = s.replace(mm[0], ' ');
  const mass = /(?<![\w.])(\d+\.?\d*)\s*g\b(?!\s*(?:mol|\/))/i.exec(rest);
  const mol = /(?<![\w.])(\d+\.?\d*)\s*mol\b(?!\^|\s*-)/i.exec(rest);
  if (!(M > 0)) return null;
  if (/\b(?:how many moles|number of moles|moles of|calculate the moles|find the moles|amount of substance)\b/i.test(s) && mass && !mol) return { kind: 'values', values: [parseFloat(mass[1]) / M] };
  if (/\b(?:what mass|mass of|find the mass|calculate the mass)\b/i.test(s) && mol && !mass) return { kind: 'values', values: [parseFloat(mol[1]) * M] };
  return null;
}

const MATHS = ['maths', 'physics'];
const RECOGNISERS = [
  { id: 'linear_eq', subjects: MATHS, match: linearEq },
  { id: 'quad_roots', subjects: MATHS, match: quadRoots },
  { id: 'expand_binomial', subjects: MATHS, match: expandBinomial },
  { id: 'surd_simplify', subjects: MATHS, match: surdSimplify },
  { id: 'trig_exact', subjects: MATHS, match: trigExact },
  { id: 'matrix_2x2', subjects: MATHS, match: matrixOps },
  { id: 'stoich_moles', subjects: ['chemistry', 'physics', 'biology'], match: stoichMoles },
];

/** First recogniser (for this subject code) that matches the stem: {id, expected} or null. */
function recognise(stem, code) {
  for (const r of RECOGNISERS) {
    if (!r.subjects.includes(code)) continue;
    const expected = r.match(stem);
    if (expected) return { id: r.id, expected };
  }
  return null;
}

module.exports = { recognise, RECOGNISERS, squareFree };
