'use strict';
/**
 * The modules the one door uses when they are on the branch, and does without when they are not — each built by its
 * own change: the join page, the teacher home's signer, the quiz-maker page's signer, the sandbox walk-through
 * (`walk-persona`: `bot/.gitignore` ignores `test-*.js`).
 * Looked up by NAME at call time (so a module that lands later is picked up with no edit here, and no file requires a
 * path that may not exist yet). A module that is absent answers null; a module that is present but throws while loading
 * throws (a broken module is loud, never silently "absent").
 *
 *   load(name) → the module | null        name ∈ studentJoin | teacherHomeToken | makerToken | testPersona
 *   _set(name, mod) / _reset()             tests only: stand a module in (or out) without mocking a path
 */
const path = require('path');

const PATHS = Object.freeze({
  studentJoin: path.join(__dirname, '..', 'quiz', 'web-quiz-student-join'),
  teacherHomeToken: path.join(__dirname, 'teacher-home.token'),
  makerToken: path.join(__dirname, 'maker.token'),
  testPersona: path.join(__dirname, 'walk-persona'),
});
let stand = {};

function load(name) {
  if (Object.prototype.hasOwnProperty.call(stand, name)) return stand[name];
  const p = PATHS[name];
  if (!p) return null;
  try { return require(p); } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message || '').includes(path.basename(p))) return null;
    throw e;
  }
}

module.exports = { load, PATHS, _set: (name, mod) => { stand[name] = mod; }, _reset: () => { stand = {}; } };
