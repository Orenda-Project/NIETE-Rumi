'use strict';
/**
 * Do a topic's pages sit inside its chapter's book page range? Pure: topics + textbook_toc rows in, findings out.
 * `outside` = topic has pages and none are in the chapter's range (a matrix typo); `spill` = some are, some are not;
 * `noRange` = "G<grade> <subject> ch<n>" keys that have topics but no usable range row. Bounds are inclusive.
 */
const chapterKey = (grade, subject, chapter) => `${grade}|${subject}|${chapter}`;
const label = (t) => `G${t.grade} ${t.subject} ch${t.chapterNumber}`;
const has = (n) => n !== null && n !== undefined;

/** @returns {{outside: object[], spill: object[], noRange: string[]}} */
function checkPages(topics, ranges) {
  const byChapter = new Map();
  for (const r of ranges) {
    if (has(r.page_start) && has(r.page_end)) byChapter.set(chapterKey(r.grade, r.subject, r.chapter_number), r);
  }
  const outside = [];
  const spill = [];
  const noRange = new Set();
  for (const t of topics) {
    const r = byChapter.get(chapterKey(t.grade, t.subject, t.chapterNumber));
    if (!r) { noRange.add(label(t)); continue; }
    const pages = t.pages || [];
    const stray = pages.filter((p) => p < r.page_start || p > r.page_end);
    if (!stray.length) continue;
    const finding = {
      topicId: t.topicId, grade: t.grade, subject: t.subject, chapterNumber: t.chapterNumber, name: t.name,
      pages, pageStart: r.page_start, pageEnd: r.page_end, stray,
    };
    (stray.length === pages.length ? outside : spill).push(finding);
  }
  return { outside, spill, noRange: [...noRange] };
}

module.exports = { checkPages };
