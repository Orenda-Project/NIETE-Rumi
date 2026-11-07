'use strict';
// Part of fde-g5-2027.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

const COMMON_EN = {
  school_line: 'School: ____________',
  student_box: ['Student Name', 'Roll No', 'Date', 'Total Marks', 'Obtained Marks'],
  footer_page: 'Page {n} of {N}',
  scheme_title: 'MARKING SCHEME',
  band: 'TEACHER\'S COPY · Do not give to children',
  covers: 'Covers: {scope}.',
  covers_partial: 'Covers {units}; every section set from these units.',
  record_title: 'Class record',
  record_cols: ['Roll', 'Name'],
  record_total: 'Total',
  record_grade: 'Grade',
  checked: '✓ checked',
  notes_title: 'Notes',
  note_replaced: '{n}: key corrected by code; the model wrote {value}.',
  accept: 'accept:',
  common_error: 'common error:',
  answer_sheet: 'answer sheet',
  or: 'OR',
};

// Every value below needs fluent-Urdu review (drafts, none transcribed).
const COMMON_UR = {
  school_line: 'اسکول: ____________', // needs fluent-Urdu review
  student_box: ['نام طالب علم', 'رول نمبر', 'تاریخ', 'کل نمبر', 'حاصل کردہ نمبر'], // needs fluent-Urdu review
  footer_page: 'صفحہ {n} از {N}', // needs fluent-Urdu review
  scheme_title: 'مارکنگ اسکیم', // needs fluent-Urdu review
  band: 'استاد کی کاپی · بچوں کو نہ دیں', // needs fluent-Urdu review
  covers: 'احاطہ: {scope}۔', // needs fluent-Urdu review
  covers_partial: 'احاطہ: {units}؛ ہر حصہ انہی ابواب سے۔', // needs fluent-Urdu review
  record_title: 'کلاس ریکارڈ', // needs fluent-Urdu review
  record_cols: ['رول نمبر', 'نام'], // needs fluent-Urdu review
  record_total: 'کل', // needs fluent-Urdu review
  record_grade: 'گریڈ', // needs fluent-Urdu review
  checked: '✓ جانچا گیا', // needs fluent-Urdu review
  notes_title: 'نوٹ', // needs fluent-Urdu review
  note_replaced: '{n}: کلید کوڈ نے درست کی؛ ماڈل نے {value} لکھا۔', // needs fluent-Urdu review
  accept: 'یہ بھی درست:', // needs fluent-Urdu review
  common_error: 'عام غلطی:', // needs fluent-Urdu review
  answer_sheet: 'جوابی کاپی', // needs fluent-Urdu review
  or: 'یا', // transcribed (FDE p.57)
};

const LEGEND = {
  title_en: 'How to mark',
  title_ur: 'جانچنے کا طریقہ', // needs fluent-Urdu review
  lines_en: [
    'MCQs: 1 mark for the letter. Two circles or an overwritten answer = 0.',
    'M = method · A = answer · U = unit · K = key point · L = label.',
    'A correct answer with no working still earns the answer mark(s); the working mark is only for steps shown.',
    'A method step with an arithmetic slip keeps half its M marks (round down) if the method is right; later steps that use the slipped number correctly earn full marks, including the final A.',
    '"Attempt any N": tell children to answer exactly N. If more are answered, mark all and keep the best N.',
    'Grades (FDE p.113): A+ 90–100 · A 80–89 · B 70–79 · C 60–69 · D 50–59 · E 40–49 · F below 40. Pass = 40%.',
  ],
  // needs fluent-Urdu review (all six)
  lines_ur: [
    'معروضی: درست حرف پر 1 نمبر۔ دو دائرے یا اوور رائٹنگ = 0۔',
    'M = طریقہ، A = جواب، U = اکائی، K = اہم نکتہ، L = نام',
    'بغیر طریقے کے درست جواب پر صرف A نمبر۔',
    'طریقہ درست ہو اور حساب میں چوک ہو تو اس مرحلے کے آدھے M نمبر (کم کی طرف)؛ بعد کے مراحل میں اسی غلط عدد پر درست کام ہو تو پورے نمبر، آخری A سمیت۔',
    '«کوئی سے N»: بچوں کو بالکل N سوال حل کرنے کو کہیں۔ زیادہ حل ہوں تو سب جانچ کر بہترین N رکھیں۔',
    'A+ 90–100 · A 80–89 · B 70–79 · C 60–69 · D 50–59 · E 40–49 · F <40',
  ],
  // The grade bands print as one left-to-right line inside an Urdu page.
  bands_line: 5,
  bands_lead_ur: 'گریڈ (FDE ص 113)؛ پاس = 40٪', // needs fluent-Urdu review
  // The chip key, and the two lines that only mean something on a Maths scheme.
  key_line: 1,
  maths_lines: [2, 3],
  key_names_en: { M: 'method', A: 'answer', U: 'unit', K: 'key point', L: 'label' },
  key_names_ur: { M: 'طریقہ', A: 'جواب', U: 'اکائی', K: 'اہم نکتہ', L: 'نام' }, // needs fluent-Urdu review
};

/**
 * The legend one subject prints. Maths keeps every line. Every other subject
 * drops the two Maths marking lines (no working, arithmetic slip), and its
 * chip key is rebuilt by the renderer from the chips its scheme prints
 * (`key_from_chips`). `bands_line` and `key_line` point into the kept lines.
 */
function legendFor(key) {
  if (key === 'maths') return { ...LEGEND, subject: key };
  const kept = LEGEND.lines_en.map((_, i) => i).filter((i) => !LEGEND.maths_lines.includes(i));
  return {
    ...LEGEND,
    subject: key,
    key_from_chips: true,
    lines_en: kept.map((i) => LEGEND.lines_en[i]),
    lines_ur: kept.map((i) => LEGEND.lines_ur[i]),
    bands_line: kept.indexOf(LEGEND.bands_line),
    key_line: kept.indexOf(LEGEND.key_line),
    maths_lines: [],
  };
}

const BEFORE_EXAM = {
  title_en: 'Teacher: before the exam',
  title_ur: 'استاد کے لیے: امتحان سے پہلے', // needs fluent-Urdu review
  lines_en: [
    'This is the marking scheme for {file} ({n} pages). Do not give it to children.',
    'Photocopy the question paper, all {n} pages, one per child.',
    'You add: {duty} on the question paper, page {p} (book p. {b}).',
    'Tell the class: {sections}; {attempts}.',
    'Time: {t}.',
    'Mark question by question across all copies, not copy by copy.',
  ],
  // needs fluent-Urdu review (all six)
  lines_ur: [
    'یہ {file} ({n} صفحات) کی مارکنگ اسکیم ہے۔ بچوں کو نہ دیں۔',
    'سوالیہ پرچے کے تمام {n} صفحات کی فوٹو کاپی کریں، ہر بچے کے لیے ایک۔',
    'شامل کریں: {duty}، سوالیہ پرچہ صفحہ {p} (کتاب ص {b})۔',
    'کلاس کو بتائیں: {sections}؛ {attempts}۔',
    'وقت: {t}۔',
    'ہر سوال کو تمام کاپیوں میں ایک ساتھ جانچیں، ایک کاپی مکمل کر کے دوسری نہیں۔',
  ],
  nothing_en: 'You add: nothing.',
  nothing_ur: 'شامل کرنے کو کچھ نہیں۔', // needs fluent-Urdu review
  unknown_pages_en: 'see the question paper',
  unknown_pages_ur: 'سوالیہ پرچہ دیکھیں', // needs fluent-Urdu review
  // "Tell the class" pieces: where each section is answered, one per answer_on.
  on_paper_en: '{sections} on the question paper',
  on_paper_ur: '{sections} سوالیہ پرچے پر', // needs fluent-Urdu review
  on_sheet_en: '{sections} on the answer sheet',
  on_sheet_ur: '{sections} جوابی کاپی پر', // needs fluent-Urdu review
  attempt_en: '{label}: attempt any {n} of {g}',
  attempt_ur: '{label}: {g} میں سے کوئی سے {n}', // needs fluent-Urdu review
  either_en: '{label}: answer one of the two',
  either_ur: '{label}: دو میں سے ایک', // needs fluent-Urdu review
};

const SUPPLIES = {
  title_en: 'Teacher supplies',
  title_ur: 'استاد مہیا کریں', // needs fluent-Urdu review
  frame_en: '{slot}: {frame} (book p. {b})',
  frame_ur: '{slot}: {frame} (کتاب ص {b})', // needs fluent-Urdu review
  words_en: ' — word bank: {words}',
  words_ur: ' — مددگار الفاظ: {words}', // needs fluent-Urdu review
  naat_ur: '{slot}: نعت، سبق 2، ص {b} — تقسیم 3، 1، 1 (مواد 3، نظم سے ربط 1، زبان 1)', // needs fluent-Urdu review
  naat_en: '{slot}: Naat, lesson 2, p. {b} — split 3, 1, 1 (content 3, link to the poem 1, language 1)',
};

// What the app says the teacher adds, by frame kind.
const YOU_ADD = {
  map: { en: 'the map of Pakistan', ur: 'پاکستان کا نقشہ' }, // needs fluent-Urdu review
  diagram: { en: 'the diagram to label', ur: 'نشان دہی والا خاکہ' }, // needs fluent-Urdu review
  picture: { en: 'the picture', ur: 'تصویر' }, // needs fluent-Urdu review
};

const FILES = { en: 'Paper + marking scheme · two PDFs', ur: 'پرچہ + مارکنگ اسکیم · دو PDF' }; // ur: needs fluent-Urdu review
const NAME = { en: 'FDE board pattern', ur: 'FDE بورڈ pattern' }; // operator rule 15 Oct: «pattern» in Latin, never طرز; rest needs fluent-Urdu review
const WAIT = { en: '~3 min', ur: 'تقریباً 3 منٹ' }; // ur: needs fluent-Urdu review
const TIME3 = { en: '3 hrs', ur: '3 گھنٹے' }; // ur: needs fluent-Urdu review

const NO_ITEMS_ON_BOOK_ACTIVITIES = 'Never set an item on a "Create and Connect" or "Discovery Playground" activity unless this slot says so.';

module.exports = {
  BEFORE_EXAM, COMMON_EN, COMMON_UR, FILES, NAME, NO_ITEMS_ON_BOOK_ACTIVITIES, SUPPLIES, TIME3, WAIT,
  YOU_ADD, legendFor,
};
