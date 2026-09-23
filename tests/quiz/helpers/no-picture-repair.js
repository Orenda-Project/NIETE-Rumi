'use strict';
/**
 * No "add a picture" repair.
 *
 * A grade 1-5 maths quiz that comes back with too few pictures gets one extra
 * model call (the generate step's `addPictures` seam, runFigureDensity). Suites
 * whose subject is something else — the authoring budget, the rows, the
 * teacher's page, a lesson-plan quiz's wiring — install this on that seam, so
 * they neither reach a model for the extra call nor count it among the calls
 * they assert on. The repair itself is driven through the real LLM boundary in
 * transcript-quiz-figure-density-generate.test.js.
 */

async function noRepair() {
  return { attempted: false, indices: [], merged: null, added: [] };
}

/** Install on the generate module's seam; returns the spy. */
function installNoPictureRepair(Gen) {
  return jest.spyOn(Gen, 'addPictures').mockImplementation(noRepair);
}

module.exports = { installNoPictureRepair };
