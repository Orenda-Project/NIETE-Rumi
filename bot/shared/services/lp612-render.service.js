/**
 * lp612-render.service — lp_doc -> self-contained HTML -> A4 PDF.
 *
 * A thin, honest wrapper around the vendored renderer (`bot/vendor/lp-v9/render_lp.js`), called
 * through its programmatic `renderDoc()` entry rather than its CLI — see SYNC.md §3.3 for why
 * that entry exists and §3.2 for the chromium-channel change that lets it run off macOS.
 *
 * The wrapper deliberately adds almost nothing. Three things only:
 *
 *   1. IT TAKES A DOCUMENT, NOT A PATH. The renderer reads a file (it resolves figure `src`
 *      relative to the document's own directory), so the doc is written into `outDir` first.
 *      The caller holds an object; making it invent a temp file is the wrapper's job, not its.
 *   2. IT TURNS `problems` INTO ONE NAMED FAILURE. The renderer collects findings and lets its
 *      CLI choose an exit code; a service has to throw. Every entry in `problems` is a defect a
 *      TEACHER would meet on paper, so none of them is a warning:
 *        • OVERFLOW    — content clipped off the bottom of a page;
 *        • TYPE FLOOR  — body or chip type under the phone-readable floor;
 *        • PAGE COUNT  — a part over its hard cap (never trimmed: cutting a long plan is an
 *                        authoring decision, and a silent trim is how five-page PDFs of
 *                        seven-page lessons shipped);
 *        • TRUNCATION  — the PDF has FEWER pages than the layout built. The teacher's plan
 *                        just ends. This is the most expensive defect the renderer can ship
 *                        and the reason `page.pdf()` is called with no `pageRanges`.
 *   3. IT KEEPS `warnings` AS WARNINGS. A part over its SOFT target is allowed —
 *      completeness beats page count — and is returned, not thrown.
 *
 * WHAT IT DOES NOT DO: it does not re-lint (the author service owns the canon gate), it does
 * not decide the page caps or type floors (those are the renderer's exported constants, and
 * there is exactly one copy of each), and it does not look at the result. Nothing in this
 * pipeline replaces a human opening the pages and reading them.
 */

const fs = require('fs');
const path = require('path');

const { logToFile } = require('../utils/logger');

// A static, literal require: the repo's unresolved-require audit reads the source text, and a
// `require(path.join(...))` is invisible to it — a vendored file that stopped existing would
// then reach production as a runtime crash instead of a red gate.
const { renderDoc } = require('../../vendor/lp-v9/render_lp.js');

function renderFailed(message, extra = {}) {
  const err = new Error(message);
  err.code = 'RENDER_FAILED';
  Object.assign(err, extra);
  return err;
}

/**
 * @param {object} args
 * @param {object} args.lpDoc     an lp_doc (schema 3.0, or 2.0 — the renderer migrates 2.0 into
 *                                the 3.0 shape in memory and keeps ONE layout path)
 * @param {'en'|'ur'} [args.lang] language to render; defaults to the document's own medium
 * @param {string} args.stem      output basename, without extension
 * @param {string} args.outDir    directory for the .json, .html, .pdf and .render.json
 * @param {string} [args.correlationId]
 * @returns {Promise<{pdfPath:string, htmlPath:string, pageCount:number, warnings:string[]}>}
 * @throws  Error with .code 'RENDER_FAILED' and .problems[]
 */
async function renderLessonPlan({ lpDoc, lang, stem, outDir, correlationId } = {}) {
  if (!lpDoc || typeof lpDoc !== 'object') throw renderFailed('renderLessonPlan needs an lpDoc object');
  if (!stem) throw renderFailed('renderLessonPlan needs a stem');
  if (!outDir) throw renderFailed('renderLessonPlan needs an outDir');

  fs.mkdirSync(outDir, { recursive: true });
  const docPath = path.join(outDir, `${stem}.lp.json`);
  fs.writeFileSync(docPath, JSON.stringify(lpDoc, null, 1), 'utf8');

  let out;
  try {
    out = await renderDoc({
      doc: docPath,
      out: outDir,
      stem,
      lang: lang || null,
      png: false,
      pdf: true,
      quiet: true,
    });
  } catch (e) {
    // SCHEMA_INVALID / OVERLAY_INVALID arrive here as named errors from the vendored renderer;
    // anything else is a genuine blow-up. Both become RENDER_FAILED, with the detail kept.
    logToFile('lp612 render threw', {
      correlationId, stem, code: e.code || null, error: e.message,
    }, 'error');
    throw renderFailed(`render of ${stem} failed: ${e.message}`, {
      problems: e.errors || [e.message],
      cause: e,
    });
  }

  const problems = out.problems || [];
  const warnings = out.warnings || [];
  const byPart = out.pagesByPart || {};
  // `pdfPages` counts the REAL file; `pagesByPart` counts what the packer laid out. They can
  // disagree, and when they do the renderer has already said so in `problems` — prefer the
  // file, because the file is what the teacher opens.
  const pageCount = out.pdfPages != null
    ? out.pdfPages
    : Object.values(byPart).reduce((a, n) => a + n, 0);

  if (problems.length) {
    logToFile('lp612 render produced defects', {
      correlationId, stem, lang: lang || null, problems, pagesByPart: byPart,
    }, 'error');
    throw renderFailed(
      `render of ${stem} produced ${problems.length} defect(s): ${problems.join(' | ')}`,
      { problems, warnings, htmlPath: out.htmlPath, pdfPath: out.pdfPath, pageCount }
    );
  }

  logToFile('lp612 render ok', {
    correlationId, stem, lang: lang || null, pageCount, pagesByPart: byPart,
    warnings, reportPath: out.reportPath,
  });

  return {
    pdfPath: out.pdfPath,
    htmlPath: out.htmlPath,
    pageCount,
    warnings,
  };
}

module.exports = { renderLessonPlan };
