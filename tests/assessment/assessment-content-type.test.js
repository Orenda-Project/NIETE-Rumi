/**
 * A paper's CONTENT TYPE must follow its bytes, not a format the uploader was
 * written for two features ago.
 *
 * `uploadExamBuffer` hardcoded `getContentType('.docx')` — a leftover from the
 * bank-composed exam generator, which only ever emitted Word. Every paper since
 * has been stored as a Word document whatever it actually is, so a teacher who
 * asked for a PDF received a file WhatsApp labelled DOCX and her phone refused
 * to open (5 Sep, production).
 *
 * This is the 1 Sep content-type defect in the other direction, and it is the
 * exact failure the assessment-format module was built to make impossible —
 * except that module governs the RENDERER and the FILENAME, and this is a third
 * place the format is decided.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/storage/r2.js'), 'utf8');

function uploadExamBufferBody() {
  const start = SRC.indexOf('async function uploadExamBuffer');
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\n}', start));
}

describe('an exam upload declares the type of the bytes it is given', () => {
  test('the content type is not hardcoded to one format', () => {
    expect(uploadExamBufferBody()).not.toMatch(/getContentType\(\s*['"]\.docx['"]\s*\)/);
  });

  test('the content type is derived from the filename it was handed', () => {
    // The filename already carries the real extension — assessment-format owns
    // that — so deriving from it keeps one source of truth rather than adding a
    // fourth place the format is decided.
    expect(uploadExamBufferBody()).toMatch(/getContentType\([^)]*filename/);
  });
});
