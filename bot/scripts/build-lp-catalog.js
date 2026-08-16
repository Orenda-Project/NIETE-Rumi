#!/usr/bin/env node
'use strict';
/**
 * Build bot/data/lp_catalog.json.
 *
 * Reads the Taleemabad K-5 ingestion tree (segmentation JSONs + page-truth TOCs)
 * and emits ONE file that the LP Flow endpoint reads at runtime. The bot has no
 * runtime dependency on the ingestion tree — this script is run offline and its
 * output is committed.
 *
 * Why the normalisation matters (measured 2026-08-16 over the real corpus):
 *   - 470 of 637 distinct `section` strings exceed the 30-code-point
 *     NavigationList title cap; the worst is 59 cp.
 *   - 320 of 2,038 `topic · pages` strings exceed the 80-cp metadata cap; the
 *     worst is 221 cp.
 *   - 463 of 2,038 topics EMBED their own section name, so a naive
 *     "section / topic" row reads "Memory Lane / All About Me (Memory Lane)".
 * All of that is fixed once, here, at build time. The endpoint only prefixes a
 * ✓/○ tick — which is why the title budget is 28, not 30.
 *
 * Usage:
 *   node scripts/build-lp-catalog.js \
 *     --segmentation "<…>/02_segmentation" --toc "<…>/01_page_truth" \
 *     [--out data/lp_catalog.json] [--check]
 *
 *   --check  build and compare against the committed file; exit 1 on drift
 *            (no write). Used to prove determinism.
 */

const fs = require('fs');
const path = require('path');

// ── Meta NavigationList caps (see DELIVERY_WIRING_PLAN.md §2) ────────────────
const TITLE_CAP = 30;
const TICK_HEADROOM = 2;                    // "✓ " is prefixed at serve time
const SECTION_CAP = TITLE_CAP - TICK_HEADROOM;
const META_CAP = 80;
const LTR = '‎';                       // keeps "p.5-7" LTR inside an RTL row

const CATALOG_VERSION = 'v8';

// Multi-clause topic separators. These join what are really two lessons' worth
// of prose in one field; the row shows the first clause only.
const CLAUSE_SEPARATORS = ['⟢', '→', ' / '];

/** Code-point length — WhatsApp caps are code points, not UTF-16 units (Rule 20). */
const cps = (s) => [...String(s == null ? '' : s)].length;

/** Clip to `n` code points, ellipsis when it actually had to cut. */
function clip(s, n) {
  const chars = [...String(s == null ? '' : s)];
  if (chars.length <= n) return chars.join('');
  return chars.slice(0, n - 1).join('') + '…';
}

/** Split a compound section ("A + B", "A / B") into its parts. */
function sectionParts(section) {
  return String(section || '')
    .split(/\s*\+\s*|\s+\/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove the section name from a topic that repeats it.
 * Handles both the trailing "(Memory Lane)" form and the leading
 * "Chapter Review: …" form, for the whole section and each compound part.
 */
function dedupeTopic(topic, section) {
  let t = String(topic || '').trim();
  if (!t) return t;
  const candidates = [String(section || '').trim(), ...sectionParts(section)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);   // longest first, so "A + B" beats "A"

  for (const c of candidates) {
    const rx = escapeRx(c);
    t = t.replace(new RegExp(`\\s*\\(\\s*${rx}\\s*\\)\\s*$`, 'i'), '').trim();
    t = t.replace(new RegExp(`^\\s*${rx}\\s*[:\\-–—]\\s*`, 'i'), '').trim();
  }
  return t || String(topic || '').trim();
}

/**
 * The section with its noise stripped but NOT capped — what the teacher should
 * be able to read somewhere on the row even when the 28-cp title cannot hold it.
 */
function cleanSection(section) {
  let s = String(section || '').trim();
  if (!s) return '';

  // "Topic 1 · What's the Science" / "Topic 2 - Adventure Begins"
  s = s.replace(/^Topic\s*\d+\s*[·:\-–—]\s*/i, '').trim();

  // Trailing gloss: "پورا سبق (whole chapter)", "جائزہ (student-facing worksheet)"
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();

  return s;
}

/**
 * A <=28 cp row title from a raw section string.
 * Order is deliberate: a gloss is always noise, so it goes first; a compound is
 * only collapsed when the full label genuinely will not fit.
 */
function shortSection(section) {
  const s = cleanSection(section);
  if (!s) return '';

  if (cps(s) <= SECTION_CAP) return s;

  const parts = sectionParts(s);
  if (parts.length > 1) {
    const collapsed = `${parts[0]} +`;
    if (cps(collapsed) <= SECTION_CAP) return collapsed;
    return clip(collapsed, SECTION_CAP);
  }
  return clip(s, SECTION_CAP);
}

/** "p.5" / "p.5-7"; a non-contiguous set collapses to first-last. */
function pagesLabel(pages) {
  const pp = [...new Set((pages || []).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (!pp.length) return '';
  if (pp.length === 1) return `p.${pp[0]}`;
  return `p.${pp[0]}-${pp[pp.length - 1]}`;
}

/**
 * Lesson type, DERIVED from segment_index.
 * The source `lp_type` field is null in 12 of the 17 books, so it cannot be
 * read; the 990/995 tail convention is uniform across all 17 and is the truth.
 */
function lpTypeFor(segmentIndex) {
  const n = Number(segmentIndex);
  if (n === 990) return 'revision';
  if (n === 995) return 'assessment';
  return 'content';
}

/** The <=20 cp description line. */
function dayLabelFor(segmentIndex, lpType) {
  const type = lpType || lpTypeFor(segmentIndex);
  if (type === 'revision') return 'Revision';
  if (type === 'assessment') return 'Worksheet';
  return `Day ${segmentIndex}`;
}

/** "Maths" and "Math" are the same subject; "General Science" slugs. */
function subjectKey(subject) {
  const s = String(subject || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (s === 'maths') return 'math';
  return s;
}

/** True when every "(" in `s` has been closed. */
function bracketsBalanced(s) {
  let depth = 0;
  for (const ch of String(s)) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return depth === 0;
}

/**
 * Drop the assessment boilerplate the 995 topics all carry:
 *   "… (student, fillable)"  /  "… (طالبِ علم، پُر کرنے والا)"
 * 145 of 2,038 lessons have it, and it is pure noise that was eating the
 * 80-cp metadata budget and getting clipped mid-word.
 */
function stripBoilerplate(topic) {
  return String(topic || '')
    .replace(/\s*\([^)]*(?:student|طالبِ?\s*علم)[^)]*\)\s*$/iu, '')
    .trim();
}

/**
 * The same boilerplate class ANYWHERE in the string, not just trailing — a
 * compound section like "تخلیقی لکھائی (طالب علم کا اظہار) + سرگرمی" carries it
 * mid-string, and once the full section joined the metadata line (staging
 * feedback round 1) the anchored strip stopped being enough. Caught by the
 * committed-artifact boilerplate test on grade_1_urdu_ch9_seg5.
 */
function stripBoilerplateAnywhere(s) {
  return String(s || '')
    .replace(/\s*\([^)]*(?:student|طالبِ?\s*علم)[^)]*\)/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Cut a topic at its first multi-clause separator.
 *
 * A separator only counts when the text before it has balanced brackets —
 * otherwise a slash inside a parenthetical list ("واحد جمع (ے / یں / وں)")
 * gets treated as a clause break and leaves a dangling bracket and a mangled
 * word on the teacher's screen. Found on grade_2_urdu ch1 seg5.
 */
function firstClause(topic) {
  let t = String(topic || '');
  for (const sep of CLAUSE_SEPARATORS) {
    let from = 0;
    for (;;) {
      const i = t.indexOf(sep, from);
      if (i <= 0) break;
      if (bracketsBalanced(t.slice(0, i))) { t = t.slice(0, i); break; }
      from = i + sep.length;
    }
  }
  return t.trim().replace(/[\s—–\-·:,;]+$/, '').trim();
}

/**
 * Clip for display, then heal a bracket the clip broke open: cut back to just
 * before the unmatched "(" rather than ship "… (student, fil…".
 */
function clipBalanced(s, n) {
  let out = clip(s, n);
  if (bracketsBalanced(out)) return out;
  const i = out.lastIndexOf('(');
  if (i <= 0) return out;
  const healed = out.slice(0, i).trim().replace(/[\s—–\-·:,;&]+$/, '').trim();
  return healed || out;
}

/**
 * Assemble the NavigationList row. The tick is NOT included — the endpoint
 * prefixes it, which is why the title budget is SECTION_CAP (28) not 30.
 */
function buildRow(lesson, opts = {}) {
  const rtl = !!opts.rtl;
  const type = lpTypeFor(lesson.segment_index);
  const sectionFull = cleanSection(lesson.section);
  const title = shortSection(lesson.section);
  const description = dayLabelFor(lesson.segment_index, type);

  const pages = pagesLabel(lesson.pages);
  const mark = rtl ? LTR : '';
  const suffix = pages ? `${mark} · ${pages}` : '';
  const budget = META_CAP - cps(suffix);

  const deduped = stripBoilerplate(dedupeTopic(lesson.topic, lesson.section));
  let topicShort = firstClause(deduped);

  // Staging feedback round 1 (): when the 28-cp title cap costs the
  // teacher part of the section name, the FULL section leads the metadata line
  // — the row then reads "section — topic · pages" and nothing is lost, only
  // moved. A section that fits stays out of metadata (it would just repeat the
  // title one line up).
  const sectionForMeta = stripBoilerplateAnywhere(sectionFull);
  let lead = title === sectionFull
    ? topicShort
    : (topicShort ? `${sectionForMeta} — ${topicShort}` : sectionForMeta);
  if (cps(lead) > budget) lead = clipBalanced(lead, budget);

  return { title, description, metadata: `${lead}${suffix}` };
}

// ── Sources ─────────────────────────────────────────────────────────────────

function loadTocs(tocDir) {
  const out = {};
  for (const entry of fs.readdirSync(tocDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(tocDir, entry.name, '_toc.json');
    if (!fs.existsSync(p)) continue;
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const map = {};
    for (const c of d.chapters || []) map[c.number] = c.title || '';
    out[d.book_stem] = map;
  }
  return out;
}

const cleanChapterTitle = (t) => String(t || '')
  .replace(/\s*\(chapter reading — full LP pending\)\s*$/i, '')
  .trim();

/**
 * Build the whole catalog object.
 * @param {object} o
 * @param {string} o.segmentationDir
 * @param {string} o.tocDir
 * @param {string} [o.builtAt] — pass a fixed value to prove determinism
 */
function buildCatalog({ segmentationDir, tocDir, builtAt }) {
  const tocs = loadTocs(tocDir);

  const files = fs.readdirSync(segmentationDir)
    .filter((f) => f.endsWith('_full_segments.json'))
    .sort();

  const books = [];
  let chapterCount = 0;
  let lessonCount = 0;

  for (const file of files) {
    const d = JSON.parse(fs.readFileSync(path.join(segmentationDir, file), 'utf8'));
    const meta = d._meta || {};
    const stem = meta.book_stem;
    const key = subjectKey(meta.subject);
    const rtl = key === 'urdu';
    const tocMap = tocs[stem] || {};

    const byChapter = new Map();
    for (const s of d.segments || []) {
      const ch = Number(s.chapter_number);
      if (!byChapter.has(ch)) byChapter.set(ch, []);
      byChapter.get(ch).push(s);
    }

    const chapters = [...byChapter.keys()].sort((a, b) => a - b).map((num) => {
      const rawTitle = cleanChapterTitle(tocMap[num] || `Chapter ${num}`);
      // The chapter's full page span, revision/worksheet pages included — the
      // chapter row shows where the chapter LIVES in the book, not where its
      // first lesson starts (staging feedback round 1).
      const chapterPages = pagesLabel(
        byChapter.get(num).flatMap((s) => (s.pages_printed || []).map(Number).filter(Number.isFinite)),
      );
      const lessons = byChapter.get(num)
        .slice()
        .sort((a, b) => Number(a.segment_index) - Number(b.segment_index))
        .map((s) => {
          const segIdx = Number(s.segment_index);
          const section = String(s.section || '').trim();
          const pages = (s.pages_printed || []).map(Number).filter(Number.isFinite);
          const topic = dedupeTopic(s.topic, section);
          const type = lpTypeFor(segIdx);
          const row = buildRow({ segment_index: segIdx, section, topic: s.topic, pages }, { rtl });
          lessonCount += 1;
          return {
            lesson_id: `${stem}_ch${num}_seg${segIdx}`,
            segment_index: segIdx,
            lp_type: type,
            day_label: dayLabelFor(segIdx, type),
            section,
            section_short: row.title,
            topic,
            topic_short: row.metadata.replace(/(‎)? · p\.[\d-]+$/, ''),
            pages,
            pages_label: pagesLabel(pages),
            row,
          };
        });

      chapterCount += 1;
      return {
        number: num,
        title: rawTitle,
        title_short: clip(rawTitle, TITLE_CAP),
        pages_label: chapterPages,
        lessons,
      };
    });

    books.push({
      stem,
      grade: Number(meta.grade),
      subject: meta.subject,
      subject_key: key,
      rtl,
      chapters,
    });
  }

  books.sort((a, b) => (a.grade - b.grade) || a.subject_key.localeCompare(b.subject_key));

  return {
    catalog_version: CATALOG_VERSION,
    built_at: builtAt || new Date().toISOString(),
    source: { segmentation: segmentationDir, toc: tocDir, books: books.length },
    counts: { books: books.length, chapters: chapterCount, lessons: lessonCount },
    books,
  };
}

/** Stable serialisation — same inputs, byte-identical output. */
function serialise(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') { args.check = true; continue; }
    if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i += 1; }
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const segmentationDir = args.segmentation || process.env.LP_SEGMENTATION_DIR;
  const tocDir = args.toc || process.env.LP_TOC_DIR;
  const outPath = path.resolve(args.out || path.join(__dirname, '..', 'data', 'lp_catalog.json'));

  if (!segmentationDir || !tocDir) {
    console.error('Usage: build-lp-catalog.js --segmentation <dir> --toc <dir> [--out <file>] [--check]');
    process.exit(2);
  }

  const existingBuiltAt = (args.check && fs.existsSync(outPath))
    ? JSON.parse(fs.readFileSync(outPath, 'utf8')).built_at
    : undefined;

  const catalog = buildCatalog({ segmentationDir, tocDir, builtAt: existingBuiltAt });
  const text = serialise(catalog);

  if (args.check) {
    const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    if (prev !== text) {
      console.error(`✗ catalog drift: rebuilt output differs from ${outPath}`);
      process.exit(1);
    }
    console.log(`✓ catalog is current (${catalog.counts.lessons} lessons)`);
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  console.log(`✓ ${outPath}`);
  console.log(`  ${catalog.counts.books} books · ${catalog.counts.chapters} chapters · ${catalog.counts.lessons} lessons`);
}

module.exports = {
  buildCatalog,
  serialise,
  buildRow,
  dedupeTopic,
  cleanSection,
  shortSection,
  pagesLabel,
  lpTypeFor,
  dayLabelFor,
  subjectKey,
  firstClause,
  stripBoilerplate,
  bracketsBalanced,
  clipBalanced,
  clip,
  cps,
  SECTION_CAP,
  META_CAP,
  TITLE_CAP,
  LTR,
};
