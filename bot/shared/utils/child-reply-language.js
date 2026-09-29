'use strict';
/**
 * Which language a child's reply should be in, decided in code, per turn.
 *
 * The model is told the answer; it is not asked to work it out. An instruction
 * alone ("reply in the language the child writes in") loses to the model's own
 * earlier replies, which sit much closer to the child's message than the
 * system prompt does, so a child who wrote English kept getting Urdu once the
 * chat had drifted, and a child answering "b" was flipped back and forth.
 *
 *   Urdu script in the message                  -> 'ur'
 *   Latin text with clear English evidence      -> 'en'
 *   Latin text with clear Roman-Urdu evidence   -> 'ur' (answered in Urdu script)
 *   no clear evidence (a letter, a number, a name, one word, a tie)
 *                                               -> the language the bot's LAST reply in
 *                                                  this chat is actually written in,
 *                                                  else the quiz language
 *
 * "Actually written in" is read from the reply text, not from the stored
 * conversations.output_language: that column records the language that was
 * REQUESTED, so reading it would carry every past drift forward.
 *
 * English vs Roman Urdu is a stop-word count over two small word lists — no
 * model call, no I/O. Words that are common in both (to, me, is-as-"this",
 * or-as-"aur", be-as-"bhi", by-as-"bye") are left out of the list they would
 * mislead, or counted where they are the stronger signal. Pure functions only.
 */

const { clampLanguage } = require('../config/ux-strings');

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN_LETTER = /[A-Za-z]/g;

const ROMAN_URDU_WORDS = new Set([
  'hai', 'hain', 'ha', 'hy', 'h', 'ho', 'hon', 'hun', 'hu', 'hoon', 'tha', 'thi', 'thay',
  'ka', 'ki', 'ke', 'k', 'ko', 'se', 'ne', 'mein', 'mai', 'ma', 'main', 'mujhe', 'mujhy', 'mera', 'meri', 'mere', 'maine',
  'ap', 'aap', 'apka', 'apki', 'aapko', 'apko', 'aapne', 'apne', 'aapane', 'tum', 'hum', 'hamein',
  'kya', 'kia', 'kyun', 'kyu', 'kaise', 'kese', 'kaisay', 'kon', 'kaun', 'konsa', 'kounsa', 'kab', 'kahan', 'kitna', 'kitne',
  'nahi', 'nahin', 'nhi', 'ni', 'nai', 'na',
  'aur', 'ya', 'bhi', 'jo', 'ye', 'yeh', 'yah', 'wo', 'woh', 'vah', 'iska', 'uska', 'koi', 'sab', 'ek', 'kuch', 'kuchh',
  'kar', 'karo', 'karen', 'karein', 'karna', 'kr', 'krna', 'kiya', 'diya', 'de', 'do', 'dein', 'den',
  'raha', 'rahi', 'rahe', 'gaya', 'gayi', 'ga', 'gi', 'sakta', 'sakti', 'sakte', 'chahiye', 'chahie',
  'bata', 'batao', 'batain', 'bataen', 'bhej', 'bhejo', 'bheje', 'bhejen', 'bhejain', 'likh', 'likha', 'likho', 'likhna',
  'ab', 'abhi', 'abi', 'phir', 'dobara', 'dubara', 'jaldi', 'mazeed', 'wala', 'wali', 'waly', 'tarah', 'matlab',
  'sawal', 'jawab', 'naam', 'nam', 'sahi', 'galat', 'ghalat', 'theek', 'thik', 'acha', 'achha', 'accha', 'shukriya', 'ji', 'han', 'haan', 'jee',
  'par', 'pr', 'per', 'upar', 'neeche', 'samajh', 'samjh', 'samjha', 'samjhao', 'pata', 'chalo',
  'agar', 'bas', 'kare', 'karey', 'kry', 'krein', 'krei', 'kren', 'kisi', 'ksi', 'koye', 'mujy', 'lain', 'lein', 'lenge', 'puchna', 'pucho', 'poocho', 'bajo', 'bayen', 'mara', 'zara', 'dosri', 'doosri', 'dusri', 'thora', 'thoda'
]);

const ENGLISH_WORDS = new Set([
  'i', 'my', 'you', 'your', 'the', 'and', 'of', 'in', 'this', 'that', 'what', 'which', 'how', 'why', 'when', 'where', 'who',
  'can', 'am', 'are', 'was', 'were', 'for', 'it', 'more', 'give', 'yes', 'again', 'want', 'not', "don't", 'dont', 'next', 'on',
  'please', 'with', 'one', 'like', 'thanks', 'thank', 'so', 'have', 'has', 'all', 'now', 'will', 'from', 'but', 'okay',
  'help', 'correct', 'about', 'tell', 'explain', 'know', 'understand', 'need', 'should', 'could', 'would', 'did', 'does',
  'there', 'their', 'they', 'we', 'our', 'an', 'at', 'if', 'any', 'some', 'many', 'much', 'very', 'good', 'right', 'wrong',
  'answer', 'question', 'questions', 'meaning', 'mean', 'is',
  'she', 'her', 'his', 'him', 'sorry', 'ready', 'play', 'start', 'let', 'lets', "let's", "i'm", 'im', 'hello', 'busy', 'every'
]);

function count(text, re) {
  return (String(text || '').match(re) || []).length;
}

/**
 * 'ur' | 'en' | null for ONE child message. null = no clear language.
 * @param {string} message
 * @returns {'ur'|'en'|null}
 */
function childMessageLanguage(message) {
  const text = String(message || '');
  if (count(text, ARABIC_SCRIPT) > 0) return 'ur';
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 2) return null;
  let ur = 0;
  let en = 0;
  for (const w of words) {
    if (ROMAN_URDU_WORDS.has(w)) ur += 1;
    else if (ENGLISH_WORDS.has(w)) en += 1;
  }
  if (ur > en) return 'ur';
  if (en > ur) return 'en';
  return null;
}

/**
 * The language a bot reply is written in: Urdu script -> 'ur'; Latin text that
 * reads as Roman Urdu -> 'ur'; other Latin text -> 'en'; nothing -> null.
 * @param {string} reply
 * @returns {'ur'|'en'|null}
 */
function replyTextLanguage(reply) {
  const text = String(reply || '');
  const arabic = count(text, ARABIC_SCRIPT);
  const latin = count(text, LATIN_LETTER);
  if (!arabic && !latin) return null;
  if (arabic >= latin) return 'ur';
  return clampLanguage(childMessageLanguage(text));
}

/**
 * The script a message is written in, for telemetry.
 * @returns {'urdu_script'|'latin'|'mixed'|'none'}
 */
function messageScript(message) {
  const arabic = count(message, ARABIC_SCRIPT);
  const latin = count(message, LATIN_LETTER);
  if (arabic && latin) return 'mixed';
  if (arabic) return 'urdu_script';
  if (latin) return 'latin';
  return 'none';
}

/**
 * The reply language for one child turn.
 * @param {object} args
 * @param {string} args.message - the child's message
 * @param {Array<{role:string, content:string}>} [args.history] - the chat the model will read
 * @param {string|null} [args.quizLanguage] - the language of the child's last quiz
 * @returns {{language:'ur'|'en', source:'message'|'last_reply'|'quiz', messageScript:string}}
 */
function decideChildReplyLanguage({ message, history = [], quizLanguage = null } = {}) {
  const script = messageScript(message);
  const fromMessage = childMessageLanguage(message);
  if (fromMessage) return { language: fromMessage, source: 'message', messageScript: script };
  const turns = Array.isArray(history) ? history : [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i] && turns[i].role === 'assistant') {
      const lang = replyTextLanguage(turns[i].content);
      if (lang) return { language: lang, source: 'last_reply', messageScript: script };
      break;
    }
  }
  return { language: clampLanguage(quizLanguage), source: 'quiz', messageScript: script };
}

module.exports = { childMessageLanguage, replyTextLanguage, messageScript, decideChildReplyLanguage };
