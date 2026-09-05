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

/**
 * Speech-to-text writes English technical terms in Urdu letters ("فیکشن") and a
 * model mirrors the transcript. The operator's rule is the other way round —
 * Urdu written well, English terms in English letters — so the known ones are
 * rewritten deterministically before validation. Longest first so a plural or
 * a compound wins over its stem. Case is the English convention (lower-case
 * common nouns).
 */
const TRANSLITERATIONS = [
  ['پروپر فیکشنز', 'proper fractions'], ['پروپر فیکشن', 'proper fraction'], ['پراپر فیکشن', 'proper fraction'],
  ['امپروپر فیکشن', 'improper fraction'], ['مکسڈ فیکشن', 'mixed fraction'],
  ['فیکشنز', 'fractions'], ['فیکشن', 'fraction'], ['فریکشنز', 'fractions'], ['فریکشن', 'fraction'],
  ['نیومریٹر', 'numerator'], ['نمبریٹر', 'numerator'], ['نیومیریٹر', 'numerator'],
  ['ڈینومینیٹر', 'denominator'], ['ڈینامینیٹر', 'denominator'], ['ڈی نومینیٹر', 'denominator'],
  ['سبٹریکشن', 'subtraction'], ['ایڈیشن', 'addition'], ['ملٹی پلیکیشن', 'multiplication'], ['ملٹیپلیکیشن', 'multiplication'], ['ڈویژن', 'division'],
  ['پلیس ویلیو', 'place value'], ['ڈیجٹس', 'digits'], ['ڈیجٹ', 'digit'],
  ['ٹرائی اینگل', 'triangle'], ['ریکٹینگل', 'rectangle'], ['پیری میٹر', 'perimeter'],
  ['فوٹو سنتھیسز', 'photosynthesis'], ['فوٹوسنتھیسز', 'photosynthesis'], ['ایکو سسٹم', 'ecosystem'], ['ایکوسسٹم', 'ecosystem'],
  ['کلوگرام', 'kilogram'], ['ٹمپریچر', 'temperature'], ['میٹیریل', 'material'], ['لیکوئڈ', 'liquid'],
  ['پروناؤن', 'pronoun'], ['ایڈجیکٹو', 'adjective'], ['سینٹینس', 'sentence'], ['نائون', 'noun'],
];

function fixTransliterations(text) {
  let out = String(text || '');
  for (const [ur, en] of TRANSLITERATIONS) out = out.split(ur).join(en);
  return out;
}

/** Apply the fixer to every child-facing field of an authored question. */
function fixQuestionTransliterations(q) {
  if (!q || typeof q !== 'object') return q;
  const fb = q.option_feedback || {};
  const wrong = {};
  Object.entries(fb.wrong || {}).forEach(([k, v]) => { wrong[k] = fixTransliterations(v); });
  const misc = {};
  Object.entries(q.distractor_misconceptions || {}).forEach(([k, v]) => { misc[k] = fixTransliterations(v); });
  return {
    ...q,
    question: fixTransliterations(q.question),
    options: Array.isArray(q.options) ? q.options.map(fixTransliterations) : q.options,
    explanation: fixTransliterations(q.explanation),
    distractor_misconceptions: Object.keys(misc).length ? misc : q.distractor_misconceptions,
    option_feedback: { ...fb, correct: fixTransliterations(fb.correct), wrong },
  };
}

module.exports = {
  fixTransliterations,
  fixQuestionTransliterations,
  TRANSLITERATIONS,
  URDU_MEDIUM,
  LANG_NAME,
  canonicalSubject,
  quizLanguageFor,
  teacherLanguageFor,
  formatLessonDate,
  isEnglishCode,
};
