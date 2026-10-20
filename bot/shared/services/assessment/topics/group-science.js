'use strict';
/**
 * Science: days whose section says "Topic N" (any separator: "·", "-", ":") group by N.
 * An unlabelled day joins the topic sharing one of its SLO codes, else the topic before it,
 * else the first topic. A chapter with no labels falls back to one topic per SLO. Pure.
 */
const { shortName, slugify } = require('./short-name');
const { collect } = require('./collect');
const { groupBySlo } = require('./group-maths');

const SECTION_TOPIC = /\bTopic\s+(\d+)\b/i;
const CELL_NAME = /^Topic\s+\d+\s*:\s*(.+?)(?:\s[-–—]\s|$)/i;
const STAGE_TAG = /\([^()]*\)$/;

/** First day's cell without its stage tag: "X (hook) → Y" -> "X". */
function dayName(row) {
  return row.topic.split('→')[0].trim().replace(STAGE_TAG, '');
}

const topicNumber = (row) => {
  const m = row.section.match(SECTION_TOPIC);
  return m ? Number(m[1]) : null;
};

function attach(groups, row, previous) {
  const shared = groups.find((g) => g.rows.some((r) => r.sloCodes.some((c) => row.sloCodes.includes(c))));
  return shared || previous || groups[0];
}

function byLabel(rows) {
  const groups = [];
  const loose = [];
  let previous = null;
  for (const row of rows) {
    const n = topicNumber(row);
    if (n === null) {
      loose.push({ row, previous });
      continue;
    }
    let group = groups.find((g) => g.n === n);
    if (!group) {
      group = { n, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    previous = group;
  }
  for (const { row, previous: before } of loose) attach(groups, row, before).rows.push(row);
  return groups;
}

/** Labelled days come first in group.rows, so an unlabelled day never names a topic. */
function nameOf(group) {
  for (const row of group.rows) {
    const m = row.topic.match(CELL_NAME);
    if (m) return shortName(m[1], row.section);
  }
  return shortName(dayName(group.rows[0]), group.rows[0].section);
}

function groupScience(rows) {
  if (!rows.some((r) => topicNumber(r) !== null)) return groupBySlo(rows, dayName);
  return byLabel(rows).map((group) => {
    const facts = collect(group.rows);
    return { name: nameOf(group), heading: null, headingOrder: null, slug: slugify(facts.sloCodes[0]), ...facts };
  });
}

module.exports = { groupScience };
