'use strict';
/**
 * D22 method-marks (Amena, 7 Nov 2026: SSC/HSSC science numericals earn method marks; she set no split). A numerical
 * constructed item of 2+ marks in physics, chemistry or biology, under analytic_points, needs a scheme point apart from
 * its final-answer point: a method/working step (formula, substitution, working). Hard ANSWER_ONLY when it has only one
 * point, or when every point states the final value, so the writer drops the item and the rewrite is told why (D22 in
 * section-prompt CHECK_FAULTS). Numerical = calc present, type/kind 'numerical', or a number with a unit in the answer.
 * An item with no points is D14's (NO_POINTS). Left after the rewrites it ships as a paper-level note (ship-notes). Pure.
 */
const { leaves } = require('./walk');
const { issue } = require('./common');
const { lastNumber } = require('./numeric-resolve');

const ID = 'D22';
const LIMITS = { minMarks: 2 }; // a 1-mark item cannot pay a method mark and an answer mark
const CODES = ['physics', 'chemistry', 'biology'];
// design_pending: the SI/board units a numerical answer ends in; extend when a subject brings another
const UNIT = /\d\s*(?:x\s*10\^-?\d+\s*)?(?:m\/s\^?2|m\/s|ms\^-1|km\/h|kg|g|mg|m|cm|mm|km|s|min|h|N|J|kJ|W|kW|kWh|Pa|kPa|Hz|V|A|mA|ohm|Ω|C|°C|K|mol|mol\/dm\^?3|dm\^?3|cm\^?3|L|mL|eV)(?![\p{L}\d])/u;

const MSG = 'numerical scheme has only a final-answer point; list method/working marks (formula, substitution, working) apart from the answer mark';

const pointsOf = (item) => (item.scheme && Array.isArray(item.scheme.points) ? item.scheme.points : []);
const isNumerical = (item) => !!item.calc || item.type === 'numerical' || item.kind === 'numerical' || UNIT.test(String(item.answer == null ? '' : item.answer));

// Every number a point states (a unit power such as m/s^2 is not one); a point stating only the final value is an answer point.
const numbersIn = (text) => (String(text == null ? '' : text).replace(/\^\s*[-+]?\d+(?:\.\d+)?/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number);

function answerOnly(item, pts) {
  if (pts.length < 2) return true;
  const value = lastNumber(item.answer);
  if (value == null) return false;
  return pts.every((p) => { const nums = numbersIn(p && p.text); return nums.length > 0 && nums.every((n) => n === value); });
}

function run(examJson, ctx) {
  const out = [];
  const code = ctx && ctx.subjectConfig && ctx.subjectConfig.code;
  const style = ctx && ctx.variant && ctx.variant.scheme_style;
  if (!CODES.includes(code) || style !== 'analytic_points') return { ok: true, issues: out };
  leaves(examJson).forEach(({ item, ref, slot }) => {
    if (Array.isArray(item.options) || Number(item.marks) < LIMITS.minMarks || !isNumerical(item)) return;
    const pts = pointsOf(item);
    if (!pts.length || !answerOnly(item, pts)) return;
    out.push(issue(ID, 'ANSWER_ONLY', ref, MSG, true, slot == null ? undefined : slot));
  });
  return { ok: !out.some((i) => i.hard), issues: out };
}

module.exports = { id: ID, name: 'method-marks', hard: true, modes: ['board'], LIMITS, MSG, run };
