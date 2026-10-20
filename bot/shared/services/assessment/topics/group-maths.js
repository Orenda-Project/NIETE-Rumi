'use strict';
/**
 * Maths: one topic per SLO code, word problems as one topic per chapter (spec §4.2). Pure.
 * groupBySlo is shared with Science chapters that carry no "Topic N" labels.
 *
 * Name precedence for an SLO topic: a "Topic N: X —" section label on a day where the code
 * comes first; else the code's own "I can…" statement (description i pairs with code i when a
 * row has as many descriptions as codes); else the first day's topic cell.
 *
 * Word problems: a code taught on any word_problem day is a word-problem code. Days whose codes
 * are all word-problem codes form the "Word problems" topic; a day shared with another code stays
 * with that code, minus the word-problem code.
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
  const buckets = new Map();
  for (const row of rows) {
    row.sloCodes.forEach((code, i) => {
      if (!buckets.has(code)) buckets.set(code, { code, rows: [], label: null, statements: [] });
      const b = buckets.get(code);
      b.rows.push(row);
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
      slug: slugify(b.code),
      ...collect(b.rows),
      sloCodes: [b.code],
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

function groupMaths(rows) {
  const wordCodes = new Set(rows.filter((r) => r.skillType === WORD_PROBLEM).flatMap((r) => r.sloCodes));
  const isProblem = (r) => r.skillType === WORD_PROBLEM
    || (r.sloCodes.length > 0 && r.sloCodes.every((c) => wordCodes.has(c)));
  const problems = rows.filter(isProblem);
  const topics = groupBySlo(rows.filter((r) => !isProblem(r)).map((r) => withoutCodes(r, wordCodes)));
  if (problems.length) {
    topics.push({ name: 'Word problems', heading: null, headingOrder: null, slug: 'word-problems', ...collect(problems) });
  }
  return topics;
}

module.exports = { groupMaths, groupBySlo };
