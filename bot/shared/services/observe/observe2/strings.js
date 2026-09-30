'use strict';

/**
 * /observe2 — every chat line the coach reads, per language (en, ur). Data, not literals at the
 * call sites. The Flows themselves are English for the pilot; these are the messages around them.
 *
 * Urdu addresses the coach with imperatives and impersonal forms only: coaches are women and men,
 * so no "آپ ... رہی/رہے ہیں" (tests/observe2/start.test.js checks it).
 * Button titles stay within WhatsApp's 20 code points.
 */

const { clampLanguage } = require('../../../config/ux-strings');

const STRINGS = {
  en: {
    deny_no_user: 'I couldn\'t find your account. Send *register* first, then /observe2 again.',
    deny_role: '/observe2 is for coaches and school leaders.',
    visit_body: 'Let\'s plan the /observe2 visit. Pick a school, then a teacher.',
    visit_cta: 'Plan my visit',
    launch_failed: 'I couldn\'t open the visit planner just now. Please send /observe2 again in a minute.',
    record_failed: 'I couldn\'t start the field form just now. Please send /observe2 again.',
    period_failed: 'I couldn\'t show the period buttons. Please send /observe2 again.',
    period_body: (name) => (name
      ? `You're observing *${name}*. How long is this period? The form has two parts, one for each half.`
      : 'How long is this period? The form has two parts, one for each half.'),
    period_button: (minutes) => `${minutes} minutes`,
    form_body: (minutes) => {
      const half = Math.round(minutes / 2);
      return [
        'Before the lesson starts:',
        '1️⃣ Open your phone\'s *voice recorder app* (not WhatsApp) and start recording. Leave it running for the whole lesson.',
        `2️⃣ Tap *Open the form* and fill it in as you watch. Save Part 1 at minute ${half}, then carry on with Part 2 until minute ${minutes}.`,
        '3️⃣ When the lesson ends: stop the recorder, tap *Seal and send* in the form, then send the recording here in this chat.',
      ].join('\n');
    },
    form_cta: 'Open the form',
    form_failed: 'The form didn\'t send. Tap the period again, or send /observe2.',
    form_gone: 'That form is already sealed, or it isn\'t yours. Send /observe2 to start a new visit.',
    try_again: 'Something went wrong on my side. Please tap the period again in a minute.',
    sealed_chat: (time) => [
      `✅ Record sealed at ${time}. Your answers are locked.`,
      '',
      'Now the recording:',
      '1️⃣ Stop the recorder.',
      '2️⃣ In the recorder app, tap *Share* → *WhatsApp* → this chat, and send it.',
      '',
      'I\'ll listen to it and send you the moments I found, to check against what you saw.',
    ].join('\n'),
    sealed_chat_recording_in: (time) => `✅ Record sealed at ${time}. Your answers are locked. The recording is already in, so the moments come to you next.`,
    recording_received: (sealed) => (sealed
      ? '🎧 Recording received, thank you. I\'m listening to it now; the moments I find come to you here to check. A full lesson takes a few minutes.'
      : '🎧 Recording received, thank you. Your form isn\'t sealed yet: open it and tap *Seal and send*. The moments I find open only after the seal.'),
    check_body: (n) => `🎧 I've listened to the recording and found ${n} moment${n === 1 ? '' : 's'}. Check each one against what you saw. Your sealed answers are already in, and they don't change.`,
    check_cta: 'Check the moments',
    moments_untimed: 'The recording came through without timings, so I can\'t point to moments in it. Your sealed record is safe. Please send the recording again as a file from the recorder app.',
    moments_failed: 'I couldn\'t read the moments in this recording just now. Your sealed record is safe, and the team has been told.',
  },
  ur: {
    deny_no_user: 'آپ کا اکاؤنٹ نہیں ملا۔ پہلے *register* لکھ کر بھیجیں، پھر دوبارہ /observe2 لکھیں۔',
    deny_role: '/observe2 کوچز اور اسکول سربراہان کے لیے ہے۔',
    visit_body: 'آئیے /observe2 وزٹ کی منصوبہ بندی کریں۔ اسکول چنیں، پھر استاد۔',
    visit_cta: 'دورہ چنیں',
    launch_failed: 'ابھی وزٹ پلانر نہیں کھل سکا۔ ایک منٹ بعد دوبارہ /observe2 بھیجیں۔',
    record_failed: 'ابھی فیلڈ فارم شروع نہیں ہو سکا۔ دوبارہ /observe2 بھیجیں۔',
    period_failed: 'پیریڈ کے بٹن نہیں دکھ سکے۔ دوبارہ /observe2 بھیجیں۔',
    period_body: (name) => (name
      ? `*${name}* کا مشاہدہ۔ یہ پیریڈ کتنے منٹ کا ہے؟ فارم کے دو حصے ہیں، پیریڈ کے ہر نصف کے لیے ایک۔`
      : 'یہ پیریڈ کتنے منٹ کا ہے؟ فارم کے دو حصے ہیں، پیریڈ کے ہر نصف کے لیے ایک۔'),
    period_button: (minutes) => `${minutes} منٹ`,
    form_body: (minutes) => {
      const half = Math.round(minutes / 2);
      return [
        'سبق شروع ہونے سے پہلے:',
        '1️⃣ فون کی *وائس ریکارڈر ایپ* (واٹس ایپ نہیں) کھولیں اور ریکارڈنگ شروع کریں۔ پورے سبق میں ریکارڈنگ چلتی رہے۔',
        `2️⃣ *فارم کھولیں* دبائیں اور دیکھتے ہوئے بھرتے جائیں۔ منٹ ${half} پر حصہ 1 محفوظ کریں، پھر منٹ ${minutes} تک حصہ 2۔`,
        '3️⃣ سبق ختم ہو تو ریکارڈنگ روکیں، فارم میں *Seal and send* دبائیں، پھر ریکارڈنگ اسی چیٹ میں بھیجیں۔',
      ].join('\n');
    },
    form_cta: 'فارم کھولیں',
    form_failed: 'فارم نہیں جا سکا۔ پیریڈ کا بٹن دوبارہ دبائیں، یا /observe2 بھیجیں۔',
    form_gone: 'یہ فارم پہلے ہی سیل ہو چکا ہے، یا کسی اور کا ہے۔ نیا وزٹ شروع کرنے کے لیے /observe2 بھیجیں۔',
    try_again: 'میری طرف کوئی مسئلہ ہوا۔ ایک منٹ بعد پیریڈ کا بٹن دوبارہ دبائیں۔',
    sealed_chat: (time) => [
      `✅ ریکارڈ ${time} پر سیل ہو گیا۔ جوابات اب بدلے نہیں جا سکتے۔`,
      '',
      'اب ریکارڈنگ:',
      '1️⃣ ریکارڈر روکیں۔',
      '2️⃣ ریکارڈر ایپ میں *Share* دبائیں، پھر *WhatsApp*، پھر یہ چیٹ چنیں اور بھیج دیں۔',
      '',
      'ریکارڈنگ سننے کے بعد اس کے لمحات آپ کو بھیجے جائیں گے، تاکہ آپ انہیں اپنے مشاہدے سے ملا سکیں۔',
    ].join('\n'),
    sealed_chat_recording_in: (time) => `✅ ریکارڈ ${time} پر سیل ہو گیا۔ جوابات اب بدلے نہیں جا سکتے۔ ریکارڈنگ پہلے ہی آ چکی ہے، اس لیے اب لمحات آپ کو بھیجے جائیں گے۔`,
    recording_received: (sealed) => (sealed
      ? '🎧 ریکارڈنگ مل گئی، شکریہ۔ اسے سنا جا رہا ہے؛ جو لمحات ملیں گے وہ چیک کرنے کے لیے یہیں آئیں گے۔ پورے سبق میں چند منٹ لگتے ہیں۔'
      : '🎧 ریکارڈنگ مل گئی، شکریہ۔ فارم ابھی سیل نہیں ہوا: فارم کھولیں اور *Seal and send* دبائیں۔ لمحات سیل کے بعد ہی کھلیں گے۔'),
    check_body: (n) => `🎧 ریکارڈنگ سن لی گئی ہے اور اس میں ${n} لمحات ملے۔ ہر لمحے کو اپنے مشاہدے سے ملا کر دیکھیں۔ آپ کے سیل شدہ جوابات پہلے سے شامل ہیں اور بدلتے نہیں۔`,
    check_cta: 'لمحات چیک کریں',
    moments_untimed: 'ریکارڈنگ وقت کے نشانات کے بغیر آئی، اس لیے اس میں لمحات کی نشاندہی نہیں ہو سکتی۔ آپ کا سیل شدہ ریکارڈ محفوظ ہے۔ ریکارڈر ایپ سے ریکارڈنگ فائل کے طور پر دوبارہ بھیجیں۔',
    moments_failed: 'ابھی اس ریکارڈنگ کے لمحات نہیں پڑھے جا سکے۔ آپ کا سیل شدہ ریکارڈ محفوظ ہے اور ٹیم کو بتا دیا گیا ہے۔',
  },
};

/** @param {string} lang the coach's language; clamped to this deployment's offer (en, ur). */
function observe2Strings(lang) {
  return STRINGS[clampLanguage(lang)] || STRINGS.en;
}

module.exports = { observe2Strings };
