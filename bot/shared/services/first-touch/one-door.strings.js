'use strict';
/**
 * Every word the one door says: the ONE WhatsApp reply (od.*), the role question page (rq.*), the landing's notes (go.*).
 * Signed copy only (the native Urdu read's fixes applied; go.stale / go.error = the signed
 * mk.stale / mk.error words; go.family.* = the signed family-door words fd.h / fd.none). No test words, no
 * gendered stems, Urdu quotes ”…“, Latin inside Urdu in U+2066…U+2069 isolates. A cta_url button is ≤ 20 code points
 * (asserted by the tests).
 *
 * str(id, lang) → the string in 'en' | 'ur'; bi(id) → the bilingual body (English, a blank line, Urdu).
 */
const S = Object.freeze({
  // §1 the one reply
  'od.teacher.body': Object.freeze({
    en: 'Your quiz home: your lessons, your coaching, ready quizzes and stories — one tap sends any of them to your class group. It opens right here in WhatsApp.',
    ur: 'آپ کا کوئز ہوم: آپ کے اسباق، آپ کی کوچنگ، تیار کوئز اور کہانیاں۔ ان میں سے کوئی بھی ایک ٹیپ سے اپنے کلاس گروپ میں بھیجیں۔ یہ یہیں ⁦WhatsApp⁩ میں کھلے گا۔',
  }),
  'od.teacher.btn': Object.freeze({ en: 'Open my quiz home', ur: 'کوئز ہوم کھولیں' }),
  'od.unknown.body': Object.freeze({
    en: "Jugnu's quiz: teachers send quizzes and stories to their class; children play and read. Tap to open — it asks one thing, then remembers you.",
    ur: 'جگنو کا کوئز: ٹیچر اپنی کلاس کو کوئز اور کہانیاں بھیجیں؛ بچے کھیلیں اور پڑھیں۔ کھولنے کے لیے ٹیپ کریں۔ جگنو ایک بات پوچھے گا، پھر آپ کو یاد رکھے گا۔',
  }),
  'od.unknown.btn': Object.freeze({ en: 'Open', ur: 'کھولیں' }),
  'od.btn.bi': Object.freeze({ en: 'Open · کھولیں', ur: 'Open · کھولیں' }),
  'od.fallback.unknown': Object.freeze({
    en: "Jugnu's quiz opens from a link. Send “quiz” again in a moment.",
    ur: 'جگنو کا کوئز لنک سے کھلتا ہے۔ تھوڑی دیر بعد دوبارہ ”کوئز“ لکھ کر بھیجیں۔',
  }),
  // §2 the role question page
  'rq.h': Object.freeze({ en: 'Tell Jugnu who you are', ur: 'جگنو کو بتائیں، آپ کون ہیں؟' }),
  'rq.child': Object.freeze({ en: 'I want to play', ur: 'مجھے کھیلنا ہے' }),
  'rq.child.sub': Object.freeze({ en: 'Play quizzes and read stories', ur: 'کوئز کھیلیں اور کہانیاں پڑھیں' }),
  'rq.teacher': Object.freeze({ en: 'I teach a class', ur: 'میں ٹیچر ہوں' }),
  'rq.teacher.sub': Object.freeze({ en: 'Send quizzes and stories to my class', ur: 'اپنی کلاس کو کوئز اور کہانیاں بھیجیں' }),
  'rq.parent.line': Object.freeze({ en: 'A parent? Tap “I want to play” for your child.', ur: 'آپ والدین ہیں؟ بچوں کے لیے ”مجھے کھیلنا ہے“ ٹیپ کریں۔' }),
  'rq.note': Object.freeze({ en: 'We ask this once. You can change it later.', ur: 'جگنو یہ ایک ہی بار پوچھے گا۔ بعد میں بدلنا ہو تو بدل لیں۔' }),
  // the landing's notes
  'go.stale': Object.freeze({ en: 'This link has expired. For a new one, send “quiz” in the chat.', ur: 'اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔' }),
  'go.error': Object.freeze({ en: "That didn't work. Try again in a moment.", ur: 'یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔' }),
  'go.family.h': Object.freeze({ en: 'Playing from home?', ur: 'گھر سے کھیلنا ہے؟' }),
  'go.family.none': Object.freeze({ en: 'No class link yet? Ask your teacher.', ur: 'ابھی لنک نہیں ملا؟ اپنے ٹیچر سے پوچھیں۔' }),
});

function str(id, lang = 'en') {
  const row = S[id];
  if (!row) return '';
  return lang === 'ur' ? row.ur : row.en;
}

/** The bilingual body: the English line, a blank line, the Urdu line. */
function bi(id) {
  const row = S[id];
  return row ? `${row.en}\n\n${row.ur}` : '';
}

module.exports = { str, bi, STRINGS: S };
