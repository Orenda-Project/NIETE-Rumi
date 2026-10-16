'use strict';
/**
 * Which words asked for a quiz, as the quiz_cmd event's `src` (a pure leaf: no IO, no require). Nothing here makes a
 * word quiz-shaped: that stays quiz-menu-request.js's isQuizMenuRequest, unchanged — the bot's own name «جگنو» / `jugnu`
 * is NOT a quiz request (it goes to the general bot as today).
 *
 * The class message's line prefills exactly `quiz` (src class_msg); the shared card's line prefills `quiz please` /
 * «کوئز دکھائیں» (src card_share; the card module's CARD_RETURN_WORDS — a test keeps the two lists equal);
 * `/quiz…` and every other quiz-shaped spelling are typed.
 */
const CLASS_WORD = 'quiz';
const CARD_WORDS = Object.freeze(['quiz please', 'کوئز دکھائیں']);

/** Lower-case, no punctuation, single spaces (Urdu letters kept). */
function norm(text) {
  return String(text == null ? '' : text).normalize('NFKC').toLowerCase()
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Which words asked: typed | class_msg | card_share | menu | home. Pure. */
function srcOf(body, door = 'text') {
  if (door === 'menu') return 'menu';
  if (door === 'home') return 'home';
  const raw = String(body || '').trim();
  if (/^\/quiz/i.test(raw)) return 'typed';
  const n = norm(raw);
  if (n === CLASS_WORD) return 'class_msg';
  if (CARD_WORDS.map(norm).includes(n)) return 'card_share';
  return 'typed';
}

module.exports = { norm, srcOf, CLASS_WORD, CARD_WORDS };
