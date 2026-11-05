'use strict';
/**
 * G6-12 board marking scheme (the teacher's copy) as HTML (SPEC §9; HTML only, not wired in yet).
 * Header and legend come from `_layout`; per item the key or model answer, the scheme (points or bands),
 * Bloom's level / official SLO when tagged, teacher-marked criteria, then a class record table.
 */
const { layoutOf, itemsBySlot, isRtl, langOf } = require('./board-render/layout');
const { css } = require('./board-render/css');
const { headerBlock } = require('./board-render/header');
const { schemeSection, classRecord } = require('./board-render/scheme-items');
const { textOf } = require('./board-render/text');

// ur: needs fluent-Urdu review (design_pending)
const TITLE = { en: 'Marking Scheme', ur: 'مارکنگ اسکیم' };

function legendBlock(layout, lang, rtl) {
  const lg = layout.legend;
  if (!lg) return '';
  const lines = (lg[`lines_${lang}`] || []).map((l) => `<li>${textOf(l, rtl)}</li>`).join('');
  return `<div class="legend"><b>${textOf(lg[`title_${lang}`] || '', rtl)}</b><ul>${lines}</ul></div>`;
}

function renderBoardScheme(exam) {
  const layout = layoutOf(exam);
  const rtl = isRtl(layout);
  const lang = langOf(layout);
  const ctx = { rtl, lang };
  const by = itemsBySlot(exam);
  const body = layout.sections.map((s) => schemeSection(layout, s, by, ctx)).join('');
  return `<!DOCTYPE html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${css(rtl)}</style></head><body>`
    + `${headerBlock(layout, lang)}<h2 class="hdr">${TITLE[lang]}</h2>${legendBlock(layout, lang, rtl)}${body}${classRecord(layout, ctx)}</body></html>`;
}

module.exports = { renderBoardScheme };
