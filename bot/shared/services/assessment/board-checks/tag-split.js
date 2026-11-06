'use strict';
/**
 * The soft SPLIT report of `tag-complete` (contract 8 part 2 section 2): the marks-weighted share of printed
 * marks per `tag.blooms`, counted as check_paper.py:161-172 does (both OR branches, every one of "any N of M",
 * stimulus MCQs; teacher_marked slots yield no leaves). A level off its target by more than `tolerance_pp` is a
 * soft note. A target whose status is `design_pending` or `default` is reported in `split` only (rubric A6b,
 * DESIGN R15). Pure.
 */
const { issue } = require('./_text-norm');

const ID = 'tag-complete';
const REPORT_ONLY = new Set(['design_pending', 'default']);

const marksOf = (n) => {
  const own = Number(n.item && n.item.marks);
  if (Number.isFinite(own) && own > 0) return own;
  const each = Number(n.slotRow && n.slotRow.marks_each);
  return Number.isFinite(each) && each > 0 ? each : 0;
};

/** leaves: walker leaves. target: {levels:{L:pct}, tolerance_pp, status}. -> {issues, split|null} */
function splitReport(leaves, target) {
  if (!target || !target.levels) return { issues: [], split: null };
  const sums = {};
  let total = 0;
  leaves.forEach((n) => {
    const b = n.item && n.item.tag && n.item.tag.blooms;
    const m = marksOf(n);
    if (!b || !m) return;
    sums[b] = (sums[b] || 0) + m;
    total += m;
  });
  if (!total) return { issues: [], split: null };
  const tol = Number.isFinite(target.tolerance_pp) ? target.tolerance_pp : 5;
  const levels = {};
  Object.keys(sums).forEach((k) => { levels[k] = Math.round((sums[k] / total) * 1000) / 10; });
  const split = { levels, target: { ...target.levels }, tolerance_pp: tol };
  const issues = [];
  if (!REPORT_ONLY.has(target.status)) {
    const keys = new Set([...Object.keys(levels), ...Object.keys(target.levels)]);
    keys.forEach((k) => {
      const have = levels[k] || 0;
      const want = Number(target.levels[k]) || 0;
      if (Math.abs(have - want) > tol) issues.push(issue(ID, 'SPLIT', '-', `level ${k} is ${have}% of marks, target ${want}% (tolerance ${tol} pp)`, false));
    });
  }
  return { issues, split };
}

module.exports = { splitReport };
