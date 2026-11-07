'use strict';
/**
 * W-UR3 (bd-5jmnfj.35): the oral poem is never a hamd, naat, prayer or a poem naming God. The model is asked again once
 * (the re-ask note names it); a poem STILL religious after that fails the paper closed, because religious text the
 * model reproduces cannot be checked against the book. Other flagged wording is mended, never blocking.
 */
const { urduOralBad } = require('./fde-early-urdu-oral');

/** True when the oral still has a flagged poem whose script is religious. */
function religiousPoemLeft(oral) {
  if (!oral || !Array.isArray(oral.flagged) || !oral.flagged.includes('poem')) return false;
  const poem = (oral.content || []).find((c) => c && c.id === 'poem');
  return !!poem && urduOralBad('poem', [], poem.script).some((f) => f.reason === 'religious-poem');
}

/** Logs a kept-flagged oral; throws ORAL_RELIGIOUS_POEM when the poem is still religious. */
function settleFlaggedOral(oral, d, { requestId, pattern, examJson, model }) {
  if (!oral || !oral.flagged.length) return;
  d.logToFile('[assessment] oral task kept flagged', { requestId, pattern, flagged: oral.flagged });
  if (religiousPoemLeft(oral)) throw d.fail('ORAL_RELIGIOUS_POEM', 'The oral poem is still religious after the re-ask.', { examJson, model });
}

module.exports = { religiousPoemLeft, settleFlaggedOral };
