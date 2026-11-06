'use strict';
/**
 * The one order a standard paper's questions print in (bd-cj8ggk.1).
 *
 * exam_json is stored as jsonb, and jsonb does not keep key order: it returns keys shortest-first. A paper
 * printed straight after generation followed the model's order; every re-render after an edit read the row
 * back and printed "MCQs" before "Fill in the Blanks", sometimes subjective before objective. Key order is
 * therefore never trusted: the renderer and the editor's list (assessment-selection) both walk the tree
 * through orderedEntries, so the paper and her numbered list always agree.
 *
 * Categories: objective, subjective, anything else. Types, by name and whatever case or plural the model
 * used: Fill in the Blanks, MCQs, MSQs, Missing Letters, then the other objective types; short answers
 * before the rest; long and written work (Long Question, Essay/Letter/Story… Writing) last. Ties keep the
 * order the keys arrived in.
 */

const CATEGORY_RANK = { objective: 0, subjective: 1 };

const TYPE_RANKS = [
  [/fill\s*in\s*the\s*blank/i, 0],
  [/^mcqs?$|multiple\s*choice/i, 1],
  [/^msqs?$/i, 2],
  [/missing\s*letter/i, 3],
  [/^(short|brief)\b/i, 5],
  [/^long\b|descriptive|\bwriting$|essay/i, 7],
];
const OTHER_TYPE_RANK = 6; // other objective types land after rank 3 (they never meet short/long in one category)

function _typeRank(name) {
  const n = String(name || '').trim();
  for (const [re, rank] of TYPE_RANKS) if (re.test(n)) return rank;
  return OTHER_TYPE_RANK;
}

function _categoryRank(name) {
  const r = CATEGORY_RANK[String(name || '').trim().toLowerCase()];
  return r === undefined ? 2 : r;
}

/** Object.entries in print order. `level` is 'category' or 'type' (a sub-type ranks as a type). */
function orderedEntries(obj, level) {
  const rank = level === 'category' ? _categoryRank : _typeRank;
  return Object.entries(obj || {})
    .map((entry, i) => ({ entry, i, r: rank(entry[0]) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.entry);
}

module.exports = { orderedEntries };
