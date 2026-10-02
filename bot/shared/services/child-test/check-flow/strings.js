'use strict';

/**
 * Child test check Flow — every word the coach reads on the check, per language (ur, en).
 * The Flow JSON carries no copy of its own: each label is ${data.*}, filled from here by the endpoint,
 * so the coach reads the check in their own language.
 *
 * Urdu addresses the coach with imperatives and impersonal forms only (coaches are women and men). The
 * bot never names itself here: marks are "from the recording" / "read from the photo", which is both
 * what the coach needs to know and free of a gendered verb ("جانچی نہیں جا سکی"). Children are the
 * child or the roll number, never "she"/"he".
 * Caps, in code points (tests/child-test/L6/check-flow-contract.test.js): input labels 20, group labels
 * 30, helpers 80, footers 35, option titles 30, headings 80, the chat button 20, header 60.
 */

const { clampLanguage } = require('../../../config/ux-strings');

const STRINGS = {
  en: {
    verdicts: [{ id: 'correct', title: 'Correct' }, { id: 'wrong', title: 'Wrong' }, { id: 'none', title: 'No answer' }],
    wverdicts: [{ id: 'correct', title: 'Correct' }, { id: 'wrong', title: 'Wrong' }, { id: 'blank', title: 'Left blank' }, { id: 'unreadable', title: "Can't read it" }],
    readwrong: [{ id: 'wrong', title: 'Read wrong' }, { id: 'correct', title: 'Read right' }],

    status_scored: 'The marks from the recording are filled in. Change anything you heard differently. Empty fields were unclear in the recording: mark them yourself.',
    status_partial: 'Only part of this could be marked from the recording. Mark the empty fields from what you heard.',
    status_failed: "This recording couldn't be marked. Mark every field from what you heard.",
    status_pending: 'This part is still being marked. Mark it from what you heard, or close this and open the check again in a minute.',
    status_missing: 'No recording arrived for this part. Mark it from what you heard.',
    status_coach: 'Already saved earlier: these are your saved marks. Tap save to go on.',
    status_locked: "This part was saved earlier and can't be changed now. Your saved marks are back in place; tap save to go on.",
    status_unavailable: 'This check is not available. Close it and open it again from the chat.',

    t_story: 'Story, 60 seconds',
    t_wc: 'Words correct',
    t_wa: 'Words tried',
    help_filled: 'From the recording. Change it if you counted differently',
    help_empty: 'Unclear in the recording. Enter your count',
    help_of10: 'Out of 10',
    t_flag: 'Words read wrong',
    flag_cap: 'Untick any word the child read right.',
    sw_label: (word) => `«${word}»`,
    t_fb: 'Letters and words (the story was too hard)',
    t_fl: 'Letters correct',
    t_fw: 'Words correct',
    t_q: 'Questions about the story',
    q_label: 'Question',
    heard: (text) => `Heard: «${text}»`,
    heard_nothing: 'Heard: no answer',
    t_fs: 'First sounds',
    hint: (text) => `Heard in the recording: «${text}» (a hint)`,
    no_hint: 'No hint',
    t_nw: 'Made-up words',
    t_nwc: 'Read wrong',
    nwc_cap: 'Untick any the child read right. These were clear in the recording.',
    unsure: 'Unclear in the recording. Mark what you heard',
    t_num: 'Numbers read aloud',
    t_numc: 'Read wrong',
    numc_cap: 'Untick any number the child read right.',
    t_qs: 'Quick sums, 60 seconds',
    t_qc: 'Sums correct',
    t_qa: 'Sums tried',
    t_wr: 'Written sums (from the photo)',
    read_as: (text) => `Read from the photo: «${text}»`,
    read_nothing: 'No answer could be read from the photo',
    t_wp: 'Word problem',
    wp_label: 'Word problem',
    next_urdu: 'Save Urdu, next: English',
    next_english: 'Save English, next: maths',
    next_maths: 'Save and finish',
    done_button: 'Done',
    done_saved: 'Saved',
    done_next: (who) => `The marks for ${who} are saved.`,
    not_available_title: 'Not available',
    not_saved_title: 'Not saved',
    not_saved_next: 'Something went wrong while saving. Close this and open the check again from the chat; what you saved before is kept.',

    err_number: 'Enter a whole number',
    err_more_than_tried: 'More than tried',
    err_out_of: (n) => `At most ${n}`,
    err_pick: 'Pick one',

    child_line: (who, grade) => `${who} · Grade ${grade}`,
    roll: (n) => `roll ${n}`,
    check_header: (who) => `Check: ${who}`,
    check_body: ({ who, urdu, english, maths }) => `Marks from the recording for ${who}: Urdu ${urdu}, English ${english}, maths ${maths}. Open the check, change anything you heard differently, and save. About a minute.`,
    words_line: (n) => `${n} words`,
    letters_line: (n) => `${n}/10 letters`,
    sums_line: (n) => `${n} quick sums`,
    not_marked: '—',
    check_cta: 'Check marks',
    completion_saved: (who) => `✓ Marks for ${who} saved.`,
    completion_not_saved: (who) => `The check for ${who} didn't save. Tap the check button above to open it again; nothing you saved is lost.`,
  },
  ur: {
    verdicts: [{ id: 'correct', title: 'درست' }, { id: 'wrong', title: 'غلط' }, { id: 'none', title: 'جواب نہیں دیا' }],
    wverdicts: [{ id: 'correct', title: 'درست' }, { id: 'wrong', title: 'غلط' }, { id: 'blank', title: 'خالی چھوڑا' }, { id: 'unreadable', title: 'پڑھا نہیں جا سکا' }],
    readwrong: [{ id: 'wrong', title: 'غلط پڑھا' }, { id: 'correct', title: 'درست پڑھا' }],

    status_scored: 'ریکارڈنگ سے نمبر بھرے ہوئے ہیں۔ جو آپ نے مختلف سنا ہو وہ بدلیں۔ خالی خانے ریکارڈنگ میں واضح نہیں تھے، انہیں خود بھریں۔',
    status_partial: 'اس حصے کا کچھ ہی حصہ جانچا جا سکا۔ خالی خانے اپنے سنے ہوئے کے مطابق بھریں۔',
    status_failed: 'یہ ریکارڈنگ جانچی نہیں جا سکی۔ ہر خانہ اپنے سنے ہوئے کے مطابق بھریں۔',
    status_pending: 'یہ حصہ ابھی جانچا جا رہا ہے۔ اپنے سنے ہوئے کے مطابق بھریں، یا بند کر کے ایک منٹ بعد دوبارہ کھولیں۔',
    status_missing: 'اس حصے کی ریکارڈنگ نہیں ملی۔ اپنے سنے ہوئے کے مطابق بھریں۔',
    status_coach: 'یہ نمبر پہلے محفوظ ہو چکے ہیں۔ آگے بڑھنے کے لیے محفوظ کریں دبائیں۔',
    status_locked: 'یہ حصہ پہلے محفوظ ہو چکا ہے اور اب بدلا نہیں جا سکتا۔ محفوظ نمبر واپس لگا دیے گئے ہیں؛ آگے بڑھنے کے لیے محفوظ کریں دبائیں۔',
    status_unavailable: 'یہ جانچ دستیاب نہیں۔ اسے بند کریں اور چیٹ سے دوبارہ کھولیں۔',

    t_story: 'کہانی، 60 سیکنڈ',
    t_wc: 'درست الفاظ',
    t_wa: 'پڑھنے کی کوشش',
    help_filled: 'ریکارڈنگ سے گنتی۔ آپ کی گنتی مختلف ہو تو بدلیں',
    help_empty: 'ریکارڈنگ میں واضح نہیں۔ اپنی گنتی لکھیں',
    help_of10: '10 میں سے',
    t_flag: 'غلط پڑھے گئے الفاظ',
    flag_cap: 'جو لفظ بچے نے درست پڑھا ہو اس سے نشان ہٹائیں۔',
    sw_label: (word) => `«${word}»`,
    t_fb: 'حروف اور الفاظ (کہانی مشکل تھی)',
    t_fl: 'درست حروف',
    t_fw: 'درست الفاظ',
    t_q: 'کہانی کے سوال',
    q_label: 'سوال',
    heard: (text) => `سنا گیا: «${text}»`,
    heard_nothing: 'سنا گیا: کوئی جواب نہیں',
    t_fs: 'پہلی آواز',
    hint: (text) => `ریکارڈنگ میں سنا گیا: «${text}» (اندازہ)`,
    no_hint: 'کوئی اندازہ نہیں',
    t_nw: 'بے معنی الفاظ',
    t_nwc: 'غلط پڑھے',
    nwc_cap: 'جو بچے نے درست پڑھا ہو اس سے نشان ہٹائیں۔ یہ ریکارڈنگ میں واضح تھے۔',
    unsure: 'ریکارڈنگ میں واضح نہیں۔ جو سنا وہ چنیں',
    t_num: 'اونچی آواز میں نمبر',
    t_numc: 'غلط پڑھے',
    numc_cap: 'جو نمبر بچے نے درست پڑھا ہو اس سے نشان ہٹائیں۔',
    t_qs: 'فوری سوال، 60 سیکنڈ',
    t_qc: 'درست سوال',
    t_qa: 'کوشش کیے گئے سوال',
    t_wr: 'لکھے ہوئے سوال (تصویر سے)',
    read_as: (text) => `تصویر سے پڑھا گیا: «${text}»`,
    read_nothing: 'تصویر سے کوئی جواب نہیں پڑھا جا سکا',
    t_wp: 'عبارتی سوال',
    wp_label: 'عبارتی سوال',
    next_urdu: 'اردو محفوظ کریں، اگلا: انگریزی',
    next_english: 'انگریزی محفوظ کریں، اگلا: حساب',
    next_maths: 'محفوظ کریں اور ختم کریں',
    done_button: 'ٹھیک ہے',
    done_saved: 'محفوظ ہو گیا',
    done_next: (who) => `${who} کے نمبر محفوظ ہو گئے۔`,
    not_available_title: 'دستیاب نہیں',
    not_saved_title: 'محفوظ نہیں ہوا',
    not_saved_next: 'محفوظ کرتے ہوئے مسئلہ آیا۔ اسے بند کریں اور چیٹ سے جانچ دوبارہ کھولیں؛ پہلے محفوظ کیا ہوا برقرار ہے۔',

    err_number: 'پورا عدد لکھیں',
    err_more_than_tried: 'کوشش سے زیادہ ہے',
    err_out_of: (n) => `زیادہ سے زیادہ ${n}`,
    err_pick: 'ایک چنیں',

    child_line: (who, grade) => `${who} · جماعت ${grade}`,
    roll: (n) => `رول نمبر ${n}`,
    check_header: (who) => `جانچ: ${who}`,
    check_body: ({ who, urdu, english, maths }) => `${who} کے لیے ریکارڈنگ سے نمبر: اردو ${urdu}، انگریزی ${english}، حساب ${maths}۔ جانچ کھولیں، جو مختلف سنا ہو بدلیں، اور محفوظ کریں۔ تقریباً ایک منٹ۔`,
    words_line: (n) => `${n} الفاظ`,
    letters_line: (n) => `${n}/10 حروف`,
    sums_line: (n) => `${n} فوری سوال`,
    not_marked: '—',
    check_cta: 'جانچ کریں',
    completion_saved: (who) => `✓ ${who} کے نمبر محفوظ ہو گئے۔`,
    completion_not_saved: (who) => `${who} کی جانچ محفوظ نہیں ہوئی۔ اوپر جانچ کا بٹن دبا کر دوبارہ کھولیں؛ پہلے محفوظ کیا ہوا برقرار ہے۔`,
  },
};

/** @param {string} lang the coach's preferred_language; clamped to this deployment's offer (en, ur). */
function checkStrings(lang) {
  return STRINGS[clampLanguage(lang)] || STRINGS.en;
}

module.exports = { checkStrings, STRINGS };
