'use strict';
/**
 * Board MCQ key settling (bd-5jmnfj.38.30), run by the board writer after the layout and before the checks, so
 * D13 NUMERIC_ORDER / KEY_RUN / KEY_SHARE are met by the code and not left to the model's word.
 *   1. An item whose four options are all numbers is sorted ascending; the key follows its value.
 *   2. Per section, in D13's walk order, a non-numeric key is moved (its body swapped with another option's) when
 *      it would make a run of D13.keyRun, or take its letter past the soft share (35%) in a section of keyShareMinN+.
 * Only clean items move: 4 options labelled A) to D) in order, distinct bodies, a key that resolves, and no option
 * that names another letter ("Both A and B"). Everything else is counted but left as written. Mutates in place.
 * The G1-5 key spreader (fde-layout spreadKeys) rotates options and would undo the numeric order, so it is not reused.
 */
const { leaves } = require('../board-checks/walk');
const OT = require('../board-checks/option-text');
const { LIMITS } = require('../board-checks/mcq-shape');

const POINTS_AT_LETTER = /\b(?:both|neither|either)\b|\b[A-D]\s*(?:and|&|or|,)\s*[A-D]\b/i;
const prefixOf = (opt) => { const s = String(opt); return s.slice(0, s.length - OT.stripLabel(s).length); };

function clean(item) {
  const o = item.options;
  if (!Array.isArray(o) || o.length !== LIMITS.optionCount) return false;
  if (o.some((x, i) => OT.labelOf(x) !== i)) return false;
  const bodies = o.map(OT.body);
  return new Set(bodies).size === bodies.length && OT.keyIndex(item) >= 0;
}

/** Write bodies back under the original labels; the answer becomes the keyed option in full. */
function rewrite(item, bodies, k) {
  item.options = item.options.map((o, i) => `${prefixOf(o)}${bodies[i]}`);
  item.answer = item.options[k];
}

/** Sorts an all-numeric item; returns true when it is numeric (its key position is then fixed). */
function sortNumeric(item) {
  const bodies = item.options.map(OT.stripLabel);
  const nums = bodies.map(OT.parseNumber);
  if (nums.some((n) => n === null)) return false;
  if (nums.every((n, i) => i === 0 || n >= nums[i - 1])) return true;
  const k = OT.keyIndex(item);
  const order = bodies.map((b, i) => i).sort((a, b) => nums[a] - nums[b] || a - b);
  rewrite(item, order.map((i) => bodies[i]), order.indexOf(k));
  return true;
}

function settleGroup(list) {
  const n = list.length;
  const cap = n >= LIMITS.keyShareMinN ? Math.floor(n * LIMITS.keyShareSoft) : n;
  const counts = [0, 0, 0, 0];
  let prev = -1;
  let run = 0;
  list.forEach(({ item, movable }) => {
    let k = OT.keyIndex(item);
    if (k < 0) return;
    const wouldRun = k === prev ? run + 1 : 1;
    if (movable && (wouldRun >= LIMITS.keyRun || counts[k] + 1 > cap)) {
      const ok = [0, 1, 2, 3].filter((j) => j !== k && j !== (wouldRun >= LIMITS.keyRun ? prev : -1));
      const target = ok.sort((a, b) => counts[a] - counts[b] || a - b)[0];
      const bodies = item.options.map(OT.stripLabel);
      [bodies[k], bodies[target]] = [bodies[target], bodies[k]];
      rewrite(item, bodies, target);
      k = target;
    }
    run = k === prev ? run + 1 : 1;
    prev = k;
    counts[k] += 1;
  });
}

function settleKeys(examJson) {
  const groups = new Map();
  leaves(examJson).forEach((l) => {
    if (!Array.isArray(l.item.options)) return;
    const ok = clean(l.item);
    const numeric = ok && sortNumeric(l.item);
    const movable = ok && !numeric && !l.item.options.some((o) => POINTS_AT_LETTER.test(OT.stripLabel(o)));
    const gid = l.sectionId != null ? l.sectionId : `free:${l.item.type || 'mcq'}`;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push({ item: l.item, movable });
  });
  groups.forEach(settleGroup);
  return examJson;
}

module.exports = { settleKeys };
