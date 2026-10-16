'use strict';
/**
 * Checking what code can check for certain in an English paper: an anagram MCQ's
 * key, and that a rhyming-words item is set on lines of a poem.
 *
 * "Which word can be made by rearranging the letters of 'tasr'?" with tars, rest,
 * rats and sort as options has two right answers and a wrong key. Whether an option
 * is an anagram of the quoted word is a letter count, so it is checked, never trusted:
 * the item is placed only when exactly one option is an anagram and the key names it.
 *
 * Pure: no I/O, never throws, the item passed in is not touched.
 */

// The class: an anagram, or rearranging / unscrambling / reordering LETTERS (not words).
const ANAGRAM = /(?<![a-z])anagrams?(?![a-z])/i;
const REARRANGE = /(?<![a-z])(?:re-?arrang|unscrambl|re-?order|jumbl)[a-z]*/i;
const LETTERS = /(?<![a-z])letters?(?![a-z])/i;
// One quoted word: 'tasr', "tasr", ‘tasr’, “tasr”, «tasr».
const QUOTED = /(?:'([A-Za-z]+)'|"([A-Za-z]+)"|‘([A-Za-z]+)’|“([A-Za-z]+)”|«([A-Za-z]+)»)/g;
const OPTION_LETTER = /^\s*\(?([a-h])\s*[).]\s*/i;

const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const lettersOf = (word) => word.toLowerCase().split('').sort().join('');

function optionParts(options) {
  return options.map((opt, i) => {
    const text = String(opt).trim();
    const m = OPTION_LETTER.exec(text);
    return { letter: m ? m[1].toLowerCase() : 'abcdefgh'[i], body: (m ? text.slice(m[0].length) : text).trim() };
  });
}

// The keyed letter: "d", "d)", "(d)", "D." or "d) sort"; else the option whose text the key is.
function keyedLetter(answer, parts) {
  if (typeof answer !== 'string') return null;
  const t = answer.trim();
  const m = OPTION_LETTER.exec(t) || /^\(?([a-h])\)?$/i.exec(t);
  if (m) return m[1].toLowerCase();
  const hit = parts.find((p) => p.body.toLowerCase() === t.toLowerCase());
  return hit ? hit.letter : null;
}

/**
 * anagramVerdict(item) → { ok: true } | { ok: false, passing: [letters] } | { ok: null }
 *
 * For an MCQ that asks for an anagram of a quoted word: ok when exactly one option is
 * one (same letters, same counts, not the word itself) and the key names it; otherwise
 * the letters of the options that are. A stem of the class with no single quoted word
 * cannot be checked and is `{ ok: false, passing: [] }`. Any other item is `{ ok: null }`.
 */
function anagramVerdict(item) {
  try {
    if (!isObject(item) || typeof item.question !== 'string' || !Array.isArray(item.options) || item.options.length < 2) return { ok: null };
    const stem = item.question;
    if (!ANAGRAM.test(stem) && !(REARRANGE.test(stem) && LETTERS.test(stem))) return { ok: null };
    const quoted = [...stem.matchAll(QUOTED)].map((m) => m.slice(1).find((g) => g !== undefined));
    if (new Set(quoted.map((w) => w.toLowerCase())).size !== 1) return { ok: false, passing: [] };
    const word = quoted[0].toLowerCase();
    const parts = optionParts(item.options);
    const passing = parts
      .filter((p) => /^[A-Za-z]+$/.test(p.body) && p.body.toLowerCase() !== word && lettersOf(p.body) === lettersOf(word))
      .map((p) => p.letter);
    if (passing.length !== 1) return { ok: false, passing };
    return keyedLetter(item.answer, parts) === passing[0] ? { ok: true } : { ok: false, passing };
  } catch (_) {
    return { ok: null };
  }
}

// Words in a title that say the model found no poem and wrote its own cue list instead.
const NO_POEM_TITLE = /cue\s+words?|not\s+in\s+the\s+given\s+pages/i;

/**
 * rhymingPoemVerdict(item) → { ok: true } | { ok: false, reason: 'passage' | 'title' | 'prose' }
 *
 * A Rhyming Words item is set on lines of a poem printed in the book. It is not
 * placed when its passage is empty, when its title says there is no poem («Cue words»,
 * «not in the given pages»), or when the passage is prose (no line breaks).
 */
function rhymingPoemVerdict(item) {
  if (!isObject(item)) return { ok: false, reason: 'passage' };
  const passage = typeof item.passage === 'string' ? item.passage.trim() : '';
  if (!passage) return { ok: false, reason: 'passage' };
  if (NO_POEM_TITLE.test(String(item.question || ''))) return { ok: false, reason: 'title' };
  if (!/\r?\n/.test(passage)) return { ok: false, reason: 'prose' };
  return { ok: true };
}

module.exports = { anagramVerdict, rhymingPoemVerdict };
