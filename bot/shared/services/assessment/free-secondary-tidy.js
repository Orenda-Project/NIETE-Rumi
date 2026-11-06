'use strict';
/**
 * bd-5jmnfj.38.31 — a G6-12 free paper's marking points sometimes carry an instruction meant for the
 * writer, in brackets: "(بغیر نام دہرائے سوال میں)", "(do not repeat the question)". The panel reads
 * these as leaked prompt text. A bracket that reads as an instruction is removed from the marking
 * points, band descriptors and accept note; a bracketed answer ("(پشاوری)", "(CO2, water)", "(a)")
 * and a marking note ("(do not accept O2)") stay. scenarioParts makes a nested scenario item print its
 * parts. Pure: mutates the paper it is given, no I/O.
 */

const BRACKET = /\s*\(([^()]*)\)/g;
const INSTRUCTION = /\b(do not|don't|without|repeat(ing)?|in the question|write|full sentences|own words)\b|بغیر|سوال میں|دہرا|لکھیں|لکھیے/i;
const MARKING_NOTE = /\b(accept|award|credit|marks?)\b|قبول|نمبر/i;

function clean(text) {
  return String(text).replace(BRACKET, (whole, inner) =>
    (INSTRUCTION.test(inner) && !MARKING_NOTE.test(inner) ? '' : whole)).trim();
}

/** Strips writer instructions from every marking field; returns how many fields changed. */
function stripInstructions(examJson) {
  let changed = 0;
  const fix = (obj, key) => {
    if (!obj || typeof obj[key] !== 'string') return;
    const next = clean(obj[key]);
    if (next !== obj[key]) { obj[key] = next; changed += 1; }
  };
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.question === 'string' || typeof node.answer === 'string') {
      (Array.isArray(node.marking_points) ? node.marking_points : []).forEach((p) => fix(p, 'point'));
      (Array.isArray(node.mark_bands) ? node.mark_bands : []).forEach((b) => fix(b, 'descriptor'));
      fix(node, 'accept');
      if (Array.isArray(node.items)) visit(node.items);
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(examJson);
  return changed;
}

const PART_LABEL = /^\s*\(?[a-h][.)]\s*/i;

/**
 * A scenario item the writer gave nested parts (`questions`) but no passage prints only its scenario:
 * the renderer draws parts under a passage. The scenario becomes the passage, the item's instruction
 * its line, and each part loses the label the renderer adds again. Returns how many items changed.
 */
function scenarioParts(examJson) {
  let changed = 0;
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.question === 'string' && Array.isArray(node.questions) && node.questions.length && !node.passage) {
      node.passage = node.question;
      node.question = String(node.main_question || 'Read the scenario and answer every part.');
      node.questions.forEach((q) => { if (q && typeof q.question === 'string') q.question = q.question.replace(PART_LABEL, ''); });
      changed += 1;
      return;
    }
    if (typeof node.question === 'string' || typeof node.answer === 'string') return;
    Object.values(node).forEach(visit);
  };
  visit(examJson);
  return changed;
}

module.exports = { stripInstructions, scenarioParts };
