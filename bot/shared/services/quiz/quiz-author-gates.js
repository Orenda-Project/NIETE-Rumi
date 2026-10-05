'use strict';
/**
 * The question-engine gates of round 2, behind app_settings `quiz_author_gates_v2`
 * (off by default: with it off, authoring is exactly what it was).
 *
 * THE SWITCH IS READ ONCE PER QUIZ and held for that quiz's whole run in an
 * AsyncLocalStorage scope (runWithAuthorGates), so the validator, the web-item
 * pass and the author prompt read the same answer without threading a flag
 * through every validate() call. A caller that passes `authorGates` explicitly
 * in its ctx wins over the scope.
 *
 * This file holds the FIGURE-CONTENT gates (pure):
 *   indistinctParts  parts drawn with the same pictogram must differ by a drawn
 *                    property the stem names (never only by decoration)
 *   placeValueFix    a place-value stem over a labelled base_ten mat: the column
 *                    heads print the answer, so they are not drawn
 *   markFix          a word_blank on a lesson about a mark (tashdeed, zer…) draws
 *                    that mark on the blank tile, unless the mark is the answer
 */

const { AsyncLocalStorage } = require('async_hooks');
// The ONE reader of the flag lives in config/feature-flags (it also checks the row's key).
const { QUIZ_AUTHOR_GATES_V2_KEY, isQuizAuthorGatesV2 } = require('../../config/feature-flags');

const scope = new AsyncLocalStorage();

/** Run `fn` with the gates on or off for everything it awaits. */
function runWithAuthorGates(on, fn) {
  return scope.run({ on: on === true }, fn);
}

/** Are the gates on here? `ctx.authorGates` wins; else the per-quiz scope; else off. */
function authorGatesOn(ctx) {
  if (ctx && typeof ctx.authorGates === 'boolean') return ctx.authorGates;
  const s = scope.getStore();
  return Boolean(s && s.on);
}

// ─── change 5: pictures a child can tell apart ──────────────────────────────

const COLOUR_WORDS = /\b(colou?r(?:ed|s)?|shaded|red|blue|green|yellow|orange|purple|pink|black|white|brown|grey|gray|dark|light)\b|رنگ|سرخ|لال|نیل|ہر[ےی]|پیل|کال[ےی]|سفید/i;
const COUNT_WORDS = /\b(how many|more|fewer|less|most|fewest|least|count|number|equal|same)\b|کتن[ےیا]|زیادہ|کم|برابر|گن/i;
const SIZE_WORDS = /\b(big|bigger|biggest|small|smaller|smallest|large|larger|tall|taller|short|shorter|long|longer|size|heavy|light)\b|بڑ[اےی]|چھوٹ[اےی]|لمب[اےی]|اونچ|بھاری|ہلک/i;

/** What a part's drawn property is called, by the stem words that name it. */
const NAMED_BY = {
  color: COLOUR_WORDS, colour: COLOUR_WORDS, shade: COLOUR_WORDS, shaded: COLOUR_WORDS,
  count: COUNT_WORDS, n: COUNT_WORDS, value: COUNT_WORDS,
  size: SIZE_WORDS, scale: SIZE_WORDS, height: SIZE_WORDS, length: SIZE_WORDS, width: SIZE_WORDS,
};
/** Keys that never make two drawings look different to a child: a handle letter, an id. */
const NOT_DRAWN = new Set(['label', 'id', 'key', 'slot', 'handle', 'alt', 'say', 'name']);

/** Every object in the spec that is drawn as a pictogram, with the spec-level picto as its default. */
function pictoParts(spec) {
  const out = [];
  const walk = (node, inherited) => {
    if (Array.isArray(node)) { node.forEach((n) => walk(n, inherited)); return; }
    if (!node || typeof node !== 'object') return;
    const picto = typeof node.picto === 'string' ? node.picto : null;
    Object.entries(node).forEach(([k, v]) => { if (Array.isArray(v)) v.forEach((x) => walk(x, picto || inherited)); });
    if (node !== spec && (picto || (inherited && ('count' in node)))) out.push({ ...node, picto: picto || inherited });
  };
  walk(spec, spec && typeof spec.picto === 'string' ? spec.picto : null);
  return out;
}

/**
 * Two or more parts drawn with the SAME pictogram must differ by a property
 * that is drawn AND that the stem names (colour, count, size), or by a drawn
 * word — when the child has to CHOOSE between them. Otherwise the child is choosing between pictures that are the same
 * picture (the red team's "who feels chilly?": three child drawings that differ
 * only by colour, under a stem about shivering). Returns the reason, or null.
 */
function indistinctParts(spec, stem = '', options = []) {
  if (!spec || typeof spec !== 'object') return null;
  // Only parts a child must CHOOSE between: parts with handles (P, Q, R), or
  // options that are handles. Equal groups that are meant to look the same
  // (an array, "4 equal groups of 8") are the lesson, not a fault.
  const opts = (Array.isArray(options) ? options : []).map((o) => String(o == null ? '' : o).trim()).filter(Boolean);
  const optionHandles = opts.length > 0 && opts.every((o) => [...o.replace(/^(bar|row|picture|part)\s+/i, '')].length <= 2);
  const groups = new Map();
  pictoParts(spec).forEach((p) => {
    if (!groups.has(p.picto)) groups.set(p.picto, []);
    groups.get(p.picto).push(p);
  });
  const text = String(stem || '');
  for (const [picto, parts] of groups) {
    if (parts.length < 2) continue;
    const handled = parts.filter((p) => typeof p.label === 'string' && p.label.trim()).length >= 2;
    if (!handled && !optionHandles) continue;
    const keys = new Set(parts.flatMap((p) => Object.keys(p)).filter((k) => k !== 'picto' && !NOT_DRAWN.has(k)));
    const differs = [...keys].filter((k) => new Set(parts.map((p) => JSON.stringify(p[k] ?? null))).size > 1);
    // A drawn WORD (a caption under each) tells them apart by itself.
    const worded = differs.some((k) => ['text', 'caption', 'word'].includes(k)
      && parts.every((p) => typeof p[k] === 'string' && [...p[k].trim()].length > 1));
    if (worded) continue;
    const named = differs.some((k) => NAMED_BY[k] && NAMED_BY[k].test(text));
    if (named) continue;
    const by = differs.length ? `only by ${differs.join(', ')}, which the question never names` : 'in nothing at all';
    return `${parts.length} parts are the same "${picto}" drawing and differ ${by}`;
  }
  return null;
}

/** "Picture A", "image 2", «تصویر الف» — a name the drawing does not carry. */
const PICTURE_N = /^\s*(picture|pic|image|photo|drawing|option|تصویر)\s*([A-Da-d1-4]|الف|ب|ج|د)\s*$/iu;

// ─── base_ten: a place-value question never reads its answer off a head ────

const PLACE_STEM = /\b(which place|what place|place value|in (?:the )?(?:ones|tens|hundreds|thousands)|(?:ones|tens|hundreds|thousands) place|column)\b|place\b.*\?|مقام|کس جگہ|کون سی جگہ|کس خانے/i;

/** The spec with its column heads dropped when the stem asks WHICH place; null when nothing changes. */
function placeValueFix(spec, { stem = '' } = {}) {
  if (!spec || spec.type !== 'base_ten' || spec.labels === false) return null;
  if (!PLACE_STEM.test(String(stem || ''))) return null;
  return { ...spec, labels: false };
}

// ─── word_blank: the mark the lesson teaches stays on screen ───────────────

const MARKS = [
  { ch: '\u0651', words: /\b(tashdeed|tashdid|shadda|shaddah|double letter)\b|تشدید|شد/i },
  { ch: '\u0650', words: /\b(zer|zair|kasra)\b|زیر/i },
  { ch: '\u064E', words: /\b(zabar|zbar|fatha)\b|زبر/i },
  { ch: '\u064F', words: /\b(pesh|paish|damma)\b|پیش/i },
  { ch: '\u0652', words: /\b(jazm|sukun|sukoon)\b|جزم/i },
];

/**
 * The spec with keepMarks when the stem names a mark that sits on a blanked
 * letter and every option carries that mark (or none does: a letter question
 * on a marked word). When the options DIFFER by the mark, the mark is the
 * answer and stays hidden. Null when nothing changes.
 */
function markFix(spec, { stem = '', options = [] } = {}) {
  if (!spec || spec.type !== 'word_blank' || spec.keepMarks === true) return null;
  const named = MARKS.filter((m) => m.words.test(String(stem || '')));
  if (!named.length) return null;
  const word = String(spec.word || '');
  const letters = Array.isArray(spec.letters) && spec.letters.length ? spec.letters.map(String) : (() => {
    const out = [];
    for (const ch of word) {
      if (out.length && /[\u064B-\u0670]/.test(ch)) out[out.length - 1] += ch; else out.push(ch);
    }
    return out;
  })();
  const blanks = (Array.isArray(spec.blanks) ? spec.blanks : [spec.blanks]).map(Number);
  const hidden = blanks.map((i) => letters[i] || '').join('');
  const opts = (Array.isArray(options) ? options : []).map((o) => String(o || ''));
  const onBlank = named.filter((m) => hidden.includes(m.ch));
  if (!onBlank.length) return null;
  const answerByMark = onBlank.some((m) => {
    const withIt = opts.filter((o) => o.includes(m.ch)).length;
    return withIt > 0 && withIt < opts.length;
  });
  return answerByMark ? null : { ...spec, keepMarks: true };
}

/**
 * A word_blank under a stem about a mark, whose word carries that mark NOWHERE
 * (prod: «گنا» for a تشدید lesson). The code cannot know which letter the mark
 * belongs on, so the question goes back to the author. Returns the reason, or null.
 */
function markMissing(spec, stem = '') {
  if (!spec || spec.type !== 'word_blank') return null;
  const word = Array.isArray(spec.letters) && spec.letters.length ? spec.letters.join('') : String(spec.word || '');
  const missing = MARKS.filter((m) => m.words.test(String(stem || '')) && !word.includes(m.ch));
  if (!missing.length) return null;
  return `the question is about a mark (${missing.map((m) => `«\u0640${m.ch}»`).join(', ')}) but the word «${word}» is drawn without it; write the word with the mark on its letter, and the picture keeps the mark on screen over the gap`;
}

// ─── change 5: the options name labels that are DRAWN ─────────────────────

const HANDLE_PREFIX = /^(bar|row|picture|part|clock|box|group|shape)\s+/i;

/**
 * Options that are handles (P, Q, R; "Bar P") must each be a label the drawing
 * actually prints. The clock engine draws ONE clock whatever `rows` says, so
 * "R / P / Q" pointed at two pictures that do not exist (W32b item 9).
 * @param {string[]} drawnTexts the text the rendered SVG carries
 * @returns {string[]|null} the handles that are not drawn, or null
 */
function handlesNotDrawn(drawnTexts, options = []) {
  const opts = (Array.isArray(options) ? options : []).map((o) => String(o == null ? '' : o).trim().replace(HANDLE_PREFIX, ''));
  if (!opts.length || !opts.every((o) => /^[A-Z]{1,2}$/.test(o))) return null;
  const drawn = new Set((Array.isArray(drawnTexts) ? drawnTexts : []).map((t) => String(t).trim()));
  const missing = opts.filter((o) => !drawn.has(o));
  return missing.length ? missing : null;
}

// ─── a drawn count that IS the key ─────────────────────────────────────────

const COUNT_ASK = /\b(how many|count)\b|کتن[ےیا]|گن(?:یں|و|ئیں)/i;

/**
 * A picture of ONE quantity under a "which number…" stem, where that quantity
 * is the key: the child reads the answer off the picture instead of using the
 * idea (W32b item 17: a ten-frame of exactly 7, "which number leaves one over
 * in pairs?", keyed 7). A "how many?" stem is counting, and counting the picture
 * is the task. Returns the reason, or null.
 */
function drawnCountIsKey(spec, stem = '', options = [], correctIndex = 0) {
  if (!spec || typeof spec !== 'object') return null;
  let n = null;
  if (spec.type === 'count_frame') n = Number(spec.count);
  if (spec.type === 'count_objects') {
    const rows = Array.isArray(spec.rows) && spec.rows.length ? spec.rows : [{ count: spec.count }];
    if (rows.length === 1) n = Number(rows[0] && rows[0].count);
  }
  if (!Number.isFinite(n) || COUNT_ASK.test(String(stem || ''))) return null;
  const opts = (Array.isArray(options) ? options : []).map((o) => String(o == null ? '' : o).trim());
  if (!opts.length || !opts.every((o) => /^\d+$/.test(o))) return null;
  return Number(opts[Number(correctIndex)]) === n
    ? `the picture draws exactly ${n} and ${n} is the answer, so the child reads the key off the picture`
    : null;
}

module.exports = {
  handlesNotDrawn, drawnCountIsKey,
  markMissing,
  QUIZ_AUTHOR_GATES_V2_KEY, isQuizAuthorGatesV2, runWithAuthorGates, authorGatesOn,
  indistinctParts, placeValueFix, markFix, PICTURE_N,
};
