'use strict';
/**
 * Transcript quiz — /quiz row layout: ONE FORMAT, EVERY ROW.
 *
 * A WhatsApp list row has exactly two fields, title (24 code points) and
 * description (72). A real lesson topic does not fit in 24, so the topic
 * lives in the description ALWAYS — for a 6-character topic too — the same
 * way lp612-catalog.service.js puts the chapter name in metadata for every
 * chapter regardless of length (see its L195-235). Deciding the field by
 * whether that particular row's text happens to fit makes the row's shape
 * depend on which lesson a teacher taught; the operator rejected that once
 * already ("it is inconsistent... all of them need to have it in the
 * consistent format").
 */

const { cpLen } = require('./religious-marks');

const ELLIPSIS = '…';

/**
 * Cut `text` to at most `max` code points, breaking at the last word boundary
 * before the cap and appending an ellipsis. Never splits a word. Leaves the
 * text alone when it already fits.
 */
function truncateWords(text, max) {
  const s = String(text || '');
  const cps = [...s];
  if (cps.length <= max) return s;

  const budget = Math.max(0, max - cpLen(ELLIPSIS));
  const windowCps = cps.slice(0, budget);

  let cutAt = windowCps.length;
  for (let i = windowCps.length - 1; i >= 0; i--) {
    if (/\s/.test(windowCps[i])) { cutAt = i; break; }
  }
  let body = windowCps.slice(0, cutAt).join('').replace(/[\s،۔,.:;]+$/, '');
  if (!body) body = windowCps.join('');   // a single word spans the whole budget — hard cut
  return `${body}${ELLIPSIS}`;
}

/**
 * The row TITLE: `${date} · ${subject}`, or the date alone when there is no
 * subject label. Word-safe truncated to `max` as a floor — the date+subject
 * combination normally fits on its own.
 */
function composeTitle({ date, subject }, max) {
  const title = subject ? `${date} · ${subject}` : String(date || '');
  return truncateWords(title, max);
}

// FIRST STRONG ISOLATE / POP DIRECTIONAL ISOLATE. A topic in the other script
// inside a row is exactly the case these exist for: without them the "·" and
// the status get dragged to the wrong side of an Urdu topic in an English row
// (round-5 render `renders/round5/F/quiz_list_en_p2.png`, the 31 Aug row read
// "· No quiz yet" with the topic stranded to its left). Same rule the offer
// interstitial already follows — transcript-quiz-language.js isolate().
const FSI = '\u2068';
const PDI = '\u2069';
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[A-Za-z]/;

/** 'ur' for a Perso-Arabic run, 'en' for a Latin one, null when neither. */
function scriptOf(text) {
  const t = String(text || '');
  if (ARABIC_RE.test(t)) return 'ur';
  if (LATIN_RE.test(t)) return 'en';
  return null;
}

/**
 * Wrap `text` in bidi isolates when its script differs from the row's, so the
 * separators around it keep their place. Costs 2 code points, which is why the
 * caller reserves them from the field cap rather than discovering the overflow
 * at WhatsApp.
 */
function isolateIfMixed(text, language) {
  const script = scriptOf(text);
  if (!script || !language) return String(text || '');
  return script === language ? String(text || '') : `${FSI}${text}${PDI}`;
}

/**
 * The lesson topic as a menu wants to read it.
 *
 * `quizzes.topic` is the digest's own re-derivation and comes back lower-cased
 * ("electric circuit") while `analysis_data.topic` keeps the classifier's title
 * case ("Electric Circuit"), so one /quiz menu showed both conventions in
 * adjacent rows. Only an all-lower-case Latin topic is touched: a topic that
 * already carries a capital is left exactly as its author wrote it ("pH and
 * acids" must not become "Ph And Acids"), and a script without case is a no-op.
 */
function normaliseTopic(topic) {
  const t = String(topic || '').trim();
  if (!t || !LATIN_RE.test(t) || /[A-Z]/.test(t)) return t;
  return t.replace(/[a-z]/, (c) => c.toUpperCase());
}

/**
 * The row DESCRIPTION: the topic is the field's owner.
 * - `${topic} · ${status}` when that fits `max`;
 * - otherwise the topic alone, word-safe truncated only if the topic itself
 *   is longer than `max`;
 * - an empty/absent status is the same as the topic alone.
 *
 * `language` is the row's language (the teacher's). It decides whether the
 * topic needs bidi isolation, nothing else.
 */
function composeDescription({ topic, status }, max, { language = null } = {}) {
  const raw = normaliseTopic(topic);
  const s = status ? String(status) : '';
  const isolated = isolateIfMixed(raw, language);
  const cost = cpLen(isolated) - cpLen(raw);        // 0 or 2
  const budget = max - cost;
  const combined = s ? `${isolated} · ${s}` : isolated;
  if (cpLen(combined) <= max) return combined;
  return isolateIfMixed(truncateWords(raw, budget), language);
}

module.exports = {
  truncateWords, composeTitle, composeDescription, normaliseTopic, isolateIfMixed, scriptOf,
};
