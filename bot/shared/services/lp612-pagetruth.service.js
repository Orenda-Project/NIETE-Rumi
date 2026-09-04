/**
 * lp612-pagetruth.service — page-truth retrieval for grades 6-12 lesson-plan authoring.
 *
 * Page-truth is the machine-readable transcription of a textbook: one JSON per printed page,
 * plus `_book.json` (title/grade/subject/medium/offset) and `_toc.json` (the chapter index).
 * Everything the author writes must trace back to it, so this module's only job is to hand the
 * author service the EXACT pages it asked for — or to fail with a name.
 *
 * Ported from the pipeline's `retrieve.py`. Two things it keeps from there:
 *
 *   1. `pages` are PRINTED page numbers — the number at the foot of the page, which is what a
 *      teacher reads off her own copy — and the file is named for the printed number
 *      (`pg_011.json`), not the PDF index. The book's `offset` is carried in `_book.json` for
 *      anyone who needs to get back to the PDF; nothing here applies it.
 *   2. A missing page is LOUD. Upstream collected `missing_pages` and carried on; here it
 *      throws. An LP authored from four of its five pages is a lesson with a hole in it, and
 *      the hole is invisible in every artefact downstream — the doc lints clean, renders clean,
 *      and is simply missing what page 12 taught.
 *
 * Source selection:
 *   • `LP612_PAGE_TRUTH_DIR` set  -> read `<dir>/<bookStem>/…` off the filesystem (dev, tests,
 *     and a machine that has the corpus mounted).
 *   • otherwise                   -> R2, keys `lp612/page-truth/<bookStem>/<file>.json`.
 */

const fs = require('fs');
const path = require('path');

const { logToFile } = require('../utils/logger');

const R2_PREFIX = 'lp612/page-truth';

/** `pg_011.json` — printed page number, zero-padded to three digits. */
const pageFile = (printed) => `pg_${String(printed).padStart(3, '0')}.json`;

function missing(message, details = {}) {
  const err = new Error(message);
  err.code = 'PAGE_TRUTH_MISSING';
  Object.assign(err, details);
  return err;
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // A corrupt page is not a missing page, and pretending otherwise would send someone
    // hunting for a file that is right there.
    const err = new Error(`page-truth ${what} is not valid JSON: ${e.message}`);
    err.code = 'PAGE_TRUTH_CORRUPT';
    throw err;
  }
}

/** Read one page-truth file from whichever source is configured. Returns null when absent. */
async function readOne(bookStem, file, localDir) {
  if (localDir) {
    const p = path.join(localDir, bookStem, file);
    if (!fs.existsSync(p)) return null;
    return parseJson(fs.readFileSync(p, 'utf8'), `${bookStem}/${file}`);
  }
  // Lazy require: R2 pulls the AWS SDK in, and a local-dir run should not pay for it.
  const { downloadFromR2 } = require('../storage/r2');
  const key = `${R2_PREFIX}/${bookStem}/${file}`;
  let buf;
  try {
    buf = await downloadFromR2(key);
  } catch (e) {
    // Every R2 read failure lands here — a genuine miss, a permissions problem, a transport
    // error. They are reported as "missing" because the caller's only recovery is the same
    // either way, but the underlying error is attached so the log says which it was.
    return { __r2Error: e, __key: key };
  }
  return parseJson(buf.toString('utf8'), `${bookStem}/${file}`);
}

/**
 * The documented hard maximum for one segment's page range.
 *
 * 25 is not invented here — it is the number `brief_segment_v2.md` has always stated. What was
 * missing was any code that enforced it. 119 of the 5,482 live segments exceed it (largest: 63
 * pages), all of them chapter-spanning revision rows, so this is a real guardrail on a real path.
 */
const MAX_SEGMENT_PAGES = 25;

/**
 * @param {object} args
 * @param {string} args.bookStem       corpus folder, e.g. `grade_9_biology`
 * @param {number[]} args.pages        PRINTED page numbers, in the order they should appear
 * @param {string} [args.correlationId]
 * @returns {Promise<{book: object, toc: object, pages: object[]}>}
 * @throws  Error with .code 'PAGE_TRUTH_MISSING' | 'PAGE_TRUTH_CORRUPT' | 'PAGE_RANGE_TOO_LARGE'
 */
async function fetchPages({ bookStem, pages, correlationId } = {}) {
  if (!bookStem || typeof bookStem !== 'string') {
    throw missing('fetchPages needs a bookStem');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw missing(`no printed pages requested for ${bookStem} — an LP with no page-truth is not authorable`, { bookStem });
  }

  // THE CAP THE BRIEF ALWAYS CLAIMED EXISTED.
  //
  // brief_segment_v2.md: "Hard maximum: 25 pages… A segment past that cannot be served at all —
  // the author pipeline refuses the page range." That refusal was never implemented anywhere:
  // no length check here, no page-span check in the importer, no CHECK on the column. The only
  // real bound was a 90,000-character slice inside compactPageTruth that appended "…[truncated]"
  // with no throw, no log and no user-facing message — so a long chapter silently lost its tail
  // and the lesson was authored from a book that stopped mid-sentence, at around 44 pages in
  // English and 29 in Urdu.
  //
  // It is enforced HERE because this is the single choke point with exactly one caller, and as a
  // THROW rather than a slice because a lesson built from two thirds of its source is worse than
  // an honest refusal: the teacher cannot tell the difference by looking at it.
  if (pages.length > MAX_SEGMENT_PAGES) {
    logToFile('lp612 page-truth: page range too large, refusing', {
      correlationId, bookStem, requested: pages.length, cap: MAX_SEGMENT_PAGES,
    }, 'error');
    const err = new Error(
      `segment asks for ${pages.length} printed pages; the cap is ${MAX_SEGMENT_PAGES}. `
      + 'A range this long cannot be authored without silently losing its tail.',
    );
    err.code = 'PAGE_RANGE_TOO_LARGE';
    err.requested = pages.length;
    err.cap = MAX_SEGMENT_PAGES;
    throw err;
  }

  const localDir = process.env.LP612_PAGE_TRUTH_DIR || null;

  const bookRaw = await readOne(bookStem, '_book.json', localDir);
  if (!bookRaw || bookRaw.__r2Error) {
    logToFile('lp612 page-truth: book not found', {
      correlationId, bookStem, source: localDir ? 'local' : 'r2',
      cause: bookRaw && bookRaw.__r2Error ? String(bookRaw.__r2Error.message) : 'absent',
    }, 'error');
    throw missing(`no page-truth for book "${bookStem}" (${localDir ? `looked in ${localDir}` : `looked at ${R2_PREFIX}/${bookStem}/`})`, { bookStem });
  }

  const tocRaw = await readOne(bookStem, '_toc.json', localDir);
  if (!tocRaw || tocRaw.__r2Error) {
    throw missing(`page-truth for "${bookStem}" has no _toc.json`, { bookStem });
  }

  const out = [];
  for (const printed of pages) {
    const file = pageFile(printed);
    const pg = await readOne(bookStem, file, localDir);
    if (!pg || pg.__r2Error) {
      logToFile('lp612 page-truth: page not found', {
        correlationId, bookStem, printedPage: printed, file,
        cause: pg && pg.__r2Error ? String(pg.__r2Error.message) : 'absent',
      }, 'error');
      throw missing(
        `page-truth for "${bookStem}" is missing printed page ${printed} (${file}). ` +
        'Authoring a lesson from an incomplete page range produces a plan with an invisible hole in it.',
        { bookStem, printedPage: printed }
      );
    }
    out.push(pg);
  }

  logToFile('lp612 page-truth fetched', {
    correlationId, bookStem, pages: out.map((p) => p.printed_page_number),
    source: localDir ? 'local' : 'r2',
  });

  return { book: bookRaw, toc: tocRaw, pages: out };
}

// ── book crops (bd-17mht) ────────────────────────────────────────────────────
// The diagram plan names a book figure by `ref` = "<book_stem>/<page>_f<k>".
// The renderer inlines it from `<outDir>/<ref>.jpg` (template.js), so these two
// helpers put the file where the renderer looks. They run AFTER the authoring
// LLM call, which takes minutes, so one or two small downloads cost nothing on
// the critical path.

/** A ref is exactly "<book>/<file>" — no traversal, no absolute paths. */
const REF_RX = /^[A-Za-z0-9_][A-Za-z0-9_-]*\/[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** Every distinct, well-formed textbook_figure ref in an lp_doc. */
function refsFromDoc(doc) {
  const out = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'textbook_figure' && typeof node.ref === 'string') {
      // A malformed or traversing ref is dropped, not fetched. The page then
      // degrades to the book-reference card, which is the designed fallback.
      if (REF_RX.test(node.ref)) out.add(node.ref);
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(doc);
  return [...out];
}

/** R2 key for a crop ref. Mirrors build_plan.py's r2_key() and the uploader. */
function figureKeyFor(ref) {
  const i = ref.indexOf('/');
  return `${R2_PREFIX}/${ref.slice(0, i)}/figures/${ref.slice(i + 1)}.jpg`;
}

/**
 * Download the named crops into `outDir` as `<ref>.jpg`.
 * Never throws for a missing crop — a lesson without its picture still ships.
 * @returns {Promise<{staged: string[], missing: string[]}>}
 */
async function stageFigures({ refs = [], outDir, correlationId } = {}) {
  const staged = [];
  const missing = [];
  if (!refs.length) return { staged, missing };

  const localDir = process.env.LP612_PAGE_TRUTH_DIR || null;
  const { downloadFromR2 } = localDir ? {} : require('../storage/r2');

  await Promise.all(
    refs.map(async (ref) => {
      const dest = path.join(outDir, `${ref}.jpg`);
      try {
        let buf;
        if (localDir) {
          const i = ref.indexOf('/');
          const src = path.join(
            localDir, ref.slice(0, i), 'figures', `${ref.slice(i + 1)}.jpg`
          );
          if (!fs.existsSync(src)) throw new Error('not on disk');
          buf = fs.readFileSync(src);
        } else {
          buf = await downloadFromR2(figureKeyFor(ref));
        }
        if (!buf || !buf.length) throw new Error('empty');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        staged.push(ref);
      } catch (_) {
        missing.push(ref);
      }
    })
  );

  if (missing.length) {
    logToFile(
      `lp612.figures.missing correlationId=${correlationId || '-'} ` +
        `missing=${missing.join(',')} staged=${staged.length}`
    );
  }
  return { staged, missing };
}

module.exports = { fetchPages, MAX_SEGMENT_PAGES, refsFromDoc, stageFigures, figureKeyFor };
