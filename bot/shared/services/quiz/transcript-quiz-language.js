'use strict';
/**
 * Transcript quiz — language and subject rules, in CODE, not in a prompt.
 *
 * Quiz language (what the children read):
 *   subject ∈ {urdu, islamiat, sst, genk}  → 'ur'
 *   subject = english                       → 'en'
 *   anything else (maths, science, other)  → the lesson's language ('ur' when mixed)
 *
 * Teacher-facing language (offer, PDF caption, report):
 *   users.preferred_language → transcript language → 'ur'
 * Deliberately NOT the English market floor: an Urdu-speaking teacher whose
 * preference was never stored should not get an English offer.
 */

const { LANGUAGE_OFFER } = require('../../config/languages');

const URDU_MEDIUM = new Set(['urdu', 'islamiat', 'sst', 'genk']);

const LANG_NAME = { ur: 'Urdu', en: 'English' };

// Whatever a teacher, a transcript or an earlier pass calls a subject, one
// name internally. Keys are lowercased; matching is exact first, then by
// substring so "General Science (Grade 5)" still lands on science.
const CANON = [
  ['islamiat', ['islamiat', 'islamiyat', 'islamic studies', 'islamic study', 'islamiyaat', 'deeniyat', 'اسلامیات', 'دینیات']],
  ['urdu', ['urdu', 'اردو']],
  ['english', ['english', 'english language', 'eng', 'انگریزی', 'انگلش']],
  ['maths', ['maths', 'math', 'mathematics', 'riyazi', 'ریاضی', 'حساب']],
  ['science', ['science', 'general science', 'gen science', 'sci', 'سائنس']],
  ['sst', ['sst', 'social studies', 'social study', 'social science', 'pakistan studies', 'pak studies', 'معاشرتی علوم', 'مطالعہ پاکستان']],
  ['genk', ['genk', 'gk', 'general knowledge', 'meri kitab', 'میری کتاب', 'معلومات عامہ']],
];

function canonicalSubject(subject) {
  const s = String(subject || '').trim().toLowerCase();
  if (!s) return 'other';
  for (const [canon, names] of CANON) {
    if (names.includes(s)) return canon;
  }
  for (const [canon, names] of CANON) {
    if (names.some((n) => n.length > 2 && s.includes(n))) return canon;
  }
  return 'other';
}

function isEnglishCode(lang) {
  const l = String(lang || '').trim().toLowerCase();
  return l === 'en' || l.startsWith('en-') || l.startsWith('en_') || l === 'english';
}

function quizLanguageFor(subject, transcriptLanguage) {
  const canon = canonicalSubject(subject);
  if (URDU_MEDIUM.has(canon)) return 'ur';
  if (canon === 'english') return 'en';
  return isEnglishCode(transcriptLanguage) ? 'en' : 'ur';
}

function teacherLanguageFor({ preferredLanguage, transcriptLanguage } = {}) {
  const pref = String(preferredLanguage || '').trim();
  if (pref && LANGUAGE_OFFER.includes(pref)) return pref;
  if (transcriptLanguage) return isEnglishCode(transcriptLanguage) ? 'en' : 'ur';
  return 'ur';
}

const UR_MONTHS = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PKT_OFFSET_MIN = 5 * 60;

/**
 * "5 ستمبر" / "5 Sep" (with the year when asked), in Pakistan time. Digits stay
 * ASCII in both languages — that is how NIETE teachers write dates on WhatsApp.
 */
function formatLessonDate(iso, language, { year = false } = {}) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pkt = new Date(d.getTime() + PKT_OFFSET_MIN * 60 * 1000);
  const day = pkt.getUTCDate();
  const mi = pkt.getUTCMonth();
  const y = pkt.getUTCFullYear();
  const month = language === 'ur' ? UR_MONTHS[mi] : EN_MONTHS[mi];
  return year ? `${day} ${month} ${y}` : `${day} ${month}`;
}

module.exports = {
  URDU_MEDIUM,
  LANG_NAME,
  canonicalSubject,
  quizLanguageFor,
  teacherLanguageFor,
  formatLessonDate,
  isEnglishCode,
};
