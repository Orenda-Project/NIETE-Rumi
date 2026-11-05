'use strict';
/**
 * D13 mcq-shape (contract 8 §5): shape of every leaf with an `options` array (stimulus MCQs included).
 * Hard: OPTION_COUNT, OPTION_LABELS, KEY_UNRESOLVED, DUP_OPTION, NUMERIC_ORDER, KEY_RUN, KEY_SHARE (>40%).
 * Soft: NONE_ALL_OF_ABOVE, KEY_SHARE between 35% and 40%.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const T = require('./option-text');

const LIMITS = {
  optionCount: 4, // the board's count (rubric part2.md:34, SPEC §5)
  keyRun: 4, // rubric D13: "no run of 4 or more"
  keyShareHard: 0.4, // rubric D13 house rule
  keyShareSoft: 0.35, // check_paper.py warned at 35%
  keyShareMinN: 10, // design_pending: smallest MCQ section in BLUEPRINTS is G6 History A (10); no source beyond that
};
const ID = 'D13';
const NONE_ALL = /\b(?:all|none) of the (?:above|these)\b|مندرجہ\s*بالا\s*تمام|تمام\s*مندرجہ\s*بالا|مندرجہ\s*بالا\s*میں\s*سے\s*کوئی\s*نہیں|^کوئی\s*نہیں$/;

function itemIssues(l, out) {
  const { item, ref, slot } = l;
  const push = (rule, msg, hard) => out.push(issue(ID, rule, ref, msg, hard, slot == null ? undefined : slot));
  const opts = item.options;
  if (opts.length !== LIMITS.optionCount) push('OPTION_COUNT', `${opts.length} options, ${LIMITS.optionCount} expected`, true);
  if (opts.some((o, i) => T.labelOf(o) !== i)) push('OPTION_LABELS', 'option labels are not A) to D) in order', true);
  const k = T.keyIndex(item);
  if (k < 0) push('KEY_UNRESOLVED', `answer "${String(item.answer).slice(0, 40)}" does not resolve to exactly one option`, true);
  const bodies = opts.map((o) => T.body(o).replace(/\s+/g, ''));
  if (new Set(bodies).size !== bodies.length) push('DUP_OPTION', 'two options are the same after stripping labels', true);
  const nums = opts.map((o) => T.parseNumber(T.stripLabel(o)));
  if (opts.length > 1 && nums.every((n) => n !== null) && nums.some((n, i) => i > 0 && n < nums[i - 1])) {
    push('NUMERIC_ORDER', 'numeric options are not ascending', true);
  }
  if (opts.some((o) => NONE_ALL.test(T.body(o)))) push('NONE_ALL_OF_ABOVE', 'an option reads all/none of the above', false);
  return k;
}

function keyChecks(group, out, detail) {
  const keyed = group.items.filter((g) => g.k >= 0);
  let run = 0;
  let flagged = false;
  keyed.forEach((g, i) => {
    run = i > 0 && keyed[i - 1].k === g.k ? run + 1 : 1;
    if (run >= LIMITS.keyRun && !flagged) {
      flagged = true;
      out.push(issue(ID, 'KEY_RUN', g.leaf.ref, `${run} MCQs in a row keyed ${'ABCD'[g.k]} in ${group.id}`, true, g.leaf.slot == null ? undefined : g.leaf.slot));
    }
    if (run < LIMITS.keyRun) flagged = false;
  });
  const n = keyed.length;
  const counts = [0, 0, 0, 0];
  keyed.forEach((g) => { counts[g.k] += 1; });
  const shares = counts.map((c) => (n ? c / n : 0));
  detail.shares[group.id] = { n, shares: Object.fromEntries(shares.map((s, i) => ['ABCD'[i], Number(s.toFixed(3))])) };
  if (n < LIMITS.keyShareMinN) return;
  shares.forEach((s, i) => {
    const hard = s > LIMITS.keyShareHard + 1e-9;
    if (hard || s > LIMITS.keyShareSoft + 1e-9) {
      out.push(issue(ID, 'KEY_SHARE', group.id, `${'ABCD'[i]} keys ${(s * 100).toFixed(1)}% of ${n} MCQs in ${group.id}`, hard, group.id));
    }
  });
}

function run(examJson) {
  const out = [];
  const detail = { shares: {} };
  const groups = new Map();
  leaves(examJson).forEach((l) => {
    if (!Array.isArray(l.item.options)) return;
    const k = itemIssues(l, out);
    const gid = l.sectionId != null ? l.sectionId : `free:${l.item.type || 'mcq'}`;
    if (!groups.has(gid)) groups.set(gid, { id: gid, items: [] });
    groups.get(gid).items.push({ leaf: l, k });
  });
  groups.forEach((g) => keyChecks(g, out, detail));
  return { ok: !out.some((i) => i.hard), issues: out, detail };
}

module.exports = { id: ID, name: 'mcq-shape', hard: true, modes: ['free', 'board'], LIMITS, run };
