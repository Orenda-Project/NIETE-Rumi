#!/usr/bin/env node
/**
 * Put the printed-page text where the runtime author can read it.
 *
 *   node bot/scripts/upload-lp612-page-truth.js <page-truth-root> \
 *        [--books a,b] [--include-figures] [--dry-run]
 *
 * The author needs three things per book: `_book.json` (grade/subject/medium and
 * the printed-vs-PDF offset), `_toc.json` (the chapter index), and one
 * `pg_NNN.json` per printed page. On Railway those come from R2 under
 * `lp612/page-truth/<book_stem>/`, which is what this uploads to. Locally,
 * `LP612_PAGE_TRUTH_DIR` short-circuits the whole thing and the author reads
 * the same layout off disk.
 *
 * **Text only by default.** The page-truth corpus is around a gigabyte and
 * roughly 994 MB of that is `figures/` — scanned crops that the renderer
 * degrades gracefully without, falling back to a "book reference" card. Text
 * alone is 30–50 MB. Taking the figures is therefore an explicit `--include-figures`,
 * not something a routine re-upload does by accident.
 *
 * Re-runnable: every put overwrites its own key, so running it again after more
 * books land costs bandwidth and nothing else.
 */

const fs = require('fs');
const path = require('path');

const R2_PREFIX = 'lp612/page-truth';

/** The three shapes the author actually reads. Anything else in a book folder —
 *  editor backups, notes, intermediate dumps — is left behind. */
const PAGE_FILE_RE = /^pg_\d+\.json$/;
const BOOK_FILE = '_book.json';
const TOC_FILE = '_toc.json';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const contentTypeFor = (file) =>
  CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

function r2KeyFor(bookStem, file) {
  return `${R2_PREFIX}/${bookStem}/${file}`;
}

/**
 * Decide what to upload for one book.
 *
 * Returns [] when `_book.json` is absent, deliberately: the author throws
 * PAGE_TRUTH_MISSING for a book with no `_book.json`, so uploading that book's
 * pages would produce something that looks present in R2 and fails at request
 * time. Better to report the book as unuploadable than to half-upload it.
 *
 * @param {object} p
 * @param {string} p.bookStem
 * @param {string[]} p.files      paths relative to the book folder, '/'-separated
 * @param {boolean} [p.includeFigures]
 */
function planUpload({ bookStem, files, includeFigures = false }) {
  const list = files || [];
  if (!list.includes(BOOK_FILE)) return [];

  const wanted = list.filter((f) => {
    if (f === BOOK_FILE || f === TOC_FILE) return true;
    if (PAGE_FILE_RE.test(f)) return true;
    if (includeFigures && f.startsWith('figures/')) return true;
    return false;
  });

  // Sorted so a re-run produces the same order — a dry run diffed against a
  // previous dry run should show content changes, not directory-order noise.
  return wanted.sort().map((file) => ({
    file,
    key: r2KeyFor(bookStem, file),
    contentType: contentTypeFor(file),
  }));
}

/** Book folders under the page-truth root — a book is any directory holding a
 *  `_book.json`. */
function findBooks(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(root, name, BOOK_FILE)))
    .sort();
}

/** Files inside one book folder, relative and '/'-separated, one level of
 *  nesting (enough for `figures/`). */
function listBookFiles(bookDir) {
  const out = [];
  for (const entry of fs.readdirSync(bookDir, { withFileTypes: true })) {
    if (entry.isFile()) out.push(entry.name);
    else if (entry.isDirectory()) {
      for (const sub of fs.readdirSync(path.join(bookDir, entry.name), { withFileTypes: true })) {
        if (sub.isFile()) out.push(`${entry.name}/${sub.name}`);
      }
    }
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const root = argv.find((a) => !a.startsWith('--'));
  if (!root) {
    console.error('usage: upload-lp612-page-truth.js <page-truth-root> '
      + '[--books a,b] [--include-figures] [--dry-run]');
    process.exit(2);
  }
  const dryRun = argv.includes('--dry-run');
  const includeFigures = argv.includes('--include-figures');
  const booksIdx = argv.indexOf('--books');
  const only = booksIdx >= 0 ? new Set(argv[booksIdx + 1].split(',').map((s) => s.trim())) : null;

  // Lazily required so the pure helpers stay importable without R2 credentials.
  const { uploadBuffer } = dryRun ? { uploadBuffer: null } : require('../shared/storage/r2');

  const books = findBooks(root).filter((b) => !only || only.has(b));
  let uploaded = 0;
  let bytes = 0;
  const skipped = [];

  for (const bookStem of books) {
    const bookDir = path.join(root, bookStem);
    const plan = planUpload({ bookStem, files: listBookFiles(bookDir), includeFigures });
    if (!plan.length) {
      skipped.push(bookStem);
      continue;
    }
    for (const item of plan) {
      const body = fs.readFileSync(path.join(bookDir, item.file));
      bytes += body.length;
      if (!dryRun) await uploadBuffer(body, item.key, item.contentType);
      uploaded += 1;
    }
    console.log(`  ${bookStem.padEnd(34)} ${String(plan.length).padStart(5)} files`);
  }

  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`\nlp612 page-truth ${dryRun ? '(DRY RUN) ' : ''}—`);
  console.log(`  books     ${books.length}`);
  console.log(`  ${dryRun ? 'would send' : 'uploaded '} ${uploaded} files, ${mb} MB`);
  console.log(`  figures   ${includeFigures ? 'INCLUDED' : 'excluded (pass --include-figures to send them)'}`);
  if (skipped.length) {
    console.log(`  SKIPPED   ${skipped.length} book(s) with no ${BOOK_FILE}: ${skipped.join(', ')}`);
  }
  return { books: books.length, uploaded, bytes, skipped };
}

module.exports = {
  planUpload, findBooks, listBookFiles, r2KeyFor, contentTypeFor, main,
  R2_PREFIX, BOOK_FILE, TOC_FILE,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`lp612 page-truth upload failed: ${err.message}`);
    process.exit(1);
  });
}
