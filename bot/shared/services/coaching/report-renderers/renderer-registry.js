/**
 * Report Renderer Registry
 *
 * Routes framework key → the renderer that produces its coaching report.
 * A renderer is `{ render(reportData) -> Promise<Buffer> }`.
 *
 * Today there are two renderers:
 *   - pdfkit : the hardcoded ~1100-line PDFKit layout shared by
 *              OECD / HOTS / TEACH / FICO (the default).
 *   - html   : MEWAKA's Playwright HTML→PDF path (hero focus area +
 *              6-domain Swahili scorecard + inline SVG sparkline), which
 *              doesn't fit the PDFKit layout.
 *
 * Adding a new framework's report design is now "register one line" here
 * (point a key at a renderer), not "edit an `if` in pdf-report.service.js".
 * Unknown frameworks fall back to the default PDFKit renderer.
 *
 * Mirrors the report-transformers/report-transformer-dispatch.js pattern:
 * an object map + lazy require so callers never pull a renderer they don't
 * use (e.g. the PDFKit path never pulls Playwright).
 */

const { logToFile } = require('../../../utils/logger');

// ─── Renderers (lazy require so unused renderers stay unloaded) ──────────

/**
 * Default renderer: the existing PDFKit layout. Wraps the PDFKit-only entry
 * on PDFReportService so output is byte-identical to the pre-registry path.
 */
const pdfkitRenderer = {
  key: 'pdfkit',
  render(reportData) {
    const PDFReportService = require('../../pdf-report.service');
    return PDFReportService._generatePDFKitReport(reportData);
  },
};

/**
 * MEWAKA renderer: the existing Playwright HTML→PDF path. Wraps the
 * HTML-only entry on PDFReportService so output is byte-identical.
 */
const htmlRenderer = {
  key: 'html',
  render(reportData) {
    const PDFReportService = require('../../pdf-report.service');
    return PDFReportService._generateMEWAKAReport(reportData, Date.now());
  },
};

// ─── Registry: framework key → renderer ──────────────────────────────────

const renderers = {
  oecd: pdfkitRenderer,
  hots: pdfkitRenderer,
  teach: pdfkitRenderer,
  fico: pdfkitRenderer,
  mewaka: htmlRenderer,   // Tanzania CPD — Playwright HTML→PDF report
};

const DEFAULT_RENDERER = pdfkitRenderer;

/**
 * Get the report renderer for a given framework key.
 * @param {string} frameworkKey - Framework key (oecd, hots, teach, fico, mewaka)
 * @returns {{ render: (reportData: object) => Promise<Buffer> }} Renderer
 */
function getReportRenderer(frameworkKey) {
  const renderer = renderers[frameworkKey];
  if (!renderer) {
    logToFile(`[report-renderer-registry] Unknown framework "${frameworkKey}", falling back to default (pdfkit) renderer`);
    return DEFAULT_RENDERER;
  }
  return renderer;
}

module.exports = { getReportRenderer };
