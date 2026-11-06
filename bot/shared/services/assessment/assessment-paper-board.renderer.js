'use strict';
/**
 * G6-12 board paper (the child's copy) as HTML (SPEC §9).
 * Reads `exam._layout` (board-layout.js) and the items; prints no tag, key, answer or scheme.
 * "Page n of N" is the PDF footer's (board-render/print.js), not the page body's.
 */
const { layoutOf, itemsBySlot, isRtl, langOf } = require('./board-render/layout');
const { css } = require('./board-render/css');
const { headerBlock, bubbleBlock } = require('./board-render/header');
const { sectionBlock } = require('./board-render/items');

function renderBoardPaper(exam) {
  const layout = layoutOf(exam);
  const rtl = isRtl(layout);
  const lang = langOf(layout);
  const by = itemsBySlot(exam);
  const body = layout.sections.map((s) => sectionBlock(layout, s, by, { rtl, lang })).join('');
  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${css(rtl)}</style></head><body>`
    + `${headerBlock(layout, lang)}${bubbleBlock(layout, lang)}${body}</body></html>`;
}

module.exports = { renderBoardPaper };
