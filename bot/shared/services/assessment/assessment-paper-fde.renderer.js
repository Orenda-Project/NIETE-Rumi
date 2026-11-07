'use strict';
/**
 * The board-pattern paper and its marking scheme.
 *
 * Only papers that carry `_layout` come here (the old renderer keeps every
 * other paper exactly as it was). Everything printed is decided by `_layout`,
 * the copy of the pattern made when the paper was generated: FDE's section
 * lines, its question lines with the counts recomputed from the questions
 * actually on the paper, its numbering, the student box, the teacher's
 * before-the-exam box and the legend.
 *
 * Three promises this file keeps:
 *   - No count is typed. Every count in a printed line is an atom in the
 *     pattern (`{w:eight}`, `{n:8}`, `{t:40}`) recomputed from the live items;
 *     the page total comes from Chromium's own footer, never the HTML.
 *   - No review text reaches paper. A string carrying a review mark or filler
 *     makes the render throw instead of print.
 *   - Urdu papers read right to left with Urdu digits, each number isolated so
 *     it keeps its own order, by one rule applied to every text node.
 *
 * Fonts are embedded (the printing Chromium has no system fonts) and the
 * footer repeats the page's @font-face rules exactly: a footer template font
 * loads only when the page declares the same face.
 *
 * Pure: strings in, strings out. `framePages` reads a finished PDF.
 */

const { bareOption, choiceLine, itemNumber, totalMarks, workSpace } = require('./fde-renderer/counts-options');
const { REFUSED_ITEM, substitute, toUrduDigits } = require('./fde-renderer/fonts-digits');
const { framePages } = require('./fde-renderer/frame-pages');
const { renderPaper } = require('./fde-renderer/render-paper');
const { pdfOptions, renderMarkingScheme } = require('./fde-renderer/render-scheme');

module.exports = {
  workSpace,
  renderPaper,
  renderMarkingScheme,
  totalMarks,
  choiceLine,
  pdfOptions,
  toUrduDigits,
  framePages,
  // the generation service re-asks a section whose item text hits this list
  REFUSED_ITEM,
  // for tests and the paper view
  substitute,
  itemNumber,
  bareOption,
};
