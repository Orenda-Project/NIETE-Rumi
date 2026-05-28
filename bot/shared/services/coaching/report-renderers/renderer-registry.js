/**
 * Report Renderer Registry
 *
 * Routes framework key → the renderer that produces its coaching report.
 * A renderer is `{ render(input) -> Promise<Buffer | {png, caption}> }`.
 *
 * Three renderers ship:
 *   - hero   : the unified celebration design (Playwright HTML → PNG +
 *              caption). DEFAULT for OECD / HOTS / TEACH / FICO; consumes
 *              an input of shape `{ session, analysis, opts }` and returns
 *              `{ png, caption }`.
 *   - pdfkit : the hardcoded PDFKit layout. Kept as the fallback for
 *              unknown frameworks (so a clone that adds a new framework
 *              key still renders something), and as the safety net the
 *              report-generator falls back to if the hero render rejects.
 *   - html   : MEWAKA's Playwright HTML→PDF path (hero focus area +
 *              6-domain Swahili scorecard + inline SVG sparkline). Kept
 *              as the active MEWAKA renderer in OSS — MEWAKA does not yet
 *              ship a `mewaka-framework.js` module, so the hero renderer's
 *              score adapter cannot produce groups for it. Add the
 *              framework module + a `mewaka-adapter.js` to flip mewaka
 *              onto `heroRenderer` in a follow-up.
 *
 * Adding a new framework's report design is "register one line" here
 * (point a key at a renderer), not "edit an `if` in pdf-report.service.js".
 *
 * Mirrors the report-transformers/report-transformer-dispatch.js pattern:
 * an object map + lazy require so callers never pull a renderer they don't
 * use (e.g. the PDFKit path never pulls Playwright).
 */

const { logToFile } = require('../../../utils/logger');

// ─── Renderers (lazy require so unused renderers stay unloaded) ──────────

/**
 * Hero renderer: the unified celebration design. Returns { png, caption } on
 * success, OR a PDFKit Buffer if the hero pipeline throws (graceful fallback
 * so a Chromium crash / narrative-LLM failure / font miss never leaves the
 * teacher with no report).
 *
 * Accepts either a hero-shaped input `{ session, analysis, opts }` directly,
 * OR a legacy `reportData` object with the hero input attached at
 * `reportData._heroInput` (the side-channel used by report-generator so the
 * PDFKit / HTML renderers can keep their reportData contract unchanged).
 */
const heroRenderer = {
  key: 'hero',
  async render(input) {
    const { generateHeroReport } = require('../report-v2/hero-report.service');
    const hero = (input && input._heroInput) || input;
    try {
      return await generateHeroReport(hero.session, hero.analysis, hero.opts || {});
    } catch (err) {
      logToFile('[renderer-registry] hero render failed → PDFKit fallback', {
        framework: hero.analysis && hero.analysis.framework,
        error: err && err.message,
      });
      // Fall back to the PDFKit layout. report-generator passes the full
      // PDFKit-shaped reportData as the top-level argument, so the renderer
      // can route to it directly.
      return pdfkitRenderer.render(input);
    }
  },
};

/**
 * Default renderer (fallback): the existing PDFKit layout. Wraps the PDFKit-only
 * entry on PDFReportService so output is byte-identical to the pre-registry path.
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
  oecd:  heroRenderer,
  hots:  heroRenderer,
  teach: heroRenderer,
  fico:  heroRenderer,
  mewaka: htmlRenderer, // see file-header note; flip in a follow-up after
                        // adding `mewaka-framework.js` + a `mewaka-adapter.js`
};

const DEFAULT_RENDERER = pdfkitRenderer;

/**
 * Get the report renderer for a given framework key.
 * @param {string} frameworkKey - Framework key (oecd, hots, teach, fico, mewaka)
 * @returns {{ key:string, render:(input:object) => Promise<Buffer|{png,caption}> }}
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
