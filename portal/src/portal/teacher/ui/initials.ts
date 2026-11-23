/**
 * The avatar's letters for a name: the first letter of the first and last words, upper-cased ("Ayesha Bibi" → "AB",
 * one word → its first letter, nothing → "·").
 *
 * bd-o15qnr.45 (queue #240; the operator 23 Nov ~23:20: 'Imran Baig (Test)' showed "I(") — LETTERS only: a part in
 * brackets is a note, not a name ("Imran Baig (Test)" → "IB"), and a word's dots, digits and marks are skipped
 * ("Dr. Rifat Yasmeen" → "DY"). A name that is only a bracketed note keeps its letters ("(Test)" → "T"). Urdu letters
 * count as letters ("عائشہ بی بی" → "عب").
 */
const LETTER = /\p{L}/u;

function lettersOnly(word: string): string {
  return Array.from(word).filter((ch) => LETTER.test(ch)).join('');
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).map(lettersOnly).filter(Boolean);
}

export function initialsOf(name: string): string {
  const raw = String(name || '').trim();
  let words = wordsOf(raw.replace(/[([{][^)\]}]*[)\]}]/g, ' '));
  if (!words.length) words = wordsOf(raw);
  if (!words.length) return '·';
  const first = (w: string) => Array.from(w)[0];
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '')).toUpperCase();
}
