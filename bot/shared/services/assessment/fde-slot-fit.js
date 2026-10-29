'use strict';
/**
 * Page fit for Grade 1-2 picture slots (bd-5jmnfj.4.58.4).
 *
 * v28 marked a slot of six items or fewer `short` (break-inside: avoid), but Chromium ignores that on a
 * block taller than a page, and G1 English Q8 (four scenes), Q11 (five objects) and Q12 (five sentence
 * boxes) each measured taller than the 270 mm a page holds. So a short picture slot's pictures are sized
 * to the room its items leave, and the slot then moves whole. A longer picture grid is cut into lines of
 * three, and the last two lines are one block, so a lone line never sits on a page of its own.
 *
 * Pure: numbers and strings in, strings out.
 */

const PAGE_BUDGET_MM = 245; // what a slot may take of the ~270 mm of a page, the rest is the page's own margin
const HEAD_MM = 10;
const ITEM_MM = 25; // stem line, margins and one-line answer box under a picture
const WIDE_ITEM_MM = 13; // number line and margins; the picture and its box sit side by side
const WIDE_BOX_MM = 28;
const PER_ROW = 3;
const FLOOR = 0.7; // a picture is never drawn under 70% of its size: below that it is not worth the fit

// The default heights in fde-picture-block's PICTURE_CSS.
const DEFAULT_MM = { object: 28, count: 14, dots: 24, clock: 24, shapes: 22, scene: 45, plant: 60, circuit: 62 };
const WIDE_PIC_MM = 44;

/** The estimated height of a slot of `n` items, in mm. */
function slotHeightMm({ n, pic, wide = false, perRow = 1 }) {
  if (wide) return HEAD_MM + n * (WIDE_ITEM_MM + Math.max(pic, WIDE_BOX_MM));
  return HEAD_MM + Math.ceil(n / perRow) * (ITEM_MM + pic);
}

/** The picture height that lets `n` items fit one page, or null when the default already fits or no fit is worth it. */
function fitHeightMm({ n, pic, wide = false, perRow = 1 }) {
  const lines = wide ? n : Math.ceil(n / perRow);
  const avail = Math.floor((PAGE_BUDGET_MM - HEAD_MM) / lines - (wide ? WIDE_ITEM_MM : ITEM_MM));
  if (avail >= pic) return null;
  return avail >= Math.round(pic * FLOOR) ? avail : null;
}

const defaultOf = (q, wide) => (wide ? WIDE_PIC_MM : DEFAULT_MM[q.picture && q.picture.kind] || 28);

/** ` style="--pic-fit:34mm"` for a short slot whose pictures need it, else ''. */
function fitAttr(live, { grid = false, wide = false, bubble = false } = {}) {
  const pics = live.filter((q) => q && q.picture);
  if (!pics.length || bubble) return '';
  const pic = Math.max(...pics.map((q) => defaultOf(q, wide)));
  const mm = fitHeightMm({ n: live.length, pic, wide, perRow: grid && !wide ? PER_ROW : 1 });
  return mm ? ` style="--pic-fit:${mm}mm"` : '';
}

/** One item that is a scene and the slot's only prompt, outside a frame and a speech bubble. */
function soloScene(live, { frame = false, bubble = false } = {}) {
  return !frame && !bubble && live.length === 1 && Boolean(live[0].picture) && live[0].picture.kind === 'scene';
}

/** Cells in lines of `perRow`; the last two lines (or all, when there are two or fewer) are one unbreakable block. */
function groupRows(cells, perRow = PER_ROW) {
  const rows = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(`<div class="pic-row">${cells.slice(i, i + perRow).join('')}</div>`);
  const keep = Math.min(2, rows.length);
  return rows.slice(0, rows.length - keep).join('') + `<div class="pic-tail">${rows.slice(rows.length - keep).join('')}</div>`;
}

const SLOT_FIT_CSS = `
  .pic img { max-height: var(--pic-fit, none); }
  .pic-row, .pic-tail { break-inside: avoid; }
  /* Three cells to a line: border-box keeps the start padding inside the width (content-box fitted two). */
  .q.pic-cell { box-sizing: border-box; width: calc(33.333% - 4.2mm); }
  .q.pic-cell.wide { display: grid; grid-template-columns: 56mm 1fr; column-gap: 4mm; align-items: center; width: 100%; }
  .q.pic-cell.wide > .n { grid-column: 1 / -1; }
  .q.pic-cell.wide > .pic { grid-column: 1; margin: 0; }
  .q.pic-cell.wide > .write-box { grid-column: 2; margin: 0; }
  .subq { break-inside: avoid; }
  .work-square { width: 100%; box-sizing: border-box; }
  .q.solo-scene .pic-scene { text-align: center; }
  .q.solo-scene .pic-scene img { height: auto; width: 130mm; max-width: 100%; max-height: none; }`;

module.exports = { slotHeightMm, fitHeightMm, fitAttr, soloScene, groupRows, SLOT_FIT_CSS, PER_ROW };
