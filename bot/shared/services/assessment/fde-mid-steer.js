'use strict';
/**
 * The note Sections B and C of a Grade 3–4 end-of-chapter paper carry about Section A
 * (bd-5jmnfj.33.2). v30 G3 General Knowledge Q4 v/vi re-asked Q5 i/ii and G3 Maths Q5 parts
 * re-asked Q1 facts: the sections were written beside each other, and takenNote/firstAskNote
 * only cover Grade 5 slots. The writer now asks Section A first and hands the other sections
 * this list of what A already tests.
 *
 * Pure: reads a reply tree, returns a string or null, never throws.
 */

const LABEL = /^\s*(?:[a-dA-D]|[ivx]+|الف|ب|ج|د)\)\s*/;
const stripLabel = (s) => String(s ?? '').replace(LABEL, '').trim();
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** Every item object under seen/unseen → category → type → [items]. */
function items(tree) {
  const out = [];
  ['seen', 'unseen'].forEach((part) => {
    const cats = tree && tree[part];
    if (!cats || typeof cats !== 'object') return;
    Object.values(cats).forEach((types) => {
      if (!types || typeof types !== 'object') return;
      Object.values(types).forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((q) => { if (q && typeof q === 'object' && q.removed !== true) out.push(q); });
      });
    });
  });
  return out;
}

/** One "- question — answer" line per item; match items list each pair; empty stems are skipped. */
function lineOf(q) {
  if (Array.isArray(q.column_a) && Array.isArray(q.column_b)) {
    return q.column_a.map((a, i) => {
      const b = text(q.column_b[i]);
      const left = text(a);
      return left && b ? `- ${left} — ${b}` : null;
    }).filter(Boolean);
  }
  const stem = text(q.question);
  if (!stem) return [];
  const answer = stripLabel(q.answer);
  if (Array.isArray(q.options) && q.options.length) {
    return [`- ${stem} — ${answer} [options: ${q.options.map(stripLabel).filter(Boolean).join(', ')}]`];
  }
  return [answer ? `- ${stem} — ${answer}` : `- ${stem}`];
}

/**
 * steerNote(tree, earlier) → the note for a section written after `earlier` (default 'Section A';
 * 'Sections A and B' for Section C, bd-5jmnfj.33.7.2), or null when they gave nothing to list.
 */
function steerNote(tree, earlier = 'Section A') {
  try {
    const lines = items(tree).flatMap(lineOf);
    if (!lines.length) return null;
    return [
      `${earlier} of this paper ${earlier === 'Section A' ? 'is' : 'are'} already written. Its items, each with its answer:`,
      lines.join('\n'),
      'Never ask any of these facts again in your section, in any shape: no stem, option, blank or passage question '
        + 'may ask for or print one of these answers, and no item\'s answer may be one of them. '
        + 'Test different facts, words and numbers from the same chapter.',
    ].join('\n\n');
  } catch (_) {
    return null;
  }
}

module.exports = { steerNote };
