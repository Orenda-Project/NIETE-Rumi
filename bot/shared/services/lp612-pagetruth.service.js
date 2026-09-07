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
const { isLp612WideSegmentsEnabled } = require('../config/lp612-flags');

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
 * The page range one segment may ask for without any special handling.
 *
 * 25 is the number `brief_segment_v2.md` has always stated. It was enforced here as a THROW from
 * 2026-09-04 until bd-oak77.30, and that throw was the last path in the system that refused a
 * teacher a lesson outright: measured on production 2026-09-07, **109 of 4,938 servable segments
 * (2.21%) span more than 25 printed pages** — every one of them `lp_type='revision'`, the chapter
 * reviews and semester summaries that span many pages by their nature — and every one of them is
 * on the menu, tappable, and failed 100% of the time.
 *
 * It is now a THRESHOLD, not a cap: over it, `LP612_WIDE_SEGMENTS` decides whether the range is
 * served (and the author told it is writing a revision across that span) or refused as before.
 * The constant itself is unchanged, deliberately — the flag-off path must be today byte for byte.
 */
const MAX_SEGMENT_PAGES = 25;

/**
 * The bound past which even a wide segment cannot be served WHOLE — and is therefore trimmed
 * rather than refused.
 *
 * Sized from measurement, not taste. The widest range in the production corpus is 63 printed
 * pages (`grade_11_computer_science.c01.r990`), whose whole assembled prompt counts 98,620 tokens
 * against claude-sonnet-5's 1,000,000-token window; the densest is 48 pages at 108,104 tokens.
 * 80 sits above the corpus maximum with headroom and still leaves ~87% of the window unused, so
 * this limb is UNREACHABLE by anything in the corpus today. It exists so that a future import can
 * never resurrect an outright refusal: past it the range is trimmed to the whole leading pages
 * that fit, the loss is recorded in `coverage`, stated in the prompt and stated in the lesson.
 */
const WIDE_SEGMENT_PAGE_CEILING = 80;

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

  // THE CAP NO LONGER REFUSES A LESSON — bd-oak77.30.
  //
  // What it used to say, and why the sentence was wrong:
  //
  //   brief_segment_v2.md: "Hard maximum: 25 pages… A segment past that cannot be served at all —
  //   the author pipeline refuses the page range."
  //
  // That refusal was implemented here on 2026-09-04 to close a REAL defect — a 90,000-character
  // slice inside `compactPageTruth` that appended "…[truncated]" with no throw, no log and no
  // user-facing message, so a long chapter silently lost its tail and the lesson was authored
  // from a book that stopped mid-sentence. The defect was real. The remedy was too strong: it
  // turned an invisible partial lesson into no lesson at all, on 109 of 4,938 servable segments
  // that are on the menu and tappable, and one of them (`grade_6_mathematics.s901`, 32 pages)
  // failed a real teacher on 2026-09-07.
  //
  // The operator's rule is explicit: the length cap must not also forcefully fail lessons. So the
  // two properties are separated. Never silently lose the tail — still absolute, and now stronger,
  // because what replaces a refusal drops WHOLE PAGES and says so rather than biting a string in
  // half. Never refuse — new, and what `LP612_WIDE_SEGMENTS` buys.
  //
  // Three outcomes, in order:
  //   flag OFF, over 25            -> refuse, exactly as before (this is the shipped default)
  //   flag ON, up to the ceiling   -> serve the whole range
  //   flag ON, past the ceiling    -> serve the leading pages that fit, record the loss
  const wideOk = isLp612WideSegmentsEnabled();
  let wanted = pages;
  let dropped = [];

  if (pages.length > MAX_SEGMENT_PAGES && !wideOk) {
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

  if (wideOk && pages.length > WIDE_SEGMENT_PAGE_CEILING) {
    wanted = pages.slice(0, WIDE_SEGMENT_PAGE_CEILING);
    dropped = pages.slice(WIDE_SEGMENT_PAGE_CEILING);
    // LOUD, because a partial lesson that nobody can see is the defect this file exists to stop.
    logToFile('lp612 page-truth: range past the ceiling, serving the leading pages', {
      correlationId, bookStem, requested: pages.length, served: wanted.length,
      ceiling: WIDE_SEGMENT_PAGE_CEILING, droppedFrom: dropped[0], droppedTo: dropped[dropped.length - 1],
    }, 'warn');
  } else if (wideOk && pages.length > MAX_SEGMENT_PAGES) {
    logToFile('lp612 page-truth: wide segment served whole', {
      correlationId, bookStem, requested: pages.length, threshold: MAX_SEGMENT_PAGES,
    });
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
  for (const printed of wanted) {
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

  /**
   * WHAT THE LESSON IS ACTUALLY BUILT FROM — always present, on every path.
   *
   * `complete: true` for every ordinary segment and every wide one inside the ceiling, which is
   * the entire production corpus. It is returned unconditionally rather than only when something
   * was lost, so no reader has to distinguish "nothing was dropped" from "this bundle predates
   * the field" — the shape that let the old silent truncation hide.
   */
  const coverage = {
    requested: pages.length,
    served: out.length,
    complete: dropped.length === 0,
    droppedPages: dropped,
    firstPage: out.length ? out[0].printed_page_number : null,
    lastPage: out.length ? out[out.length - 1].printed_page_number : null,
  };

  logToFile('lp612 page-truth fetched', {
    correlationId, bookStem, pages: out.map((p) => p.printed_page_number),
    source: localDir ? 'local' : 'r2',
    ...(coverage.complete ? {} : { requested: coverage.requested, droppedPages: dropped.length }),
  });

  return { book: bookRaw, toc: tocRaw, pages: out, coverage };
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

module.exports = {
  WIDE_SEGMENT_PAGE_CEILING, fetchPages, MAX_SEGMENT_PAGES, refsFromDoc, stageFigures, figureKeyFor };
