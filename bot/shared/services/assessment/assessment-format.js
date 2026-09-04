'use strict';
/**
 * PDF or Word — and which renderer runs is decided in ONE place.
 *
 * The bug this module exists to make impossible: the orchestrator called
 * `htmlToPdf` unconditionally while the FILENAME came from `outputFormat`, so a
 * teacher picking Word would have received a PDF named `.docx`. That is the same
 * shape as the 1 Sep content-type defect (a PDF stored as a Word document), and
 * it is why the Word option was removed from the confirm screen rather than
 * fixed at the time.
 *
 * Here the renderer and the extension come off the same object. They cannot
 * drift apart, because there is nowhere for them to drift.
 */

const FORMATS = ['pdf', 'docx'];

/** What the teacher's choice maps to. `word` is what the screen says. */
const ALIASES = { pdf: 'pdf', docx: 'docx', word: 'docx' };

/**
 * The renderer for a chosen format.
 *
 * Unknown or missing input falls back to PDF rather than inventing an
 * extension — a paper that arrives as a PDF when she asked for something we do
 * not support is recoverable; a file named for a format it is not, is not.
 *
 * The renderers are required lazily. `html-to-pdf` pulls in playwright and
 * `html-to-docx` pulls in jszip, both of which live in bot/ — a top-level
 * require here would kill every root test suite that loads this file.
 */
function rendererFor(format) {
  const key = ALIASES[String(format || '').trim().toLowerCase()] || 'pdf';

  if (key === 'docx') {
    return {
      ext: 'docx',
      contentTypeExt: '.docx',
      label: 'Word',
      render: (html, opts) => require('../../utils/html-to-docx').htmlToDocx(html, opts),
    };
  }
  return {
    ext: 'pdf',
    contentTypeExt: '.pdf',
    label: 'PDF',
    render: (html, opts) => require('../../utils/html-to-pdf')
      .htmlToPdf(html, { timeout: 60000, ...(opts || {}) }),
  };
}

module.exports = { rendererFor, FORMATS, ALIASES };
