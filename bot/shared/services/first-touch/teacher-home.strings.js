'use strict';
/**
 * Every word the teacher home says. Values signed in the first-touch copy (and its Urdu read) are copied verbatim;
 * the maker's signed ids are reused through maker.strings and the report page's signed confirm-queue words through
 * teacher-jugnu.page, never retyped. Latin runs inside Urdu carry their isolates.
 *
 * `cm.return` is the one return line every class message from this page ends with (behind quiz_teacher_home); the
 * child's shared card and the stories page import this object so all of them say exactly the same words.
 */
const { clampLanguage } = require('../../config/ux-strings');
const Maker = require('./maker.strings');
const Jugnu = require('../../templates/teacher-jugnu.page');

const STRINGS = Object.freeze({
  'th.h': Object.freeze({ en: 'Hello, {first}', ur: 'السلام علیکم، {first}' }),
  'th.hello.noname': Object.freeze({ en: 'Hello', ur: 'السلام علیکم' }),
  'th.title': Object.freeze({ en: 'My quiz home', ur: 'میرا کوئز ہوم' }),
  // the top card
  'th.primary.lib': Object.freeze({ en: 'Pick a story or quiz for your class', ur: 'اپنی کلاس کے لیے کہانی یا کوئز چنیں' }),
  'th.zero': Object.freeze({ en: 'No one in your class has played yet', ur: 'ابھی تک کلاس میں سے کسی نے نہیں کھیلا' }),
  // {n} ≥ 1, in the page's digits
  'th.played.n': Object.freeze({ en: '{n} in your class played', ur: 'کلاس میں سے {n} نے کھیلا' }),
  'th.again': Object.freeze({ en: 'Send again', ur: 'دوبارہ بھیجیں' }),
  // the top card names what it sends again (only while quiz_teacher_home_named_item is on)
  'th.kind.story': Object.freeze({ en: 'Story:', ur: 'کہانی:' }),
  'th.kind.quiz': Object.freeze({ en: 'Quiz:', ur: 'کوئز:' }),
  'th.again.story': Object.freeze({ en: 'Send this story again', ur: 'یہ کہانی دوبارہ بھیجیں' }),
  'th.again.quiz': Object.freeze({ en: 'Send this quiz again', ur: 'یہ کوئز دوبارہ بھیجیں' }),
  'th.report': Object.freeze({ en: 'See report', ur: 'رپورٹ دیکھیں' }),
  'th.send': Object.freeze({ en: 'Send to my class', ur: 'اپنی کلاس کو بھیجیں' }),
  // the send sheet
  'th.send.note1': Object.freeze({ en: 'Nothing is sent until you pick the group', ur: 'گروپ چننے تک کچھ نہیں جائے گا' }),
  'th.send.note2': Object.freeze({ en: 'Once children play, the report comes as usual', ur: 'بچے کھیل لیں تو رپورٹ ہمیشہ کی طرح آئے گی' }),
  'th.back.note': Object.freeze({ en: 'After sending, come back using the button in this chat', ur: 'بھیجنے کے بعد اسی چیٹ میں بٹن دبا کر واپس آئیں' }),
  'th.copied': Object.freeze({ en: 'Copied', ur: 'کاپی ہو گیا' }),
  'th.copy.long': Object.freeze({ en: 'Long-press to copy', ur: 'کاپی کرنے کے لیے دبا کر رکھیں' }),
  // the "My lessons" timeline
  'th.timeline': Object.freeze({ en: 'My lessons', ur: 'میرے اسباق' }),
  'th.tag.lp': Object.freeze({ en: 'Lesson plan', ur: 'لیسن پلان' }),
  'th.tag.coach': Object.freeze({ en: 'Coaching session', ur: 'کوچنگ سیشن' }),
  'th.tag.quiz': Object.freeze({ en: 'Quiz sent', ur: 'بھیجا گیا کوئز' }),
  'th.lastlesson': Object.freeze({ en: 'Quiz from your last lesson: {topic}', ur: 'آپ کے پچھلے سبق کا کوئز: {topic}' }),
  'th.tag.story': Object.freeze({ en: 'Story sent', ur: 'بھیجی گئی کہانی' }),
  'th.quiz.this': Object.freeze({ en: 'Quiz this', ur: 'اس کا کوئز بنائیں' }),
  'th.job': Object.freeze({ en: 'Your quiz is on its way — it takes a few minutes and arrives in this chat too', ur: 'کوئز تیار ہونے میں چند منٹ لگیں گے — یہ اسی چیٹ میں بھی آ جائے گا' }),
  'th.quiz.making': Object.freeze({ en: 'Making your quiz…', ur: 'آپ کا کوئز بن رہا ہے…' }),
  'th.quiz.late': Object.freeze({ en: 'Taking longer than usual — it will arrive in this chat', ur: 'معمول سے زیادہ وقت لگ رہا ہے — کوئز اسی چیٹ میں آ جائے گا' }),
  'th.more': Object.freeze({ en: 'More', ur: 'مزید' }),
  // the page opened for ONE recorded lesson (quiz_teacher_home_one_lesson: a Digital Coach report's "Create Quick Quiz"):
  // the card's heading (as th.lastlesson, for this lesson), and the quiet link to the whole home
  'th.one.say': Object.freeze({ en: 'Quiz from this lesson', ur: 'اس سبق کا کوئز' }),
  'th.one.all': Object.freeze({ en: 'See all my lessons', ur: 'میرے سب اسباق دیکھیں' }),
  // the library
  'th.sec.library': Object.freeze({ en: 'Library: stories & videos', ur: 'لائبریری: کہانیاں اور ویڈیوز' }),
  'th.chosen.for': Object.freeze({ en: 'Chosen for Grade {n}', ur: 'جماعت {n} کے لیے منتخب' }),
  // the teacher's story sends and the children of those sends who read; {sent} ≥ 1 and {read} in the page's digits
  'th.stories.counts': Object.freeze({ en: '{sent} stories sent · children who read: {read}', ur: '{sent} کہانیاں بھیجی گئیں · پڑھنے والے بچے: {read}' }),
  'th.stories.counts.one': Object.freeze({ en: '1 story sent · children who read: {read}', ur: '۱ کہانی بھیجی گئی · پڑھنے والے بچے: {read}' }),
  'th.all.stories': Object.freeze({ en: 'All stories', ur: 'سب کہانیاں' }),
  // a story the teacher sent this month, by its row; {day} = the send's day/month in the page's digits
  'th.sent.on': Object.freeze({ en: 'Sent ✓ {day}', ur: 'بھیجی گئی ✓ {day}' }),
  'th.videos.card': Object.freeze({ en: 'Ready video quizzes', ur: 'تیار ویڈیو کوئز' }),
  // the foot
  'th.make': Object.freeze({ en: 'Make a new quiz', ur: 'نیا کوئز بنائیں' }),
  'th.change': Object.freeze({ en: 'Not a teacher? Change', ur: 'ٹیچر نہیں ہیں؟ بدلیں' }),
  'th.children': Object.freeze({ en: 'Children on this phone', ur: 'اس فون پر بچے' }),
  'th.try.student': Object.freeze({ en: 'Try it as a student', ur: 'بچوں والا حصہ آزمائیں' }),
  // the way to the portal Home (quiz_teacher_home_portal_link); a page link, kept within a WhatsApp button's 20 code points
  'th.portal': Object.freeze({ en: 'Open my portal', ur: 'اپنا پورٹل کھولیں' }),
  // the one tap back to the chat on every stale / error page and the error line (the link is wa.me/<bot>?text=quiz)
  'th.open.wa': Object.freeze({ en: 'Open WhatsApp', ur: 'واٹس ایپ کھولیں' }), // a no-break space inside the brand name (the signed form)
  // the home's answer did not come (an error, or nothing after 15 s): ask for it again (the Urdu is mk.error's own words)
  'th.retry': Object.freeze({ en: 'Try again', ur: 'دوبارہ کوشش کریں' }),
  // the class message's last line; {link} = https://wa.me/<the bot's number>?text=quiz
  'cm.return': Object.freeze({ en: 'Any day: send “quiz” to this number → {link}', ur: 'کسی بھی دن اس نمبر پر ”کوئز“ لکھ کر بھیجیں ← {link}' }),
});

// Signed ids reused as they are: the maker's, and the report page's confirm queue (its Urdu {name} slots isolated).
const REUSED = Object.freeze({
  'th.copy': ['mk', 'mk.copy'], 'th.grade.n': ['mk', 'mk.grade.n'], 'th.stale': ['mk', 'mk.stale'],
  'th.error': ['mk', 'mk.error'], 'th.lang.switch': ['mk', 'mk.lang.switch'],
  'th.confirm.q': ['jg', 'tQHead'], 'th.confirm.same': ['jg', 'tQSame'], 'th.confirm.diff': ['jg', 'tQDiff'],
  'th.confirm.unsure': ['jg', 'tQUnsure'],
});

/** The value of `id` in `lang` ('bi' → the Urdu slot; anything else through the one clamp). */
function str(id, lang) {
  const l = lang === 'bi' ? 'ur' : clampLanguage(lang);
  const reused = REUSED[id];
  if (reused) return reused[0] === 'mk' ? Maker.str(reused[1], l) : Jugnu.T[l][reused[1]];
  const row = STRINGS[id];
  if (!row) throw new Error(`teacher home strings: unknown id "${id}"`);
  return row[l];
}

/** A frame's value with its {name} slots filled. */
function fill(id, lang, params = {}) {
  return str(id, lang).replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
}

const ALL_IDS = Object.freeze([...Object.keys(STRINGS), ...Object.keys(REUSED)]);

module.exports = { STRINGS, REUSED, ALL_IDS, str, fill };
