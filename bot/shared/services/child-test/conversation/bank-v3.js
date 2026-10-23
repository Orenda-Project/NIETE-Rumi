'use strict';

/**
 * The v3 item bank, as the conversation reads it (CONTRACT §21.3, L36). Pure reads, never throws.
 *
 *   tasksFor({ grade })                  the 18 task ids in visit order: L35's item-bank.tasksFor when it
 *                                        has landed, else tasks.js TASKS_V3 (the same list, by contract)
 *   specFor({ grade, set, task })        the task's spec ({ task, title, timed_s, items, practice, stop,
 *                                        script, … } or { gap: true, reason }), or null when the bank has none
 *   pageOf({ grade, set, task })         the task's page in its child booklet (one task per side, L38): the
 *                                        tasks of its booklet that have a child sheet and are not gaps, in order
 *
 * The bank is L35's item-bank.v3.json through item-bank.js (getTaskSpec, tasksFor). Tests and the render
 * harness inject a §21.3-shaped bank with __setForTest.
 */

const { TASKS_V3, blockOf, kindOf } = require('../tasks');

// No child sheet: the coach reads these aloud (CONTRACT §21.7).
const NO_SHEET = new Set(['listening', 'word_problems']);
const LANG_OF_BLOCK = { urdu: 'ur', english: 'en' };

let injected = null;

function itemBank() {
  try {
    return require('../item-bank');
  } catch (err) {
    return {};
  }
}

/** A task's spec in a §21.3 bank: reading by language (one form for both grades), maths by grade. */
function lookup(bank, { grade, set, task }) {
  const sets = (bank && bank.sets) || {};
  const form = sets[set] || sets.A || Object.values(sets)[0];
  if (!form) return null;
  const block = blockOf(task);
  const kind = kindOf(task);
  if (block === 'maths') {
    const m = (form.maths || {})[String(grade)] || (form.maths || {})[String(Number(grade) === 5 ? 5 : 3)];
    return (m && m[kind]) || null;
  }
  const r = (form.reading || {})[LANG_OF_BLOCK[block]];
  return (r && r[kind]) || null;
}

function tasksFor({ grade } = {}) {
  if (!injected) {
    const ib = itemBank();
    if (typeof ib.tasksFor === 'function') {
      try {
        const list = ib.tasksFor({ grade });
        if (Array.isArray(list) && list.length) return list;
      } catch (err) { /* the contract list below */ }
    }
  }
  return [...TASKS_V3];
}

function specFor({ grade, set = 'A', task } = {}) {
  if (injected) return lookup(injected, { grade, set, task });
  const ib = itemBank();
  try {
    if (typeof ib.getTaskSpec === 'function') return ib.getTaskSpec({ grade, set, task }) || null;
    if (typeof ib.bankV3 === 'function') return lookup(ib.bankV3(), { grade, set, task });
  } catch (err) {
    return null;
  }
  return null;
}

const isGap = (spec) => !!(spec && spec.gap);
const hasSheet = (task) => !NO_SHEET.has(kindOf(task));

function pageOf({ grade, set = 'A', task } = {}) {
  if (!hasSheet(task)) return null;
  const pages = tasksFor({ grade })
    .filter((x) => blockOf(x) === blockOf(task) && hasSheet(x) && !isGap(specFor({ grade, set, task: x })));
  const i = pages.indexOf(task);
  return i >= 0 ? i + 1 : null;
}

module.exports = {
  tasksFor, specFor, pageOf, isGap, hasSheet,
  __setForTest(bank) { injected = bank || null; },
};
