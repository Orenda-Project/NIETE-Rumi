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
 * @param {object} args
 * @param {string} args.bookStem       corpus folder, e.g. `grade_9_biology`
 * @param {number[]} args.pages        PRINTED page numbers, in the order they should appear
 * @param {string} [args.correlationId]
 * @returns {Promise<{book: object, toc: object, pages: object[]}>}
 * @throws  Error with .code 'PAGE_TRUTH_MISSING' | 'PAGE_TRUTH_CORRUPT'
 */
async function fetchPages({ bookStem, pages, correlationId } = {}) {
  if (!bookStem || typeof bookStem !== 'string') {
    throw missing('fetchPages needs a bookStem');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw missing(`no printed pages requested for ${bookStem} — an LP with no page-truth is not authorable`, { bookStem });
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

module.exports = { fetchPages };
