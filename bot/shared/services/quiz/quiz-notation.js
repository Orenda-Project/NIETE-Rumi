'use strict';
/**
 * Notation helpers and the "does this question need a card" rule. Dependency
 * free on purpose: the child-facing render contract requires this file, and it
 * must never drag the diagram engine (and its chemistry library) into a
 * message send.
 */
const BUTTON_TITLE_MAX = 20;
const CARD_WIDTH = 1080;

// Notation WhatsApp text cannot render, or renders badly.
const NOTATION_RE = /[\^_]|[²³¹⁰⁴-⁹₀-₉]|[√∑∫π≤≥≠∈∉∪∩⊂⊆∞±°]|\{[^{}]*,[^{}]*\}|\b(?:[A-Z][a-z]?\d+)+[A-Z]?[a-z]?\b/;

const cp = (s) => [...String(s || '')].length;

function needsQuestionCard(q) {
  const stem = String(q.question || q.question_text || '');
  const options = Array.isArray(q.options) ? q.options : [q.option_a, q.option_b, q.option_c, q.option_d].filter((o) => o != null && o !== '');
  if (NOTATION_RE.test(stem) || options.some((o) => NOTATION_RE.test(String(o)))) return true;
  return options.some((o) => cp(o) > BUTTON_TITLE_MAX);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ^ / _ / formula digits → <sup>/<sub>. Input is already HTML-escaped. */
function richNotation(text) {
  let t = String(text || '');
  t = t.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>').replace(/\^([0-9A-Za-z+\-]+)/g, '<sup>$1</sup>');
  t = t.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>').replace(/_([0-9A-Za-z]+)/g, '<sub>$1</sub>');
  // Formula-like tokens only: element symbols each followed by digits (H2O, CO2, C6H12O6).
  t = t.replace(/\b((?:[A-Z][a-z]?\d*){2,})\b/g, (tok) => (/\d/.test(tok) ? tok.replace(/([A-Z][a-z]?)(\d+)/g, '$1<sub>$2</sub>') : tok));
  return t;
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const mapChars = (str, table) => [...str].map((c) => table[c] || c).join('');

/** The same notation for WhatsApp TEXT (feedback lines): real super/subscript digits. */
function unicodeNotation(text) {
  let t = String(text || '');
  t = t.replace(/\^\{([0-9+\-]+)\}/g, (_, d) => mapChars(d, SUP)).replace(/\^([0-9+\-]+)/g, (_, d) => mapChars(d, SUP));
  t = t.replace(/_\{([0-9]+)\}/g, (_, d) => mapChars(d, SUB)).replace(/_([0-9]+)/g, (_, d) => mapChars(d, SUB));
  t = t.replace(/\b((?:[A-Z][a-z]?\d*){2,})\b/g, (tok) => (/\d/.test(tok) ? tok.replace(/([A-Z][a-z]?)(\d+)/g, (_, el, d) => el + mapChars(d, SUB)) : tok));
  return t;
}


module.exports = { needsQuestionCard, richNotation, unicodeNotation, esc, NOTATION_RE, BUTTON_TITLE_MAX };
