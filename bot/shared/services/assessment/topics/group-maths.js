'use strict';
/**
 * Maths: one topic per SLO code, word problems as one topic per chapter (spec §4.2). Pure.
 * groupBySlo is shared with Science chapters that carry no "Topic N" labels.
 *
 * Name precedence for an SLO topic: a "Topic N: X —" section label on a day where the code
 * comes first; else the code's own "I can…" statement (description i pairs with code i when a
 * row has as many descriptions as codes); else the first day's topic cell.
 *
 * In a chapter the matrix splits with "Topic N:" labels, a code that is never a day's first code is
 * taught inside another topic; it joins the topic of the first code on each day it appears (G1 Ch3:
 * fact families AS-05 sit inside subtraction facts AS-06). Unlabelled chapters keep one topic per SLO.
 *
 * Word problems: a code is a word-problem code when it is the only code on some word_problem day,
 * or when its "Topic N:" label says Word Problems. The "Word problems" topic is the word_problem days
 * plus the days whose codes are all word-problem codes (spec §4.2: G1 Ch3 days 48-51). A day shared
 * with another code stays with that code, minus the word-problem code. If folding would leave the
 * chapter with no other topic, only the word_problem days fold.
 */
const { shortName, slugify } = require('./short-name');
const { collect } = require('./collect');

const WORD_PROBLEM = 'word_problem';
const SECTION_LABEL = /\bTopic\s+\d+\s*:\s*(.+?)\s[—–-]\s/i;
const I_CAN = /^I (can|know) /i;

const firstLetterUp = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "I can count backwards from 9." -> "Count backwards from 9". */
function fromStatement(statement) {
  return firstLetterUp(statement.replace(I_CAN, '').replace(/\.$/, ''));
}

/** Description i belongs to code i when the counts match; a lone code owns the whole cell. */
function statementFor(row, i) {
  if (row.sloCodes.length === row.sloDescriptions.length) return row.sloDescriptions[i];
  return row.sloCodes.length === 1 ? row.sloDescriptions.join(' / ') : null;
}

function sloBuckets(rows) {
  const labelled = rows.some((r) => SECTION_LABEL.test(r.section));
  const leads = new Set(rows.flatMap((r) => (labelled ? r.sloCodes.slice(0, 1) : r.sloCodes)));
  const buckets = new Map();
  for (const row of rows) {
    row.sloCodes.forEach((code, i) => {
      const lead = leads.has(code) ? code : row.sloCodes[0];
      if (!buckets.has(lead)) buckets.set(lead, { codes: [], rows: [], label: null, statements: [] });
      const b = buckets.get(lead);
      if (!b.codes.includes(code)) b.codes.push(code);
      if (!b.rows.includes(row)) b.rows.push(row);
      const label = i === 0 && row.section.match(SECTION_LABEL);
      if (label && !b.label) b.label = label[1];
      const statement = statementFor(row, i);
      if (statement) b.statements.push(statement);
    });
  }
  return [...buckets.values()];
}

/**
 * fallbackName(row) names a topic from its first day when the code has no label or statement.
 * Default: the day's topic cell.
 */
function groupBySlo(rows, fallbackName = (row) => row.topic) {
  return sloBuckets(rows).map((b) => {
    const statements = [...new Set(b.statements)];
    let raw;
    if (b.label) raw = b.label;
    else if (statements.length) raw = fromStatement(statements[0]);
    else raw = fallbackName(b.rows[0]);
    return {
      name: shortName(raw, b.rows[0].section),
      heading: null,
      headingOrder: null,
      slug: slugify(b.codes[0]),
      ...collect(b.rows),
      sloCodes: b.codes,
      sloDescriptions: statements,
    };
  });
}

/** A shared day keeps its other codes (and their descriptions, when they line up). */
function withoutCodes(row, drop) {
  const keep = row.sloCodes.map((c) => !drop.has(c));
  const aligned = row.sloCodes.length === row.sloDescriptions.length;
  return {
    ...row,
    sloCodes: row.sloCodes.filter((_, i) => keep[i]),
    sloDescriptions: aligned ? row.sloDescriptions.filter((_, i) => keep[i]) : row.sloDescriptions,
  };
}

/** Codes the only code on a word_problem day, or labelled "Topic N: … Word Problems". */
function wordProblemCodes(rows) {
  const codes = new Set();
  for (const r of rows) {
    if (r.skillType === WORD_PROBLEM && r.sloCodes.length === 1) codes.add(r.sloCodes[0]);
    const label = r.section.match(SECTION_LABEL);
    if (label && /word problem/i.test(label[1]) && r.sloCodes.length) codes.add(r.sloCodes[0]);
  }
  return codes;
}

function split(rows, wordCodes) {
  const isProblem = (r) => r.skillType === WORD_PROBLEM
    || (r.sloCodes.length > 0 && r.sloCodes.every((c) => wordCodes.has(c)));
  return {
    problems: rows.filter(isProblem),
    topics: groupBySlo(rows.filter((r) => !isProblem(r)).map((r) => withoutCodes(r, wordCodes))),
  };
}

function groupMaths(rows) {
  let { problems, topics } = split(rows, wordProblemCodes(rows));
  const hasOtherDays = rows.some((r) => r.skillType !== WORD_PROBLEM);
  if (!topics.length && hasOtherDays) ({ problems, topics } = split(rows, new Set()));
  if (problems.length) {
    topics.push({ name: 'Word problems', heading: null, headingOrder: null, slug: 'word-problems', ...collect(problems) });
  }
  return topics;
}

module.exports = { groupMaths, groupBySlo };
