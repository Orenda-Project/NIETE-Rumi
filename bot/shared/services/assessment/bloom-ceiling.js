'use strict';
/**
 * The Bloom's tag a question can honestly carry, read from its shape. Pure: no I/O.
 *
 * The question writer tags its own questions. Left unchecked it tags a bare sum Apply and a
 * one-mark "your favourite" Evaluate. Rule: working a just-taught procedure on a bare item is
 * Understand; Apply needs a new situation (a word problem, an unfamiliar context, choosing the
 * operation). A ceiling only lowers a tag, never raises one, and an unknown tag is left alone.
 */

const LEVELS = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
const rank = (tag) => LEVELS.indexOf(tag);
const APPLY = rank('Apply');
const ANALYZE = rank('Analyze');
const EVALUATE = rank('Evaluate');

// Words a bare computation may carry besides its numbers: the instruction, nothing else.
const DRILL_WORDS = new Set([
  'what', 'is', 'the', 'a', 'of', 'and', 'to', 'from', 'by', 'into', 'value', 'answer',
  'solve', 'find', 'calculate', 'work', 'out', 'write', 'complete', 'fill', 'in', 'blank', 'blanks',
  'add', 'adding', 'sum', 'total', 'plus', 'subtract', 'subtracting', 'minus', 'difference',
  'multiply', 'multiplying', 'product', 'times', 'divide', 'dividing', 'quotient', 'groups', 'gives',
  'estimate', 'round', 'off', 'nearest', 'ten', 'tens', 'hundred', 'hundreds', 'thousand',
  'skip', 'counting', 'count', 'pattern', 'next', 'missing', 'number', 'numbers',
]);
const BLANK = /_{2,}/;
const RETELL = /in your own words|\bdescribe\b|اپنے الفاظ میں|بیان کریں/i;
const REASONING = /compare|\bwhy\b|reason|differen|contrast|تجزیہ|فرق|موازنہ|کیوں|وجہ/i;
const TRUE_FALSE = /^(true|false|صحیح|غلط|درست)$/i;

function textOf(item) {
  return [item.main_question, item.question, item.text, item.statement]
    .filter((s) => typeof s === 'string').join(' ').trim();
}

function marksOf(item) {
  const n = Number(item.marks);
  return Number.isFinite(n) ? n : null;
}

function isBareComputation(text) {
  if (!/\d/.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  return words.every((w) => DRILL_WORDS.has(w));
}

// A one-mark blank in a short sentence. Numbers are left to isBareComputation: a blank inside
// a story with numbers ("Babloo had Rs. 250 ...") is a word problem and may be Apply.
function isShortBlank(text, marks) {
  if (!BLANK.test(text) || /\d/.test(text) || marks === null || marks > 1) return false;
  return text.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length <= 14;
}

function isSelectedResponse(item) {
  if (Array.isArray(item.options) && item.options.length) return true;
  return typeof item.answer === 'string' && TRUE_FALSE.test(item.answer.trim());
}

/** The tag this item may carry at most, or null when its own tag is already honest. */
function ceilingFor(item) {
  if (!item || typeof item !== 'object') return null;
  const own = rank(item.blooms);
  if (own < 0) return null;
  const text = textOf(item);
  const marks = marksOf(item);
  const oneMark = marks !== null && marks <= 1;

  let cap = null;
  if (own >= APPLY && (isBareComputation(text) || isShortBlank(text, marks))) cap = 'Understand';
  else if (own >= ANALYZE && oneMark && isSelectedResponse(item)) cap = 'Understand';
  else if (own >= EVALUATE && oneMark) cap = 'Understand';
  else if (own >= ANALYZE && RETELL.test(text) && !REASONING.test(text)) cap = 'Understand';

  return cap !== null && rank(cap) < own ? cap : null;
}

function walk(examJson, visit) {
  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const category of Object.values(branch)) {
      if (!category || typeof category !== 'object') continue;
      for (const entry of Object.values(category)) {
        const lists = Array.isArray(entry) ? [entry]
          : (entry && typeof entry === 'object' ? Object.values(entry).filter(Array.isArray) : []);
        lists.forEach((list) => list.forEach((q) => q && typeof q === 'object' && visit(q)));
      }
    }
  }
}

/** Lower every over-high tag in the paper in place; return what moved. */
function capBlooms(examJson) {
  const moved = [];
  walk(examJson, (item) => {
    const to = ceilingFor(item);
    if (!to) return;
    moved.push({ question: textOf(item), from: item.blooms, to });
    item.blooms = to;
  });
  return moved;
}

/** Appended to the non-board writer's system prompt; the format examples still tag drill Apply. */
const APPLY_NOTE = [
  '',
  "## BLOOM'S: WHAT IS NOT APPLY",
  '- Not Apply: a bare sum, a drill, or a blank that repeats the rule just taught ("12 x 5", "25 + ___ = 40",',
  '  "2, 4, ___, 8", "She is ___ her lunch. (eat)"). Tag those Understand.',
  '- Apply needs a new situation: a word problem, an unfamiliar context, or choosing which method to use.',
  '- Analyze, Evaluate and Create need real reasoning: comparing, judging with reasons, or producing something',
  '  new. A one-mark choice, a "your favourite", or retelling "in your own words" is Understand at most.',
  '- This overrides any example above.',
].join('\n');

module.exports = { ceilingFor, capBlooms, LEVELS, APPLY_NOTE };
