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
// Stem line, margins and one-line answer box under a picture, as Chromium measures them (v37r4 G1 Urdu:
// 51.1 mm item - 22 mm picture = 29.1 mm; 25 left five fitted items at 272.5 mm, over the 263 mm page).
const ITEM_MM = 29.5;
const GRID_ITEM_MM = 25; // a line of cells side by side (two or three to a line): G1 Maths Q8 measured 232 mm for 3 lines of 50 mm pictures
// Number line (13.5 mm) and the cell's 4 mm bottom margin; the picture and its box sit side by side. Measured on
// G1 Urdu Q10 (v37r4): five cells at 47.5 mm with a 34 mm picture, the slot 265 mm against the 13 mm assumed.
const WIDE_ITEM_MM = 17.5;
const WIDE_BOX_MM = 28;
const PER_ROW = 3;
const FLOOR = 0.6; // a picture is never drawn under 60% of its size: below that it is not worth the fit

// The default heights in fde-picture-block's PICTURE_CSS.
const DEFAULT_MM = { object: 28, count: 14, dots: 24, clock: 24, shapes: 22, scene: 45, plant: 60, circuit: 62 };
const WIDE_PIC_MM = 44;
// v29 G1 Maths Q8: five compare scenes one to a line measured 360 mm and split over two pages. Two to a
// line take three lines of 75 mm, and each scene prints larger than the 45 mm it had (bd-5jmnfj.4.58).
const PAIR_SCENE_MM = 50;
const PAIR = 2;

/** The estimated height of a slot of `n` items, in mm. */
function slotHeightMm({ n, pic, wide = false, perRow = 1 }) {
  if (wide) return HEAD_MM + n * (WIDE_ITEM_MM + Math.max(pic, WIDE_BOX_MM));
  return HEAD_MM + Math.ceil(n / perRow) * ((perRow > 1 ? GRID_ITEM_MM : ITEM_MM) + pic);
}

// A written slot is kept whole only when it fits one page (bd-5jmnfj.33.8.1). Calibrated on the v42
// sandbox renders: G4 Maths Q3 (four 52 mm boxes) and Q5 (three 68 mm boxes, one-line English stems)
// fit; G3 GK Q5 (three 68 mm boxes, two-line Urdu stems) and G4 Science Q5 (four 68 mm boxes) do not.
const WRITE_BUDGET_MM = 258;
const ITEM_GAP_MM = 4;
const LINE_MM = { en: 5, ur: 9 };
const CHARS_PER_LINE = { en: 100, ur: 85 };

/** True when written items with these stems, each over a `boxMm` answer box, fit one page. */
function writeSlotFits({ stems = [], boxMm = 0, ur = false }) {
  const lang = ur ? 'ur' : 'en';
  const text = stems.reduce((mm, s) => mm + LINE_MM[lang] * Math.max(1, Math.ceil(String(s || '').length / CHARS_PER_LINE[lang])), 0);
  return HEAD_MM + text + stems.length * (boxMm + ITEM_GAP_MM) <= WRITE_BUDGET_MM;
}

/** The picture height that lets `n` items fit one page, or null when the default already fits or no fit is worth it. */
function fitHeightMm({ n, pic, wide = false, perRow = 1 }) {
  const lines = wide ? n : Math.ceil(n / perRow);
  const avail = Math.floor((PAGE_BUDGET_MM - HEAD_MM) / lines - (wide ? WIDE_ITEM_MM : (perRow > 1 ? GRID_ITEM_MM : ITEM_MM)));
  if (avail >= pic) return null;
  return avail >= Math.round(pic * FLOOR) ? avail : null;
}

const defaultOf = (q, wide, pair) => (wide ? WIDE_PIC_MM : (pair ? PAIR_SCENE_MM : DEFAULT_MM[q.picture && q.picture.kind] || 28));

/** ` style="--pic-fit:34mm"` for a short slot whose pictures need it, else ''. */
function fitAttr(live, { grid = false, wide = false, bubble = false, pair = false } = {}) {
  const pics = live.filter((q) => q && q.picture);
  if (!pics.length || bubble) return '';
  const pic = Math.max(...pics.map((q) => defaultOf(q, wide, pair)));
  const perRow = pair ? PAIR : (grid && !wide ? PER_ROW : 1);
  const mm = fitHeightMm({ n: live.length, pic, wide, perRow });
  return mm ? ` style="--pic-fit:${mm}mm"` : '';
}

/** One item that is a scene and the slot's only prompt, outside a frame and a speech bubble. */
function soloScene(live, { frame = false, bubble = false } = {}) {
  return !frame && !bubble && live.length === 1 && Boolean(live[0].picture) && live[0].picture.kind === 'scene';
}

/**
 * Two or more items that are each a scene, a stem and an answer box (no options, sub-questions, table or
 * passage), outside a frame and a speech bubble: they print two to a line (v29 G1 Maths Q8).
 */
function sceneGrid(live, { frame = false, bubble = false, mcq = false } = {}) {
  if (frame || bubble || mcq || live.length < 2) return false;
  return live.every((q) => q && q.picture && q.picture.kind === 'scene'
    && !(Array.isArray(q.options) && q.options.length) && !(Array.isArray(q.questions) && q.questions.length)
    && !q.table && !q.passage);
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
  .q.pic-cell.pair { width: calc(50% - 4.2mm); }
  .q.pic-cell.pair .pic-scene img { height: 50mm; }
  .q.pic-cell.wide { display: grid; grid-template-columns: 56mm 1fr; column-gap: 4mm; align-items: center; width: 100%; }
  .q.pic-cell.wide > .n { grid-column: 1 / -1; }
  .q.pic-cell.wide > .pic { grid-column: 1; margin: 0; }
  .q.pic-cell.wide > .write-box { grid-column: 2; margin: 0; }
  .subq { break-inside: avoid; }
  .work-square { width: 100%; box-sizing: border-box; }
  .q.solo-scene .pic-scene { text-align: center; }
  .q.solo-scene .pic-scene img { height: auto; width: 130mm; max-width: 100%; max-height: none; }`;

module.exports = { slotHeightMm, fitHeightMm, writeSlotFits, fitAttr, soloScene, sceneGrid, groupRows, SLOT_FIT_CSS, PER_ROW, PAIR, PAIR_SCENE_MM };
