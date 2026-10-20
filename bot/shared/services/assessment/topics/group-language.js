'use strict';
/**
 * English and Urdu: topic rows -> topics under skill headings (spec §4.1). Pure.
 *
 * - A topic cell may hold several parts joined by "⟢"; a part may open with a skill label
 *   ("قواعد — …"). Parts with different skills become separate topics (each carries the whole
 *   row: the matrix gives no per-part pages or SLOs); parts with one skill stay one topic.
 * - pre_reading days fold into the next topic; with nothing after them they stand alone.
 * - A "Connect and Create" day folds into the nearest earlier topic of the same skill.
 */
const { headingFor, skillFromLabel } = require('./headings');
const { shortName, slugify } = require('./short-name');
const { collect } = require('./collect');

const PART_SEPARATOR = '⟢';
const LABEL_DASH = /\s[—–]\s/;
const CONNECT_AND_CREATE = /connect and create|تخلیق کریں/i;
const BARE_LABEL_WORDS = 2;
const PRE_READING = 'pre_reading';

/** One part of a topic cell: its skill, its raw text (for the id) and its name text. */
function parsePart(subject, row, text) {
  const dash = text.match(LABEL_DASH);
  const label = dash ? text.slice(0, dash.index).trim() : null;
  const labelSkill = skillFromLabel(subject, label);
  const bare = labelSkill && label.split(' ').length <= BARE_LABEL_WORDS;
  return { skill: labelSkill || row.skillType, text, body: bare ? text.slice(dash.index + dash[0].length) : text };
}

/** A row -> one unit per distinct skill among its parts, in part order. */
function unitsOf(subject, row) {
  const parts = row.topic.split(PART_SEPARATOR).map((p) => p.trim()).filter(Boolean)
    .map((p) => parsePart(subject, row, p));
  const units = [];
  for (const part of parts) {
    if (!units.some((u) => u.skill === part.skill)) units.push({ ...part, row });
  }
  return units;
}

function startTopic(subject, unit, pending) {
  const first = pending.length ? pending[0] : unit;
  return {
    skill: unit.skill,
    name: shortName(unit.body, unit.row.section),
    slug: `${unit.skill}-${slugify(first.text)}`,
    rows: [...pending.map((p) => p.row), unit.row],
  };
}

function nearestSameSkill(topics, skill) {
  for (let i = topics.length - 1; i >= 0; i -= 1) if (topics[i].skill === skill) return topics[i];
  return null;
}

function finish(subject, topic) {
  return {
    name: topic.name,
    ...headingFor(subject, topic.skill),
    slug: topic.slug,
    ...collect(topic.rows),
  };
}

function groupLanguage(subject, rows) {
  const topics = [];
  let pending = [];
  for (const unit of rows.flatMap((row) => unitsOf(subject, row))) {
    if (unit.skill === PRE_READING) {
      pending.push(unit);
      continue;
    }
    const host = CONNECT_AND_CREATE.test(unit.row.section) ? nearestSameSkill(topics, unit.skill) : null;
    if (host && !pending.length) {
      host.rows.push(unit.row);
      continue;
    }
    topics.push(startTopic(subject, unit, pending));
    pending = [];
  }
  if (pending.length) {
    const [first, ...rest] = pending;
    const alone = startTopic(subject, first, []);
    alone.rows.push(...rest.map((p) => p.row));
    topics.push(alone);
  }
  return topics.map((t) => finish(subject, t));
}

module.exports = { groupLanguage };
