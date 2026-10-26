'use strict';
/**
 * Urdu words the one voice reads wrong from their Urdu spelling, and the spelling it is given instead (the TTS input
 * only; the screen keeps the Urdu). A Devanagari respelling, picked by ear on the voice's own takes (Oct 2026): Urdu
 * with diacritics alone did not fix them. Whole words only: a word that contains a listed word (ساتھی) is left as it is.
 *
 * No requires: the portal's tests may load this file from the bot folder.
 */

const SAY = Object.freeze({
  'فاختائیں': 'फ़ाख़्ताएँ',
  'کھیر': 'खीर',
  'ساتھ': 'साथ',
  'مینہ': 'मेंह',
  'گیت': 'गीत',
  'چیل': 'चील',
  'میلا': 'मेला',
  'ثے': 'से',
});

// The diacritics, tatweel and joiners a written word may carry; a listed word matches with or without them.
const MARKS = /[ً-ٰٟـ‌‍]/g;
const bare = (w) => w.normalize('NFC').replace(MARKS, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ه/g, 'ہ');
const LISTED = new Map(Object.entries(SAY).map(([w, say]) => [bare(w), say]));

// A voice that reads a listed word right from its Urdu spelling: voice id -> the listed words left as written for it.
// Data only, empty today (every voice is given every respelling).
const SKIP_FOR = Object.freeze({});

/**
 * `text` as the voice is given it: each listed Urdu word respelled, every other character as written. Pure.
 * `opts.voice` (optional): the voice's id; the words SKIP_FOR lists for it stay as written. `opts.skipFor` stands in
 * for SKIP_FOR (tests). With no exception for the voice, the output is exactly sayOf(text).
 */
function sayOf(text, opts = {}) {
  const skips = ((opts && opts.skipFor) || SKIP_FOR)[opts && opts.voice];
  const skip = Array.isArray(skips) && skips.length ? new Set(skips.map(bare)) : null;
  return String(text).replace(/[؀-ۿݐ-ݿ‌‍]+/g, (word) => {
    const b = bare(word);
    return (skip && skip.has(b) ? null : LISTED.get(b)) || word;
  });
}

module.exports = { SAY, SKIP_FOR, sayOf };
