'use strict';
/**
 * Maths: one topic per SLO code, word-problem days as one topic per chapter (spec §4.1). Pure.
 * groupBySlo is shared with Science chapters that carry no "Topic N" labels.
 *
 * Name precedence for an SLO topic: a "Topic N: X —" section label on a day where the code
 * comes first; else the code's own "I can…" statement (from days teaching that code alone);
 * else the first day's topic cell.
 */
const { shortName, slugify } = require('./short-name');
const { collect } = require('./collect');

const WORD_PROBLEM = 'word_problem';
const SECTION_LABEL = /\bTopic\s+\d+\s*:\s*(.+?)\s[—–-]\s/i;
const I_CAN = /^I can /i;

const firstLetterUp = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "I can count backwards from 9." -> "Count backwards from 9". */
function fromStatement(statement) {
  return firstLetterUp(statement.replace(I_CAN, '').replace(/\.$/, ''));
}

function sloBuckets(rows) {
  const buckets = new Map();
  for (const row of rows) {
    row.sloCodes.forEach((code, i) => {
      if (!buckets.has(code)) buckets.set(code, { code, rows: [], label: null, solo: [] });
      const b = buckets.get(code);
      b.rows.push(row);
      const label = i === 0 && row.section.match(SECTION_LABEL);
      if (label && !b.label) b.label = label[1];
      if (row.sloCodes.length === 1) b.solo.push(row.sloDescriptions.join(' / '));
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
    const solo = [...new Set(b.solo.filter(Boolean))];
    let raw;
    if (b.label) raw = b.label;
    else if (solo.length) raw = fromStatement(solo[0]);
    else raw = fallbackName(b.rows[0]);
    return {
      name: shortName(raw, b.rows[0].section),
      heading: null,
      headingOrder: null,
      slug: slugify(b.code),
      ...collect(b.rows),
      sloCodes: [b.code],
      sloDescriptions: solo,
    };
  });
}

function groupMaths(rows) {
  const problems = rows.filter((r) => r.skillType === WORD_PROBLEM);
  const topics = groupBySlo(rows.filter((r) => r.skillType !== WORD_PROBLEM));
  if (problems.length) {
    topics.push({ name: 'Word problems', heading: null, headingOrder: null, slug: 'word-problems', ...collect(problems) });
  }
  return topics;
}

module.exports = { groupMaths, groupBySlo };
