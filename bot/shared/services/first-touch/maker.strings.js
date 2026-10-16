'use strict';
/**
 * Every word the quiz-maker page and its WhatsApp cta say, copied verbatim from the signed first-touch copy (v1.2);
 * never retyped (the Urdu values carry their U+2066…U+2069 isolates as escapes). Subject chip labels are not here:
 * they are the catalog's REAL labels (ux-strings.js SUBJECT_LABELS, and regSubjectIslamiat for Islamic Studies),
 * read live by subjectLabel().
 *
 * `mk.lang.switch` is written in the language it switches TO: the English page shows «اردو», the Urdu page "English".
 * `.bi` values are one whole value (Urdu block first), the same in both slots.
 */
const { resolveUx, clampLanguage, subjectLabelFor } = require('../../config/ux-strings');

const STRINGS = Object.freeze({
  'mk.h': Object.freeze({ en: "Make a quiz", ur: "کوئز بنائیں" }),
  'mk.grade': Object.freeze({ en: "Grade", ur: "جماعت" }),
  'mk.subject': Object.freeze({ en: "Subject", ur: "مضمون" }),
  'mk.topic': Object.freeze({ en: "Topic", ur: "موضوع" }),
  'mk.make': Object.freeze({ en: "Make the quiz", ur: "کوئز بنائیں" }),
  'mk.ready.h': Object.freeze({ en: "Your quiz is ready", ur: "آپ کا کوئز تیار ہے" }),
  'mk.change': Object.freeze({ en: "Change my choice", ur: "اپنا انتخاب بدلیں" }),
  'mk.stale': Object.freeze({ en: "This link has expired. For a new one, send “quiz” in the chat.", ur: "اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔" }),
  'mk.error': Object.freeze({ en: "That didn't work. Try again in a moment.", ur: "یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔" }),
  'mk.lang.switch': Object.freeze({ en: "اردو", ur: "English" }),
  'class.lang.en': Object.freeze({ en: "The questions are in English.", ur: "سوال انگریزی میں ہیں۔" }),
  'class.lang.ur': Object.freeze({ en: "The questions are in Urdu.", ur: "سوال اردو میں ہیں۔" }),
  'maker.body': Object.freeze({ en: "Your first quiz in three taps: grade, subject, topic. Then send it to your class group. It opens right here in WhatsApp.\n\nNot a teacher? Send “child”.", ur: "آپ کا پہلا کوئز تین ٹیپ میں: جماعت، مضمون، موضوع۔ پھر اسے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔\n\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔" }),
  'maker.btn': Object.freeze({ en: "Make my quiz", ur: "میرا کوئز بنائیں" }),
  // one value, Urdu block first, a blank line, the English block (COPY v1.2: a composition of two signed values)
  'maker.body.bi': Object.freeze({ en: "آپ کا پہلا کوئز تین ٹیپ میں: جماعت، مضمون، موضوع۔ پھر اسے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔\n\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nYour first quiz in three taps: grade, subject, topic. Then send it to your class group. It opens right here in WhatsApp.\n\nNot a teacher? Send “child”.", ur: "آپ کا پہلا کوئز تین ٹیپ میں: جماعت، مضمون، موضوع۔ پھر اسے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔\n\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nYour first quiz in three taps: grade, subject, topic. Then send it to your class group. It opens right here in WhatsApp.\n\nNot a teacher? Send “child”." }),
  'maker.btn.bi': Object.freeze({ en: "Make quiz · بنائیں", ur: "Make quiz · بنائیں" }),
});

/** The value of `id` in `lang` ('bi' → the Urdu slot; anything else through the one clamp). */
function str(id, lang) {
  const row = STRINGS[id];
  if (!row) throw new Error(`maker strings: unknown id "${id}"`);
  return row[lang === 'bi' ? 'ur' : clampLanguage(lang)];
}

// The subject codes a chip may carry (FIRST_QUIZ §5.2), in chip order.
const SUBJECT_CODES = Object.freeze(['maths', 'english', 'urdu', 'science', 'general_knowledge', 'islamic_studies']);

/** `mk.subj.<code>`: the REAL catalog label; null for a code with none. */
function subjectLabel(code, lang) {
  const l = lang === 'bi' ? 'ur' : clampLanguage(lang);
  if (code === 'islamic_studies') return resolveUx('regSubjectIslamiat', { language: l });
  return SUBJECT_CODES.includes(code) ? subjectLabelFor(code, l) : null;
}

module.exports = { STRINGS, SUBJECT_CODES, str, subjectLabel };
