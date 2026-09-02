#!/usr/bin/env node
/**
 * Load the 6-12 segmentation corpus into the serving menu.
 *
 *   node bot/scripts/import-lp612-segments.js <dir-or-file> [--corpus-version v1] [--dry-run]
 *
 * Input is the segmentation fleet's own output: one `<book_stem>_segments.json`
 * per book, `{ _meta, segments: [...] }`, per SEGMENTATION_PLAN.md. Point it at
 * a directory and it takes every such file in it.
 *
 * **This script is designed to be run repeatedly.** The corpus lands book by
 * book over hours and any book can be re-segmented afterwards, so:
 *
 *  - every write is an upsert on `segment_id`, which is derived from
 *    (book, chapter, printed page range) and is therefore stable across a re-run
 *    that draws the same boundaries;
 *  - a re-run that MOVED a boundary produces a new id, so the segment it
 *    replaced is retired (`is_current = false`) rather than left in the menu
 *    beside its replacement — retired, not deleted, because renders reference it;
 *  - reconciliation is scoped to the book_stems actually present in this run, so
 *    importing one finished book never touches another's rows.
 *
 * `is_religious` is computed HERE and stored. Serving never re-derives it: one
 * rule, in one place, that a future caller cannot get subtly wrong. See
 * bot/shared/config/lp612-flags.js for what the flag it feeds actually gates.
 */

const fs = require('fs');
const path = require('path');

const TABLE = 'niete_lp612_segments';
const CHUNK = 250;

const MENU_TITLE_CAP = 30;      // Meta NavigationList row title, CODE POINTS
const SUBTOPIC_TITLE_CAP = 80;  // metadata line

const LP_TYPES = ['content', 'exercise_review', 'assessment', 'practical', 'revision'];

const cps = (s) => [...String(s == null ? '' : s)].length;

// ── the operator's hold ─────────────────────────────────────────────────────

/**
 * Two rules, deliberately different in scope.
 *
 * A book that IS Islamiat is held whole — subject name or book stem, in either
 * script. That is the bulk of it.
 *
 * Separately, a segment in ANY book whose chapter or subtopic names explicitly
 * religious content is held too, because the hold is on content and not on a
 * shelf label: a seerah chapter in an Urdu reader is exactly the case a
 * subject-name check misses.
 *
 * The marker list is deliberately narrow. "Islamic civilisation" as a Pakistan
 * Studies history chapter is NOT seerah, and a looser list would quietly remove
 * a whole subject from the menu rather than hold a lesson — a much worse
 * failure, and a silent one.
 */
const ISLAMIAT_RE = /islamiat|islamiyat|اسلامیات/i;

const RELIGIOUS_MARKERS = [
  'ﷺ',            // the honorific — reliable seerah marker in Urdu text
  'سیرت', 'سیرة', 'seerah', 'seerat', 'sirah',
  'حدیث', 'hadith', 'hadeeth',
  'قرآن', 'قرآنی', 'quran', "qur'an", 'qur’an',
  'نعت', 'naat',
  'سنت', 'sunnah',
  'نبوی', 'prophet muhammad', 'the prophet',
];

function isReligiousSegment(segment) {
  const s = segment || {};
  if (ISLAMIAT_RE.test(String(s.subject || ''))) return true;
  if (ISLAMIAT_RE.test(String(s.book_stem || ''))) return true;

  const text = `${s.chapter_title || ''} ${s.subtopic_title || ''} ${s.menu_title || ''}`
    .toLowerCase();
  return RELIGIOUS_MARKERS.some((m) => text.includes(m.toLowerCase()));
}

// ── validation ──────────────────────────────────────────────────────────────

const REQUIRED = [
  'segment_id', 'book_stem', 'grade', 'subject', 'chapter_key',
  'subtopic_title', 'menu_title', 'printed_page_start', 'order_index',
];

/**
 * Errors skip the row; warnings import it and report.
 *
 * The split is on whether the row would be WRONG or merely IMPERFECT. A missing
 * chapter_key makes a segment unroutable, so it cannot be imported. An over-cap
 * menu_title costs a clipped row — the catalogue clips defensively at render
 * anyway — so it is reported and imported, because dropping the lesson would be
 * the larger harm.
 */
function validateSegment(segment) {
  const errors = [];
  const warnings = [];
  const s = segment || {};

  for (const f of REQUIRED) {
    if (s[f] === undefined || s[f] === null || s[f] === '') errors.push(`missing ${f}`);
  }

  const grade = Number(s.grade);
  if (s.grade !== undefined && (!Number.isFinite(grade) || grade < 6 || grade > 12)) {
    errors.push(`grade ${s.grade} is outside 6-12`);
  }

  if (s.lp_type && !LP_TYPES.includes(s.lp_type)) {
    // Caught here rather than by the table's CHECK, so the report names the
    // segment instead of the whole batch failing on one row.
    errors.push(`unknown lp_type "${s.lp_type}"`);
  }

  if (s.language && !['en', 'ur'].includes(s.language)) {
    errors.push(`unknown language "${s.language}"`);
  }

  if (cps(s.menu_title) > MENU_TITLE_CAP) {
    warnings.push(`menu_title is ${cps(s.menu_title)} code points (cap ${MENU_TITLE_CAP})`);
  }
  if (cps(s.subtopic_title) > SUBTOPIC_TITLE_CAP) {
    warnings.push(`subtopic_title is ${cps(s.subtopic_title)} code points (cap ${SUBTOPIC_TITLE_CAP})`);
  }

  return { errors, warnings };
}

// ── the row ─────────────────────────────────────────────────────────────────

const intOrNull = (v) => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

function toRow(segment, { corpusVersion = 'v1' } = {}) {
  const s = segment || {};
  return {
    segment_id: s.segment_id,
    book_stem: s.book_stem,
    grade: intOrNull(s.grade),
    subject: s.subject,
    medium: s.medium ?? null,
    language: s.language || 'en',
    chapter_number: intOrNull(s.chapter_number),
    chapter_title: s.chapter_title ?? null,
    chapter_key: s.chapter_key,
    part: s.part ?? null,
    part_index: intOrNull(s.part_index),
    subtopic_title: s.subtopic_title,
    menu_title: s.menu_title,
    section_ref: s.section_ref ?? null,
    // Verbatim. Never recomputed from a PDF offset: three books in this corpus
    // shift offset mid-book and one prints duplicate page numbers.
    printed_page_start: intOrNull(s.printed_page_start),
    printed_page_end: intOrNull(s.printed_page_end ?? s.printed_page_start),
    pages_covered: Array.isArray(s.pages_covered) ? s.pages_covered : [],
    order_index: intOrNull(s.order_index),
    day_number: intOrNull(s.day_number),
    segment_index: intOrNull(s.segment_index),
    lp_type: s.lp_type || 'content',
    skill_type: s.skill_type ?? null,
    slo_text: s.slo_text ?? null,
    revision_source_segments: Array.isArray(s.revision_source_segments) ? s.revision_source_segments : [],
    prev_segment_id: s.prev_segment_id ?? null,
    next_segment_id: s.next_segment_id ?? null,
    // null, never {}. Serving tests `yt && yt.url`, and an empty object passes
    // a truthiness check and renders an empty video line.
    yt: s.yt && typeof s.yt === 'object' && Object.keys(s.yt).length ? s.yt : null,
    is_religious: isReligiousSegment(s),
    notes: s.notes ?? null,
    corpus_version: corpusVersion,
    is_current: true,
    updated_at: new Date().toISOString(),
  };
}

// ── reconcile ───────────────────────────────────────────────────────────────

/**
 * What a re-run of ONE book has to retire.
 *
 * Scoped to a single book_stem on purpose: the corpus arrives book by book, and
 * an import of the finished chemistry book must not retire physics rows just
 * because this run did not mention them.
 */
function reconcilePlan({ bookStem, incomingIds, existingIds }) {
  const incoming = new Set(incomingIds || []);
  return {
    bookStem,
    retire: (existingIds || []).filter((id) => !incoming.has(id)),
  };
}

// ── io ──────────────────────────────────────────────────────────────────────

function readSegmentFiles(target) {
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs.readdirSync(target)
      .filter((f) => f.endsWith('_segments.json'))
      .map((f) => path.join(target, f))
    : [target];
  return files.sort();
}

function parseFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const segments = Array.isArray(raw) ? raw : (raw.segments || []);
  return { file, meta: raw._meta || {}, segments };
}

// ── main ────────────────────────────────────────────────────────────────────

async function importFile({ supabase, file, segments, corpusVersion, dryRun, report }) {
  const rows = [];
  for (const s of segments) {
    const { errors, warnings } = validateSegment(s);
    if (errors.length) {
      report.errors.push({ file, segment_id: s && s.segment_id, errors });
      continue;
    }
    if (warnings.length) {
      report.warnings.push({ file, segment_id: s.segment_id, warnings });
    }
    rows.push(toRow(s, { corpusVersion }));
  }
  if (!rows.length) return;

  const bookStems = [...new Set(rows.map((r) => r.book_stem))];

  // Flagged by text rather than by book — the list a human should look at when
  // the religious review happens.
  for (const r of rows) {
    if (r.is_religious && !ISLAMIAT_RE.test(r.book_stem) && !ISLAMIAT_RE.test(r.subject)) {
      report.flaggedByText.push({ segment_id: r.segment_id, title: r.subtopic_title });
    }
  }

  if (dryRun) {
    report.wouldUpsert += rows.length;
    return;
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(TABLE).upsert(chunk, { onConflict: 'segment_id' });
    if (error) throw new Error(`upsert failed for ${file}: ${error.message}`);
    report.upserted += chunk.length;
  }

  // Retire what this run replaced, book by book.
  for (const bookStem of bookStems) {
    const { data, error } = await supabase
      .from(TABLE).select('segment_id').eq('book_stem', bookStem).eq('is_current', true);
    if (error) throw new Error(`reconcile read failed for ${bookStem}: ${error.message}`);

    const plan = reconcilePlan({
      bookStem,
      incomingIds: rows.filter((r) => r.book_stem === bookStem).map((r) => r.segment_id),
      existingIds: (data || []).map((r) => r.segment_id),
    });
    if (!plan.retire.length) continue;

    const { error: retireError } = await supabase
      .from(TABLE)
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .in('segment_id', plan.retire);
    if (retireError) throw new Error(`retire failed for ${bookStem}: ${retireError.message}`);
    report.retired += plan.retire.length;
  }
}

async function main(argv = process.argv.slice(2)) {
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: import-lp612-segments.js <dir-or-file> [--corpus-version v1] [--dry-run]');
    process.exit(2);
  }
  const dryRun = argv.includes('--dry-run');
  const cvIdx = argv.indexOf('--corpus-version');
  const corpusVersion = cvIdx >= 0 ? argv[cvIdx + 1] : 'v1';

  // Required lazily so the pure helpers above stay importable in a test that
  // has no database.
  const supabase = dryRun ? null : require('../shared/config/supabase');

  const report = {
    files: 0, upserted: 0, retired: 0, wouldUpsert: 0,
    errors: [], warnings: [], flaggedByText: [],
  };

  for (const file of readSegmentFiles(target)) {
    const { segments } = parseFile(file);
    report.files += 1;
    await importFile({ supabase, file, segments, corpusVersion, dryRun, report });
  }

  console.log(`\nlp612 segment import ${dryRun ? '(DRY RUN) ' : ''}—`);
  console.log(`  files      ${report.files}`);
  console.log(`  ${dryRun ? 'would load' : 'upserted '}  ${dryRun ? report.wouldUpsert : report.upserted}`);
  if (!dryRun) console.log(`  retired    ${report.retired}`);
  console.log(`  held (religious, flagged by text, review these): ${report.flaggedByText.length}`);
  for (const f of report.flaggedByText.slice(0, 20)) {
    console.log(`    ${f.segment_id}  ${f.title}`);
  }
  if (report.warnings.length) {
    console.log(`  warnings   ${report.warnings.length} (imported anyway)`);
    for (const w of report.warnings.slice(0, 20)) {
      console.log(`    ${w.segment_id}: ${w.warnings.join('; ')}`);
    }
  }
  if (report.errors.length) {
    console.log(`  SKIPPED    ${report.errors.length} segments could not be imported`);
    for (const e of report.errors.slice(0, 20)) {
      console.log(`    ${e.segment_id || '(no id)'}: ${e.errors.join('; ')}`);
    }
  }
  return report;
}

module.exports = {
  isReligiousSegment,
  validateSegment,
  toRow,
  reconcilePlan,
  readSegmentFiles,
  parseFile,
  importFile,
  main,
  TABLE,
  RELIGIOUS_MARKERS,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`lp612 segment import failed: ${err.message}`);
    process.exit(1);
  });
}
