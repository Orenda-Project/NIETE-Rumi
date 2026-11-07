'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Fit = require('../fde-slot-fit');
const V37 = require('../fde-render-v37'); // round 6 layout: marks, alphabet strip, ruled lines, passage reprint
const { clampLanguage } = require('../../../config/ux-strings');
const { matchOrder, bankOrder, matchTable, matchAnswer, matchStem, MATCH_CSS } = require('../fde-match-block');
const { oralSheet, childCard, ORAL_CSS } = require('../fde-oral-sheet');
const { pictureBlock, bubbleBlock, PICTURE_CSS } = require('../fde-picture-block');
const { assertCounts, itemsBySlot, layoutOf, totalMarks } = require('./counts-options');
const { esc, faces, refuseReviewText, substitute, textOf } = require('./fonts-digits');
const { sectionHead, slotBlock } = require('./item-blocks');

function schemeCss(medium) {
  const ur = medium === 'ur';
  const start = ur ? 'right' : 'left';
  return `
  .band { background: #000; color: #fff; text-align: center; font-weight: 700; padding: 3px 0; letter-spacing: ${ur ? '0' : '.06em'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .scheme-title { text-align: center; font-weight: 700; font-size: ${ur ? '13pt' : '12pt'}; letter-spacing: ${ur ? '0' : '.04em'}; }
  .covers { text-align: center; font-size: ${ur ? '10pt' : '9pt'}; margin-bottom: 6px; }
  .box { border: 1.5px solid #000; padding: 4px 8px; margin: 6px 0; break-inside: avoid; font-size: ${ur ? '11pt' : '9.5pt'}; }
  .box .bt { font-weight: 700; margin-bottom: 2px; }
  ${medium === 'ur' ? `@counter-style urdu-steps { system: numeric; symbols: '۰' '۱' '۲' '۳' '۴' '۵' '۶' '۷' '۸' '۹'; suffix: '۔ '; }
  .box ol { margin: 0; padding-${start}: 16px; list-style-type: urdu-steps; }` : `.box ol { margin: 0; padding-${start}: 16px; }`}
  .box ul { margin: 0; padding-${start}: 14px; }
  .s-head { font-weight: 700; border-bottom: 1.5px solid #000; margin: 8px 0 3px; break-after: avoid; }
  .strip { font-size: ${ur ? '11pt' : '9.5pt'}; margin: 2px 0 6px; break-inside: avoid; }
  .strip .sl { font-weight: 700; }
  .strip .sc { white-space: nowrap; }
  table.rows { width: 100%; border-collapse: collapse; font-size: ${ur ? '10.5pt' : '9pt'}; }
  table.rows td { border-bottom: 1px solid #ccc; padding: 3px 4px; vertical-align: top; }
  table.rows tr { break-inside: avoid; }
  table.rows tr.slot-row { break-after: avoid; }
  table.rows tr.slot-row td { border-bottom: 1px solid #000; padding-top: 6px; }
  td.n { width: 8%; font-weight: 700; white-space: nowrap; }
  td.ans { width: 42%; }
  td.pts { width: 50%; }
  .q-line { color: #444; font-size: .92em; }
  .pt { display: block; }
  .chip { display: inline-block; border: 1px solid #000; border-radius: 3px; padding: 0 3px; font-weight: 700; margin-${ur ? 'left' : 'right'}: 3px; font-family: 'PaperLatin', Arial, sans-serif; direction: ltr; unicode-bidi: isolate; }
  .acc, .err { display: block; color: #333; }
  .err { unicode-bidi: isolate; }
  .q-line .sq { width: 5mm; height: 4mm; margin: 0 1mm; }
  .crit { display: block; }
  .crit-m { font-weight: 700; }
  section.record { break-before: page; }
  .rec-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  table.rec { width: 100%; border-collapse: collapse; font-size: 8pt; line-height: 1.1; }
  table.rec th, table.rec td { border: 1px solid #000; height: 9mm; padding: 0 2px; text-align: center; }
  table.rec td.name { width: 32%; }
  .notes { margin-top: 8px; break-inside: avoid; }`;
}

// ── shared page chrome ─────────────────────────────────────────────────────

function css(medium, kind) {
  const ur = medium === 'ur';
  const start = ur ? 'right' : 'left';
  const end = ur ? 'left' : 'right';
  return `
  @page { size: A4; }
  ${faces(medium).join('\n')}
  html, body { margin: 0; padding: 0; }
  body { font-family: ${ur ? "'PaperUrdu','PaperLatin',serif" : "'PaperLatin',Arial,sans-serif"};
    font-size: ${ur ? '12.5pt' : '10.5pt'}; line-height: ${ur ? 2.0 : 1.45}; color: #000; }
  .num, .ascii, .ltr { direction: ltr; unicode-bidi: isolate; }
  .ascii, .ltr { font-family: 'PaperLatin', Arial, sans-serif; }
  .school { text-align: center; font-weight: 700; }
  .title { text-align: center; font-weight: 700; font-size: ${ur ? '13.5pt' : '12.5pt'}; margin-top: 2px; }
  .atoms { display: flex; justify-content: space-between; font-weight: 700; margin: 4px 0; }
  .note { border: 1px solid #000; padding: 4px 8px; font-size: ${ur ? '11pt' : '9.5pt'}; margin: 4px 0 8px; break-inside: avoid; }
  table.student { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: ${ur ? '11pt' : '9.5pt'}; }
  table.student td { border: 1px solid #000; padding: 3px 6px; height: 7mm; }
  table.student td.k { background: #f0f0f0; font-weight: 700; white-space: nowrap; width: 22%; }
  section.sec { break-inside: auto; }
  .sec-head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline; border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000; padding: 2px 0; margin: 10px 0 4px; break-after: avoid; font-weight: 700; }
  .sec-head .t { text-align: ${start}; font-weight: 400; }
  .sec-head .l { text-align: center; padding: 0 8px; }
  .sec-head .m { text-align: ${end}; font-weight: 400; }
  .sec-note { font-weight: 700; margin: 2px 0 6px; break-after: avoid; break-inside: avoid; }
  .slot { margin: 6px 0 4px; }
  .slot-head { display: flex; gap: 6px; align-items: baseline; font-weight: 700; margin: 6px 0 3px; break-after: avoid; break-inside: avoid; }
  .slot-head .ml { margin-${start}: auto; white-space: nowrap; font-weight: 700; }
  .slot-head .ins { font-weight: 700; }
  .slot-head .lab { white-space: nowrap; flex: none; }
  .q { margin: 3px 0 5px; padding-${start}: 6mm; break-inside: avoid; }
  /* A slot's last item never sits alone at the top of a page. */
  .slot > .q:last-child { break-before: avoid; }
  .q .n { display: inline-block; min-width: 6mm; margin-${start}: -6mm;${ur ? ' box-sizing: border-box; padding-left: 1.2mm;' : ''} }
  .q.qcont { padding-${start}: 0; }
  .q.qcont .n { margin-${start}: 0; font-weight: 700; min-width: 0; margin-${end}: 4px; }
  .opts { display: grid; gap: 1px 10px; margin: 2px 0 0; }
  .opts.four { grid-template-columns: repeat(4, 1fr); }
  .opts.two { grid-template-columns: repeat(2, 1fr); }
  .opt .ol { margin-${end}: 3px; }
  .work-box { border: 1px solid #555; margin: 3px 0 2px;
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 7.5mm, #bbb 7.5mm, #bbb 7.8mm); }
  .work-square { border: 1px solid #555; margin: 3px 0 2px; }
  /* Inset from the end: a border on the content edge is clipped from the PDF (bd-5jmnfj.4.20). */
  .write-box { border: 1.2px solid #000; margin: 2mm 0 1mm; margin-${end}: 0.5mm; }
  .sq { display: inline-block; width: 9mm; height: 7mm; border: 1.2px solid #000; vertical-align: middle; margin: 0 2mm; }
  .word-box.bank { display: flex; flex-wrap: wrap; justify-content: center; gap: 2mm 8mm; padding: 2mm 4mm; font-size: 13pt; break-after: avoid; break-inside: avoid; }
  /* Picture cells sit in lines, not a flex grid (bd-5jmnfj.4.50.6): Chromium starts a flex grid on
     its heading's page and pushes only the cells, so v22 left headings alone at a page foot. As
     lines, the first row moves with its heading; one row is enough on either side of a break. */
  .pic-grid { orphans: 1; widows: 1; }
  .q.pic-cell { display: inline-block; vertical-align: top; width: 30%; margin: 0 0 4mm; margin-inline-end: 4mm; break-inside: avoid; }
  /* border-box: the .q start padding is inside the 100%, so the box closes at the margin (bd-5jmnfj.4.58.2). */
  .q.pic-cell.wide { display: block; width: 100%; box-sizing: border-box; margin-inline-end: 0; }
  .q.pic-cell.wide .pic img { height: 44mm; }
  table.data { border-collapse: collapse; margin: 4px 0; }
  table.data th, table.data td { border: 1px solid #000; padding: 2px 10px; text-align: center; }
  table.data th { background: #f0f0f0; }
  svg.sym { width: .95em; height: .95em; vertical-align: -0.12em; margin: 0 .05em; }
  .frac { display: inline-flex; flex-direction: column; vertical-align: middle; font-size: 0.8em; line-height: 1; text-align: center; margin: 0 1px; }
  .frac sup, .frac sub { font-size: 1em; vertical-align: baseline; line-height: 1; }
  .frac sup { border-bottom: 1px solid #000; }
  .frame { position: relative; border: 1.2px solid #000; margin: 4px 0; break-inside: avoid; }
  .frame-anchor { position: absolute; inset: 0; }
  .frame-title { position: absolute; top: 2mm; ${start}: 3mm; font-size: ${ur ? '10pt' : '8.5pt'}; color: #555; }
  .frame-duty { position: absolute; top: 7mm; ${start}: 3mm; font-size: ${ur ? '9pt' : '8pt'}; color: #555; }
  .label-lines { position: absolute; ${end}: 3mm; top: 8mm; bottom: 3mm; display: flex; flex-direction: column; justify-content: space-around; width: 45mm; }
  .label-line { border-bottom: 1px solid #000; height: 6mm; }
  .label-line .num-l { font-size: 8pt; color: #555; }
  .word-box { border: 1px solid #000; padding: 2px 8px; margin: 3px 0; text-align: center; break-inside: avoid; }
  .word-line { margin: 3px 0; }
  ${V37.V37_CSS}
  .passage { border: 1px solid #888; padding: 4px 8px; margin: 3px 0 5px; text-align: justify; break-inside: avoid; }
  /* A passage and its parts are too tall to move as one block: the page may break between parts. */
  .q.comp { break-inside: auto; }
  .verse { text-align: center; margin: 3px 0 5px; }
  .part { margin: 4px 0; break-inside: avoid; }
  .part-head { display: flex; gap: 6px; align-items: baseline; font-weight: 700; }
  .part-head .ml { margin-${start}: auto; }
  .sub { margin: 2px 0 2px 0; padding-${start}: 6mm; }
  .sub .n { display: inline-block; min-width: 6mm; margin-${start}: -6mm;${ur ? ' box-sizing: border-box; padding-left: 1.2mm;' : ''} }
  .pick-row { display: flex; gap: 8px; align-items: baseline; margin: 2px 0; }
  .pick-k { min-width: 22mm; font-weight: 700; }
  .blank { display: inline-block; min-width: 28mm; border-bottom: 1px dashed #000; margin: 0 4px; font-size: 7pt; color: #777; }
  .ant-row { display: flex; gap: 14mm; margin: 2px 0; }
  .or { text-align: center; font-weight: 700; margin: 2px 0; break-before: avoid; break-after: avoid; }
  .slot.either { break-inside: avoid; }
  .slot.short { break-inside: avoid; }
  .or-lead, .alt { font-weight: 700; }
  .sit { margin-top: 3px; }
  ${ur ? `/* Nastaliq ascenders rise above the line box; without room above, a block
     that starts a page paints the tops of its letters at the foot of the page before. */
  .sec-head, .slot-head, .part-head, .q, .alt, .or-lead, .s-head, table.rows td { padding-top: .45em; }` : ''}
  .topics { display: flex; gap: 10mm; flex-wrap: wrap; }
  ${PICTURE_CSS}
  ${Fit.SLOT_FIT_CSS}
  ${MATCH_CSS}
  ${kind === 'scheme' ? schemeCss(medium) + ORAL_CSS : ''}`;
}

function headerBlock(L, ctx, total) {
  const lang = ctx.medium;
  const H = L.header;
  const box = H[`student_box_${lang}`] || H.student_box_en;
  const atoms = `<div class="atoms"><span>${textOf(H[`time_line_${lang}`] || '', ctx)}</span><span>${textOf(substitute(H[`total_line_${lang}`] || '', { w: total, n: total, t: total, g: total }, lang), ctx)}</span></div>`;
  return `<div class="school">${textOf(H[`school_line_${lang}`], ctx)}</div>
<div class="title">${textOf(H[`title_${lang}`], ctx)}</div>
${atoms}
${H[`note_${lang}`] ? `<div class="note">${textOf(H[`note_${lang}`], ctx)}</div>` : ''}
<table class="student">
  <tr><td class="k">${textOf(box[0], ctx)}</td><td colspan="3"></td></tr>
  <tr><td class="k">${textOf(box[1], ctx)}</td><td></td><td class="k">${textOf(box[2], ctx)}</td><td></td></tr>
  <tr><td class="k">${textOf(box[3], ctx)}</td><td>${textOf(String(total), ctx)}</td><td class="k">${textOf(box[4], ctx)}</td><td></td></tr>
</table>`;
}

function contextFor(L, subject, answerLines) {
  const key = String(L.subject || subject || '').toLowerCase();
  return {
    medium: clampLanguage(L.medium), maths: key === 'maths' || key === 'math' || key === 'mathematics', answerLines,
    ...(L.verse_source ? { verseSource: L.verse_source } : {}),
  };
}

/**
 * renderPaper({ examJson, grade, subject, answerLines }) → HTML.
 * Throws NO_LAYOUT, REVIEW_TEXT or PATTERN_SHORT_SLOT rather than print a wrong paper.
 */
function renderPaper({ examJson, grade, subject, answerLines = true, allowShort = false }) {
  const L = layoutOf(examJson);
  refuseReviewText(examJson, 'paper');
  const { all, live } = itemsBySlot(examJson, L);
  assertCounts(L, all, { allowShort });
  const ctx = contextFor(L, subject, answerLines);
  const total = totalMarks(examJson);
  const sections = L.sections.map((sec) => `<section class="sec" data-section="${esc(sec.id)}">${sectionHead(sec, live, ctx)}${sec.slots.map((slot) => slotBlock(slot, sec, all.get(slot.slot), ctx)).join('')}</section>`).join('\n');
  const lang = ctx.medium;
  return `<!DOCTYPE html>
<html lang="${lang}"${lang === 'ur' ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><title>${esc(L.header[`title_${lang}`] || '')}</title>
<style>${css(lang, 'paper')}</style></head>
<body data-grade="${esc(grade)}">
${headerBlock(L, ctx, total)}
${sections}
</body></html>`;
}

// ── the marking scheme ─────────────────────────────────────────────────────


function fill(template, values) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined || values[k] === null ? m : String(values[k])));
}

function shortLabel(label) {
  return String(label || '').replace(/^Q\.\s?/, 'Q').replace(/^(Q\d+)\.\s*\(/, '$1 (').replace(/[.:]\s*$/, '').trim();
}

/*
 * A frame the teacher fills from the book when no book page is confirmed
 * (the Social Studies map, a Science diagram whose page the item does not give): the scheme names the book's own map and prints no
 * page, rather than a page nobody has checked.
 */
const BOOK_SOURCE = {
  map: { en: "the book's outline map", ur: 'کتاب کا خاکہ نقشہ' }, // ur: needs fluent-Urdu review
  diagram: { en: "the book's diagram", ur: 'کتاب کا خاکہ' }, // ur: needs fluent-Urdu review
};

// How much of a question's stem the key column repeats. 110 cut mid-sentence on every G5 Maths
// Section C stem (v27, bd-5jmnfj.4.58.3); a two-line do-as-directed item reads whole (bd-5jmnfj.33.2).
const KEY_ECHO = 200;

// The rows the scheme pass wrote in code stay in `_layout.scheme_shortfall`; the key prints no note about them (panel, bd-5jmnfj.4.58.9.1).

// A supply whose item already prints a drawn picture: nothing for the teacher to add.
function pictured(live, supply) {
  const list = (live && live.get && live.get(supply.slot)) || [];
  return list.some((q) => q && q.picture && q.picture.src);
}

module.exports = {
  BOOK_SOURCE, KEY_ECHO, contextFor, css, fill, pictured, renderPaper, shortLabel,
};
