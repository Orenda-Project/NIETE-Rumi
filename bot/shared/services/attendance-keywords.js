'use strict';
/**
 * The words that open the attendance door, and the matcher (moved out of attendance-router.service.js unchanged, so
 * a pure keyword door — menu-request.js — can ask "would attendance take this?" without loading the database client).
 * attendance-router.service.js re-exports both; its callers are unchanged.
 *
 * Deliberately tight. The old detector matched loose substrings, so "I need the
 * student list for my LP" dropped the teacher into attendance. Everything here is
 * either an explicit word for attendance or a slash command.
 */
const KEYWORDS = [
  'attendance', '/attendance', 'roll call',
  'حاضری', 'hazri', 'haazri', 'haziri', 'hajri',
];

function detect(message) {
  if (!message || typeof message !== 'string') return { detected: false };
  const lower = message.toLowerCase().trim();
  for (const kw of KEYWORDS) {
    // Word-boundary match, so a keyword inside a longer sentence still counts
    // ("mark attendance please") but an unrelated phrase does not.
    const re = new RegExp(`(^|[^a-z])${kw.replace('/', '\\/')}([^a-z]|$)`, 'i');
    if (re.test(lower)) return { detected: true, keyword: kw };
  }
  return { detected: false };
}

module.exports = { KEYWORDS, detect };
