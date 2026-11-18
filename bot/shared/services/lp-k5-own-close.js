'use strict';
/**
 * bd-snkn32.52 (queue #134 B) — "Before they write" for a grades 1–5 own plan: the twin of the 6–12 close
 * (lp612-own-close.js), in that close's own words, so both bands tell a teacher the same thing.
 *
 * WHY. #120: 173 of 234 teachers who got a plan had none on the shelf; the reviewer's 5D failed them (an exit ticket in
 * a NEW context, success criteria read aloud, pupils self-predict with thumbs before handing in). A grades 1–5 slide
 * script has no field for either, so this adds `wrap.beforeTheyWrite` (printed in the Check section, before the exit
 * ticket). The criteria are the plan's own outcome (`goal`), never model text; added by code after the gate, so it is
 * always there and always the same. The new context is the rewrite's job (lp-k5-own system rule).
 *
 * SHORT. A class of 50: when the outcome is longer than GOAL_MAX_WORDS (or missing), the box is one line instead.
 * The book's language decides the words (classroom content: frozen with the plan, never the teacher's UI language).
 *
 * Pure: no I/O. Returns a new script; the one given is never changed.
 */
const {
  CLOSE_TITLE, CLOSE_TITLE_UR, THUMBS_LINE, THUMBS_LINE_UR, SHORT_LINE, SHORT_LINE_UR,
} = require('./lp612-own-close');

const READ = 'Read the success criteria aloud:';
const READ_UR = 'کامیابی کے معیار بلند آواز سے پڑھیں:';
/** Longer than this, the outcome is not something a teacher reads aloud to fifty children in a breath. */
const GOAL_MAX_WORDS = 30;

const words = (s) => String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).length;

function addK5Close(script, lang) {
  if (!script || typeof script !== 'object' || !script.wrap || typeof script.wrap !== 'object') return script;
  const out = JSON.parse(JSON.stringify(script));
  const urdu = lang === 'ur';
  const goal = String(out.goal || '').trim();
  const fits = goal && words(goal) <= GOAL_MAX_WORDS;
  out.wrap.beforeTheyWrite = fits
    ? [`${urdu ? READ_UR : READ} ${goal}`, urdu ? THUMBS_LINE_UR : THUMBS_LINE]
    : [urdu ? SHORT_LINE_UR : SHORT_LINE];
  return out;
}

module.exports = {
  addK5Close, READ, READ_UR, GOAL_MAX_WORDS, CLOSE_TITLE, CLOSE_TITLE_UR, THUMBS_LINE, THUMBS_LINE_UR, SHORT_LINE, SHORT_LINE_UR,
};
