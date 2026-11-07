'use strict';
// Part of marking-scheme.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { dropPassageAnswer } = require('../fde-sub-answers');
const { CATEGORIES, SENTENCE_FILL, TREES, answerOf, canonicalBlooms, clone, fillPoints, fillSentences, fillsWhole, hasPoints, isObject, show, toNumber } = require('./basics');
const { normaliseComprehension, normaliseOne, normaliseSituationParts } = require('./normalise-items');

function normaliseQuestion(q, slots, where, log, shortfall, ctx) {
  if (!isObject(q)) {
    log.push(`${where}: not a question, skipped`);
    return;
  }
  const slot = typeof q.slot === 'string' ? slots.get(q.slot.trim()) : undefined;
  if (!slot) {
    log.push(`${where}: unknown slot ${show(q.slot)}, left as is`);
    return;
  }
  const label = `${slot.slot} ${where}`;

  const objective = slot.category === 'objective' || slot.shape === 'mcq';
  if (objective && 'scheme' in q) {
    delete q.scheme;
    log.push(`${label}: scheme dropped on an objective item`);
  }

  const blooms = canonicalBlooms(q.blooms);
  if (!blooms) log.push(`${label}: blooms ${show(q.blooms)} set to Understand`);
  q.blooms = blooms || 'Understand';

  if (objective) return;
  if ('scheme' in q) normaliseOne(q, q.marks, q.question, slot, label, log);
  if (slot.shape === 'comprehension') normaliseComprehension(q, slot, label, log, shortfall, ctx);
  if (slot.shape === 'situation') normaliseSituationParts(q, slot, label, log, { ...ctx, shortfall });

  // The marks the row prints (the renderer's own fallback), on its answer.
  const marks = Number(q.marks) || toNumber(slot.marks_each);
  const answer = answerOf(q.answer);
  if (fillsWhole(slot) && !hasPoints(q) && answer && Number.isFinite(marks) && marks > 0) {
    (SENTENCE_FILL.has(slot.slot) ? fillSentences : fillPoints)(q, marks, answer);
    ctx.filled.push({ slot: slot.slot, item: ctx.item, part: null, filled_by: 'code' });
    const n = q.scheme.points.length;
    log.push(`${label}: no points; ${n > 1 ? `${n} A points of ${show(marks)} written on its sentences` : `one A point of ${show(marks)} written on the answer`}`);
  }
}

function slotIndex(layout) {
  const slots = new Map();
  if (!isObject(layout) || !Array.isArray(layout.sections)) return slots;
  for (const sec of layout.sections) {
    if (!isObject(sec) || !Array.isArray(sec.slots)) continue;
    for (const slot of sec.slots) {
      if (isObject(slot) && typeof slot.slot === 'string') slots.set(slot.slot, slot);
    }
  }
  return slots;
}

/**
 * Check every question's scheme against its slot (removed questions too: they
 * can be put back). Returns { examJson, log, shortfall: [{ slot, kind, have, need }] };
 * rows code filled are listed in `examJson._layout.scheme_shortfall` as
 * [{ slot, item, part, filled_by: 'code' }], a key that is absent when none was.
 */
function normaliseScheme(examJson) {
  const log = [];
  const shortfall = [];
  let out;
  try {
    out = clone(examJson);
  } catch (err) {
    log.push(`paper could not be copied (${err.message}), left as is`);
    return { examJson, log, shortfall };
  }
  if (!isObject(out)) {
    log.push('not a paper, left as is');
    return { examJson: out, log, shortfall };
  }

  // Rows filled on an earlier pass have points now; their entries are kept.
  const filled = isObject(out._layout) && Array.isArray(out._layout.scheme_shortfall) ? out._layout.scheme_shortfall : [];
  try {
    const slots = slotIndex(out._layout);
    for (const tree of TREES) {
      if (!isObject(out[tree])) continue;
      for (const category of CATEGORIES) {
        const types = out[tree][category];
        if (!isObject(types)) continue;
        for (const [type, list] of Object.entries(types)) {
          if (!Array.isArray(list)) continue;
          list.forEach((q, i) => {
            const where = `${tree}.${category}.${type}[${i}]`;
            try {
              if (dropPassageAnswer(q)) log.push(`${where}: passage answer dropped, its parts carry the answers`);
              normaliseQuestion(q, slots, where, log, shortfall, { filled, item: i });
            } catch (err) {
              if (isObject(q)) delete q.scheme;
              log.push(`${where}: ${err.message}; scheme dropped`);
            }
          });
        }
      }
    }
  } catch (err) {
    log.push(`normaliseScheme stopped early: ${err.message}`);
  }
  if (isObject(out._layout)) {
    const seen = new Set();
    const rows = filled.filter((f) => {
      const key = isObject(f) ? `${f.slot}|${f.item}|${f.part}` : '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (rows.length) out._layout.scheme_shortfall = rows;
    else delete out._layout.scheme_shortfall;
  }
  return { examJson: out, log, shortfall };
}

module.exports = {
  normaliseScheme,
};
