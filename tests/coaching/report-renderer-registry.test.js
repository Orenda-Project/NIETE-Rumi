/**
 * Report Renderer Registry — Conformance Tests
 *
 * The coaching report renderer is pluggable per framework via
 * bot/shared/services/coaching/report-renderers/renderer-registry.js.
 * Today: OECD/HOTS/TEACH/FICO render via the shared PDFKit layout and
 * MEWAKA renders via the Playwright HTML→PDF path. Adding a framework's
 * report design should be "register one line" in the registry, NOT editing
 * a hardcoded `if (framework === 'x')` branch in pdf-report.service.js.
 *
 * These tests lock the seam in place: if someone reintroduces a hardcoded
 * framework equality check in pdf-report.service.js, the grep assertion
 * below FAILS.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

const {
  getReportRenderer,
} = require('../../bot/shared/services/coaching/report-renderers/renderer-registry');

const PDF_REPORT_SERVICE_PATH = path.join(
  __dirname,
  '../../bot/shared/services/pdf-report.service.js'
);

describe('Report Renderer Registry — getReportRenderer()', () => {
  test('returns a renderer with a render() method', () => {
    const renderer = getReportRenderer('oecd');
    expect(renderer).toBeDefined();
    expect(typeof renderer.render).toBe('function');
  });

  describe('PDFKit renderer for the pdfkit-layout frameworks', () => {
    for (const framework of ['oecd', 'hots', 'teach', 'fico']) {
      test(`"${framework}" maps to the PDFKit renderer`, () => {
        const renderer = getReportRenderer(framework);
        expect(renderer.key).toBe('pdfkit');
      });
    }

    test('oecd/hots/teach/fico all share ONE PDFKit renderer instance', () => {
      const oecd = getReportRenderer('oecd');
      expect(getReportRenderer('hots')).toBe(oecd);
      expect(getReportRenderer('teach')).toBe(oecd);
      expect(getReportRenderer('fico')).toBe(oecd);
    });
  });

  describe('HTML renderer for MEWAKA', () => {
    test('"mewaka" maps to the HTML (Playwright) renderer', () => {
      const renderer = getReportRenderer('mewaka');
      expect(renderer.key).toBe('html');
    });

    test('the MEWAKA renderer is NOT the PDFKit renderer', () => {
      expect(getReportRenderer('mewaka')).not.toBe(getReportRenderer('oecd'));
    });
  });

  describe('Unknown frameworks fall back to the default', () => {
    test('an unknown framework falls back to the PDFKit (default) renderer', () => {
      const fallback = getReportRenderer('does-not-exist');
      expect(fallback.key).toBe('pdfkit');
      expect(fallback).toBe(getReportRenderer('oecd'));
    });

    test('undefined framework falls back to the PDFKit (default) renderer', () => {
      expect(getReportRenderer(undefined).key).toBe('pdfkit');
    });
  });

  describe('No hardcoded framework fork in pdf-report.service.js', () => {
    const source = fs.readFileSync(PDF_REPORT_SERVICE_PATH, 'utf8');

    test('source contains no hardcoded `framework === "mewaka"` equality', () => {
      // Tolerant of single/double quotes and whitespace around `===`.
      const hardcodedMewaka = /framework\s*===\s*['"]mewaka['"]/;
      expect(hardcodedMewaka.test(source)).toBe(false);
    });

    test('source contains no hardcoded equality against ANY framework key', () => {
      const hardcodedAnyFramework = /framework\s*===\s*['"](oecd|hots|teach|fico|mewaka)['"]/;
      expect(hardcodedAnyFramework.test(source)).toBe(false);
    });

    test('source dispatches through the renderer registry', () => {
      expect(source).toMatch(/getReportRenderer/);
    });
  });
});
