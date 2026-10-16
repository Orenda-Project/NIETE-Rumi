'use strict';
/**
 * The words that ask for a quiz under the one door, and the source each one names — a pure leaf (no IO, no require),
 * so the text door and the child's door can ask "is this the return word?" without loading the reply's service.
 *
 * The class message's line prefills exactly `quiz` (src class_msg); the shared card's line prefills `quiz please` /
 * «کوئز دکھائیں», and `jugnu` / «جگنو» answer too (src card_share); `/quiz…` and every other spelling are typed.
 */
const CLASS_WORD = 'quiz';
const CARD_WORDS = Object.freeze(['quiz please', 'کوئز دکھائیں', 'jugnu', 'جگنو']);
const RETURN_WORDS = Object.freeze(['jugnu', 'جگنو']);

/** Lower-case, no punctuation, single spaces (Urdu letters kept). */
function norm(text) {
  return String(text == null ? '' : text).normalize('NFKC').toLowerCase()
    .replace(/[​-‏‪-‮⁦-⁩﻿]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Is this the bare return word (`jugnu` / «جگنو») — quiz-shaped ONLY under the switch? Pure. */
function isReturnWord(text) {
  return RETURN_WORDS.includes(norm(text));
}

/** Which words asked: typed | class_msg | card_share | menu | home. Pure. */
function srcOf(body, door = 'text') {
  if (door === 'menu') return 'menu';
  if (door === 'home') return 'home';
  const raw = String(body || '').trim();
  if (/^\/quiz/i.test(raw)) return 'typed';
  const n = norm(raw);
  if (n === CLASS_WORD) return 'class_msg';
  if (CARD_WORDS.includes(n)) return 'card_share';
  return 'typed';
}

module.exports = { norm, isReturnWord, srcOf, CLASS_WORD, CARD_WORDS, RETURN_WORDS };
