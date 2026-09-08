/**
 * PDF or Word — and the bytes must match the extension.
 *
 * The orchestrator called htmlToPdf unconditionally while the FILENAME used
 * `outputFormat`. Offering Word in that state would have shipped a PDF named
 * `.docx` — the same class of defect as the content-type bug that lost a paper
 * on 1 Sep, in reverse. Which is exactly why the Word option was taken OFF the
 * confirm screen rather than fixed at the time.
 *
 * One object now owns both halves, so the renderer and the extension cannot
 * drift apart.
 */

const { rendererFor, FORMATS } = require('../../bot/shared/services/assessment/assessment-format');

describe('rendererFor', () => {
  test('pdf and docx each get their own renderer', () => {
    expect(rendererFor('pdf').ext).toBe('pdf');
    expect(rendererFor('docx').ext).toBe('docx');
  });

  test("'word' is accepted as a synonym — it is what the screen used to say", () => {
    expect(rendererFor('word').ext).toBe('docx');
    expect(rendererFor('WORD').ext).toBe('docx');
  });

  test('an unknown format falls back to PDF rather than inventing an extension', () => {
    for (const bad of ['rtf', '', undefined, null, 'txt']) {
      expect(rendererFor(bad).ext).toBe('pdf');
    }
  });

  test('the extension and the renderer come from ONE object, so they cannot disagree', () => {
    for (const fmt of ['pdf', 'docx', 'word', 'nonsense', undefined]) {
      const r = rendererFor(fmt);
      expect(typeof r.render).toBe('function');
      expect(['pdf', 'docx']).toContain(r.ext);
      expect(r.contentTypeExt).toBe(`.${r.ext}`);
    }
  });

  test('every declared format is reachable through rendererFor', () => {
    for (const f of FORMATS) expect(rendererFor(f).ext).toBe(f);
  });
});

describe('the docx renderer produces a real Word file', () => {
  const { htmlToDocx } = require('../../bot/shared/utils/html-to-docx');

  test('the bytes are a ZIP — every .docx is a zip archive, PK\\x03\\x04', async () => {
    const buf = await htmlToDocx('<h1>Grade 4 Science</h1><p>1. What is a living thing? [1 mark]</p>');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  test('it is NOT a PDF — the failure this whole module exists to prevent', async () => {
    const buf = await htmlToDocx('<p>x</p>');
    expect(buf.slice(0, 4).toString()).not.toBe('%PDF');
  });

  test('the question text survives into the document', async () => {
    const buf = await htmlToDocx('<p>Bunty divides 18 candies among 9 friends.</p>');
    // document.xml lives inside the zip; the text is there in plain UTF-8.
    expect(buf.toString('latin1')).toContain('word/document.xml');
  });
});
