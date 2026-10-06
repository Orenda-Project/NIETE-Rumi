'use strict';
/**
 * The title a child reads on an Urdu quiz's first screen.
 *
 * A lesson-plan quiz is labelled with the lesson's catalog name, verbatim — and
 * the catalog names are English or Roman Urdu ("Understanding Dialogue",
 * "Bhaloo Aur Billi"), so an Urdu page opened on a title its child cannot read.
 * With quiz_author_gates_v2 on, the lesson's digest writes `title_ur` once, with
 * the quiz (lp-quiz-digest). The page shows it on an Urdu code; every other
 * reader of the label (the teacher's messages, the report) is unchanged, and a
 * quiz written before it keeps the title it had.
 */

const URDU_LETTER = /\p{Script=Arabic}/u;
const MAX_WORDS = 8;

/** A usable Urdu title, or null: Urdu script, short, more Urdu letters than Latin ones. */
function cleanUrduTitle(raw) {
  const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!t || !URDU_LETTER.test(t)) return null;
  if (t.split(' ').length > MAX_WORDS) return null;
  const urdu = [...t].filter((ch) => URDU_LETTER.test(ch)).length;
  const latin = [...t].filter((ch) => /[A-Za-z]/.test(ch)).length;
  return urdu > latin ? t : null;
}

/** The topic the page shows: an Urdu code reads the quiz's own Urdu title when it has one. */
function pageTopic({ lang, meta, fallback }) {
  if (lang === 'ur') {
    const t = cleanUrduTitle(meta && meta.digest && meta.digest.title_ur);
    if (t) return t;
  }
  return fallback || '';
}

module.exports = { cleanUrduTitle, pageTopic };
