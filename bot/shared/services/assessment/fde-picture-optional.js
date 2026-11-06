'use strict';
/**
 * A picture slot marked `picture_optional` (G2 Maths multiplication and division, bd-cj8ggk.5) prints as plain
 * facts when its pictures are still missing after the re-ask: the paper never fails over them, and never prints
 * an empty box. The whole question loses its pictures, so it reads as one kind. Every other picture slot's
 * shortfall is returned untouched, and still fails the paper. Pure: mutates the exam tree it is given.
 */

function optionalSlots(P) {
  return new Set(P.sections.flatMap((s) => s.slots).filter((sl) => sl.picture_optional).map((sl) => sl.slot));
}

function eachItem(examJson, fn) {
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) if (Array.isArray(list)) list.forEach((q) => q && fn(q));
    }
  }
}

/** Drops the pictures of every optional slot in `shortfall`; returns the shortfall that still fails the paper. */
function settleOptionalPictures(examJson, P, shortfall, log = () => {}) {
  const optional = optionalSlots(P);
  const dropped = [...new Set(shortfall.filter((f) => f.reason === 'picture' && optional.has(f.slot)).map((f) => f.slot))];
  if (!dropped.length) return shortfall;
  eachItem(examJson, (q) => { if (dropped.includes(q.slot)) delete q.picture; });
  log('[assessment] pictures dropped', { slots: dropped });
  return shortfall.filter((f) => !(f.reason === 'picture' && dropped.includes(f.slot)));
}

module.exports = { settleOptionalPictures };
