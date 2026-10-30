'use strict';
/**
 * FDE Grade 3 end-of-chapter pattern (2026-27 session): Maths, English, Urdu and General
 * Knowledge, 50 written marks each, set from the chapter or pages the teacher chose
 * (bd-5jmnfj.33.1). Class III has no Science or Social Studies paper; Islamiat is held.
 * The subject data lives in ./mid/g3-*.js; the chrome in ./mid/chrome.js.
 */

const { build } = require('./mid/chrome');

module.exports = build({
  id: 'fde_g3_2026',
  grade: 3,
  subjects: [
    require('./mid/g3-maths'),
    require('./mid/g3-english'),
    require('./mid/g3-urdu'),
    require('./mid/g3-general-knowledge'),
  ],
});
