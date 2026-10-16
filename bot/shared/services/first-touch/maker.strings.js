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
  // the one tour banner (TOUR.md §2, §5)
  'mk.tour': Object.freeze({ en: "3 taps: grade, subject and topic. Then send. About a minute.", ur: "تین قدم: جماعت، مضمون اور موضوع چنیں، پھر بھیج دیں۔ تقریباً ایک منٹ لگے گا۔" }),
  'mk.tour.ok': Object.freeze({ en: "Got it", ur: "ٹھیک ہے" }),
  'mk.tour.replay': Object.freeze({ en: "How it works", ur: "یہ کیسے کام کرتا ہے" }),
  'mk.grade': Object.freeze({ en: "Grade", ur: "جماعت" }),
  'mk.subject': Object.freeze({ en: "Subject", ur: "مضمون" }),
  'mk.topic': Object.freeze({ en: "Topic", ur: "موضوع" }),
  'mk.make': Object.freeze({ en: "Make the quiz", ur: "کوئز بنائیں" }),
  'mk.ready.h': Object.freeze({ en: "Your quiz is ready", ur: "آپ کا کوئز تیار ہے" }),
  'mk.change': Object.freeze({ en: "Change my choice", ur: "اپنا انتخاب بدلیں" }),
  'mk.stale': Object.freeze({ en: "This link has expired. For a new one, send “quiz” in the chat.", ur: "اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔" }),
  'mk.error': Object.freeze({ en: "That didn't work. Try again in a moment.", ur: "یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔" }),
  'mk.lang.switch': Object.freeze({ en: "اردو", ur: "English" }),
  // the ready screen (COPY v1.2 §2 A). mk.ready.sub.lang is composed by maker.page readySub from its signed parts:
  // the grade (mk.grade.n), the REAL subject label, the topic, the language clause and the library clause below.
  'mk.ready.lang.en': Object.freeze({ en: "questions in English", ur: "سوال انگریزی میں ہیں۔" }),
  'mk.ready.lang.ur': Object.freeze({ en: "questions in Urdu", ur: "سوال اردو میں ہیں۔" }),
  // the library clause: the signed tail of mk.ready.sub.lang, verbatim
  'mk.ready.sub.lib': Object.freeze({ en: "a ready quiz from the NIETE library", ur: "\u2066NIETE\u2069 لائبریری کا تیار کوئز۔" }),
  // frames: {n} = the question count in the page's digits ("Question 1 of 10" / «سوال نمبر ۱ از ۱۰»)
  'mk.ready.q': Object.freeze({ en: "Question 1 of {n}", ur: "سوال نمبر ۱ از {n}" }),
  'mk.send': Object.freeze({ en: "Send to class group", ur: "کلاس گروپ میں بھیجیں" }),
  'mk.send.note': Object.freeze({ en: "Opens WhatsApp with the message ready. Nothing is sent until you pick the group.", ur: "پیغام تیار ہوگا اور \u2066WhatsApp\u2069 کھل جائے گا۔ گروپ چننے تک کچھ نہیں جائے گا۔" }),
  'mk.copy': Object.freeze({ en: "Copy the message", ur: "پیغام کاپی کریں" }),
  'mk.next': Object.freeze({ en: "Next time, /quiz also lists a quiz from your own lesson plan or recording.", ur: "اگلی بار \u2066/quiz\u2069 آپ کے اپنے سبق کے منصوبے یا ریکارڈنگ سے بنا کوئز بھی دکھائے گا۔" }),
  'mk.topic.mark.en': Object.freeze({ en: "EN", ur: "EN" }),
  'mk.topic.mark.ur': Object.freeze({ en: "اردو", ur: "اردو" }),
  // frames: {grade} = mk.grade.n in a sentence, {subject} = the REAL subject label ("Last time: Grade 4, Maths")
  'mk.prefill': Object.freeze({ en: "Last time: {grade}, {subject}", ur: "پچھلی بار: {grade}، {subject}" }),
  'mk.prefill.keep': Object.freeze({ en: "Use it", ur: "یہی رکھیں" }),
  'mk.prefill.change': Object.freeze({ en: "Change", ur: "تبدیل کریں" }),
  // mk.grade.n in a sentence: "Grade {n}" / «جماعت {n}» (the Urdu-Indic digit is the caller's)
  'mk.grade.n': Object.freeze({ en: "Grade {n}", ur: "جماعت {n}" }),
  'class.lang.en': Object.freeze({ en: "The questions are in English.", ur: "سوال انگریزی میں ہیں۔" }),
  'class.lang.ur': Object.freeze({ en: "The questions are in Urdu.", ur: "سوال اردو میں ہیں۔" }),
  'maker.body': Object.freeze({ en: "Your first quiz in three taps: grade, subject, topic. Then send it to your class group. It opens right here in WhatsApp.\n\nNot a teacher? Send “child”.", ur: "آپ کا پہلا کوئز تین ٹیپ میں: جماعت، مضمون، موضوع۔ پھر اسے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔\n\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔" }),
  'maker.btn': Object.freeze({ en: "Make my quiz", ur: "میرا کوئز بنائیں" }),
  // one value, Urdu block first, a blank line, the English block (COPY v1.2: a composition of two signed values)
  'maker.body.bi': Object.freeze({ en: "آپ کا پہلا کوئز تین ٹیپ میں: جماعت، مضمون، موضوع۔ پھر اسے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔\n\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nYour first quiz in three taps: grade, subject, topic. Then send it to your class group. It opens right here in WhatsApp.\n\nNot a teacher? Send “child”.", ur: "آپ کا پہلا کوئز تین ٹیپ میں: جماعت، مضمون، موضوع۔ پھر اسے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔\n\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nYour first quiz in three taps: grade, subject, topic. Then send it to your class group. It opens right here in WhatsApp.\n\nNot a teacher? Send “child”." }),
  'maker.btn.bi': Object.freeze({ en: "Make quiz · بنائیں", ur: "Make quiz · بنائیں" }),
  // the three branch cards and the forward line (the cards addon, cards.page.js). The .word values are the REAL
  // words the feature doors match (lp-intent BARE, the coaching trigger, the /assessment command); mk.card.exam is
  // not here: it is the REAL menu row title, read live (resolveUx("menuRowAssessmentTitle")).
  'mk.card.lp': Object.freeze({ en: "Lesson plans", ur: "سبق کے منصوبے" }),
  'mk.card.lp.word': Object.freeze({ en: "lesson plan", ur: "لیسن پلان" }),
  'mk.card.coach': Object.freeze({ en: "AI coaching", ur: "اے آئی کوچنگ" }),
  'mk.card.coach.word': Object.freeze({ en: "coaching", ur: "کوچنگ" }),
  'mk.card.exam.word': Object.freeze({ en: "/assessment", ur: "/assessment" }),
  // frame: {bot} = this deployment's bot number (digits, read live), never a literal; the Urdu link keeps ?text=quiz
  'mk.fwd': Object.freeze({ en: "Teachers: make a class quiz in 3 taps with the NIETE bot on WhatsApp. Open this link and send the message:\nhttps://wa.me/{bot}?text=quiz", ur: "ٹیچرز کے لیے: \u2066NIETE\u2069 کے \u2066WhatsApp\u2069 بوٹ سے تین ٹیپ میں اپنی کلاس کا کوئز بنائیں۔ یہ لنک کھولیں اور پیغام بھیج دیں:\nhttps://wa.me/{bot}?text=quiz" }),
  'mk.fwd.btn': Object.freeze({ en: "Share with teachers", ur: "ٹیچرز کو بھیجیں" }),
});

/** The value of `id` in `lang` ('bi' → the Urdu slot; anything else through the one clamp). */
function str(id, lang) {
  const row = STRINGS[id];
  if (!row) throw new Error(`maker strings: unknown id "${id}"`);
  return row[lang === 'bi' ? 'ur' : clampLanguage(lang)];
}

// The subject codes a chip may carry (FIRST_QUIZ §5.2), in chip order.
const SUBJECT_CODES = Object.freeze(['maths', 'english', 'urdu', 'science', 'general_knowledge', 'islamic_studies']);

/** A frame's value with its {name} slots filled (the values are the caller's, already in the page's digits). */
function fill(id, lang, params = {}) {
  return str(id, lang).replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
}

/** `mk.subj.<code>`: the REAL catalog label; null for a code with none. */
function subjectLabel(code, lang) {
  const l = lang === 'bi' ? 'ur' : clampLanguage(lang);
  if (code === 'islamic_studies') return resolveUx('regSubjectIslamiat', { language: l });
  return SUBJECT_CODES.includes(code) ? subjectLabelFor(code, l) : null;
}

module.exports = { STRINGS, SUBJECT_CODES, str, fill, subjectLabel };
