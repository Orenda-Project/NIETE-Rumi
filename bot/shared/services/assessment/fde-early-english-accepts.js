'use strict';
/**
 * v37r6 G2 English accept lists (bd-5jmnfj.4.58.9.1). The prompt rule "accept never lists near" did not hold in the
 * loop-6 paper, so it is enforced here:
 *   - G2 Q10 Prepositions keyed in / on / under / behind: «near» is a different position, never an alternative.
 *   - G2 Q7 Opposites: an accept word that is a weaker form of the same pole (damp for the opposite of dry) is dropped.
 * Pure: takes {examJson, notes} and returns {examJson, notes}; never throws.
 */

const G2_ENGLISH = /^g2\.english\./i;
const EXACT_POSITIONS = new Set(['in', 'on', 'under', 'behind', 'above', 'below', 'inside', 'over']);
// keyed opposite -> accept words that are not opposites of the stem word (a milder degree, or a different dimension)
const NOT_OPPOSITE = {
  wet: ['damp', 'moist'], dry: ['damp', 'moist'], hot: ['warm'], cold: ['cool', 'chilly'],
  big: ['tall', 'long'], small: ['short', 'thin'], tall: ['big', 'long'], short: ['small', 'little', 'thin'],
};

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

function prune(q, drop, notes, why) {
  const accept = q.scheme.accept.filter((a) => !drop(norm(a)));
  if (accept.length === q.scheme.accept.length) return q;
  notes.push(`${q.slot}: ${why} removed from accept for «${q.answer}»`);
  return { ...q, scheme: { ...q.scheme, accept } };
}

function fixOne(q, type, notes) {
  if (!q || typeof q !== 'object' || !G2_ENGLISH.test(String(q.slot || ''))) return q;
  if (!q.scheme || !Array.isArray(q.scheme.accept)) return q;
  const key = norm(q.answer);
  if (/preposition/i.test(type) && EXACT_POSITIONS.has(key)) return prune(q, (a) => a === 'near', notes, '«near»');
  if (/opposite/i.test(type) && NOT_OPPOSITE[key]) {
    const bad = new Set(NOT_OPPOSITE[key]);
    return prune(q, (a) => bad.has(a), notes, `not-opposite (${[...bad].join('/')})`);
  }
  return q;
}

function earlyEnglishAccepts(input) {
  const prev = input && input.examJson ? input : { examJson: input, notes: [] };
  const { examJson } = prev;
  const notes = prev.notes ? prev.notes.slice() : [];
  try {
    if (!examJson || typeof examJson !== 'object' || !examJson.unseen) return { examJson, notes };
    const unseen = Object.fromEntries(Object.entries(examJson.unseen).map(([cat, byType]) => [cat,
      !byType || typeof byType !== 'object' ? byType
        : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type,
          Array.isArray(list) ? list.map((q) => fixOne(q, type, notes)) : list]))]));
    return { examJson: { ...examJson, unseen }, notes };
  } catch (e) {
    return { examJson, notes };
  }
}

module.exports = { earlyEnglishAccepts };
