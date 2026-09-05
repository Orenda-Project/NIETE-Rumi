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
 *   users.preferred_language, clamped to the offer. Nothing else — not the
 *   transcript, not the quiz. See teacherLanguageFor().
 */

const { LANGUAGE_OFFER, getLanguage } = require('../../config/languages');
const { resolveUx, clampLanguage, subjectLabelFor } = require('../../config/ux-strings');

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

/**
 * What the TEACHER reads. The language she stored, clamped to the offer, and
 * nothing else.
 *
 * A recording never changes her language; neither does a transcript. The
 * earlier version fell back to the detected transcript language when she had
 * stored nothing, which meant the same teacher could be addressed in Urdu on
 * one surface and English on the next depending on which lesson she had just
 * recorded. clampLanguage's floor is the one answer for "nothing is known",
 * shared with the rest of the deployment.
 *
 * `transcriptLanguage` is still accepted and ignored so a stale caller cannot
 * quietly change the answer.
 */
function teacherLanguageFor({ preferredLanguage } = {}) {
  return clampLanguage(preferredLanguage);
}

/**
 * The two subjects where the quiz language is not a real choice: an
 * Urdu-grammar or an Islamiyat lesson taught in Urdu, quizzed in English, is
 * not a quiz about that lesson. Everything else is asked.
 */
const LANGUAGE_ASK_SKIPPED = new Set(['urdu', 'islamiat']);

function needsLanguageAsk(subject) {
  return !LANGUAGE_ASK_SKIPPED.has(canonicalSubject(subject));
}

const LANGUAGE_BUTTON_PREFIX = 'tq_lang_';

/**
 * The two reply buttons for the ask, the subject-rule language first — the
 * one she would have been given silently before, still the easy tap.
 *
 * Each title is the language's own name from the registry, so it cannot drift
 * from what /language and /settings show, and neither is translated: a
 * language names itself the same way whichever language you are reading in.
 */
function languageAskButtons(quizId, ruleLanguage) {
  const first = LANGUAGE_OFFER.includes(ruleLanguage) ? ruleLanguage : LANGUAGE_OFFER[0];
  const order = [first, ...LANGUAGE_OFFER.filter((c) => c !== first)];
  return order.map((code) => ({
    id: `${LANGUAGE_BUTTON_PREFIX}${code}_${quizId}`,
    title: getLanguage(code).languageTitle,
  }));
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

/**
 * The digest's canonical subject → the display code in the class reference
 * table, whose labels SUBJECT_LABELS mirrors. `sst` and `genk` are the
 * digest's own short names for the two the table spells out.
 */
const SUBJECT_LABEL_CODES = {
  urdu: 'urdu',
  english: 'english',
  maths: 'maths',
  science: 'science',
  sst: 'social_studies',
  genk: 'general_knowledge',
};

/**
 * Islamiyat is taught in these classrooms and the digest emits it, but it is
 * NOT one of the six codes seeded in the `subjects` reference table — and
 * SUBJECT_LABELS is that table's display mirror: the class-manager Flow builds
 * its subject picker from those keys and validates a teacher's selection
 * against them (class-manager-endpoint.js normalizeSubjectSelection). A
 * seventh key there would offer teachers a subject the table has never heard
 * of, so the quiz carries its own label and the mirror stays exact.
 */
const EXTRA_SUBJECT_LABELS = {
  islamiat: { en: 'Islamiyat', ur: 'اسلامیات' },
};

/** The subject's name in the reader's language, or null when we cannot name it. */
function subjectLabel(subject, language) {
  const canon = canonicalSubject(subject);
  const lang = clampLanguage(language);
  const extra = EXTRA_SUBJECT_LABELS[canon];
  if (extra) return extra[lang] || extra.en;
  const code = SUBJECT_LABEL_CODES[canon];
  return code ? subjectLabelFor(code, lang) : null;
}

// FIRST STRONG ISOLATE / POP DIRECTIONAL ISOLATE. The topic's script is not
// knowable when the catalog string is written — an Urdu topic sits inside an
// English sentence and vice versa — and an un-isolated atom drags the
// punctuation and the brackets around it (language-protocol §9.2).
const FSI = '\u2068';
const PDI = '\u2069';

function isolate(text) {
  return `${FSI}${text}${PDI}`;
}

/**
 * "Urdu lesson on *واحد اور جمع* (singular and plural)" — the one phrase the
 * offer, the hand-off and the /quiz rows all name the lesson by.
 *
 * The subject is in the TEACHER's language; the topic is the one the class
 * actually heard (the quiz language); the gloss in brackets is the teacher's
 * language and appears only when the two differ. The teacher taps "yes" on a
 * lesson she recognises, and then reads a quiz in the language her children
 * were taught in — round 1 named neither, and an English offer arriving before
 * an Urdu quiz read as two different lessons.
 */
function lessonLabel({ digest, quizLanguage, teacherLanguage } = {}) {
  const quizLang = clampLanguage(quizLanguage);
  const teacherLang = clampLanguage(teacherLanguage);
  const taught = topicFor(digest, quizLang);
  const inTeacherLanguage = topicFor(digest, teacherLang);
  const gloss = quizLang !== teacherLang && inTeacherLanguage && inTeacherLanguage !== taught
    ? inTeacherLanguage : '';
  const subject = subjectLabel(digest && digest.subject, teacherLang);

  if (!taught) {
    return subject
      ? resolveUx('tqLessonNoTopic', { language: teacherLang, params: { subject } })
      : resolveUx('tqLessonPlain', { language: teacherLang });
  }
  const topic = gloss ? `${isolate(`*${taught}*`)} (${isolate(gloss)})` : isolate(`*${taught}*`);
  return subject
    ? resolveUx('tqLessonOnSubject', { language: teacherLang, params: { subject, topic } })
    : resolveUx('tqLessonOnTopic', { language: teacherLang, params: { topic } });
}

/** The topic label in a given language: the lesson's own name for Urdu, the clean English label otherwise. */
function topicFor(digest, language) {
  const d = digest || {};
  return language === 'ur' ? (d.topic_as_taught || d.topic || '') : (d.topic || d.topic_as_taught || '');
}

module.exports = {
  topicFor,
  needsLanguageAsk,
  languageAskButtons,
  LANGUAGE_ASK_SKIPPED,
  LANGUAGE_BUTTON_PREFIX,
  lessonLabel,
  subjectLabel,
  SUBJECT_LABEL_CODES,
  EXTRA_SUBJECT_LABELS,
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
