'use strict';

/**
 * Child test check Flow (bd-s1oo0.6) — how many item slots each screen has. The Flow JSON is static,
 * so a screen carries the most items any form has for that block; unused slots are hidden. The item
 * bank (CONTRACT §2) has 3 Urdu questions, 2 English, 5 Urdu first sounds, 5 Urdu and 8 English
 * made-up words, 8 numbers and 4 written sums.
 */
module.exports = Object.freeze({
  urdu: Object.freeze({ q: 3, fs: 5, nw: 8 }),
  english: Object.freeze({ q: 3, fs: 0, nw: 8 }),
  maths: Object.freeze({ n: 8, w: 4 }),
});
