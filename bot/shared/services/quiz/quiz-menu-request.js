'use strict';
/**
 * Is this message a request for the quiz menu, and nothing else?
 *
 * The /quiz door used to open for three exact strings — `quiz`, `/quiz…` and
 * «کوئز». Everything a teacher actually types around them (`quiz/`, `/ quiz`,
 * `/quizz`, `quize`, `Quiz?`, `send me quiz`, `where is my quiz`, `mera quiz`,
 * `mujhe quize dein`, «کویز») fell through to the intent classifier and was
 * answered by general AI chat: 54 of 351 bare quiz requests in the fourteen
 * days to 24 Sep 2026 on production.
 *
 * A MENU REQUEST is the whole message being a quiz word plus, at most, a few
 * words that only ask for it — possessives, "send/give/show/make/new", "where
 * is", "please", and their Roman-Urdu and Urdu counterparts. A message that
 * names anything else ("quiz on fractions for class 4", "what is a quiz", "quiz
 * time") carries content and belongs to the classifier; a quiz CONTROL word
 * ("stop quiz", "next quiz", "start quiz", "exit quiz") belongs to the quiz a
 * child is taking and is never a menu request.
 *
 * Pure: no IO, no config. Shared by the teacher's text door and the child's.
 */

/** Spellings of the word itself, after normalisation (lower case, Urdu letters folded). */
const QUIZ_WORD_RX = /^(?:q(?:u|w)?(?:i|ui|iu)z{1,3}(?:e|es|s|ez|zes|ze)?|quizzes|kw?u?iz{1,2}|kwiz|کو(?:ئ|ی|ئی)ز(?:ز|یں|وں|ے)?)$/u;

/**
 * Words that ask for the quiz and say nothing about WHICH one. Deliberately
 * excludes start/stop/exit/end/next/again/take/restart/answer/result: those are
 * what a child types to a quiz in progress.
 */
const REQUEST_WORDS = new Set([
  // English
  'my', 'mine', 'me', 'i', 'a', 'an', 'the', 'all', 'our', 'show', 'send', 'give', 'open', 'see', 'view',
  'get', 'make', 'create', 'new', 'want', 'need', 'please', 'pls', 'plz', 'pleas', 'where', 'is', 'are',
  'list', 'menu', 'can', 'you', 'u',
  // Roman Urdu
  'mera', 'meray', 'mere', 'meri', 'mujhe', 'mujhay', 'muje', 'mjhe', 'mujhy', 'hamara', 'hamare',
  'den', 'dein', 'dain', 'de', 'do', 'dijiye', 'dijiey', 'dijye', 'dikhao', 'dikhaen', 'dikhayen',
  'dikhain', 'dikhaein', 'bhejo', 'bhejen', 'bhejein', 'bhejain', 'bhej', 'bhaijen', 'btao', 'batao',
  'bataen', 'bataein', 'chahiye', 'chahye', 'chaiye', 'chaye', 'chahie', 'kahan', 'kahaan', 'kidhar',
  'hai', 'hain', 'ka', 'ki', 'ke', 'kar', 'karo', 'karen', 'karein', 'kr', 'krdo', 'krden', 'ap', 'aap',
  'app', 'apna', 'apne', 'naya', 'nayi', 'banao', 'banayen', 'banaen', 'banaein',
  // Urdu
  'میرا', 'میرے', 'میری', 'مجھے', 'ہمارا', 'ہمارے', 'دکھائیں', 'دکھاؤ', 'دکھائے', 'بھیجیں', 'بھیجو',
  'بھیج', 'دیں', 'دو', 'دیجیے', 'دیجئے', 'چاہیے', 'چاہئے', 'کریں', 'کرو', 'کہاں', 'ہے', 'ہیں',
  'کا', 'کی', 'کے', 'فہرست', 'مینو', 'آپ', 'اپنا', 'اپنے', 'نیا', 'نئی', 'بنائیں', 'بنا', 'براہ',
  'مہربانی', 'کرم',
]);

/** A message longer than this is a sentence, not a request for a menu. */
const MAX_TOKENS = 6;

/**
 * Lower-case, fold the Arabic-script letters people type interchangeably, and
 * turn every punctuation mark, slash and emoji into a space.
 * @param {string} text
 * @returns {string[]} tokens
 */
function tokens(text) {
  let t = String(text == null ? '' : text).normalize('NFKC').toLowerCase();
  t = t
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')           // harakat, superscript alef, tatweel
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '') // joiners, bidi marks
    .replace(/\u0643/gu, '\u06A9')                          // Arabic kaf → Urdu keheh
    .replace(/[\u064A\u0649]/gu, '\u06CC')                  // Arabic yeh / alef maksura → Farsi yeh
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  return t.split(' ').filter(Boolean);
}

/**
 * @param {string} text the message as the teacher (or child) typed it
 * @returns {boolean} true when the message asks for the quiz menu and nothing else
 */
function isQuizMenuRequest(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return false;
  // `/quiz` with anything after it has always been the command (the topic is
  // ignored by the transcript menu) — unchanged.
  if (/^\/quiz(\s|$)/i.test(raw)) return true;
  const toks = tokens(raw);
  if (!toks.length || toks.length > MAX_TOKENS) return false;
  let quizWords = 0;
  for (const tok of toks) {
    if (QUIZ_WORD_RX.test(tok)) { quizWords += 1; continue; }
    if (!REQUEST_WORDS.has(tok)) return false;
  }
  return quizWords > 0;
}

module.exports = { isQuizMenuRequest };
