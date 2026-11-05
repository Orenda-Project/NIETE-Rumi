'use strict';
/**
 * The G6-12 board patterns (FBISE SSC/HSSC), looked up by id (bd-5jmnfj.38.24).
 *
 * Kept apart from patterns/index.js on purpose: that registry feeds the Flow, browse and the FDE renderer,
 * none of which read a variants[] subject. A board pattern is reachable only by its id, from
 * _writePatternPaper, until the surfaces lane lists it.
 */
const { normalise } = require('../index');

const BOARD = Object.freeze(Object.fromEntries(
  ['fbise-ssc1', 'fbise-ssc2', 'fbise-hssc1', 'fbise-hssc2'].map((f) => {
    const def = require(`./${f}`); // eslint-disable-line global-require, import/no-dynamic-require
    return [def.id, def];
  }),
));

function get(id) {
  return (typeof id === 'string' && BOARD[id]) || null;
}

function isBoard(id) {
  return get(id) !== null;
}

function subjectOf(id, subject) {
  const def = get(id);
  return (def && def.subjects[normalise(subject)]) || null;
}

/** Its own grade only, and only a subject it sets. */
function isEligible(id, grade, subject) {
  const def = get(id);
  return Boolean(def && Number(grade) === def.grade && subjectOf(id, subject));
}

module.exports = { get, isBoard, subjectOf, isEligible };
