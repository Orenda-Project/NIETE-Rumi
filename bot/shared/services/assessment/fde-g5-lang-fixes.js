'use strict';
/**
 * Per-item key fixes for the G5 language papers (bd-5jmnfj.4.58.34, v29 review):
 * - Urdu Q7 (picture description): the helper list held «خوشی», which the picture does not show; it goes when at
 *   least six words remain (the instruction asks for any six).
 * - English Q7 and Q8: a marking point that pays for a length the paper never sets is dropped, its marks move to
 *   the first kept point. Kept when the slot's instruction states a length.
 *
 * Pure: item in, item out; never throws.
 */

const { mendLangKey } = require('./fde-g5-lang-key-mends'); // v35 G5 English Q1(b) accept rule, Q3 printed apostrophe

const { sentenceStem } = require('./fde-english-r3-mends'); // v37 r3 G5 Q2 part i complete-sentence stem

const NOT_SHOWN = new Set(['خوشی']);
const LENGTH_POINT = /\blength\b|\b\d+\s*(?:to|-|–)\s*\d+\s+(?:words|sentences)\b/i;
const STATED = /\b\d+\s*(?:to|-|–)?\s*\d*\s+(?:words|sentences)\b/i;

function dropLength(q, slot, notes) {
  const points = q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : null;
  if (!points || STATED.test(String(slot.instruction_en || ''))) return q;
  const gone = points.filter((p) => LENGTH_POINT.test(String(p.text)));
  const kept = points.filter((p) => !LENGTH_POINT.test(String(p.text)));
  if (!gone.length || !kept.length) return q;
  const moved = gone.reduce((s, p) => s + Number(p.marks || 0), 0);
  notes.push(`${q.slot}: dropped a length point the paper never sets (${moved} mark moved)`);
  return { ...q, scheme: { ...q.scheme, points: kept.map((p, i) => (i === 0 ? { ...p, marks: Number(p.marks) + moved } : p)) } };
}

function dropUnshown(q, notes) {
  if (!Array.isArray(q.words)) return q;
  const kept = q.words.filter((w) => !NOT_SHOWN.has(String(w).trim()));
  if (kept.length === q.words.length || kept.length < 6) return q;
  notes.push(`${q.slot}: removed a helper word the picture does not show`);
  return { ...q, words: kept };
}

/** `slot` is the item's layout slot (may be undefined). */
function langFixes(q, slot, notes) {
  if (!q || typeof q !== 'object' || !slot) return q;
  if (q.slot === 'english.B.Q2') { const stem = sentenceStem(q, notes); if (stem !== q) return stem; }
  const mended = mendLangKey(q, slot, notes);
  if (mended !== q) return mended;
  if (/^english\.C\.Q(7|8)$/.test(q.slot) && /^english\./.test(slot.slot)) return dropLength(q, slot, notes);
  if (q.slot === 'urdu.C.Q7' && (slot.kinds || []).includes('picture_description')) return dropUnshown(q, notes);
  return q;
}

module.exports = { langFixes };
