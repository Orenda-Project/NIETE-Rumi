'use strict';
/**
 * Transcript quiz — the three LP lint gates, ported to the quiz figure canvas.
 *
 * The LP lane fits a diagram to a 727px COLUMN and reads `requiredBox(svg,
 * {colPx})`'s width-only scale. A quiz figure sits in a BOX instead — 1080x565
 * minus the `.fig` padding — and the SVG is centred with
 * `width:auto;height:auto;max-width:100%;max-height:100%`, so it scales by
 * `min(boxW/vbW, boxH/vbH)`. A tall figure is height-bound: measuring it with
 * the LP lane's column-only formula reports a label far bigger than the child
 * actually sees. Every export here recomputes the scale from `requiredBox`'s
 * own `vbW`/`vbH`/`minFont` instead of passing it a `colPx`.
 *
 * Pure module: an SVG string in, a result out. No network, no DB, no logging.
 */

const { requiredBox } = require('../../../vendor/lp-v9/diagrams/lib/svg');
const { checkOverlaps, checkDegenerate } = require('../../../vendor/lp-v9/diagrams');
const { PNG_WIDTH, PNG_HEIGHT } = require('./transcript-quiz-figure');

// The `.fig` box in transcript-quiz-figure.js's figureHtml(): 1080x565 with
// `padding: 36px 32px`. The SVG is centred inside what padding leaves.
const BOX_W = PNG_WIDTH - 2 * 32;  // 1016
const BOX_H = PNG_HEIGHT - 2 * 36; // 493

const LABEL_FLOOR_PX = 13.5;
// A 1080-wide PNG is displayed at about 360 CSS px on a mid-range Android —
// reported alongside the canvas measurement, never enforced on its own.
const PHONE_CSS_WIDTH = 360;

/**
 * Does the smallest label in `svg` clear the legibility floor on the quiz
 * canvas? Mirrors the LP lane's FIGURE gate (lint_lp.js ~line 445), but scaled
 * to a box instead of a column.
 *
 * @param {string} svg
 * @param {string} [type] figure type, for the message; defaults to "figure"
 * @returns {?{renderedPx:number, floorPx:number, phonePx:number, minFont:number, vbW:number, vbH:number, message:string}}
 */
function labelFloorDefect(svg, type = 'figure') {
  let box;
  try {
    box = requiredBox(svg);
  } catch (_) {
    // no viewBox — already caught upstream as FIGURE_RENDER; not this gate's job.
    return null;
  }
  const { vbW, vbH, minFont } = box;
  if (!vbW || !vbH) return null;
  const scale = Math.min(BOX_W / vbW, BOX_H / vbH);
  const renderedPx = +(minFont * scale).toFixed(2);
  if (renderedPx >= LABEL_FLOOR_PX) return null;
  const phonePx = +((renderedPx * PHONE_CSS_WIDTH) / PNG_WIDTH).toFixed(2);
  return {
    renderedPx,
    floorPx: LABEL_FLOOR_PX,
    phonePx,
    minFont,
    vbW,
    vbH,
    message: `the ${type} figure renders its smallest label at ${renderedPx}px on the 1080px picture (floor ${LABEL_FLOOR_PX}px, about ${phonePx}px on the child's phone) — fewer ticks, shorter labels, or a simpler spec`,
  };
}

/**
 * Zero-tolerance label/box collision check, wrapping the engine's own
 * `checkOverlaps`.
 *
 * @param {string} svg
 * @param {string} [type] figure type, for the message; defaults to "figure"
 * @returns {?{pairs:Array, first:{kind:string,a:string,b:string,detail:string}, message:string}}
 */
function overlapDefect(svg, type = 'figure') {
  let pairs;
  try {
    pairs = checkOverlaps(svg);
  } catch (_) {
    return null;
  }
  if (!pairs || !pairs.length) return null;
  const p = pairs[0];
  const first = { kind: p.kind, a: p.a, b: p.b, detail: p.detail };
  return {
    pairs,
    first,
    message: `the ${type} figure has ${pairs.length} unreadable label(s) — ${first.kind} between ${first.a} and ${first.b}; simplify it or shorten the labels`,
  };
}

/**
 * Sliver / flat / empty check, wrapping the engine's own `checkDegenerate`.
 *
 * @param {string} svg
 * @param {string} [type] figure type, for the message; defaults to "figure"
 * @returns {?{rows:Array, first:{kind:string,detail:string}, message:string}}
 */
function degenerateDefect(svg, type = 'figure') {
  let rows;
  try {
    rows = checkDegenerate(svg);
  } catch (_) {
    return null;
  }
  if (!rows || !rows.length) return null;
  const first = { kind: rows[0].kind, detail: rows[0].detail };
  const verb = first.kind === 'empty'
    ? 'draws almost nothing'
    : `draws a ${first.kind} shape a child cannot read as one`;
  return {
    rows,
    first,
    message: `the ${type} figure ${verb} — ${first.detail}; give it real area, or simplify the spec`,
  };
}

/**
 * Every gate defect a figure carries, in the fixed order label-floor →
 * overlap → degenerate. The validator decides what to do with what comes
 * back (fail, retry, log).
 *
 * @param {string} svg
 * @param {string} [type] figure type, for the messages
 * @returns {Array<{code:string, message:string}>}
 */
function figureGateDefects(svg, type = 'figure') {
  const out = [];
  const label = labelFloorDefect(svg, type);
  if (label) out.push({ code: 'FIGURE_LABEL_SMALL', message: label.message });
  const overlap = overlapDefect(svg, type);
  if (overlap) out.push({ code: 'FIGURE_OVERLAP', message: overlap.message });
  const degenerate = degenerateDefect(svg, type);
  if (degenerate) out.push({ code: 'FIGURE_DEGENERATE', message: degenerate.message });
  return out;
}

module.exports = {
  BOX_W,
  BOX_H,
  LABEL_FLOOR_PX,
  PHONE_CSS_WIDTH,
  labelFloorDefect,
  overlapDefect,
  degenerateDefect,
  figureGateDefects,
};
