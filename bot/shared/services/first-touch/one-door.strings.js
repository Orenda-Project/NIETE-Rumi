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
const { clampLanguage } = require('../../config/ux-strings');

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
  // the child-side reply under this switch (no retired door word)
  'od.child.body': Object.freeze({ en: 'Your stories, videos and quizzes are here.', ur: 'آپ کی کہانیاں، ویڈیوز اور کوئز یہاں ہیں۔' }),
  'od.child.btn': Object.freeze({ en: 'Open', ur: 'کھولیں' }),
  // §2 the role question page
  'rq.h': Object.freeze({ en: 'Tell Jugnu who you are', ur: 'جگنو کو بتائیں، آپ کون ہیں؟' }),
  'rq.child': Object.freeze({ en: 'I want to play', ur: 'مجھے کھیلنا ہے' }),
  'rq.child.sub': Object.freeze({ en: 'Play quizzes and read stories', ur: 'کوئز کھیلیں اور کہانیاں پڑھیں' }),
  'rq.teacher': Object.freeze({ en: 'I teach a class', ur: 'میں ٹیچر ہوں' }),
  'rq.teacher.sub': Object.freeze({ en: 'Send quizzes and stories to my class', ur: 'اپنی کلاس کو کوئز اور کہانیاں بھیجیں' }),
  'rq.parent.line': Object.freeze({ en: 'A parent? Tap “I want to play” for your child.', ur: 'آپ والدین ہیں؟ بچوں کے لیے ”مجھے کھیلنا ہے“ ٹیپ کریں۔' }),
  'rq.note': Object.freeze({ en: 'We ask this once. You can change it later.', ur: 'جگنو یہ ایک ہی بار پوچھے گا۔ بعد میں بدلنا ہو تو بدل لیں۔' }),
  // the confirm sheet ("Is it <First>?") — a child the server already knows on this phone, before any binding
  'cl.confirm.q': Object.freeze({ en: 'Is it {first}?', ur: 'کیا یہ \u2068{first}\u2069 ہیں؟' }),
  'cl.confirm.yes': Object.freeze({ en: "Yes, it's me", ur: 'جی ہاں، یہ میں ہوں' }),
  'cl.confirm.none': Object.freeze({ en: 'None of these', ur: 'ان میں سے کوئی نہیں' }),
  'cl.confirm.no': Object.freeze({ en: "No, it's not me", ur: 'یہ میں نہیں ہوں' }),
  'cl.confirm.who': Object.freeze({ en: 'Who is playing?', ur: 'کھیلنے کے لیے اپنا نام چنیں' }),
  // the three notice sentences shown BEFORE a phone is kept with a child's name — the child page's signed words,
  // verbatim (dashboard/public/wq/wq-bind.js noticeSave / noticeStopPhoneOnly / noticeReadings); {first} = the name
  'cl.notice.save': Object.freeze({
    en: "Jugnu will save this phone number with {first}'s name until the end of the school year (31 March), longer only if you keep playing.",
    ur: 'جگنو اس فون نمبر کو \u2068{first}\u2069 کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔',
  }),
  'cl.notice.stop': Object.freeze({
    en: 'A grown-up can remove this phone number any time by sending STOP on WhatsApp.',
    ur: 'گھر کے بڑے کسی بھی وقت واٹس\u00a0ایپ پر \u2066STOP\u2069 بھیج کر یہ نمبر ہٹا سکتے ہیں۔',
  }),
  'cl.notice.readings': Object.freeze({
    en: 'Readings {first} makes with the microphone are kept too.',
    ur: 'مائیک پر \u2068{first}\u2069 کی پڑھائی کی ریکارڈنگ بھی رکھی جاتی\u00a0ہے۔',
  }),
  // the landing's notes
  'go.stale': Object.freeze({ en: 'This link has expired. For a new one, send “quiz” in the chat.', ur: 'اس لنک کی مدت ختم ہو گئی ہے۔ نیا لنک لینے کے لیے چیٹ میں ”کوئز“ لکھ کر بھیجیں۔' }),
  'go.error': Object.freeze({ en: "That didn't work. Try again in a moment.", ur: 'یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔' }),
  'go.wa': Object.freeze({ en: 'Open WhatsApp', ur: 'واٹس ایپ کھولیں' }),
  'go.family.h': Object.freeze({ en: 'Playing from home?', ur: 'گھر سے کھیلنا ہے؟' }),
  'go.family.none': Object.freeze({ en: 'No class link yet? Ask your teacher.', ur: 'ابھی لنک نہیں ملا؟ اپنے ٹیچر سے پوچھیں۔' }),
});

function str(id, lang = 'en', params = null) {
  const row = S[id];
  if (!row) return '';
  const out = clampLanguage(lang) === 'ur' ? row.ur : row.en;
  return params ? out.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m)) : out;
}

/** The bilingual body: the English line, a blank line, the Urdu line. */
function bi(id) {
  const row = S[id];
  return row ? `${row.en}\n\n${row.ur}` : '';
}

module.exports = { str, bi, STRINGS: S };
