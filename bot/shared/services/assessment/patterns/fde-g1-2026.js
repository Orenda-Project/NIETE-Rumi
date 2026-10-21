'use strict';
/**
 * FDE Grade 1 annual assessment pattern (2026-27 session): Maths, English, Urdu and
 * General Knowledge, set from the whole book. Islamiat is not built yet.
 * The subject data lives in ./early/g1-*.js; the chrome in ./early/chrome.js.
 */

const { build } = require('./early/chrome');

module.exports = build({
  id: 'fde_g1_2026',
  grade: 1,
  subjects: [
    require('./early/g1-maths'),
    require('./early/g1-english'),
    require('./early/g1-urdu'),
    require('./early/g1-gk'),
  ],
});
