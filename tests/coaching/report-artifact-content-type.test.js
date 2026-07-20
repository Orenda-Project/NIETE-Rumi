/**
 * Coaching report artifact: PNG must be stored/served as PNG, never as a PDF.
 *
 * Reported from ICT 2026-07-20 (Hammad): "the pdf being sent was corrupted, it
 * actually gives a .PNG file as .PDF."
 *
 * The hero renderer returns a PNG. Three places used to mislabel it:
 *   1. R2 upload  — `_report.pdf` key + ContentType application/pdf
 *   2. report-generator — sent every buffer through uploadReportPDF
 *   3. dashboard  — hardcoded `Content-Type: application/pdf` when serving
 * Each produced a file that PDF readers reject as corrupt.
 *
 * Source-level guards: the live path pulls in R2, supabase, whatsapp and
 * playwright — too many real deps to unit-test end-to-end — so we lock the
 * call-site shape the same way the other coaching guards do.
 */

const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

describe('Coaching report artifact — correct content type', () => {
  describe('r2.js', () => {
    const src = read('bot/shared/storage/r2.js');

    it('exposes uploadReportImage for hero PNGs', () => {
      expect(src).toMatch(/async function uploadReportImage\s*\(/);
      expect(src).toMatch(/uploadReportImage,/); // exported
    });

    it('stores report images with a .png key and image/png content type', () => {
      const fn = src.slice(src.indexOf('async function uploadReportImage'));
      expect(fn).toMatch(/_report\.png/);
      expect(fn).toMatch(/ContentType:\s*'image\/png'/);
    });

    it('leaves the real-PDF path (uploadReportPDF) intact for PDFKit reports', () => {
      const fn = src.slice(src.indexOf('async function uploadReportPDF'));
      expect(fn).toMatch(/_report\.pdf/);
      expect(fn).toMatch(/ContentType:\s*'application\/pdf'/);
    });
  });

  describe('report-generator.service.js', () => {
    const src = read('bot/shared/services/coaching/report-generator.service.js');

    it('uploads hero PNGs via uploadReportImage, not uploadReportPDF', () => {
      expect(src).toMatch(/uploadReportImage\(\s*reportResult\.png/);
      // the old unconditional call must be gone
      expect(src).not.toMatch(/uploadReportPDF\(\s*bufferToUpload/);
    });

    it('still delivers the hero report to WhatsApp as an image', () => {
      expect(src).toMatch(/sendImage\(/);
    });
  });

  describe('dashboard report proxy', () => {
    const src = read('dashboard/index.js');

    it('does not hardcode application/pdf when serving the report', () => {
      expect(src).toMatch(/isPng\s*\?\s*'image\/png'\s*:\s*'application\/pdf'/);
    });
  });
});
