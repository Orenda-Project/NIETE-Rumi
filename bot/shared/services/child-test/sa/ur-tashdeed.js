'use strict';

/**
 * Jugnu's Urdu narrations as the voice is given them with tashdeed (switch sa_voice_tashdeed): each doubled letter
 * in the narrations' words carries its shadda, and a short word that reads two ways carries its vowel inside its
 * phrase only. The voice input only: the screen and the clip key keep the line as written, and only marks are added
 * (the letters are the line's own).
 *
 * No requires: the portal's tests may load this file from the bot folder.
 */

// Whole words, with and without their marks: the word, then as it is voiced.
const WORDS = Object.freeze({
  'السلام': 'السّلام',
  'بچے': 'بچّے',
  'بچوں': 'بچّوں',
  'بچہ': 'بچّہ',
  'بلی': 'بلّی',
  'تہجی': 'تہجّی',
  'ہجے': 'ہجّے',
  'حصہ': 'حصّہ',
  'حصے': 'حصّے',
});

// A word that reads two ways, in the phrase that settles it (کل is "kal" in a story and "kul" in a sum).
const PHRASES = Object.freeze([
  ['رک جائیں', 'رُک جائیں'],
  ['اڑ رہا', 'اُڑ رہا'],
  ['اتر جاتا', 'اُتر جاتا'],
  ['مل کر', 'مِل کر'],
  ['کل کتنی', 'کُل کتنی'],
]);

const MARKS = /[ً-ٰٟ]/gu;
const bare = (w) => w.normalize('NFC').replace(MARKS, '');
const LISTED = new Map(Object.entries(WORDS).map(([w, say]) => [bare(w), say]));

// The roles of Jugnu's narrations; items (letters, words, numbers) and passages are left as they are.
const NARRATION = new Set(['battery', 'instruction', 'feedback', 'question', 'problem', 'check']);

/** `text` with the narrations' tashdeed and vowels added; every other character as written. Pure. */
function tashdeedOf(text) {
  let out = String(text == null ? '' : text);
  for (const [from, to] of PHRASES) out = out.split(from).join(to);
  return out.replace(/[؀-ۿݐ-ݿ]+/g, (word) => (word === bare(word) && LISTED.get(word)) || word);
}

/** The manifest's Urdu narration rows tashdeedOf changes, each with `say` (the voiced text). */
function voicedWithTashdeed(rows) {
  return (rows || [])
    .filter((r) => r && r.lang === 'ur' && NARRATION.has(r.role))
    .map((r) => ({ ...r, say: tashdeedOf(r.text) }))
    .filter((r) => r.say !== r.text);
}

module.exports = { WORDS, PHRASES, tashdeedOf, voicedWithTashdeed };
