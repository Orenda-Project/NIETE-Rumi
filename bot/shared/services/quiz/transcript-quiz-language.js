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
  // 'عمومی معلومات' is the subject's own display label (SUBJECT_LABELS), so a
  // label handed back in is recognised as the subject it names.
  ['genk', ['genk', 'gk', 'general knowledge', 'meri kitab', 'میری کتاب', 'معلومات عامہ', 'عمومی معلومات']],
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
 * What the TEACHER reads. The language they stored, clamped to the offer, and
 * nothing else.
 *
 * A recording never changes the teacher's language; neither does a
 * transcript. The earlier version fell back to the detected transcript
 * language when they had stored nothing, which meant the same teacher could
 * be addressed in Urdu on one surface and English on the next depending on
 * which lesson they had just recorded. clampLanguage's floor is the one
 * answer for "nothing is known", shared with the rest of the deployment.
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
 * one the teacher would have been given silently before, still the easy tap.
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

/**
 * THE EXAMPLES THE ASK NAMES. The ask tells the teacher what an Urdu quiz does
 * with English terms, with an example or two — which must come from THIS lesson
 * (a science lesson was told "fraction, numerator"). In order of preference:
 *
 *   1. up to two of the digest's own key_terms written in English letters and
 *      short enough to read at a glance (a term, not a sentence), repeats
 *      dropped;
 *   2. when the lesson has none — no digest yet (a quiz born from a lesson
 *      plan), or only Urdu terms — a pair that fits the SUBJECT;
 *   3. and when neither fits, no examples at all: an example from another
 *      subject is worse than none.
 */
const ASK_TERM_MAX_CODE_POINTS = 24;
const ASK_TERM_MAX_WORDS = 3;
const ASK_TERM_SHAPE = /^[A-Za-z][A-Za-z0-9' -]*$/;
const ASK_TERM_FALLBACK = {
  maths: ['fraction', 'numerator'],
  science: ['photosynthesis', 'cell'],
  english: ['noun', 'verb'],
};

function askTermExamples({ digest, subject } = {}) {
  const terms = [];
  const seen = new Set();
  const keyTerms = digest && Array.isArray(digest.key_terms) ? digest.key_terms : [];
  for (const k of keyTerms) {
    const term = String((k && typeof k === 'object' ? k.term : k) || '').replace(/\s+/g, ' ').trim();
    const usable = ASK_TERM_SHAPE.test(term)
      && [...term].length <= ASK_TERM_MAX_CODE_POINTS
      && term.split(' ').length <= ASK_TERM_MAX_WORDS
      && !seen.has(term.toLowerCase());
    if (!usable) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
    if (terms.length === 2) return terms;
  }
  if (terms.length) return terms;
  return [...(ASK_TERM_FALLBACK[canonicalSubject(subject || (digest && digest.subject))] || [])];
}

/**
 * The body of the quiz language ask, in the teacher's language, naming this
 * lesson's English terms (above). Each term is a first-strong isolate so a term
 * with a digit or a hyphen keeps its shape inside an Urdu line, and the terms
 * are joined by the language's own list comma (`،` in Urdu).
 *
 * @param {{digest?: object, subject?: string}} lesson
 * @param {string} teacherLang
 */
function languageAskBody(lesson, teacherLang) {
  const terms = askTermExamples(lesson || {});
  if (!terms.length) return resolveUx('tqAskLanguagePlain', { language: teacherLang });
  const examples = terms.map(isolate).join(resolveUx('vqLetterSep', { language: teacherLang }));
  return resolveUx('tqAskLanguage', { language: teacherLang, params: { examples } });
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
  ['ہول', 'whole'], ['پارٹس', 'parts'], ['پارٹ', 'part'], ['ٹیسٹ', 'test'], ['سرکل', 'circle'], ['ہاف', 'half'], ['کوارٹر', 'quarter'], ['ایریا', 'area'], ['پیریمیٹر', 'perimeter'], ['شیپ', 'shape'], ['ٹرائی اینگل', 'triangle'], ['سکوائر', 'square'], ['ریکٹینگل', 'rectangle'],
  ['سبٹریکشن', 'subtraction'], ['ایڈیشن', 'addition'], ['ملٹی پلیکیشن', 'multiplication'], ['ملٹیپلیکیشن', 'multiplication'], ['ڈویژن', 'division'],
  ['پلیس ویلیو', 'place value'], ['ڈیجٹس', 'digits'], ['ڈیجٹ', 'digit'],
  ['ٹرائی اینگل', 'triangle'], ['ریکٹینگل', 'rectangle'], ['پیری میٹر', 'perimeter'],
  ['فوٹو سنتھیسز', 'photosynthesis'], ['فوٹوسنتھیسز', 'photosynthesis'], ['ایکو سسٹم', 'ecosystem'], ['ایکوسسٹم', 'ecosystem'],
  ['کلوگرام', 'kilogram'], ['ٹمپریچر', 'temperature'], ['میٹیریل', 'material'], ['لیکوئڈ', 'liquid'],
  ['پروناؤن', 'pronoun'], ['ایڈجیکٹو', 'adjective'], ['سینٹینس', 'sentence'], ['نائون', 'noun'],
  // Science and geometry, from ten real prod lessons seeded onto staging on
  // 2026-09-06: the round-3 table was written from a maths-only corpus, so a
  // circuit, an atom and a radius all reached the teacher in Urdu letters.
  ['الیکٹرک سرکٹس', 'electric circuits'], ['الیکٹرک سرکٹ', 'electric circuit'], ['سرکٹس', 'circuits'], ['سرکٹ', 'circuit'],
  ['اسٹرکچر', 'structure'], ['سٹرکچر', 'structure'],
  ['ایٹمز', 'atoms'], ['ایٹم', 'atom'],
  ['الیکٹرانز', 'electrons'], ['الیکٹران', 'electron'],
  ['پروٹونز', 'protons'], ['پروٹون', 'proton'],
  ['نیوٹرانز', 'neutrons'], ['نیوٹران', 'neutron'],
  ['نیوکلیئس', 'nucleus'], ['نیوکلئس', 'nucleus'], ['نیوکلیس', 'nucleus'],
  ['ڈائی میٹر', 'diameter'], ['ڈایا میٹر', 'diameter'], ['ڈایامیٹر', 'diameter'], ['ڈائیامیٹر', 'diameter'],
  ['ریڈیئس', 'radius'], ['ریڈیس', 'radius'], ['ریڈئس', 'radius'],
  ['سرکمفرنس', 'circumference'],
  ['امپراپر', 'improper'], ['پراپر', 'proper'], ['مکسچر', 'mixture'], ['مکس', 'mixed'],
];

// A word character in ANY script: letter, combining mark or digit. Everything
// else — a space, a Latin comma, an Urdu comma (،), an Urdu full stop (۔), a
// bracket, the string edge — is a word boundary. Written with Unicode property
// escapes rather than a hand-listed Arabic range, because the Arabic block puts
// ، ۔ ؟ ؛ in among its letters, and a hand-listed range therefore treats
// "circle، ریڈیس، اور ڈائی میٹر" as ONE word and rewrites none of it.
const WORD_CHAR = '\\p{L}\\p{M}\\p{N}';

/**
 * Compiled once, and matched at URDU WORD BOUNDARIES rather than as a raw
 * substring. The substring form was safe only while every entry was long: the
 * moment a three-letter one is needed (`مکس` → mixed, from a real lesson) it
 * eats the middle of an unrelated word — `مکسچر` (mixture) came back as
 * "mixedچر" on the first pass over the seeded corpus. A boundary is any
 * non-Urdu character or the edge of the string, so `مکس fraction` is rewritten
 * and `مکسچر` is not, and `سٹرکچر` no longer fires inside `اسٹرکچر`.
 */
const TRANSLITERATION_RULES = TRANSLITERATIONS.map(([ur, en]) => [
  new RegExp(`(^|[^${WORD_CHAR}])(${ur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![${WORD_CHAR}])`, 'gu'),
  en,
]);

function fixTransliterations(text) {
  let out = String(text || '');
  for (const [rx, en] of TRANSLITERATION_RULES) out = out.replace(rx, (_m, pre) => pre + en);
  return out;
}

/**
 * A whole English phrase spelled out in Urdu letters, e.g. "اسٹرکچر آف این
 * ایٹم". No table can hold these — the giveaway is the GRAMMAR, not the terms:
 * `آف` and `اینڈ` standing alone are never Urdu words, they are how a
 * speech-to-text writes "of" and "and" inside an English phrase. When one
 * appears, the label is a transliteration rather than the Urdu the prompt asked
 * for, and the digest has already produced the clean English label alongside it.
 */
const ENGLISH_CONNECTOR_IN_URDU = new RegExp(`(^|[^${WORD_CHAR}])(آف|اینڈ)(?![${WORD_CHAR}])`, 'u');

/** The SLO statement in the DOCUMENT's language (D1); falls back to the lesson-language one. */
function sloStatement(slo, language) {
  if (!slo) return '';
  const pick = language === 'ur' ? slo.statement_ur : slo.statement_en;
  return String(pick || slo.statement || '').trim();
}

function isTransliteratedEnglishPhrase(label) {
  return ENGLISH_CONNECTOR_IN_URDU.test(String(label || ''));
}

/** Apply the fixer to every child-facing field of an authored question. */
/** Walk a diagram spec and fix every string field (labels, titles, captions, notes). */
function fixSpecStrings(node) {
  if (typeof node === 'string') return fixTransliterations(node);
  if (Array.isArray(node)) return node.map(fixSpecStrings);
  if (node && typeof node === 'object') {
    const out = {};
    Object.entries(node).forEach(([k, v]) => { out[k] = k === 'type' || k === 'kind' ? v : fixSpecStrings(v); });
    return out;
  }
  return node;
}

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
    // A figure's labels/titles/captions are read by the child too.
    figure: q.figure && typeof q.figure === 'object' ? fixSpecStrings(q.figure) : q.figure,
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

// Common irregular English plurals, mapped to their singular. A short list on
// purpose: the rule only has to stop a topic being glossed with its own plural,
// and anything missing here simply keeps its bracket, as before.
const IRREGULAR_PLURALS = Object.freeze({
  children: 'child', men: 'man', women: 'woman', people: 'person', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose', halves: 'half', leaves: 'leaf', lives: 'life', knives: 'knife',
  wives: 'wife', shelves: 'shelf', wolves: 'wolf', calves: 'calf', loaves: 'loaf', thieves: 'thief',
  vertices: 'vertex', indices: 'index', matrices: 'matrix', radii: 'radius',
});

/**
 * An English word without its trailing plural: -ies → -y, -es after s/x/z/ch/sh,
 * otherwise a final -s that is not part of -ss, -us or -is ("class", "bus",
 * "axis" stay whole). Non-Latin words are returned as they are.
 */
function singular(word) {
  if (!/^[a-z]+$/.test(word)) return word;
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Do two topic labels name the same thing? True when they differ only in
 * "&" versus "and" (or "اور"), punctuation, spacing, case, or an English
 * word's plural ("Proper Fraction" / "Proper Fractions"). The digest's
 * `topic` and `topic_as_taught` are written separately and often agree in all
 * but that — "Comparing & ordering unlike fractions" / "Comparing and ordering
 * unlike fractions" — and a bracket repeating the topic tells the teacher
 * nothing. Two labels in different scripts are never the same by this test,
 * so a translation always survives.
 */
function sameTopic(a, b) {
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(^|\s)اور(?=\s|$)/g, ' and ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(singular)
    .join(' ');
  return norm(a) === norm(b);
}

/**
 * "Urdu lesson on *واحد اور جمع* (singular and plural)" — the one phrase the
 * offer, the hand-off and the /quiz rows all name the lesson by.
 *
 * The subject is in the TEACHER's language; the topic is the one the class
 * actually heard (the quiz language); the gloss in brackets is the teacher's
 * language and appears only when it adds information — a translation, or a
 * genuinely different name, never the same topic with "&" for "and" (sameTopic). The teacher taps "yes" on a
 * lesson they recognise, and then reads a quiz in the language their children
 * were taught in — round 1 named neither, and an English offer arriving before
 * an Urdu quiz read as two different lessons.
 */
function lessonLabel({ digest, quizLanguage, teacherLanguage } = {}) {
  const quizLang = clampLanguage(quizLanguage);
  const teacherLang = clampLanguage(teacherLanguage);
  const taught = topicFor(digest, quizLang);
  const inTeacherLanguage = topicFor(digest, teacherLang);
  // The gloss is there to add information: a translation, or a genuinely
  // different name. A near-duplicate of the topic is not shown.
  const gloss = quizLang !== teacherLang && inTeacherLanguage && !sameTopic(inTeacherLanguage, taught)
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
  isolate,
  topicFor,
  needsLanguageAsk,
  languageAskButtons,
  languageAskBody,
  LANGUAGE_ASK_SKIPPED,
  LANGUAGE_BUTTON_PREFIX,
  lessonLabel,
  subjectLabel,
  SUBJECT_LABEL_CODES,
  EXTRA_SUBJECT_LABELS,
  fixTransliterations,
  fixQuestionTransliterations,
  isTransliteratedEnglishPhrase,
  sloStatement,
  TRANSLITERATIONS,
  URDU_MEDIUM,
  LANG_NAME,
  canonicalSubject,
  quizLanguageFor,
  teacherLanguageFor,
  formatLessonDate,
  isEnglishCode,
};
