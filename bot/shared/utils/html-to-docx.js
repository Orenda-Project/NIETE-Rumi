'use strict';
/**
 * HTML → DOCX conversion utility.
 *
 * Thin wrapper over `@turbodocx/html-to-docx` (a maintained fork of
 * `html-to-docx`) so callers don't have to know about the package name or
 * the export shape. Used by the assessment-generator callback when the
 * teacher picked "docx" as the output format on the WhatsApp Flow SPEC
 * screen — the UG_EG service returns a print-ready HTML exam paper, we
 * hand it to `htmlToDocx()` and forward the resulting .docx buffer through
 * WhatsApp's `document` media type.
 *
 * Contract:
 *   const buffer = await htmlToDocx(htmlString, { title, margins })
 *   → Buffer (WORD_ML zip; first 4 bytes = 50 4b 03 04)
 *
 * Options are optional; defaults produce a portrait A4 doc with 720-twip
 * margins (0.5 inch) — matches the whitespace of the PDF path we already
 * ship. Failure is a hard throw (no swallowing) — the caller is expected
 * to catch and fall back to PDF or send a friendly WhatsApp error.
 */

const htmlToDocxLib = require('@turbodocx/html-to-docx');

/**
 * Convert an HTML string to a DOCX buffer.
 *
 * @param {string} html            Full HTML document (with <html><body>...).
 * @param {object} [opts]
 * @param {string} [opts.title]    Document title (used in Word's Properties).
 * @param {object} [opts.margins]  Twip margins { top, right, bottom, left }.
 *                                 Default: 720 twips = 0.5 inch each side.
 * @returns {Promise<Buffer>}      The .docx file as a Buffer.
 */
async function htmlToDocx(html, opts = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('htmlToDocx: html must be a non-empty string');
  }

  const options = {
    orientation: 'portrait',
    margins: opts.margins || { top: 720, right: 720, bottom: 720, left: 720 },
    title: opts.title || 'Assessment',
  };

  const buffer = await htmlToDocxLib(html, null, options);

  // The library returns a Node Buffer in Node runtimes. Guard against the
  // Blob path (browser build) just in case.
  if (Buffer.isBuffer(buffer)) return buffer;
  if (buffer && typeof buffer.arrayBuffer === 'function') {
    return Buffer.from(await buffer.arrayBuffer());
  }
  throw new Error('htmlToDocx: unexpected return type from converter');
}

module.exports = { htmlToDocx };
