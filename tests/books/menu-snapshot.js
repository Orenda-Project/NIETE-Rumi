'use strict';
/**
 * Every K-5 WhatsApp menu screen an ICT teacher can reach, rendered from the real lp_catalog.json, as one string.
 *
 * Used by the book-shelf suites (bd-97daxo.4) to prove an ICT teacher's menus are byte-identical before and after
 * GB's books join the catalog: the hash of this string was taken on origin/sandbox 49416a018, before any change.
 * Every lesson counts as available and nothing as downloaded, so every row the catalog can produce is in it.
 */
const crypto = require('crypto');

function renderAll(Catalog, ...shelfArgs) {
  const out = [];
  const all = new Set();
  for (const b of Catalog.catalog().books) for (const c of b.chapters) for (const l of c.lessons) all.add(l.lesson_id);
  const grades = Catalog.gradesWithContent(all, ...shelfArgs);
  out.push(['grades', grades]);
  for (const g of grades) {
    const subjects = Catalog.buildSubjectItems(g, all, ...shelfArgs);
    out.push(['subjects', g, subjects]);
    for (const s of subjects) {
      out.push(['title', g, s.id, Catalog.subjectTitle(g, s.id, ...shelfArgs)]);
      const chapters = Catalog.buildChapterItems(g, s.id, all, ...shelfArgs);
      out.push(['chapters', g, s.id, chapters]);
      for (const ch of chapters) {
        for (let page = 1; page < 10; page += 1) {
          const r = Catalog.buildLessonItems(g, s.id, ch.id, all, new Set(), page, ...shelfArgs);
          out.push(['lessons', g, s.id, ch.id, page, r]);
          if (!r.hasMore) break;
        }
      }
    }
  }
  return JSON.stringify(out);
}

const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { renderAll, hashOf };
