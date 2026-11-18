/**
 * bd-c2iiq3 — is this buffer fit to be a teacher's lesson PDF?
 *
 * A 0-byte render once became the current asset for a lesson and was sent to teachers
 * as an empty file. The real lessons are hundreds of KB; anything under MIN_BYTES, or
 * without a %PDF header, is a broken render, never a lesson.
 */

const MIN_BYTES = 1024;

/**
 * @param {{minBytes?: number}} [opts] the size floor applies to the render on disk;
 *   after ghostscript the output may legitimately be smaller, so callers pass minBytes: 1.
 * @returns {string|null} why the buffer is not a usable PDF, or null if it is.
 */
function pdfProblem(buffer, { minBytes = MIN_BYTES } = {}) {
  if (!buffer || buffer.length === 0) return 'empty file (0 bytes)';
  const head = buffer.subarray(0, 1024).toString('latin1').trimStart();
  if (!head.startsWith('%PDF-')) return 'not a PDF (no %PDF- header)';
  if (buffer.length < minBytes) return `too small to be a lesson (${buffer.length} bytes)`;
  return null;
}

module.exports = { pdfProblem, MIN_BYTES };
