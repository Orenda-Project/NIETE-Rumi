'use strict';
/**
 * bd-snkn32.53 (queue #134 D) — the children visible in a grades 1–5 own plan: ONE fixed line at the top of the Opening
 * (`hook.childrenLine`) telling her to use a girl's and a boy's name from her class, a place the children know, and to
 * ask one child for their own example. The reviewer's 6B (both genders, deliberate; varied contexts) failed on 115 of
 * 276 grades 1–5 own plans (#120). The rewrite is also told the rule (lp612-own-ways CHILDREN_LINE), so the examples
 * themselves change; this line makes it the teacher's habit. Added by code after the gate; the book's language.
 *
 * Pure: no I/O. Returns a new script; the one given is never changed.
 */
const LINE = 'Make it theirs: use a girl\'s and a boy\'s name from your class in the examples (for example Ayesha and Bilal), '
  + 'a place the children know (home, the bazaar, the school), and ask one child for their own example.';
const LINE_UR = 'سبق کو بچوں کا بنائیں: مثالوں میں اپنی جماعت کی ایک لڑکی اور ایک لڑکے کا نام لیں (جیسے عائشہ اور بلال)، '
  + 'کوئی جانی پہچانی جگہ لیں (گھر، بازار، اسکول)، اور ایک بچے سے اس کی اپنی مثال پوچھیں۔';

function addK5Children(script, lang) {
  if (!script || typeof script !== 'object' || !script.hook || typeof script.hook !== 'object') return script;
  const out = JSON.parse(JSON.stringify(script));
  out.hook.childrenLine = lang === 'ur' ? LINE_UR : LINE;
  return out;
}

module.exports = { addK5Children, LINE, LINE_UR };
