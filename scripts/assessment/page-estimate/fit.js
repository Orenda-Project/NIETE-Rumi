#!/usr/bin/env node
'use strict';
/**
 * bd-nr8mrm.8 — fit the page estimate from calibrate.js's measurements.
 *
 *     node scripts/assessment/page-estimate/fit.js <measured.json>
 *
 * height ≈ base + Σ count·perType (+ urduPerQ·total on a Nastaliq paper). A type seen in fewer
 * than MIN_PAPERS papers is pooled into its category's default. Prints a 5-fold held-out check
 * (exact page / within one / overshoot) and the numbers to paste into the portal's pageEstimate.ts.
 */

const MIN_PAPERS = Number(process.env.MIN_PAPERS || 15);
const URDU_SUBJECTS = new Set(['urdu', 'islamiat', 'pakistan_studies_ur']);

/** Least squares by normal equations, a small ridge so a rare column cannot explode. */
function leastSquares(X, y, ridge = 1e-2) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  X.forEach((x, n) => {
    for (let i = 0; i < k; i++) { b[i] += x[i] * y[n]; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; }
  });
  for (let i = 1; i < k; i++) A[i][i] += ridge;
  for (let c = 0; c < k; c++) { // Gauss-Jordan with partial pivoting
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < k; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => (A[i][i] ? v / A[i][i] : 0));
}

function columns(rows, categoryOf, drop = new Set()) {
  const seen = {};
  rows.forEach((r) => Object.keys(r.counts).forEach((t) => { seen[t] = (seen[t] || 0) + 1; }));
  const types = Object.keys(seen).filter((t) => seen[t] >= MIN_PAPERS && !drop.has(t)).sort();
  const col = (t) => (types.includes(t) ? t : `_${categoryOf(t)}`);
  return { types, cols: [...types, '_objective', '_subjective', '_urdu'], col };
}

function design(r, cols, col) {
  const x = Object.fromEntries(cols.map((c) => [c, 0]));
  let total = 0;
  for (const [t, n] of Object.entries(r.counts)) { x[col(t)] += n; total += n; }
  if (URDU_SUBJECTS.has(r.subject)) x._urdu = total;
  return [1, ...cols.map((c) => x[c])];
}

/** A type the fit gives a negative height (collinear with another) is pooled and the fit rerun. */
function fit(rows, categoryOf) {
  const drop = new Set();
  for (;;) {
    const { cols, col } = columns(rows, categoryOf, drop);
    const w = leastSquares(rows.map((r) => design(r, cols, col)), rows.map((r) => r.height));
    const per = Object.fromEntries(cols.map((c, i) => [c, w[i + 1]]));
    const neg = cols.filter((c) => !c.startsWith('_') && per[c] < 0);
    if (!neg.length) return { base: w[0], per, cols, col };
    neg.forEach((c) => drop.add(c));
  }
}

const predict = (m, r) => design(r, m.cols, m.col).reduce((s, v, i) => s + v * (i ? m.per[m.cols[i - 1]] : m.base), 0);

function main([file]) {
  const Q = require('../../../bot/shared/services/assessment/question-types');
  const categoryOf = (t) => (Q.categoryOf(t) === 'subjective' ? 'subjective' : 'objective');
  const rows = require(require('path').resolve(file)).filter((r) => r.pdfPages <= 8);
  const PAGE = Number(process.env.PAGE_PX || 1040); // A4 content box is 1023px; page breaks add a little
  let exact = 0; let near = 0; let over = 0;
  rows.forEach((r, i) => {
    const m = fit(rows.filter((_, j) => j % 5 !== i % 5), categoryOf);
    const est = Math.max(1, Math.ceil(predict(m, r) / PAGE));
    if (est === r.pdfPages) exact++;
    if (Math.abs(est - r.pdfPages) <= 1) near++;
    if (est > r.pdfPages) over++;
  });
  const m = fit(rows, categoryOf);
  console.log(`n=${rows.length} pagePx≈${PAGE.toFixed(0)} held-out: exact ${exact}, within 1 ${near}, over ${over}`);
  console.log(JSON.stringify({ base: Math.round(m.base),
    per: Object.fromEntries(Object.entries(m.per).map(([k, v]) => [k, Math.round(v)])) }, null, 1));
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { leastSquares };
