'use strict';

/**
 * /observe2 — every chat line the coach reads, per language (en, ur). Data, not literals at the
 * call sites. The Flows themselves are English for the pilot; these are the messages around them.
 *
 * Urdu addresses the coach with imperatives and impersonal forms only: coaches are women and men,
 * so no "آپ ... رہی/رہے ہیں" (tests/observe2/start.test.js checks it).
 * Button titles stay within WhatsApp's 20 code points; list row titles within 24.
 *
 * Sending the recording: as a DOCUMENT (📎 → Document), never "Share → WhatsApp". Shared that way a
 * recorder-app file goes as an audio attachment, which WhatsApp refuses over 16 MB on the phone, and a
 * full lesson from a recorder app is bigger than that. A document can be up to 100 MB.
 */

const { clampLanguage } = require('../../../config/ux-strings');

// Digits inside Urdu prose are Urdu digits (U+06F0-06F9).
const urDigits = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d)));

const STRINGS = {
  en: {
    deny_no_user: 'I couldn\'t find your account. Send *register* first, then /observe2 again.',
    deny_role: '/observe2 is for coaches and school leaders.',
    visit_body: 'Let\'s plan the /observe2 visit. Pick a school, then a teacher.',
    visit_cta: 'Plan my visit',
    launch_failed: 'I couldn\'t open the visit planner just now. Please send /observe2 again in a minute.',
    record_failed: 'I couldn\'t start the field form just now. Please send /observe2 again.',
    period_failed: 'I couldn\'t show the period choices. Please send /observe2 again.',
    period_body: (name) => (name
      ? `You're observing *${name}*. How long is this period? The form has two parts: up to guided practice, then the children working on their own.`
      : 'How long is this period? The form has two parts: up to guided practice, then the children working on their own.'),
    period_button: (minutes) => `${minutes} minutes`,
    period_list_button: 'Pick a period',
    // The parts follow the lesson's steps (FICO pilot sheet R4/R10): Part 1 is saved when the children
    // start working on their own.
    form_body: (minutes) => {
      return [
        'Before the lesson starts:',
        '1️⃣ Open your phone\'s *voice recorder app* (not WhatsApp) and start recording. Leave it running for the whole lesson. It keeps recording while you take photos; a WhatsApp voice note stops when the camera opens.',
        `2️⃣ Tap *Open the form* and fill it in as you watch. Save Part 1 when the children start working on their own, then carry on with Part 2 until minute ${minutes}. Take photos with the phone's camera as you go, and add them in the form with *Upload saved photos*.`,
        '3️⃣ When the lesson ends: stop the recorder, tap *Seal and send* in the form, then send the recording here as a *Document* (📎 → *Document*), not as audio.',
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
      '2️⃣ Send it here as a *Document*: tap 📎 → *Document*, find the recording (often in a *Recordings* or *Voice Recorder* folder) and tap *Send*.',
      'On iPhone: first save it to Files (in Voice Memos, *Share* → *Save to Files*), then here tap ➕ → *Document*.',
      '',
      'Not as audio: WhatsApp refuses audio over 16 MB, and a lesson recording is bigger. A document can be up to 100 MB.',
      '',
      'I\'ll listen to it and send you the moments I found, to check against what you saw.',
    ].join('\n'),
    sealed_chat_recording_in: (time) => `✅ Record sealed at ${time}. Your answers are locked. The recording is already in, so the moments come to you next.`,
    recording_received: (sealed) => (sealed
      ? '🎧 Recording received, thank you. I\'m listening to it now; the moments I find come to you here to check. A full lesson takes a few minutes.'
      : '🎧 Recording received, thank you. Your form isn\'t sealed yet: open it and tap *Seal and send*. The moments I find open only after the seal.'),
    check_body: (n) => `🎧 I've listened to the recording and found ${n} moment${n === 1 ? '' : 's'}. Check each one against what you saw. Your sealed answers are already in, and they don't change.`,
    check_cta: 'Check the moments',
    moments_untimed: 'The recording came through without timings, so I can\'t point to moments in it. Your sealed record is safe. Please send the recording again from the recorder app, as a *Document* (📎 → *Document*).',
    moments_failed: 'I couldn\'t read the moments in this recording just now. Your sealed record is safe, and the team has been told.',
    duplicate_form_waiting: 'Your form for this visit is still waiting for its recording: send the recording of this lesson here as a *Document* (📎 → *Document*).',
    // A recording that came with no form waiting: kept with its own form, to fill whenever the coach is ready.
    held_saved: (minutes) => [
      `💾 Saved: your ${minutes ? `${minutes}-minute ` : ''}recording, as one visit with its own form.`,
      'Fill in the form whenever you\'re ready: tap *Fill the form* now, or later from /observe2 → *Complete the form*. Record your next lesson whenever you like.',
    ].join('\n'),
    btn_fill_form: 'Fill the form',
    form_body_after: [
      'The lesson is recorded, so fill in the form from what you saw and heard. No need to watch the clock.',
      'The parts follow the lesson: Part 1 is up to and including guided practice, Part 2 is independent practice and the wrap-up.',
      'At the end, tap *Seal and send*.',
    ].join('\n'),
  },
  ur: {
    deny_no_user: 'آپ کا اکاؤنٹ نہیں ملا۔ پہلے *register* لکھ کر بھیجیں، پھر دوبارہ \u2066/observe2\u2069 لکھیں۔',
    deny_role: '\u2066/observe2\u2069 کوچز اور اسکول سربراہان کے لیے ہے۔',
    visit_body: 'آئیے \u2066/observe2\u2069 وزٹ کی منصوبہ بندی کریں۔ اسکول چنیں، پھر استاد۔',
    visit_cta: 'دورہ چنیں',
    launch_failed: 'ابھی وزٹ پلانر نہیں کھل سکا۔ ایک منٹ بعد دوبارہ \u2066/observe2\u2069 بھیجیں۔',
    record_failed: 'ابھی فیلڈ فارم شروع نہیں ہو سکا۔ دوبارہ \u2066/observe2\u2069 بھیجیں۔',
    period_failed: 'پیریڈ کے انتخاب نہیں دکھ سکے۔ دوبارہ \u2066/observe2\u2069 بھیجیں۔',
    period_body: (name) => (name
      ? `*${name}* کا مشاہدہ۔ یہ پیریڈ کتنے منٹ کا ہے؟ فارم کے دو حصے ہیں: گائیڈڈ پریکٹس تک، پھر بچوں کا اپنا کام۔`
      : 'یہ پیریڈ کتنے منٹ کا ہے؟ فارم کے دو حصے ہیں: گائیڈڈ پریکٹس تک، پھر بچوں کا اپنا کام۔'),
    period_button: (minutes) => `${minutes} منٹ`,
    period_list_button: 'پیریڈ چنیں',
    form_body: (minutes) => {
      return [
        'سبق شروع ہونے سے پہلے:',
        '1️⃣ فون کی *وائس ریکارڈر ایپ* (واٹس ایپ نہیں) کھولیں اور ریکارڈنگ شروع کریں۔ پورے سبق میں ریکارڈنگ چلتی رہے۔ تصویر لیتے وقت بھی یہ ریکارڈ کرتی رہتی ہے؛ واٹس ایپ کا وائس نوٹ کیمرہ کھلتے ہی رک جاتا ہے۔',
        `2️⃣ *فارم کھولیں* دبائیں اور دیکھتے ہوئے بھرتے جائیں۔ جب بچے خود کام شروع کریں تو حصہ 1 محفوظ کریں، پھر منٹ ${minutes} تک حصہ 2۔ سبق کے دوران تصویریں فون کے کیمرے سے لیں، اور فارم میں *Upload saved photos* سے شامل کریں۔`,
        '3️⃣ سبق ختم ہو تو ریکارڈنگ روکیں، فارم میں *Seal and send* دبائیں، پھر ریکارڈنگ اسی چیٹ میں *Document* کے طور پر بھیجیں (📎، پھر *Document*)، آڈیو کے طور پر نہیں۔',
      ].join('\n');
    },
    form_cta: 'فارم کھولیں',
    form_failed: 'فارم نہیں جا سکا۔ پیریڈ کا بٹن دوبارہ دبائیں، یا \u2066/observe2\u2069 بھیجیں۔',
    form_gone: 'یہ فارم پہلے ہی سیل ہو چکا ہے، یا کسی اور کا ہے۔ نیا وزٹ شروع کرنے کے لیے \u2066/observe2\u2069 بھیجیں۔',
    try_again: 'میری طرف کوئی مسئلہ ہوا۔ ایک منٹ بعد پیریڈ کا بٹن دوبارہ دبائیں۔',
    sealed_chat: (time) => [
      `✅ ریکارڈ ${time} پر سیل ہو گیا۔ جوابات اب بدلے نہیں جا سکتے۔`,
      '',
      'اب ریکارڈنگ:',
      '1️⃣ ریکارڈر روکیں۔',
      '2️⃣ اسے یہاں *Document* کے طور پر بھیجیں: 📎 دبائیں، پھر *Document*، ریکارڈنگ تلاش کریں (عموماً *Recordings* یا *Voice Recorder* فولڈر میں) اور *Send* دبائیں۔',
      'آئی فون پر: پہلے اسے Files میں محفوظ کریں (Voice Memos میں *Share*، پھر *Save to Files*)، پھر یہاں ➕ دبائیں، پھر *Document*۔',
      '',
      'آڈیو کے طور پر نہیں: واٹس ایپ \u206616 MB\u2069 سے بڑی آڈیو نہیں بھیجتا، اور سبق کی ریکارڈنگ اس سے بڑی ہوتی ہے۔ *Document* کے طور پر \u2066100 MB\u2069 تک کی فائل جا سکتی ہے۔',
      '',
      'ریکارڈنگ سننے کے بعد اس کے لمحات آپ کو بھیجے جائیں گے، تاکہ آپ انہیں اپنے مشاہدے سے ملا سکیں۔',
    ].join('\n'),
    sealed_chat_recording_in: (time) => `✅ ریکارڈ ${time} پر سیل ہو گیا۔ جوابات اب بدلے نہیں جا سکتے۔ ریکارڈنگ پہلے ہی آ چکی ہے، اس لیے اب لمحات آپ کو بھیجے جائیں گے۔`,
    recording_received: (sealed) => (sealed
      ? '🎧 ریکارڈنگ مل گئی، شکریہ۔ اسے سنا جا رہا ہے؛ جو لمحات ملیں گے وہ چیک کرنے کے لیے یہیں آئیں گے۔ پورے سبق میں چند منٹ لگتے ہیں۔'
      : '🎧 ریکارڈنگ مل گئی، شکریہ۔ فارم ابھی سیل نہیں ہوا: فارم کھولیں اور *Seal and send* دبائیں۔ لمحات سیل کے بعد ہی کھلیں گے۔'),
    check_body: (n) => `🎧 ریکارڈنگ سن لی گئی ہے اور اس میں ${n} لمحات ملے۔ ہر لمحے کو اپنے مشاہدے سے ملا کر دیکھیں۔ آپ کے سیل شدہ جوابات پہلے سے شامل ہیں اور بدلتے نہیں۔`,
    check_cta: 'لمحات چیک کریں',
    moments_untimed: 'ریکارڈنگ وقت کے نشانات کے بغیر آئی، اس لیے اس میں لمحات کی نشاندہی نہیں ہو سکتی۔ آپ کا سیل شدہ ریکارڈ محفوظ ہے۔ ریکارڈر ایپ سے ریکارڈنگ دوبارہ *Document* کے طور پر بھیجیں (📎، پھر *Document*)۔',
    moments_failed: 'ابھی اس ریکارڈنگ کے لمحات نہیں پڑھے جا سکے۔ آپ کا سیل شدہ ریکارڈ محفوظ ہے اور ٹیم کو بتا دیا گیا ہے۔',
    duplicate_form_waiting: 'اس وزٹ کا فارم ابھی اپنی ریکارڈنگ کا منتظر ہے: اس سبق کی ریکارڈنگ یہیں *Document* کے طور پر بھیجیں (📎، پھر *Document*)۔',
    held_saved: (minutes) => [
      `💾 ریکارڈنگ${minutes ? ` (${urDigits(minutes)} منٹ)` : ''} محفوظ ہو گئی، ایک وزٹ کے طور پر، اپنے فارم کے ساتھ۔`,
      'فارم جب چاہیں بھریں: ابھی *فارم بھریں* دبائیں، یا بعد میں ⁦/observe2⁩ میں ⁦Complete the form⁩ سے۔ اگلا سبق جب چاہیں ریکارڈ کریں۔',
    ].join('\n'),
    btn_fill_form: 'فارم بھریں',
    form_body_after: [
      'سبق ریکارڈ ہو چکا ہے، اس لیے فارم اپنے مشاہدے اور سنی ہوئی باتوں سے بھریں۔ گھڑی دیکھنے کی ضرورت نہیں۔',
      'فارم کے حصے سبق کے مراحل کے مطابق ہیں: حصہ ۱ رہنمائی کے ساتھ مشق تک، حصہ ۲ انفرادی مشق اور اختتام۔',
      'آخر میں *Seal and send* دبائیں۔',
    ].join('\n'),
  },
};

/** @param {string} lang the coach's language; clamped to this deployment's offer (en, ur). */
function observe2Strings(lang) {
  return STRINGS[clampLanguage(lang)] || STRINGS.en;
}

module.exports = { observe2Strings };
