'use strict';
/**
 * bd-5jmnfj.38.31 — spreads the MCQ key letters of a G6-12 free paper (panel A7a: one letter for
 * over 40% of the keys, or four in a row). The key option is swapped into a planned position and the
 * options relabelled; no option's words change. Pure: mutates the paper it is given, no I/O.
 *
 * Left alone: numeric options (their order means something), options that name another option
 * ("both a and b"), and an item whose key cannot be read.
 */

const LATIN = ['a', 'b', 'c', 'd'];
const URDU = ['الف', 'ب', 'ج', 'د'];
// c, a, d, b, ... : every letter once per four items, no letter twice in a row.
const PLAN = [2, 0, 3, 1];
const LABEL = /^\s*\(?\s*(الف|ب|ج|د|[a-dA-D])\s*\)\s*/;
const NAMES_OTHERS = /\b(both|all|none|neither)\b|\b[a-d]\s*(and|or|&)\s*[a-d]\b|دونوں|تمام|کوئی نہیں/i;

function labelOf(option) {
  const m = String(option).match(LABEL);
  return m ? m[1] : null;
}

function textOf(option) {
  return String(option).replace(LABEL, '').trim();
}

function indexOfLabel(label) {
  if (!label) return -1;
  const u = URDU.indexOf(label);
  return u >= 0 ? u : LATIN.indexOf(label.toLowerCase());
}

/** The key's position among the options, from a letter, a labelled answer or the option text; -1 if unreadable. */
function keyIndex(item) {
  const options = Array.isArray(item.options) ? item.options : [];
  const answer = String(item.answer ?? '').trim();
  const bare = answer.match(/^\(?\s*(الف|ب|ج|د|[a-dA-D])\s*\)?$/);
  const labelled = bare ? bare[1] : (answer.match(LABEL) || [])[1];
  const fromLabel = indexOfLabel(labelled);
  if (fromLabel >= 0 && fromLabel < options.length) return fromLabel;
  const want = answer.replace(/[.۔]\s*$/, '').toLowerCase();
  return options.findIndex((o) => textOf(o).replace(/[.۔]\s*$/, '').toLowerCase() === want);
}

function isMcq(item) {
  return item && typeof item === 'object' && Array.isArray(item.options) && item.options.length === 4;
}

function movable(item) {
  if (!isMcq(item) || keyIndex(item) < 0) return false;
  const texts = item.options.map(textOf);
  if (texts.every((t) => /^[-+]?[\d.,/ ]+\s*\S{0,6}$/.test(t))) return false;
  return !texts.some((t) => NAMES_OTHERS.test(t));
}

/** Every MCQ in paper order (a stimulus group's items included). */
function mcqs(examJson) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (isMcq(node)) { out.push(node); return; }
    if (typeof node.question === 'string' || typeof node.answer === 'string') {
      if (Array.isArray(node.items)) visit(node.items);
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(examJson);
  return out;
}

function labelsFor(item) {
  const first = labelOf(item.options[0]) || 'a';
  if (URDU.includes(first)) return URDU;
  return first === first.toUpperCase() ? LATIN.map((l) => l.toUpperCase()) : LATIN;
}

function place(item, target) {
  const from = keyIndex(item);
  const labels = labelsFor(item);
  const texts = item.options.map(textOf);
  const keyText = texts[from];
  [texts[from], texts[target]] = [texts[target], texts[from]];
  item.options = texts.map((t, i) => `${labels[i]}) ${t}`);
  item.answer = `${labels[target]}) ${keyText}`;
  return from !== target;
}

/** Moves each movable key to its planned position. Returns how many keys moved. */
function balanceKeys(examJson) {
  let moved = 0;
  let k = 0;
  mcqs(examJson).forEach((item) => {
    if (!movable(item)) return;
    if (place(item, PLAN[k % PLAN.length])) moved += 1;
    k += 1;
  });
  return moved;
}

module.exports = { balanceKeys, keyIndex, textOf, isMcq };
