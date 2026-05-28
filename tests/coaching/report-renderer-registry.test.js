/**
 * Report Renderer Registry — Conformance Tests
 *
 * The coaching report renderer is pluggable per framework via
 * bot/shared/services/coaching/report-renderers/renderer-registry.js.
 *
 * Default: ALL FIVE frameworks (OECD/HOTS/TEACH/FICO/MEWAKA) render via the
 * unified celebration ("hero") design. Unknown frameworks fall back to
 * PDFKit. The legacy htmlRenderer stays defined as a documented escape hatch
 * for cloners that want the older MEWAKA-PDF format; no framework currently
 * dispatches to it.
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

  describe('Hero renderer is the default for ALL five frameworks', () => {
    for (const framework of ['oecd', 'hots', 'teach', 'fico', 'mewaka']) {
      test(`"${framework}" maps to the hero renderer`, () => {
        const renderer = getReportRenderer(framework);
        expect(renderer.key).toBe('hero');
      });
    }

    test('all five frameworks share ONE hero renderer instance', () => {
      const oecd = getReportRenderer('oecd');
      expect(getReportRenderer('hots')).toBe(oecd);
      expect(getReportRenderer('teach')).toBe(oecd);
      expect(getReportRenderer('fico')).toBe(oecd);
      expect(getReportRenderer('mewaka')).toBe(oecd);
    });
  });

  describe('Unknown frameworks fall back to the PDFKit default', () => {
    test('an unknown framework falls back to the PDFKit (default) renderer', () => {
      const fallback = getReportRenderer('does-not-exist');
      expect(fallback.key).toBe('pdfkit');
    });

    test('undefined framework falls back to the PDFKit (default) renderer', () => {
      expect(getReportRenderer(undefined).key).toBe('pdfkit');
    });

    test('the PDFKit fallback is NOT the hero renderer', () => {
      expect(getReportRenderer('does-not-exist')).not.toBe(getReportRenderer('oecd'));
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
