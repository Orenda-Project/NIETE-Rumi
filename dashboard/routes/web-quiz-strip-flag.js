'use strict';
/**
 * The switch for serving the child pages' scripts without their whole-line // comments (web-quiz-static.js,
 * lib/wq-strip.js): app_settings web_quiz_wq_strip.
 *
 * Read exactly as web_quiz_brotli is (web-quiz-brotli-flag.js): default OFF, ON only for the JSON boolean true,
 * remembered 30 s, never read per request, one background read at a time; no row, no database client, a failed or
 * throwing read are all OFF, never a throw. It acts only where web_quiz_brotli already compresses (a versioned
 * script to a phone that takes br), so it does nothing while web_quiz_brotli is off.
 */
const { createBrotliFlag } = require('./web-quiz-brotli-flag');

const KEY = 'web_quiz_wq_strip';

/** createStripFlag({ db, now }) → on(), with on.ready() (for tests). */
function createStripFlag(opts = {}) {
  return createBrotliFlag({ ...opts, key: KEY });
}

let shared = null;
/** The process's one switch (the web quiz router's). */
function stripOn() {
  if (!shared) shared = createStripFlag();
  return shared();
}

module.exports = { KEY, createStripFlag, stripOn };
