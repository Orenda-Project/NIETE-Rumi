'use strict';
/**
 * Is this message a teacher asking to register? (pure)
 *
 * Until this, only the exact text "/register" opened the registration Flow. In production,
 * 16 Sep – 16 Oct 2026, 25 teachers sent a bare "Register", 3 sent "Register me", others
 * "i need to register" or "get registered", and 16 sent a slash form that missed by a
 * character ("/registered", "/ register", "Type/register", "/registere"). None of them got
 * a form: a substring keyword branch answered "I'll ask for your name after you try one of
 * my features!", or the AI chat did.
 *
 * The same substring rule also caught the attendance REGISTER ("attendence register grade
 * 5b", "daily attendence register") and "Mera registration number kia hai". So this is a
 * whitelist, not a substring: a message is a request only when it is SHORT, carries the
 * register stem, and every other word is one a person uses to ask for it ("i need to",
 * "please", "krna k lye", "مجھے … کرنا ہے"). Anything about attendance, a class, a number,
 * or a digit is not a request to set up her own account.
 */

// Bidi controls a copied or isolated command carries (the Urdu copy isolates /register).
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩﻿]/g;

// The register stem, in Latin and Urdu script. "unregister" is not it (\b), nor "registrar".
const STEM = /^(?:register(?:ed|e|ing)?|registration|registeration|registr|regster|registor|signup|رجسٹر|رجسٹریشن|رجسٹرڈ)$/;

// Words that make it about something other than her own account.
const OFF_TOPIC = /^(?:attendance|attendence|atendance|attendnce|haziri|hazri|حاضری|number|no|roll|admission|dakhla|داخلہ|class|classes|grade|students?|children|list|book|copy|جماعت|کلاس|طلبہ|نمبر|بچوں|فہرست)$/;

// Every other word in a request must come from here.
const ASKING_WORDS = new Set([
  // English
  'i', 'me', 'my', 'myself', 'need', 'want', 'have', 'has', 'to', 'please', 'plz', 'pls', 'kindly',
  'how', 'do', 'can', 'could', 'get', 'got', 'account', 'on', 'in', 'with', 'for', 'niete', 'portal',
  'the', 'a', 'an', 'now', 'here', 'bot', 'app', 'sign', 'up', 'type', 'am', 'im', "i'm", 'already',
  'again', 'want', 'wanna', 'would', 'like', 'help', 'is', 'it', 'yes', 'ok', 'okay', 'hi', 'hello',
  'sir', 'madam', 'mam', 'maam', 'myself', 'as', 'teacher', 'principal', 'new', 'complete', 'my',
  // Roman Urdu
  'mujhe', 'mujhy', 'mjhe', 'mjhy', 'muje', 'main', 'mai', 'mein', 'mera', 'meri', 'apna', 'apni',
  'kar', 'kr', 'karna', 'krna', 'karni', 'krni', 'karo', 'kro', 'karen', 'karein', 'kren', 'krein',
  'krwana', 'karwana', 'krwa', 'karwa', 'krwani', 'karwani', 'karwaen', 'krwaen', 'do', 'dein', 'den',
  'dain', 'hai', 'he', 'h', 'hy', 'k', 'ke', 'ky', 'kay', 'ki', 'ka', 'lye', 'liye', 'lie', 'liay',
  'liyay', 'chahta', 'chahti', 'chahiye', 'chahye', 'chahie', 'kaise', 'kese', 'kaisay', 'kesy',
  'hona', 'hun', 'hoon', 'ho', 'gaya', 'gya', 'nahi', 'nai', 'abhi', 'mujh',
  // Urdu script
  'مجھے', 'میں', 'میرا', 'میری', 'اپنا', 'اپنی', 'کرنا', 'کرنی', 'کریں', 'کرو', 'کر', 'کروانا', 'کروائیں',
  'ہے', 'ہوں', 'ہو', 'چاہتی', 'چاہتا', 'چاہیے', 'کیسے', 'کے', 'کی', 'کا', 'لیے', 'لئے', 'دیں', 'براہ',
  'کرم', 'اکاؤنٹ', 'پورٹل',
]);

const MAX_WORDS = 9;

/**
 * Split into words, after the repairs a typed command needs: bidi controls stripped, case
 * folded, trailing punctuation dropped, and the slash detached ("Type/register" → type
 * register, "register/" → register, "/ register" → register).
 */
function wordsOf(text) {
  const cleaned = text
    .replace(BIDI_CONTROLS, '')
    .toLowerCase()
    .replace(/[\\/]/g, ' ')
    .replace(/[.,!?;:،۔؟"'“”()\[\]*_~-]+/g, ' ')
    .trim();
  return cleaned ? cleaned.split(/\s+/) : [];
}

/**
 * @param {*} text the message as it arrived
 * @returns {boolean} true when the whole message asks to register her own account
 */
function isRegistrationIntent(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  if (/\d/.test(text)) return false; // a number means someone else's registration, or a register's
  if (/\bsign\s*up\b/i.test(text) && wordsOf(text).length <= 3) return true;

  const words = wordsOf(text);
  if (!words.length || words.length > MAX_WORDS) return false;

  let stem = false;
  for (const w of words) {
    if (STEM.test(w)) { stem = true; continue; }
    if (OFF_TOPIC.test(w)) return false;
    if (!ASKING_WORDS.has(w)) return false;
  }
  return stem;
}

module.exports = { isRegistrationIntent };
