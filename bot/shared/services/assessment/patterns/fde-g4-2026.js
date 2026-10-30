'use strict';
/**
 * FDE Grade 4 end-of-chapter pattern (2026-27 session): Maths, English, Urdu and Science,
 * 50 written marks each, set from the chapter or pages the teacher chose (bd-5jmnfj.33.1).
 * The subject data lives in ./mid/g4-*.js; the chrome in ./mid/chrome.js.
 */

const { build } = require('./mid/chrome');

module.exports = build({
  id: 'fde_g4_2026',
  grade: 4,
  subjects: [
    require('./mid/g4-maths'),
    require('./mid/g4-english'),
    require('./mid/g4-urdu'),
    require('./mid/g4-science'),
  ],
});
