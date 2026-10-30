'use strict';
/**
 * v27 G5 Urdu Q1 item 15 (bd-5jmnfj.4.58.3): the رموزِ اوقاف MCQ printed «الف) ۔ “ ” (واوین)» and
 * «ب) (ختمہ)» — the full stop had slid from the ختمہ option into the واوین one. An option that names a
 * punctuation mark in words is normalised to «label) sign (name)»; the key follows its option.
 *
 * Pure: {examJson, notes}; an MCQ that names no mark is returned as it was.
 */

const MARKS = [
  ['واوین', '“ ”'],
  ['ختمہ', '۔'],
  ['سوالیہ نشان', '؟'],
  ['فجائیہ', '!'],
  ['سکتہ', '،'],
  ['وقفہ', '؛'],
  ['رابطہ', ':'],
];
// «الف) anything (name)»: the label, whatever sign the model put, the name in brackets.
const OPTION = /^\s*([^\s)]{1,4})\)\s*(.*?)\s*\(([^()]+)\)\s*$/u;

function fixOption(option) {
  const m = OPTION.exec(String(option));
  if (!m) return option;
  const name = m[3].trim();
  const mark = MARKS.find(([n]) => n === name);
  if (!mark) return option;
  const fixed = `${m[1]}) ${mark[1]} (${name})`;
  return fixed === option ? option : fixed;
}

function fixItem(q, notes) {
  if (!q || typeof q !== 'object' || !Array.isArray(q.options) || q.options.length < 2) return q;
  const options = q.options.map((o) => (typeof o === 'string' ? fixOption(o) : o));
  const changed = options.map((o, i) => [q.options[i], o]).filter(([was, now]) => was !== now);
  if (!changed.length) return q;
  const swap = new Map(changed);
  const answer = typeof q.answer === 'string' && swap.has(q.answer) ? swap.get(q.answer) : q.answer;
  notes.push(`${q.slot}: punctuation options rewritten so each names its own mark: ${changed.map(([was, now]) => `«${was}» → «${now}»`).join(', ')}`);
  return { ...q, options, answer };
}

/** Every MCQ's punctuation-mark options normalised; `notes` is one string per changed item. */
function urduPunctFixes(examJson) {
  const notes = [];
  if (!examJson || typeof examJson !== 'object') return { examJson, notes };
  const out = { ...examJson };
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, types]) => [cat, !types || typeof types !== 'object' ? types
      : Object.fromEntries(Object.entries(types).map(([type, list]) => [type, Array.isArray(list) ? list.map((q) => fixItem(q, notes)) : list]))]));
  }
  return { examJson: out, notes };
}

module.exports = { urduPunctFixes, fixOption };
