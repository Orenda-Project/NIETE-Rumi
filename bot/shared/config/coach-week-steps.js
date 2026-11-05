'use strict';
/**
 * Coach reports in the app, phase 3 — the four steps "How to do it next week" for the week's focus, one fixed set per
 * behaviour (rubric key), in English and Urdu. A fixed catalogue on purpose: these are moves a coach will make with a
 * teacher, so they are written once and reviewed, never generated per coach.
 *
 * DRAFT (5 Nov 2026), for the ICT HITL owner's review: her design asks for four steps per focus and gives none. Each set
 * follows her Coach Training module for that behaviour. `reviewed: false` until she has read and changed them; the page
 * shows them meanwhile (sandbox only; staging waits for her review). The Urdu is MACHINE-DRAFTED, gender-neutral (آپ;
 * the elicited_if_then line quotes her own supplied wording, which is hers to change),
 * and waits for a native check. The asked_and_waited set is the one her review mockup showed.
 *
 * Language is data (Rule 20): this file is the one place the steps live; the portal reads them through the week report.
 */

const STEPS = Object.freeze({
  opened_with_specific_praise: {
    reviewed: false,
    en: [
      'Before the debrief, pick one thing that really worked in the lesson.',
      'Open with it, and name exactly what the teacher did.',
      'Say why it worked for the students.',
      'Keep "but" out of the first minute.',
    ],
    ur: [
      'ڈی بریف سے پہلے سبق کی ایک ایسی بات چنیں جو واقعی کامیاب رہی۔',
      'اسی سے آغاز کریں، اور بالکل وہی بتائیں جو استاد نے کیا۔',
      'بتائیں کہ اس سے طلبہ کو کیا فائدہ ہوا۔',
      'پہلے منٹ میں "لیکن" نہ کہیں۔',
    ],
  },
  anchored_in_real_moment: {
    reviewed: false,
    en: [
      'Write down one moment from the lesson while you watch: the time and what was said.',
      'In the debrief, start the point with that moment.',
      'Use the students\' or the teacher\'s own words from it.',
      'Ask the teacher what they noticed in that moment.',
    ],
    ur: [
      'سبق دیکھتے ہوئے ایک لمحہ لکھ لیں: وقت اور جو کہا گیا۔',
      'ڈی بریف میں بات اسی لمحے سے شروع کریں۔',
      'اس لمحے کے طلبہ یا استاد کے اپنے الفاظ استعمال کریں۔',
      'استاد سے پوچھیں کہ اس لمحے انہوں نے کیا محسوس کیا۔',
    ],
  },
  asked_and_waited: {
    reviewed: false,
    en: [
      'After your praise, ask one open question.',
      'Try: "What was going through your mind at that point?"',
      'Count to five in your head before you speak again.',
      'If the teacher stays quiet, keep waiting. Don\'t answer for them.',
    ],
    ur: [
      'تعریف کے بعد ایک کھلا سوال پوچھیں۔',
      'یوں کہیں: "اس وقت آپ کے ذہن میں کیا چل رہا تھا؟"',
      'دوبارہ بولنے سے پہلے دل میں پانچ تک گنیں۔',
      'اگر استاد خاموش رہیں تو انتظار کرتے رہیں، ان کی جگہ جواب نہ دیں۔',
    ],
  },
  one_improvement_only: {
    reviewed: false,
    en: [
      'Before the debrief, choose the one change that would help the students most.',
      'Leave the rest for another visit.',
      'Name that one change, and only that one.',
      'If you notice yourself adding a second, stop and come back to the first.',
    ],
    ur: [
      'ڈی بریف سے پہلے وہ ایک تبدیلی چنیں جس سے طلبہ کو سب سے زیادہ فائدہ ہو۔',
      'باقی باتیں اگلے دورے کے لیے چھوڑ دیں۔',
      'صرف وہی ایک تبدیلی بتائیں۔',
      'اگر دوسری بات شروع کرنے لگیں تو رک جائیں اور پہلی پر واپس آئیں۔',
    ],
  },
  moves_not_teacher: {
    reviewed: false,
    en: [
      'Talk about what happened in the lesson, not about the teacher.',
      'Say "When the question was asked…", not "You always…".',
      'Describe the move and what the students did next.',
      'Leave out words about the teacher as a person.',
    ],
    ur: [
      'سبق میں جو ہوا اس پر بات کریں، استاد کی ذات پر نہیں۔',
      '"جب سوال پوچھا گیا…" کہیں، "آپ ہمیشہ…" نہیں۔',
      'طریقہ بتائیں اور یہ کہ اس کے بعد طلبہ نے کیا کیا۔',
      'استاد کی شخصیت کے بارے میں الفاظ استعمال نہ کریں۔',
    ],
  },
  elicited_if_then: {
    reviewed: false,
    en: [
      'Once you agree on the change, stop before you name the next step.',
      'Try: "Next time, what will you do differently? Tell me in your own words."',
      'Wait, and let the teacher put it in their own words.',
      'Say their step back once, in their words.',
    ],
    ur: [
      'تبدیلی پر اتفاق ہو جائے تو اگلا قدم خود بتانے سے پہلے رک جائیں۔',
      'یوں کہیں: "اگلی بار آپ کیا مختلف کریں گی؟ اپنے الفاظ میں بتائیں۔"',
      'انتظار کریں اور استاد کو اپنے الفاظ میں کہنے دیں۔',
      'ان کا قدم ایک بار انہی کے الفاظ میں دہرائیں۔',
    ],
  },
  righting_reflex_held: {
    reviewed: false,
    en: [
      'Aim for the teacher to talk more than you.',
      'When you want to explain, ask a question instead.',
      'Let a pause sit; the teacher will often fill it.',
      'Keep your own turns short: one or two sentences.',
    ],
    ur: [
      'کوشش کریں کہ استاد آپ سے زیادہ بولیں۔',
      'جب سمجھانے کا دل چاہے تو اس کی جگہ سوال پوچھیں۔',
      'خاموشی کو رہنے دیں، اکثر استاد اسے خود بھر دیتے ہیں۔',
      'اپنی بات مختصر رکھیں: ایک یا دو جملے۔',
    ],
  },
  rehearsed_the_step: {
    reviewed: false,
    en: [
      'Before you finish, ask the teacher to say the step out loud.',
      'Try: "Say it to me now, exactly as you\'ll say it in class."',
      'Wait three to five seconds after they answer.',
      'Thank them, and leave it there.',
    ],
    ur: [
      'بات ختم کرنے سے پہلے استاد سے کہیں کہ قدم زبانی کہیں۔',
      'یوں کہیں: "ابھی مجھے بالکل کلاس والے انداز میں کہہ کر سنائیں۔"',
      'ان کے جواب کے بعد تین سے پانچ سیکنڈ انتظار کریں۔',
      'شکریہ ادا کریں اور بات وہیں ختم کریں۔',
    ],
  },
});

/** The four steps for a behaviour, or null when it has none. */
function stepsFor(key) {
  return Object.prototype.hasOwnProperty.call(STEPS, key) ? STEPS[key] : null;
}

module.exports = { STEPS, stepsFor };
