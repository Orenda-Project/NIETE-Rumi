'use strict';
/**
 * Topics in one chapter must not share a name (a teacher sees two identical tick boxes).
 * Colliding SLO topics are renamed "<first 3 shared words>: <words that differ>" from their
 * "I can…" statements; statements sharing no lead words get their SLO code instead, e.g.
 * "Add numbers (NS-03)", so a name never starts with ":". Anything still equal gets " (2)", " (3)". Pure.
 */
const { shortName, MAX_NAME } = require('./short-name');

const LEAD_WORDS = 3;
const I_CAN = /^I (can|know) /i;

const wordsOf = (statement) => statement.replace(I_CAN, '').replace(/\s*\.$/, '').split(/\s+/);

function commonLength(lists) {
  let n = 0;
  while (lists.every((w) => n < w.length && w[n].toLowerCase() === lists[0][n].toLowerCase())) n += 1;
  return n;
}

/** Rename one group of equal names from their statements, if every member has exactly one. */
function fromStatements(group) {
  if (!group.every((t) => t.sloDescriptions.length === 1)) return group.map((t) => t.name);
  const lists = group.map((t) => wordsOf(t.sloDescriptions[0]));
  const shared = commonLength(lists);
  if (shared === 0) return group.map(withCode);
  const lead = lists[0].slice(0, Math.min(LEAD_WORDS, shared)).join(' ');
  const head = lead.charAt(0).toUpperCase() + lead.slice(1);
  return lists.map((w) => shortName(`${head}: ${w.slice(shared).join(' ')}`));
}

/** "Add numbers" + M-01-NS-03 -> "Add numbers (NS-03)", within 40 code points. */
function withCode(t) {
  if (!t.sloCodes.length) return t.name;
  const tag = ` (${t.sloCodes[0].split('-').slice(-2).join('-')})`;
  return `${Array.from(t.name).slice(0, MAX_NAME - tag.length).join('').trim()}${tag}`;
}

function numbered(names) {
  const seen = new Map();
  return names.map((name) => {
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n === 1) return name;
    const room = Array.from(name).slice(0, MAX_NAME - ` (${n})`.length).join('').trim();
    return `${room} (${n})`;
  });
}

/** topics: [{name, sloDescriptions}] of one chapter -> names, all different. */
function distinctNames(topics) {
  const names = topics.map((t) => t.name);
  const byName = new Map();
  topics.forEach((t, i) => byName.set(t.name, [...(byName.get(t.name) || []), i]));
  for (const idx of byName.values()) {
    if (idx.length < 2) continue;
    const renamed = fromStatements(idx.map((i) => topics[i]));
    idx.forEach((i, k) => { names[i] = renamed[k]; });
  }
  return numbered(names);
}

module.exports = { distinctNames };
