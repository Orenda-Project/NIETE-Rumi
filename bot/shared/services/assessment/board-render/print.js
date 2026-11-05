'use strict';
/**
 * How a G9-12 board paper becomes a PDF (bd-5jmnfj.38.25.3): Chromium's footer prints "Page n of N" in the
 * paper's medium (its fonts embedded: a footer loads none of the page's), and the paper's total marks.
 * The orchestrator picks these for a `_layout.profile === 'board'` paper in place of the FDE renderer's.
 */
const { layoutOf, isRtl, langOf } = require('./layout');
const { facesCss } = require('./css');

// ur: needs fluent-Urdu review (design_pending)
const PAGE = { en: 'Page {n} of {N}', ur: 'صفحہ {n} از {N}' };
const SCHEME = { en: 'Marking Scheme', ur: 'مارکنگ اسکیم' };

function boardLayout(examJson) {
  const L = layoutOf(examJson);
  if (L.profile !== 'board') {
    const err = new Error('NO_LAYOUT: not a board paper');
    err.code = 'NO_LAYOUT';
    throw err;
  }
  return L;
}

function pdfOptions(examJson, kind) {
  const L = boardLayout(examJson);
  const rtl = isRtl(L);
  const lang = langOf(L);
  const page = PAGE[lang].replace('{n}', '<span class="pageNumber"></span>').replace('{N}', '<span class="totalPages"></span>');
  const text = kind === 'scheme' ? `${SCHEME[lang]} · ${page}` : page;
  const font = rtl ? "font-family:'PaperUrdu';font-size:8.5pt;line-height:1.7" : "font-family:'PaperLatin';font-size:7.5pt";
  const body = `<div${rtl ? ' dir="rtl"' : ''} style="width:100%;${font};text-align:center;color:#333;padding:0 14mm">${text}</div>`;
  return {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<style>${facesCss(rtl)}</style>${body}`,
    margin: { top: '14mm', right: '14mm', bottom: rtl ? '22mm' : '18mm', left: '14mm' },
  };
}

/** The paper's total: its sections' marks, summed in quarters (FBISE halves and quarters). */
function totalMarks(examJson) {
  const L = boardLayout(examJson);
  return L.sections.reduce((n, s) => n + Math.round(Number(s.marks) * 4), 0) / 4;
}

module.exports = { pdfOptions, totalMarks };
