'use strict';
/**
 * Split one catalog lesson into two teaching days.
 *
 * Some lessons cannot fit one period (G4 Urdu ch10 seg2 is 12 pages). Part 1 KEEPS its
 * lesson_id, so the teacher's ✓ tick, the R2 key and the review-sheet link survive. Part 2
 * is a new entry, id + "b", on the SAME segment_index, placed directly after it. Every
 * consumer keys on lesson_id as a string and no table has a catalog foreign key, so a new
 * id needs no migration; a renumbered day would have broken every later lesson's id.
 *
 * The list lives in data/lp_splits.json. buildCatalog applies it, so a rebuild keeps the
 * splits; scripts/apply-lp-splits.js applies it to the committed catalog when the ingestion
 * tree is not on this machine. The builder's row helpers are passed in (`B`), because the
 * builder requires this module and a require back would be a cycle.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const SPLITS_PATH = path.join(DATA, 'lp_splits.json');

function loadSplits(file = SPLITS_PATH) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

/** One part of a split lesson, its day label and row re-made for that part. */
function partOf(lesson, part, rtl, B) {
  const base = B.dayLabelDisplay(lesson.segment_index, lesson.lp_type, rtl);
  const label = rtl ? `${base} · حصہ ${B.urDigits(part)}` : `${base} · part ${part}`;
  const row = B.buildRow(
    { segment_index: lesson.segment_index, section: lesson.section, topic: lesson.topic, pages: lesson.pages },
    { rtl, label },
  );
  return {
    ...lesson,
    lesson_id: part === 1 ? lesson.lesson_id : `${lesson.lesson_id}b`,
    part,
    day_label: `${B.dayLabelFor(lesson.segment_index, lesson.lp_type)} · part ${part}`,
    topic_short: row.lead,
    row: { title: row.title, description: row.description, metadata: row.metadata },
  };
}

/**
 * A new catalog with every listed lesson split in two. Pure; applying it twice changes nothing.
 * `B` is build-lp-catalog's exports (buildRow, dayLabelDisplay, dayLabelFor, urDigits).
 */
function applySplits(catalog, ids, B) {
  const out = JSON.parse(JSON.stringify(catalog));
  const todo = new Set(ids);
  for (const book of out.books) {
    for (const ch of book.chapters) {
      ch.lessons = ch.lessons.flatMap((l) => {
        if (!todo.has(l.lesson_id)) return [l];
        todo.delete(l.lesson_id);
        if (l.part === 1) return [l];               // already split; part 2 follows as its own entry
        return [partOf(l, 1, !!book.rtl, B), partOf(l, 2, !!book.rtl, B)];
      });
    }
  }
  if (todo.size) throw new Error(`lp_splits: not in the catalog: ${[...todo].join(', ')}`);
  out.counts = { ...out.counts, lessons: out.books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.lessons.length, 0), 0) };
  return out;
}

module.exports = { applySplits, loadSplits, partOf, SPLITS_PATH };
