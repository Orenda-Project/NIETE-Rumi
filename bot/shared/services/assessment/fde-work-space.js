'use strict';
/*
 * How tall the child's working space is for one item, in mm, when the stem or the scheme asks for
 * more than the slot's ruled lines give (bd-5jmnfj.4.58.9.1, G5 Maths Q1 (b)):
 *  - a stem that asks the child to draw, construct or measure with a tool needs room for a
 *    protractor, ruler or compass: at least TOOL_MM;
 *  - an item whose scheme has an M (method) mark needs room for the working: at least METHOD_MM.
 * Pure: no I/O. Returns null when neither applies, so the caller keeps its own box.
 */
const TOOL_MM = 60;
const METHOD_MM = 40;

const ACT = /\b(draw|construct|measure|bisect)\b/i;
const TOOL = /\b(tools?|protractor|ruler|compass(?:es)?|set[- ]?squares?|dividers?)\b/i;

function asksToolDrawing(q) {
  const stem = String((q && q.question) || '');
  return ACT.test(stem) && TOOL.test(stem);
}

function hasMethodMark(q) {
  const pts = q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [];
  return pts.some((p) => p && p.kind === 'M');
}

function workMm(q) {
  if (q && Array.isArray(q.options) && q.options.length) return null;
  if (asksToolDrawing(q)) return TOOL_MM;
  if (hasMethodMark(q)) return METHOD_MM;
  return null;
}

module.exports = { workMm, asksToolDrawing, hasMethodMark, TOOL_MM, METHOD_MM };
