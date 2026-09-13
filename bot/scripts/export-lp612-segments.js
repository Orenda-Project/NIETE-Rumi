#!/usr/bin/env node
/**
 * Write the LIVE 6-12 menu back out as the corpus files the importer reads.
 *
 *   node bot/scripts/export-lp612-segments.js <out-dir>
 *
 * This is the first half of a video refresh. The second half is the importer:
 *
 *   node bot/scripts/import-lp612-segments.js <out-dir> --yt-dir <swarm-dir>
 *
 * WHY THIS EXISTS. `--yt-dir` is an OVERLAY, not an input on its own: the importer needs a BASE
 * corpus (one `<book_stem>_segments.json` per book) and attaches the swarm's picks to it by
 * `segment_id`. The base is not inert. `reconcilePlan` retires — `is_current = false` — every id
 * live for a book that the base does not name, which is correct when the base comes from a
 * re-segmentation run and wrong in every other case. Re-deriving the base by re-cutting the books
 * would move boundaries, mint new ids, retire the ones the renders point at, and rebuild the menu
 * a teacher is holding. Worse, the fleet's original `out/*.json` are not on this machine at all.
 *
 * Generating the base from the table removes the whole question. `incomingIds === existingIds` by
 * construction, so the retire list is empty; every column except `yt` upserts to the value it
 * already holds; and nothing anywhere in the loop re-reads a book.
 *
 * `yt` IS DELIBERATELY EXPORTED NULL — including for the ~4,700 segments that hold a pick today.
 * That is not data loss, it is the only thing that lets the swarm RETRACT one. `overlayYt` only
 * ever sets a pick, so a rejection (named in the swarm's file, `yt: null`) clears nothing by
 * itself; the clearing happens because `mergeExistingYt` declines to carry the STORED pick for an
 * id the swarm covered. A base that carried the stored pick would arrive already filled, `hasPick`
 * would be true, `withdrawn` would print 0, and the re-read the swarm just rejected would be
 * written straight back. The picks are safe meanwhile: for any id the swarm did not name, the
 * importer carries the stored value forward from the table itself.
 *
 * A SHORT READ IS AN ERROR HERE, NEVER A FILE. PostgREST truncates at `db-max-rows` and reports
 * nothing; a base missing rows is a base that retires them. So this reads in windows, checks the
 * total against an exact count, and throws before writing anything.
 */

const fs = require('fs');
const path = require('path');

const { PAGE } = require('../shared/utils/postgrest-paged');

const TABLE = 'niete_lp612_segments';

/**
 * The columns a segment file carries — the inverse of the importer's `toRow`.
 *
 * Four table columns are deliberately NOT here. `grade`/`also_grades` are re-derived from the
 * single `grade` field below. `is_religious` is recomputed at import from the text fields, so
 * carrying it would create a second, staler source for one rule. `is_current` is always true for
 * an exported row. `corpus_version` is a flag on the import, and is recorded in `_meta` instead.
 */
const COLUMNS = [
  'segment_id', 'book_stem', 'grade', 'also_grades', 'subject', 'medium', 'language',
  'chapter_number', 'chapter_title', 'chapter_key', 'part', 'part_index',
  'subtopic_title', 'menu_title', 'section_ref',
  'printed_page_start', 'printed_page_end', 'pages_covered',
  'order_index', 'day_number', 'segment_index',
  'lp_type', 'skill_type',
  'slo_text', 'slo_codes', 'slo_descriptions', 'slo_source', 'section',
  'revision_source_segments', 'prev_segment_id', 'next_segment_id',
  'notes', 'corpus_version',
];

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * The two grade columns, back into the one field the corpus writes.
 *
 * `toRow` derives BOTH `grade` and `also_grades` from `s.grade` through `parseGradeSpan`, so a row
 * taught in two years has to leave here as `"9-10"`. Exporting the integer 9 would drop grade 10
 * from the menu on the next import, silently, for one practicals book.
 */
function gradeSpec(row) {
  const also = arr(row.also_grades);
  return also.length ? [row.grade, ...also].join('-') : row.grade;
}

function toSegment(row) {
  return {
    segment_id: row.segment_id,
    book_stem: row.book_stem,
    grade: gradeSpec(row),
    subject: row.subject,
    medium: row.medium ?? null,
    language: row.language,
    chapter_number: row.chapter_number ?? null,
    chapter_title: row.chapter_title ?? null,
    chapter_key: row.chapter_key,
    part: row.part ?? null,
    part_index: row.part_index ?? null,
    subtopic_title: row.subtopic_title,
    menu_title: row.menu_title,
    section_ref: row.section_ref ?? null,
    printed_page_start: row.printed_page_start,
    printed_page_end: row.printed_page_end ?? null,
    pages_covered: arr(row.pages_covered),
    order_index: row.order_index,
    day_number: row.day_number ?? null,
    segment_index: row.segment_index ?? null,
    lp_type: row.lp_type || 'content',
    skill_type: row.skill_type ?? null,
    slo_text: row.slo_text ?? null,
    slo_codes: arr(row.slo_codes),
    slo_descriptions: arr(row.slo_descriptions),
    slo_source: row.slo_source ?? null,
    section: row.section ?? null,
    revision_source_segments: arr(row.revision_source_segments),
    prev_segment_id: row.prev_segment_id ?? null,
    next_segment_id: row.next_segment_id ?? null,
    // Null on purpose. See the header: this is what lets the swarm withdraw a pick.
    yt: null,
    notes: row.notes ?? null,
  };
}

/**
 * Every live row, whole or not at all.
 *
 * `pagedRows` is the house pager and is the right shape for SERVING — it returns `[]` on error so
 * a database blip shows a teacher an empty menu instead of a stack trace. That contract is exactly
 * wrong here: a silently short read produces a base file whose next import retires every row it
 * dropped. So the windowing is the same (and borrows the measured PAGE), and the error handling is
 * the opposite.
 */
async function readAllCurrent(supabase) {
  const { count, error: countError } = await supabase
    .from(TABLE)
    .select('segment_id', { count: 'exact', head: true })
    .eq('is_current', true);
  if (countError) throw new Error(`count read failed: ${countError.message}`);

  const all = [];
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLUMNS.join(','))
      .eq('is_current', true)
      .order('segment_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read failed at row ${from}: ${error.message}`);
    const rows = data || [];
    all.push(...rows);
    // A short page is the only proof of the end of the set.
    if (rows.length < PAGE) break;
  }

  if (typeof count === 'number' && all.length !== count) {
    throw new Error(
      `refusing to write a partial base: read ${all.length} of ${count} live segments. `
      + 'Every row missing from a base file is a row the next import RETIRES.',
    );
  }
  return all;
}

function groupByBook(rows) {
  const books = new Map();
  for (const row of rows) {
    if (!books.has(row.book_stem)) books.set(row.book_stem, []);
    books.get(row.book_stem).push(row);
  }
  return books;
}

/**
 * @param {object}   opts.supabase  a PostgREST client
 * @param {string}   opts.outDir    where the `<book_stem>_segments.json` files go
 * @param {string[]} [opts.books]   limit to these book_stems (a one-book refresh)
 * @returns {Promise<{files: number, segments: number, books: string[]}>}
 */
async function exportSegments({ supabase, outDir, books = null }) {
  // Read EVERYTHING first. Nothing is written until the whole set is proven complete, so a failed
  // run leaves no half-corpus for someone to point the importer at.
  const rows = await readAllCurrent(supabase);
  const wanted = books && books.length ? new Set(books) : null;
  const grouped = groupByBook(rows.filter((r) => !wanted || wanted.has(r.book_stem)));

  fs.mkdirSync(outDir, { recursive: true });

  const report = { files: 0, segments: 0, books: [] };
  for (const [bookStem, bookRows] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // The order the fleet writes in and the order the menu reads in.
    const ordered = bookRows.slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const doc = {
      _meta: {
        source: `${TABLE} (is_current = true)`,
        book_stem: bookStem,
        segments: ordered.length,
        corpus_version: [...new Set(ordered.map((r) => r.corpus_version).filter(Boolean))].sort(),
        exported_at: new Date().toISOString(),
        note: 'Generated FROM the live table, not from a re-segmentation run. yt is null by '
          + 'design so a --yt-dir overlay can withdraw a pick as well as add one.',
      },
      segments: ordered.map(toSegment),
    };
    fs.writeFileSync(
      path.join(outDir, `${bookStem}_segments.json`),
      `${JSON.stringify(doc, null, 2)}\n`,
    );
    report.files += 1;
    report.segments += ordered.length;
    report.books.push(bookStem);
  }
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const outDir = argv.find((a) => !a.startsWith('--'));
  if (!outDir) {
    console.error('usage: export-lp612-segments.js <out-dir> [--book <book_stem>]...');
    process.exit(2);
  }
  const books = argv.reduce((acc, a, i) => (a === '--book' ? [...acc, argv[i + 1]] : acc), []);

  // Required lazily so the pure helpers above stay importable in a test with no database.
  const supabase = require('../shared/config/supabase');

  const report = await exportSegments({ supabase, outDir, books });
  console.log('\nlp612 segment export —');
  console.log(`  books     ${report.files}`);
  console.log(`  segments  ${report.segments}`);
  console.log(`  into      ${outDir}`);
  console.log('\nnext: node bot/scripts/import-lp612-segments.js '
    + `${outDir} --yt-dir <swarm-dir> --dry-run`);
  return report;
}

module.exports = { exportSegments, readAllCurrent, toSegment, gradeSpec, COLUMNS, TABLE, main };

if (require.main === module) {
  main().catch((err) => {
    console.error(`lp612 segment export failed: ${err.message}`);
    process.exit(1);
  });
}
