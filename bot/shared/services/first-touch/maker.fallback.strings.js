'use strict';
/**
 * The words of the empty /quiz line's maker reply and of the maker cta's refused-send fallback (3 reply buttons),
 * copied verbatim from the signed first-touch copy (v1.2, M4 and M4 fallback); never retyped. Held here, not in the
 * catalog: a bilingual button opens with a Latin word, and the catalog's Urdu-slot direction gate would prefix U+200F
 * and push `Record · ریکارڈ کریں` (20/20 code points) past Meta's cap.
 *
 * `.bi` values are ONE whole value (the Urdu block, a blank line, the English block), the same in both slots.
 * Bilingual buttons: Latin first, « · », then Urdu.
 */
const { clampLanguage } = require('../../config/ux-strings');

const STRINGS = Object.freeze({
  'maker.empty.body': Object.freeze({ en: "No lesson recorded yet — no problem. Make a ready quiz for your class in three taps: grade, subject, topic. It opens right here in WhatsApp.", ur: "ابھی تک کوئی سبق ریکارڈ نہیں ہوا — کوئی بات نہیں۔ تین ٹیپ میں اپنی کلاس کے لیے تیار کوئز بنائیں: جماعت، مضمون، موضوع۔ یہ یہیں \u2066WhatsApp\u2069 میں کھلے گا۔" }),
  'maker.empty.btn': Object.freeze({ en: "Make a quiz", ur: "کوئز بنائیں" }),
  'maker.fallback.body': Object.freeze({ en: "No lesson recorded yet.\nNot a teacher? Send “child”.\n\nPick one:", ur: "ابھی تک کوئی سبق ریکارڈ نہیں ہوا۔\nٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nایک چنیں:" }),
  'maker.fallback.body.known': Object.freeze({ en: "No lesson recorded yet. Pick one:", ur: "ابھی تک کوئی سبق ریکارڈ نہیں ہوا۔ ایک چنیں:" }),
  'maker.fallback.body.unknown': Object.freeze({ en: "Not a teacher? Send “child”.\n\nPick one to start:", ur: "ٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nشروع کرنے کے لیے ایک چنیں:" }),
  // one value, Urdu block first, a blank line, the English block (COPY v1.2 §4 rule 1), the same in both slots
  'maker.fallback.body.unknown.bi': Object.freeze({ en: "ٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nشروع کرنے کے لیے ایک چنیں:\n\nNot a teacher? Send “child”.\n\nPick one to start:", ur: "ٹیچر نہیں ہیں؟ ”بچہ“ لکھ کر بھیجیں۔\n\nشروع کرنے کے لیے ایک چنیں:\n\nNot a teacher? Send “child”.\n\nPick one to start:" }),
  'maker.fallback.btn1': Object.freeze({ en: "Ready quiz", ur: "تیار کوئز" }),
  'maker.fallback.btn2': Object.freeze({ en: "Lesson plan", ur: "سبق کا منصوبہ" }),
  'maker.fallback.btn3': Object.freeze({ en: "Record a lesson", ur: "سبق ریکارڈ کریں" }),
  'maker.fallback.btn1.bi': Object.freeze({ en: "Quiz · تیار کوئز", ur: "Quiz · تیار کوئز" }),
  'maker.fallback.btn2.bi': Object.freeze({ en: "Plan · لیسن پلان", ur: "Plan · لیسن پلان" }),
  'maker.fallback.btn3.bi': Object.freeze({ en: "Record · ریکارڈ کریں", ur: "Record · ریکارڈ کریں" }),
});

/** The value of `id` in `lang` ('bi' → the Urdu slot, which for a `.bi` id holds the whole value). */
function str(id, lang) {
  const row = STRINGS[id];
  if (!row) throw new Error(`maker fallback strings: unknown id "${id}"`);
  return row[lang === 'bi' ? 'ur' : clampLanguage(lang)];
}

module.exports = { STRINGS, str };
