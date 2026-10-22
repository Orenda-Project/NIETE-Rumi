/**
 * Child-test stimulus — the child's cards (bd-s1oo0.2, lane L2).
 *
 *   renderInlineCards({ grade, form, block, variant })  → chat-sized PNG cards, in send order
 *   renderPrintableCard({ grade, form })                → A4 PDF: Urdu, English, Maths, fallback, maths strip
 *   renderCoachSheet({ grade, form, lang })             → A4 PDF: the numbered coach copy with answer keys
 *
 * Upload and presign live in ./upload (stimulus keys in R2; a send always presigns).
 */

const { htmlToElementImages, htmlToPdf } = require('../../../utils/html-to-pdf');
const { logToFile } = require('../../../utils/logger');
const html = require('./html');
const S = require('./sizing');
const { resolveForm } = require('./source');

// The one quick-sums setting (item bank + sandbox override); a bank fixture without the accessor uses its own value.
function quickSumsSecondsFor(grade, form) {
  try { return require('../item-bank').quickSumsSeconds(grade, form); } catch (err) { return undefined; }
}

/**
 * @returns {Promise<Array<{part: string, index: number, png: Buffer, text: string, lines: number|null, widthPx: number, heightPx: number}>>}
 *   parts, in order: story (several), then nonwords — or numbers, quick_sums for maths — or
 *   fallback_letters, fallback_words for variant 'fallback'.
 */
async function renderInlineCards({ grade, form, block, variant = 'main', itemBank } = {}) {
  const { data } = resolveForm({ grade, form, itemBank });
  const page = html.buildInlineHtml({ grade: Number(grade), formCode: form, block, form: data, variant });
  const shots = await htmlToElementImages(page, { width: S.CARD_CSS_WIDTH, deviceScaleFactor: S.DEVICE_SCALE, selector: '.card' });
  logToFile('child_test.stimulus_rendered', { grade, form, block, variant, cards: shots.length });
  return shots.map((s, i) => ({ part: s.part, index: i + 1, png: s.png, text: s.text, lines: s.lines, widthPx: s.widthPx, heightPx: s.heightPx }));
}

async function renderPdf(page, onReport) {
  return htmlToPdf(page, {
    beforeCapture: true,
    onBeforeCapture: onReport,
    pdfOptions: { preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } },
  });
}

/**
 * @param {{grade:number, form:string, itemBank?:object, onLayout?:function}} a
 *   onLayout receives { overflow: [pageIds], scales, pages } from the in-page fit pass.
 * @returns {Promise<Buffer>}
 */
async function renderPrintableCard({ grade, form, itemBank, onLayout } = {}) {
  const { data } = resolveForm({ grade, form, itemBank });
  const page = html.buildPrintableHtml({ grade: Number(grade), formCode: form, form: data });
  let report = null;
  const pdf = await renderPdf(page, (r) => { report = r; if (onLayout) onLayout(r); });
  if (report && report.overflow && report.overflow.length) {
    logToFile('child_test.stimulus_print_overflow', { grade, form, pages: report.overflow });
  }
  return pdf;
}

/** @returns {Promise<Buffer>} */
async function renderCoachSheet({ grade, form, lang = 'ur', itemBank } = {}) {
  const { data, cue } = resolveForm({ grade, form, itemBank });
  const page = html.buildCoachSheetHtml({ grade: Number(grade), formCode: form, form: data, lang, cue: cue || {},
    quickSumsSeconds: quickSumsSecondsFor(grade, form) });
  // The sheet's own @page margin governs; htmlToPdf's default 50px margin on top of it clipped the right edge.
  return htmlToPdf(page, { pdfOptions: { preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } } });
}

module.exports = {
  renderInlineCards,
  renderPrintableCard,
  renderCoachSheet,
  legibility: S.legibility,
  buildInlineHtml: html.buildInlineHtml,
  buildPrintableHtml: html.buildPrintableHtml,
  buildCoachSheetHtml: html.buildCoachSheetHtml,
};
