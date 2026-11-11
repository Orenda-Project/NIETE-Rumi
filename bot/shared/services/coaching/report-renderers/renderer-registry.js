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
 *   - html   : the legacy MEWAKA Playwright HTML→PDF path (hero focus
 *              area + 6-domain Swahili scorecard + inline SVG sparkline).
 *              Kept as an escape hatch for cloners who want the older
 *              MEWAKA-PDF format; no framework currently dispatches to
 *              it. Wave-4 may remove once we confirm no adopters need it.
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
const makeHeroRenderer = (brand) => ({
  key: brand ? `hero-${brand}` : 'hero',
  async render(input) {
    const { generateHeroReport } = require('../report-v2/hero-report.service');
    const hero = (input && input._heroInput) || input;
    const opts = brand ? { ...(hero.opts || {}), brand } : (hero.opts || {});
    try {
      return await generateHeroReport(hero.session, hero.analysis, opts);
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
});

const heroRenderer = makeHeroRenderer();

/**
 * FICO = the NIETE/ICT deployment's framework, so its hero report carries the
 * NIETE brand (Green #47BA7D + Charcoal #32373C, bd-2452) instead of the
 * default palette. Branding is an opts-level concern: the renderer injects
 * `brand: 'niete'` and the hero template picks the matching palette.
 *
 * bd-2453: HERO_BRANDS is the single source of truth for framework → brand.
 * `heroBrandFor()` is exported for callers that render the hero report
 * DIRECTLY (the observe teacher-report path bypasses the registry), so the
 * same session can never be branded on one surface and unbranded on another.
 */
// bd-ra8xu.39: a FICO17 v6 visit is NIETE's too. bd-pni007: so is an FDE (obs612) visit, every tool.
const OBS612 = require('../frameworks/obs612');
const HERO_BRANDS = { fico: 'niete', fico17_v6: 'niete', ...Object.fromEntries(Object.values(OBS612.IDS).map((id) => [id, 'niete'])) };

function heroBrandFor(frameworkKey) {
  return HERO_BRANDS[String(frameworkKey || '').toLowerCase()];
}

/**
 * bd-pni007: an FDE (obs612) visit renders FDE's own report (generateHeroReport → report-v2/obs612-report.js), on the
 * NIETE brand. No PDFKit fallback: that layout is FICO's (a total, a %, goal bars) and would print FDE's levels and
 * Yes counts as FICO numbers. A failure is the caller's to handle, as on the observe send path.
 */
const obs612Renderer = {
  key: 'obs612',
  async render(input) {
    const { generateHeroReport } = require('../report-v2/hero-report.service');
    const hero = (input && input._heroInput) || input;
    return generateHeroReport(hero.session, hero.analysis, { ...(hero.opts || {}), brand: HERO_BRANDS[OBS612.IDS.gen] });
  },
};

const ficoNieteHeroRenderer = makeHeroRenderer(HERO_BRANDS.fico);

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
  oecd:   heroRenderer,
  hots:   heroRenderer,
  teach:  heroRenderer,
  fico:   ficoNieteHeroRenderer,
  fico17_v6: ficoNieteHeroRenderer,
  mewaka: heroRenderer,
  // bd-pni007: the three FDE tools (this version's ids; an unknown version falls to the default like any unknown key).
  ...Object.fromEntries(Object.values(OBS612.IDS).map((id) => [id, obs612Renderer])),
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

module.exports = { getReportRenderer, heroBrandFor };
