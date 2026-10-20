'use strict';
/**
 * groupChapter(subject, rows) -> Topic[]: the topics a teacher ticks for one chapter (spec §4).
 * Pure. Assessment (995), revision (990), duhrai and review_assess days are never topics.
 *
 * Topic = {topicId, grade, subject, chapterNumber, chapterTitle, name, heading|null,
 *          headingOrder|null, sortOrder, pages, sloCodes, sloDescriptions, days}
 * topicId = "<grade>-<subject>-<chapter>-<slug>"; a repeated slug gets -2, -3 in sort order.
 */
const { groupLanguage } = require('./group-language');
const { groupMaths } = require('./group-maths');
const { groupScience } = require('./group-science');

const GROUPERS = {
  english: (rows) => groupLanguage('english', rows),
  urdu: (rows) => groupLanguage('urdu', rows),
  maths: groupMaths,
  science: groupScience,
};
const NON_TOPIC_SKILLS = new Set(['duhrai', 'review_assess', 'revision', 'assessment']);
const NON_TOPIC_SEGMENTS = new Set([990, 995]);

function isTopicRow(row) {
  return row.lpType === 'content' && !NON_TOPIC_SKILLS.has(row.skillType) && !NON_TOPIC_SEGMENTS.has(row.seg);
}

const chapterKey = (row) => `${row.grade}/${row.chapter}`;

function groupChapter(subject, rows) {
  const grouper = GROUPERS[subject];
  if (!grouper) throw new Error(`no topic grouping for subject "${subject}"`);
  if (!rows.length) return [];
  if (new Set(rows.map(chapterKey)).size > 1) throw new Error('groupChapter takes the rows of one chapter only');
  const { grade, chapter, chapterTitle } = rows[0];
  const seen = new Map();
  return grouper(rows.filter(isTopicRow)).map((t, i) => {
    const base = `${grade}-${subject}-${chapter}-${t.slug}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return {
      topicId: count === 1 ? base : `${base}-${count}`,
      grade, subject, chapterNumber: chapter, chapterTitle,
      name: t.name, heading: t.heading, headingOrder: t.headingOrder, sortOrder: i + 1,
      pages: t.pages, sloCodes: t.sloCodes, sloDescriptions: t.sloDescriptions, days: t.days,
    };
  });
}

/** Every chapter in the rows, in first-appearance order. */
function groupAll(subject, rows) {
  const chapters = new Map();
  for (const row of rows) {
    if (!chapters.has(chapterKey(row))) chapters.set(chapterKey(row), []);
    chapters.get(chapterKey(row)).push(row);
  }
  return [...chapters.values()].flatMap((chapterRows) => groupChapter(subject, chapterRows));
}

module.exports = { groupChapter, groupAll, isTopicRow };
