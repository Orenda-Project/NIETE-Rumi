'use strict';
/**
 * FDE Grade 2 annual assessment pattern (2026-27 session): Maths, English, Urdu and
 * General Knowledge, set from the whole book. Islamiat is not built yet.
 * The subject data lives in ./early/g2-*.js; the chrome in ./early/chrome.js.
 */

const { build } = require('./early/chrome');

module.exports = build({
  id: 'fde_g2_2026',
  grade: 2,
  subjects: [
    require('./early/g2-maths'),
    require('./early/g2-english'),
    require('./early/g2-urdu'),
    require('./early/g2-gk'),
  ],
});
