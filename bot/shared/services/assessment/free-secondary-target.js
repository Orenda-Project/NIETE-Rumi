'use strict';
/**
 * bd-5jmnfj.38.43 (q304) — FDE's thinking-level mix for a Grade 6-10 build-your-own (free) paper, the G6-12
 * sibling of fde-level-target.js (G1-5, bd-zrdvmi.50.7). Pure apart from reading the frozen registry.
 *
 * Shares of MARKS per level: R Remember, U Understand, A Apply, AE Analyze/Evaluate, C Create. A split that
 * names no AE or C folds those levels upward into the next level it does name (free-secondary-levels bucketOf).
 *   Grades 6-8:  FDE Assessment Scheme 2023-24, Grades IV-VIII (FDE Assessment Framework Prep-VIII, doc 5), by
 *                subject group. The registry's per-subject ToS rows agree with it (a test keeps them equal).
 *   Grades 9-10: the FBISE split the G6-12 registry (subject-config) marks `verified`.
 * Any other cell (a subject FDE groups nowhere, an unverified board split, G11-12) has no target: null, never a
 * made-up one, and the paper keeps the panel's 30/30/20/10/10 (free-secondary-levels PANEL).
 *
 *   fdeTarget(grade, subject)  { levels, source } | null
 *   splitText(levels)          "10% Remember, 60% Understand and 30% Apply (…)" for the writer and the rewrite
 */
const SubjectConfig = require('./subject-config');

const SCHEME = 'FDE Assessment Scheme 2023-24, Grades IV-VIII';
const FIVE = { R: 30, U: 30, A: 20, AE: 10, C: 10 };

// The Scheme's subject groups, onto the registry's G6-8 codes.
const G6_8 = {
  maths: { R: 10, U: 60, A: 30 }, // "Application and Analysis 30%"
  general_science: FIVE, computer_science: FIVE, geography: FIVE, // "Science, Computers and Geography"
  english: FIVE, urdu: FIVE, // "Languages"
  history: { R: 50, U: 20, A: 10, AE: 10, C: 10 },
  islamiat: { R: 40, U: 30, A: 20, AE: 10 },
};

function gradeOf(grade) {
  const n = typeof grade === 'number' ? grade : Number(String(grade ?? '').trim() || NaN);
  return Number.isInteger(n) ? n : null;
}

function boardTarget(grade, code) {
  let row;
  try { row = SubjectConfig.resolve(grade, code); } catch { return null; }
  const tos = row && row.tos_default;
  if (!tos || tos.status !== 'verified' || tos.scale !== 'KUA') return null;
  const { K, U, A } = tos.levels;
  return { levels: { R: K, U, A }, source: `FBISE SSC Table of Specification (${tos.source})` };
}

function fdeTarget(grade, subject) {
  const g = gradeOf(grade);
  const code = String(subject ?? '').trim().toLowerCase();
  if (!code || g === null) return null;
  if (g >= 6 && g <= 8) return G6_8[code] ? { levels: { ...G6_8[code] }, source: SCHEME } : null;
  if (g === 9 || g === 10) return boardTarget(g, code);
  return null;
}

const NAME = { R: 'Remember', U: 'Understand', A: 'Apply', AE: 'Analyze or Evaluate', C: 'Create' };

function splitText(levels) {
  const parts = Object.entries(levels).filter(([, v]) => v > 0).map(([b, v]) => `${v}% ${NAME[b]}`);
  const list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  if (!levels.AE && !levels.C) return `${list} (Apply here includes Analyze, Evaluate and Create)`;
  if (!levels.C) return `${list} (Create counts as Analyze or Evaluate here)`;
  return list;
}

module.exports = { fdeTarget, splitText, G6_8 };
