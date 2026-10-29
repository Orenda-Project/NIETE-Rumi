'use strict';
/**
 * Question stems on a topic paper (bd-6clakk.12): the stems a teacher may tick under a question
 * type, and turning her ticked ids into the stem text the writer must use. Nothing ticked means
 * Rumi chooses, which is the paper as it was.
 *
 * Pure: no I/O.
 */
const { BANK } = require('./stem-bank');

const ALIAS = { eng: 'english', math: 'maths', mathematics: 'maths', gensci: 'science' };
const subjectKey = (s) => {
  const k = String(s || '').trim().toLowerCase();
  return ALIAS[k] || k;
};

function bandOf(grade) {
  const g = Number(grade);
  if (!Number.isInteger(g) || g < 1 || g > 5) return null;
  return g <= 2 ? '1-2' : '3-5';
}

/** [{id, text}] a teacher may tick for this type; [] when there are none. */
function stemsFor(subject, grade, typeId) {
  const bands = BANK[subjectKey(subject)];
  const band = bandOf(grade);
  if (!bands || !band) return [];
  const list = (bands[band] || bands['1-5'] || {})[typeId] || [];
  return list.map(([id, text]) => ({ id, text }));
}

/** The options' type list with `stems` on each type that has some; the input is not changed. */
function withStems(types, subject, grade) {
  return (types || []).map((t) => {
    const stems = stemsFor(subject, grade, t.id);
    return stems.length ? { ...t, stems } : t;
  });
}

/**
 * Her ticked ids for one type → { stems: [text] } in the order ticked, once each, or
 * { error } naming an id the bank does not hold for that type.
 */
function resolveStems(subject, grade, typeId, ids) {
  if (ids == null) return { stems: [] };
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    return { error: `stems for ${typeId} must be a list of stem ids` };
  }
  const bank = new Map(stemsFor(subject, grade, typeId).map((s) => [s.id, s.text]));
  const stems = [];
  for (const id of [...new Set(ids)]) {
    if (!bank.has(id)) return { error: `unknown stem "${id}" for ${typeId}` };
    stems.push(bank.get(id));
  }
  return { stems };
}

module.exports = { stemsFor, withStems, resolveStems, bandOf };
