'use strict';
/**
 * G6-12 board paper (the child's copy) as HTML (SPEC §9; HTML only, no PDF and not wired in yet).
 * Reads `exam._layout` (board-layout.js) and the items; prints no tag, key, answer or scheme.
 * Page {n} of {N} is a placeholder for the PDF stage to fill.
 */
const { layoutOf, itemsBySlot, isRtl, langOf } = require('./board-render/layout');
const { css } = require('./board-render/css');
const { headerBlock, bubbleBlock } = require('./board-render/header');
const { sectionBlock } = require('./board-render/items');

// ur: needs fluent-Urdu review (design_pending)
const PAGE = { en: 'Page {n} of {N}', ur: 'صفحہ {n} از {N}' };

function renderBoardPaper(exam) {
  const layout = layoutOf(exam);
  const rtl = isRtl(layout);
  const lang = langOf(layout);
  const by = itemsBySlot(exam);
  const body = layout.sections.map((s) => sectionBlock(layout, s, by, { rtl, lang })).join('');
  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${css(rtl)}</style></head><body>`
    + `${headerBlock(layout, lang)}${bubbleBlock(layout, lang)}${body}<div class="footer">${PAGE[lang]}</div></body></html>`;
}

module.exports = { renderBoardPaper };
