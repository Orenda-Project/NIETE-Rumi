'use strict';
/**
 * bd-snkn32.53 (queue #134 D) — the children visible in a grades 1–5 own plan: ONE fixed line at the top of the Opening
 * (`hook.childrenLine`) telling her to use a girl's and a boy's name from her class, a place the children know, and to
 * ask one child for their own example. The reviewer's 6B (both genders, deliberate; varied contexts) failed on 115 of
 * 276 grades 1–5 own plans (#120). The rewrite is also told the rule (lp612-own-ways CHILDREN_LINE), so the examples
 * themselves change; this line makes it the teacher's habit. Added by code after the gate; the book's language.
 * The words live in the catalog (ux-strings `lpOwnChildrenLine`), Rule 20.
 *
 * Pure: no I/O. Returns a new script; the one given is never changed.
 */
const { resolveUx } = require('../config/ux-strings');

const KEY = 'lpOwnChildrenLine';
const lineFor = (lang) => resolveUx(KEY, { language: lang });
const LINE = lineFor('en');
const LINE_UR = lineFor('ur');

function addK5Children(script, lang) {
  if (!script || typeof script !== 'object' || !script.hook || typeof script.hook !== 'object') return script;
  const out = JSON.parse(JSON.stringify(script));
  out.hook.childrenLine = lineFor(lang);
  return out;
}

module.exports = { addK5Children, LINE, LINE_UR };
