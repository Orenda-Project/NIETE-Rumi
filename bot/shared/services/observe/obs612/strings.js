'use strict';

/**
 * bd-pni007 — the chat lines around an FDE (obs612) coach visit, per language (en, ur). Data, not literals at the
 * call sites. FDE's own form wording stays English as FDE printed it; these are the messages around it.
 *
 * Urdu is a DRAFT for native review (Rifat). It addresses the coach with imperatives and impersonal forms only
 * (coaches are women and men), and puts Urdu digits in Urdu prose. Caps (WhatsApp): list row title 24, row
 * description 72, list button 20, body 1024 code points (tests/observe/obs612-lesson.test.js measures them).
 */

const { clampLanguage } = require('../../../config/ux-strings');

const urDigits = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d)));

const TOOL_NAMES = {
  en: {
    msci: "FDE's Observation Tool for Maths and Science (Grade VI-VII)",
    enur: "FDE's Classroom Observation Tool for English & Urdu (Grade VI-VIII)",
    gen: "FDE's Teacher Observation Form General",
  },
  ur: {
    msci: 'ایف ڈی ای کا ریاضی اور سائنس کا مشاہداتی ٹول (Grade VI-VII)',
    enur: 'ایف ڈی ای کا انگریزی اور اردو کا مشاہداتی ٹول (Grade VI-VIII)',
    gen: 'ایف ڈی ای کا عمومی مشاہداتی فارم (General)',
  },
};

const TOOL_HOW = {
  en: {
    msci: '11 indicators at Level 0-3, then a quick check with 5 students and a development plan. About 10 minutes.',
    enur: 'Every item scored 1-4, then your written feedback (Section 8). About 10 minutes.',
    gen: "35 Yes/No items in 6 sections, then one line of feedback. About 5 minutes.",
  },
  ur: {
    msci: '۱۱ نکات، ہر ایک کا لیول ۰ سے ۳، پھر ۵ طلبہ سے مختصر جانچ اور ترقیاتی منصوبہ۔ تقریباً ۱۰ منٹ۔',
    enur: 'ہر نکتے کو ۱ سے ۴ نمبر دیں، پھر اپنی تحریری رائے (سیکشن ۸)۔ تقریباً ۱۰ منٹ۔',
    gen: '۶ حصوں میں ۳۵ ہاں/نہیں سوال، پھر ایک سطر رائے۔ تقریباً ۵ منٹ۔',
  },
};

const SUBJECT_LABELS = {
  en: {
    english: 'English', urdu: 'Urdu', maths: 'Maths', science: 'Science', social_studies: 'Social Studies',
    islamiat: 'Islamiat', computer: 'Computer', other: 'Other',
  },
  ur: {
    english: 'انگریزی', urdu: 'اردو', maths: 'ریاضی', science: 'سائنس', social_studies: 'معاشرتی علوم',
    islamiat: 'اسلامیات', computer: 'کمپیوٹر', other: 'کوئی اور',
  },
};

const STRINGS = {
  en: {
    class_body: (name) => (name
      ? `Which class is *${name}*'s lesson? The class and subject choose the observation form: grades 1-5 get the FICO form, as today; grades 6-12 get FDE's own tool.`
      : "Which class is this lesson? The class and subject choose the observation form: grades 1-5 get the FICO form, as today; grades 6-12 get FDE's own tool."),
    class_button: 'Pick the class',
    class_section: 'Class',
    grade_primary: 'Grade 1-5',
    grade_primary_desc: 'FICO observation, as today',
    grade_row: (g) => `Grade ${g}`,
    subject_body: (g) => `Grade ${g}. Which subject is the lesson?`,
    subject_button: 'Pick the subject',
    subject_section: 'Subject',
    science_desc: 'General science, physics, chemistry, biology',
    lesson_line: (g, subjectLabel) => `Grade ${g} · ${subjectLabel}`,
    // /observe: after the class is known, before the recording.
    fde_record_hint: (tool) => `This lesson uses ${TOOL_NAMES.en[tool]}. Record the lesson as usual and send me the recording: the FDE form comes as soon as it lands, and you set every level.`,
    // The message that opens the FDE form.
    form_body: (g, subjectLabel, tool) => `Grade ${g} · ${subjectLabel}. This lesson uses ${TOOL_NAMES.en[tool]}: ${TOOL_HOW.en[tool]}\n\nFill it in while the lesson is fresh. You set every level; the recording stays with the visit.`,
    form_body_live: (g, subjectLabel, tool) => `Grade ${g} · ${subjectLabel}. This lesson uses ${TOOL_NAMES.en[tool]}: ${TOOL_HOW.en[tool]}\n\nFill it in as you watch, and finish before you leave the room. Recording the lesson is optional: if you record it, send the recording here and it stays with the visit.`,
    form_cta: 'Open FDE form',
    // An /observe2 FDE visit's recording, linked to its form.
    recording_saved: (submitted) => (submitted
      ? '🎧 Recording received and kept with this visit. Your FDE form is already submitted.'
      : '🎧 Recording received and kept with this visit. Fill in the FDE form when you are ready: tap *Open FDE form*.'),
    form_not_ready: "The FDE form isn't switched on here yet, so I can't open it. Your recording is saved. Please tell the Rumi team.",
    form_failed: "I couldn't open the FDE form just now. Please send /observe again in a minute; your visit is saved.",
    gone: "That choice is from an older visit. Send /observe or /observe2 to start a new one.",
    try_again: 'Something went wrong on my side. Please tap your choice again in a minute.',
  },
  ur: {
    class_body: (name) => (name
      ? `*${name}* کا یہ سبق کس جماعت کا ہے؟ جماعت اور مضمون سے مشاہداتی فارم طے ہوتا ہے: جماعت ۱ تا ۵ کے لیے FICO فارم، جیسے آج ہے؛ جماعت ۶ تا ۱۲ کے لیے ایف ڈی ای کا اپنا ٹول۔`
      : 'یہ سبق کس جماعت کا ہے؟ جماعت اور مضمون سے مشاہداتی فارم طے ہوتا ہے: جماعت ۱ تا ۵ کے لیے FICO فارم، جیسے آج ہے؛ جماعت ۶ تا ۱۲ کے لیے ایف ڈی ای کا اپنا ٹول۔'),
    class_button: 'جماعت چنیں',
    class_section: 'جماعت',
    grade_primary: 'جماعت ۱ تا ۵',
    grade_primary_desc: 'FICO مشاہدہ، جیسے آج ہے',
    grade_row: (g) => `جماعت ${urDigits(g)}`,
    subject_body: (g) => `جماعت ${urDigits(g)}۔ یہ سبق کس مضمون کا ہے؟`,
    subject_button: 'مضمون چنیں',
    subject_section: 'مضمون',
    science_desc: 'جنرل سائنس، فزکس، کیمسٹری، بیالوجی',
    lesson_line: (g, subjectLabel) => `جماعت ${urDigits(g)} · ${subjectLabel}`,
    fde_record_hint: (tool) => `اس سبق کے لیے ${TOOL_NAMES.ur[tool]} استعمال ہو گا۔ سبق معمول کے مطابق ریکارڈ کر کے یہاں بھیجیں: ریکارڈنگ آتے ہی ایف ڈی ای فارم آ جائے گا۔ ہر لیول خود طے کریں۔`,
    form_body: (g, subjectLabel, tool) => `جماعت ${urDigits(g)} · ${subjectLabel}۔ اس سبق کے لیے ${TOOL_NAMES.ur[tool]}: ${TOOL_HOW.ur[tool]}\n\nسبق ذہن میں تازہ ہو تو ابھی بھریں۔ ہر لیول خود طے کریں؛ ریکارڈنگ وزٹ کے ساتھ محفوظ رہتی ہے۔`,
    form_body_live: (g, subjectLabel, tool) => `جماعت ${urDigits(g)} · ${subjectLabel}۔ اس سبق کے لیے ${TOOL_NAMES.ur[tool]}: ${TOOL_HOW.ur[tool]}\n\nسبق دیکھتے ہوئے بھریں اور کمرے سے نکلنے سے پہلے مکمل کریں۔ ریکارڈنگ ضروری نہیں: ریکارڈ کریں تو یہاں بھیج دیں، وہ وزٹ کے ساتھ محفوظ رہے گی۔`,
    form_cta: 'FDE فارم کھولیں',
    recording_saved: (submitted) => (submitted
      ? '🎧 ریکارڈنگ مل گئی اور اس وزٹ کے ساتھ محفوظ ہے۔ ایف ڈی ای فارم پہلے ہی جمع ہو چکا ہے۔'
      : '🎧 ریکارڈنگ مل گئی اور اس وزٹ کے ساتھ محفوظ ہے۔ جب تیار ہوں ایف ڈی ای فارم بھریں: *FDE فارم کھولیں* دبائیں۔'),
    form_not_ready: 'ایف ڈی ای فارم ابھی یہاں چالو نہیں، اس لیے نہیں کھل سکا۔ آپ کی ریکارڈنگ محفوظ ہے۔ براہِ کرم رومی ٹیم کو بتائیں۔',
    form_failed: 'ابھی ایف ڈی ای فارم نہیں کھل سکا۔ ایک منٹ بعد دوبارہ ⁦/observe⁩ بھیجیں؛ آپ کا وزٹ محفوظ ہے۔',
    gone: 'یہ انتخاب پرانے وزٹ کا ہے۔ نیا وزٹ شروع کرنے کے لیے ⁦/observe⁩ یا ⁦/observe2⁩ بھیجیں۔',
    try_again: 'میری طرف کوئی مسئلہ ہوا۔ ایک منٹ بعد دوبارہ انتخاب کریں۔',
  },
};

function obs612Strings(lang) {
  const l = clampLanguage(lang) === 'ur' ? 'ur' : 'en';
  return { ...STRINGS[l], subjects: SUBJECT_LABELS[l], tools: TOOL_NAMES[l], lang: l };
}

module.exports = { obs612Strings, STRINGS, SUBJECT_LABELS, TOOL_NAMES, urDigits };
