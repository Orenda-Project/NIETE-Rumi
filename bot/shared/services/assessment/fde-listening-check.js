'use strict';
/**
 * A listening answer the story never says (bd-5jmnfj.4.55). v24 G2 English asked "Why was Aisha
 * a little sad?" -> "She missed her home in Multan and her old friends." The story says neither
 * sad nor old friends, so a teacher marks the child against words no one read out.
 *
 * Every item but the last (the apply question, answered from the child's own life) must use the
 * story's words: each content word of its answer matches a script word by a light stem (drop
 * s/ed/ing) or a shared 4-letter start ("mango" ~ "mangoes"). An Urdu script is not checked: its
 * postpositions shift between a poem and its answer («شاخ پہ» / «شاخ پر»).
 *
 * Pure: no I/O, never throws.
 */

const STOP = new Set([
  'a', 'an', 'the', 'she', 'he', 'her', 'his', 'they', 'their', 'it', 'and', 'in', 'on', 'of', 'to', 'was', 'is', 'at', 'for', 'with',
  'because', 'yes', 'no', 'not', 'so', 'but', 'did', 'do', 'does', 'be', 'are', 'were', 'has', 'had', 'have', 'by', 'from', 'that',
  'this', 'i', 'you', 'we', 'my', 'your', 'our', 'me', 'him', 'them',
]);
const ARABIC = /\p{Script=Arabic}/u;

const words = (text) => String(text == null ? '' : text).toLowerCase().split(/\s+/)
  .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/'s$/, ''))
  .filter(Boolean);
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w.replace(/s$/, ''));
const same = (a, b) => a === b || stem(a) === stem(b) || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/** The answer words of the non-apply items that the script never says; [] when all are said or the script is Urdu. */
function unsaidWords(script, items) {
  if (typeof script !== 'string' || !script.trim() || ARABIC.test(script) || !Array.isArray(items)) return [];
  const told = words(script);
  const out = [];
  items.slice(0, -1).forEach((it) => {
    words(it && it.answer).forEach((w) => {
      if (!STOP.has(w) && !told.some((t) => same(w, t)) && !out.includes(w)) out.push(w);
    });
  });
  return out;
}

module.exports = { unsaidWords };
