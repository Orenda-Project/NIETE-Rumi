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

const { clampLanguage } = require('../shared/config/ux-strings');

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

/** A TEXT[] column takes an array of strings or nothing. A bare string is the
 *  shape the enrichment pass would produce for a single-SLO segment if it ever
 *  stopped wrapping, and it fails the whole chunk rather than the one row. */
const strList = (v) => {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
};

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
    // clampLanguage, not `|| 'en'`. An independent English floor is a language
    // decision made outside the one place that owns them, and it is how a
    // lookup miss degrades silently instead of loudly. Here it also stops the
    // corpus from writing a value the column's CHECK would reject.
    language: clampLanguage(s.language),
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
    // The deterministic SLO/section enrichment pass. These are the curriculum
    // spine the authoring brief quotes from — a row without them produces a
    // lesson with no learning outcome to teach to.
    //
    // Coerced to arrays here because the columns are TEXT[] NOT NULL DEFAULT
    // '{}' (the house convention, matching pages_covered): a bare string or a
    // null does not fail one row, it fails the whole 250-row chunk.
    slo_codes: strList(s.slo_codes),
    slo_descriptions: strList(s.slo_descriptions),
    slo_source: s.slo_source ?? null,
    // `section` is the human label and is present for every segment;
    // `section_ref` is the printed section number and is null for ~68% of them.
    // Both are kept: the ref is what a teacher matches against her book.
    section: s.section ?? null,
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

// ── the YouTube overlay ─────────────────────────────────────────────────────

/**
 * A pick is real only if it has a url.
 *
 * The swarm writes a `yt` slot for every segment it CONSIDERED; only the ones it
 * actually resolved carry a url. Storing the rest would put an empty object in a
 * column serving tests with `yt && yt.url` — truthy, urlless, and rendered as an
 * empty video line on a teacher's page.
 */
const hasPick = (yt) => !!(yt && typeof yt === 'object' && yt.url);

/**
 * Attach the swarm's picks to a book's segments, by segment_id.
 *
 * The two corpora are the same rows written by two different fleets hours apart:
 * `out/<book>_segments.json` (segments, `yt: null`) and
 * `yt/corpus_filled/<book>_segments.json` (the same rows with a pick). Keyed by
 * id rather than by position, because a re-cut book changes both the count and
 * the order and a positional overlay would then attach every video to the wrong
 * lesson — silently, and only visible to a teacher who followed the link.
 */
function overlayYt(segments, ytSegments) {
  const picks = new Map();
  for (const y of ytSegments || []) {
    if (y && y.segment_id && hasPick(y.yt)) picks.set(y.segment_id, y.yt);
  }
  if (!picks.size) return segments || [];
  return (segments || []).map((s) => (
    s && picks.has(s.segment_id) ? { ...s, yt: picks.get(s.segment_id) } : s
  ));
}

/**
 * Never let a yt-less run wipe a pick that is already in the table.
 *
 * The corpora arrive in the wrong order on purpose: segments tonight, picks
 * overnight, and in the morning someone re-imports a book from `out/` to top up
 * two late arrivals. That run carries `yt: null` for every row, and an upsert
 * replaces the whole row — so without this the morning's top-up is also the
 * morning's deletion of ~4,700 video links, and nothing would report it.
 *
 * An INCOMING pick still wins. A re-run is how a bad pick gets replaced.
 */
function mergeExistingYt(rows, existingRows) {
  const stored = new Map();
  for (const r of existingRows || []) {
    if (r && r.segment_id && hasPick(r.yt)) stored.set(r.segment_id, r.yt);
  }
  if (!stored.size) return rows || [];
  return (rows || []).map((r) => (
    !hasPick(r.yt) && stored.has(r.segment_id)
      ? { ...r, yt: stored.get(r.segment_id) }
      : r
  ));
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
    report.ytFilled += rows.filter((r) => hasPick(r.yt)).length;
    return;
  }

  // Read the picks already stored for exactly these ids, BEFORE the upsert that
  // would overwrite them. Order is the whole point: doing this afterwards reads
  // back the nulls this run just wrote.
  const incomingIds = rows.map((r) => r.segment_id);
  // A fresh array, never `rows` itself: mergeExistingYt returns its input
  // unchanged when there is nothing to carry, so aliasing here and then
  // rewriting `rows` in place empties both and silently upserts nothing.
  let carried = rows.slice();
  for (let i = 0; i < incomingIds.length; i += CHUNK) {
    const ids = incomingIds.slice(i, i + CHUNK);
    const { data, error } = await supabase.from(TABLE).select('segment_id, yt').in('segment_id', ids);
    if (error) throw new Error(`existing-pick read failed for ${file}: ${error.message}`);
    carried = mergeExistingYt(carried, data || []);
  }
  report.ytFilled += carried.filter((r) => hasPick(r.yt)).length;

  for (let i = 0; i < carried.length; i += CHUNK) {
    const chunk = carried.slice(i, i + CHUNK);
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
  // Where the YouTube swarm writes its filled corpus. Optional: the picks land
  // hours after the segments, so an import with no --yt-dir is the normal first
  // run, not a degraded one.
  const ytIdx = argv.indexOf('--yt-dir');
  const ytDir = ytIdx >= 0 ? argv[ytIdx + 1] : null;

  // Required lazily so the pure helpers above stay importable in a test that
  // has no database.
  const supabase = dryRun ? null : require('../shared/config/supabase');

  const report = {
    files: 0, upserted: 0, retired: 0, wouldUpsert: 0, ytFilled: 0, ytBooks: 0,
    errors: [], warnings: [], flaggedByText: [],
  };

  for (const file of readSegmentFiles(target)) {
    const { segments } = parseFile(file);
    report.files += 1;

    // The overlay is per BOOK and by filename, because that is how both fleets
    // write: one file per book, the same basename in both trees. A book the
    // swarm has not reached yet simply has no file here, and imports without a
    // pick rather than failing.
    let merged = segments;
    if (ytDir) {
      const ytFile = path.join(ytDir, path.basename(file));
      if (fs.existsSync(ytFile)) {
        merged = overlayYt(segments, parseFile(ytFile).segments);
        report.ytBooks += 1;
      }
    }

    await importFile({ supabase, file, segments: merged, corpusVersion, dryRun, report });
  }

  console.log(`\nlp612 segment import ${dryRun ? '(DRY RUN) ' : ''}—`);
  console.log(`  files      ${report.files}`);
  console.log(`  ${dryRun ? 'would load' : 'upserted '}  ${dryRun ? report.wouldUpsert : report.upserted}`);
  if (!dryRun) console.log(`  retired    ${report.retired}`);
  console.log(`  video links ${report.ytFilled}${ytDir ? ` (overlay read for ${report.ytBooks} book(s))` : ' (no --yt-dir given)'}`);
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
  overlayYt,
  mergeExistingYt,
  hasPick,
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
