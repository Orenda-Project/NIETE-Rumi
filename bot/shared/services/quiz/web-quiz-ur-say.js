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
});

// The diacritics, tatweel and joiners a written word may carry; a listed word matches with or without them.
const MARKS = /[ً-ٰٟـ‌‍]/g;
const bare = (w) => w.normalize('NFC').replace(MARKS, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ه/g, 'ہ');
const LISTED = new Map(Object.entries(SAY).map(([w, say]) => [bare(w), say]));

/** `text` as the voice is given it: each listed Urdu word respelled, every other character as written. Pure. */
function sayOf(text) {
  return String(text).replace(/[؀-ۿݐ-ݿ‌‍]+/g, (word) => LISTED.get(bare(word)) || word);
}

module.exports = { SAY, sayOf };
