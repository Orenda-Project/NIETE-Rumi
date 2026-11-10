'use strict';
/**
 * (unified spec item 12) — the gradual release never goes, grades 6–12. Pure (no I/O).
 *
 * A 6–12 plan (lp_doc v2) has sections introduction → homework; the phases are marked only on blocks: id ido / wedo /
 * youdo, or a title that starts "I do", "We do", "You do" (Urdu: میں کروں, ہم کریں, آپ کریں). They are not required
 * by the schema, so the gate is relative: a phase the plan she started from had must still be in the rewrite, with
 * something in it. A plan whose base marks no phase cannot be checked here (the instruction's GRR_LINE still asks).
 */

const PHASES = [
  { key: 'i_do', name: 'I do', id: 'ido', title: /^\s*(?:i ?do\b|میں کروں)/i },
  { key: 'we_do', name: 'We do', id: 'wedo', title: /^\s*(?:we ?do\b|ہم کریں)/i },
  { key: 'you_do', name: 'You do', id: 'youdo', title: /^\s*(?:you ?do\b|آپ کریں)/i },
];
/** Keys that name or place a block, not teach in it. */
const LABELS = new Set(['type', 'id', 'title', 'mode', 'cite', 'minutes', 'tier', 'level', 'ref']);

function hasText(v, key) {
  if (key && LABELS.has(key)) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.some((x) => hasText(x));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => hasText(x, k));
  return false;
}

function blocksOf(doc) {
  const sections = doc && Array.isArray(doc.sections) ? doc.sections : [];
  return sections.flatMap((s) => (s && Array.isArray(s.blocks) ? s.blocks : [])).filter((b) => b && typeof b === 'object');
}

const idOf = (b) => String(b.id || '').toLowerCase().replace(/[^a-z]/g, '');

/** The phases a plan has, each with something in it, in order: a subset of ['i_do', 'we_do', 'you_do']. */
function grrPhases(doc) {
  const blocks = blocksOf(doc);
  return PHASES.filter((p) => blocks.some((b) => (idOf(b) === p.id || p.title.test(String(b.title || ''))) && hasText(b)))
    .map((p) => p.key);
}

/** The phases (by name) the base had and the rewrite lost or emptied; [] passes. */
function droppedGrr(base, next) {
  const kept = new Set(grrPhases(next));
  return grrPhases(base).filter((k) => !kept.has(k)).map((k) => PHASES.find((p) => p.key === k).name);
}

module.exports = { grrPhases, droppedGrr, PHASES };
