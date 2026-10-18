'use strict';
/**
 * The child pages' scripts as the edge sends them with app_settings web_quiz_wq_strip on (routes/web-quiz-static.js):
 * every line that starts, after white space, with // is removed, whole. Nothing else changes: a trailing comment,
 * a block comment (so a /*! licence *\/), strings, templates and regexes stay byte for byte, and the kept lines keep
 * their order and their line endings. The tests (web-quiz-static-strip) prove on every public/wq/*.js that no such
 * line sits inside a string or template and that the tokens are the same once stripped.
 *
 * One function for the route and the tests (the size rows print the served gz with it).
 */
const WHOLE_LINE_COMMENT = /^\s*\/\//;

/** stripLineComments(source) → the source without its whole-line // comments (a Buffer in, a Buffer out; a string in, a string out). */
function stripLineComments(source) {
  const isBuf = Buffer.isBuffer(source);
  const text = isBuf ? source.toString('utf8') : String(source);
  const out = text.split('\n').filter((line) => !WHOLE_LINE_COMMENT.test(line)).join('\n');
  return isBuf ? Buffer.from(out, 'utf8') : out;
}

module.exports = { stripLineComments, WHOLE_LINE_COMMENT };
