'use strict';
/**
 * Urdu word help on an English lesson quiz (bd-0q8b4x, queue #300). Pure: no I/O.
 *
 * WHY. Jugnu's English story is understood about half as well as the Urdu one
 * (17% v 37%, 162 children, bd-tucpin), and children who READ the key words
 * right still miss the question: word meaning, not reading. The option this
 * serves shows a short Urdu meaning under hard English words in an English
 * lesson quiz, so a later fair test (by lot, per class link) can tell whether
 * that closes part of the gap.
 *
 * WHERE A MEANING COMES FROM. The book's own glossary first (the lesson plan's
 * key words, when they carry Urdu), then a meaning the model offers, which is
 * only kept once the key checker agrees with it (quiz-word-help.service.js).
 *
 * OFF unless app_settings `quiz_word_help` is JSON true; `quiz_word_help_lot`
 * true serves it to half the class links only (armOf).
 */
const crypto = require('crypto');

const URDU = /[؀-ۿ]/;
const URDU_RUN = /[؀-ۿ][؀-ۿ‌\s]*[؀-ۿ]|[؀-ۿ]/;
const LATIN_WORD = /^[A-Za-z][A-Za-z' -]{0,30}$/;
/** At most this many words help one question; a meaning at most this many words. */
const PER_QUESTION = 3;
const MEANING_WORDS = 4;

const arr = (v) => (Array.isArray(v) ? v : []);
const urduRun = (s) => { const m = String(s || '').match(URDU_RUN); return m ? m[0].replace(/\s+/g, ' ').trim() : ''; };

/** One glossary entry ({en, ur}) from any shape a plan writes a key word in, or null. */
function entryOf(w) {
  if (typeof w === 'string') {
    // the v9 "word — meaning" line (lp-v9-html-source wrap.keyFacts)
    const m = w.match(/^\s*([A-Za-z][A-Za-z' -]{0,30}?)\s*[—–:-]\s*(.+)$/);
    return m && URDU.test(m[2]) ? { en: m[1].trim().toLowerCase(), ur: urduRun(m[2]) } : null;
  }
  if (!w || typeof w !== 'object') return null;
  let term = String(w.term || w.word || '').trim();
  let ur = '';
  const bracket = term.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (bracket && URDU.test(bracket[2])) { term = bracket[1].trim(); ur = urduRun(bracket[2]); }
  if (!ur) ur = [w.urdu, w.gloss, w.meaning, w.def, w.definition].map(urduRun).find(Boolean) || '';
  if (!ur || !LATIN_WORD.test(term)) return null;
  return { en: term.toLowerCase(), ur };
}

/** The lesson's own English → Urdu glossary, de-duplicated, in the plan's order. */
function bookGlossary(slideScript) {
  const ss = slideScript && typeof slideScript === 'object' ? slideScript : {};
  const hook = ss.hook || {};
  const all = [...arr(hook.keyWords), ...arr(ss.keyWords), ...arr(ss.vocab), ...arr(hook.vocab), ...arr((ss.wrap || {}).keyFacts)];
  const out = [];
  all.map(entryOf).forEach((e) => { if (e && !out.some((o) => o.en === e.en)) out.push(e); });
  return out;
}

/** Everything the child reads on a stored row: stem and options. */
function rowText(row) {
  const r = row || {};
  return [r.question_text, r.option_a, r.option_b, r.option_c, r.option_d].filter((t) => t != null).join(' \n ');
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when `word` is in `text` as a whole word (or its plain plural). */
function hasWord(text, word) {
  return new RegExp(`(^|[^A-Za-z])${escRe(word)}(s|es)?($|[^A-Za-z])`, 'i').test(text);
}

/** The book's words that appear in this row, at most PER_QUESTION. */
function matchWords(row, glossary) {
  const text = rowText(row);
  return arr(glossary).filter((g) => hasWord(text, g.en)).slice(0, PER_QUESTION).map((g) => ({ en: g.en, ur: g.ur, from: 'book' }));
}

/** A meaning the model offered, held to shape: a word in the row, a short Urdu-script meaning. Else null. */
function cleanMade(row, w) {
  const en = String((w && w.en) || '').trim().toLowerCase();
  const ur = String((w && w.ur) || '').replace(/\s+/g, ' ').trim();
  if (!LATIN_WORD.test(en) || !hasWord(rowText(row), en)) return null;
  if (!ur || /[A-Za-z]/.test(ur) || !URDU.test(ur) || ur.split(' ').length > MEANING_WORDS) return null;
  return { en, ur, from: 'made' };
}

/** The lot: a class link's half, fixed for ever by its id. */
function armOf(shareCodeId) {
  const h = crypto.createHash('sha256').update(`quiz_word_help:${shareCodeId}`).digest();
  return h[0] % 2 === 0 ? 'help' : 'control';
}

/** What the page gets for one row: [{en, ur}] or null (switch off, other half, or no words). */
function servedWords(row, { on, lot, shareCodeId } = {}) {
  const words = arr(row && row.media && row.media.word_help).filter((w) => w && w.en && w.ur);
  if (!on || !words.length) return null;
  if (lot && armOf(shareCodeId) !== 'help') return null;
  return words.slice(0, PER_QUESTION).map((w) => ({ en: w.en, ur: w.ur }));
}

module.exports = {
  bookGlossary, matchWords, cleanMade, armOf, servedWords, rowText, hasWord, PER_QUESTION,
};
