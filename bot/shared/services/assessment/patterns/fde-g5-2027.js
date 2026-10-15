'use strict';
/**
 * The FDE Grade V Centralised Annual Examination pattern (Feb 2027), as data.
 *
 * One object per subject the generator can set in this pattern. Everything a
 * board-pattern paper is decided by lives here: sections, their time and marks,
 * each question slot (how many items are printed, how many the child answers,
 * marks each), FDE's own printed lines, the scope, and the marking-scheme
 * chrome. The layout pass, the scheme check and the renderer read it; nothing
 * writes it (the whole tree is frozen on load).
 *
 * Printed lines are FDE's words. A count inside a line is an atom `{k:v}`:
 * `v` is the value FDE printed and `k` says what it counts — w the attempt as a
 * word, n the attempt as a number, t attempt × marks (a slot or section total).
 * Strip the braces and you have FDE's line; the renderer recomputes the value
 * when a teacher removes a question, so no printed count is ever typed.
 * Whitespace and the multiplication sign are normalised (FDE prints "x" and
 * "×" on the same page); every other character is as printed.
 *
 * Urdu: lines copied from FDE's pages are marked "transcribed"; every other
 * Urdu line here is a draft and needs fluent-Urdu review before teachers see it.
 * Religious text is never authored: the Naat alternative prints FDE's
 * instruction only and has no key.
 *
 * Data only. No requires.
 */

const COMMON_EN = {
  school_line: 'School: ____________',
  disclaimer: 'Practice paper in the FDE Grade V Centralised Annual Examination pattern (Feb 2027). Not an official FDE paper.',
  student_box: ['Student Name', 'Roll No', 'Date', 'Total Marks', 'Obtained Marks'],
  footer: 'Not an official FDE paper',
  footer_page: 'Page {n} of {N}',
  scheme_title: 'MARKING SCHEME',
  band: 'TEACHER\'S COPY · Do not give to children',
  covers: 'Covers: {scope}. Not an official FDE paper.',
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
  disclaimer: 'یہ مشق کا پرچہ ہے جو FDE کے جماعت پنجم کے مرکزی سالانہ امتحان (فروری 2027) کے طرز پر بنایا گیا ہے۔ یہ سرکاری پرچہ نہیں ہے۔', // needs fluent-Urdu review
  student_box: ['نام طالب علم', 'رول نمبر', 'تاریخ', 'کل نمبر', 'حاصل کردہ نمبر'], // needs fluent-Urdu review
  footer: 'یہ سرکاری FDE پرچہ نہیں ہے', // needs fluent-Urdu review
  footer_page: 'صفحہ {n} از {N}', // needs fluent-Urdu review
  scheme_title: 'مارکنگ اسکیم', // needs fluent-Urdu review
  band: 'استاد کی کاپی · بچوں کو نہ دیں', // needs fluent-Urdu review
  covers: 'احاطہ: {scope}۔ یہ سرکاری FDE پرچہ نہیں ہے۔', // needs fluent-Urdu review
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
    'A correct answer with no working earns the A mark(s) only (Q1(b): both marks).',
    'A method step with an arithmetic slip keeps half its M marks (round down) if the method is right; later steps that use the slipped number correctly earn full marks, including the final A.',
    '"Attempt any N": tell children to answer exactly N. If more are answered, mark all and keep the best N.',
    'Grades (FDE p.115): A+ 90–100 · A 80–89 · B 70–79 · C 60–69 · D 50–59 · E 40–49 · F below 40. Pass = 40%.',
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
  bands_lead_ur: 'گریڈ (FDE ص 115)؛ پاس = 40٪', // needs fluent-Urdu review
};

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
const NAME = { en: 'FDE board pattern', ur: 'FDE بورڈ طرز' }; // ur: needs fluent-Urdu review
const WAIT = { en: '~3 min', ur: 'تقریباً 3 منٹ' }; // ur: needs fluent-Urdu review
const TIME3 = { en: '3 hrs', ur: '3 گھنٹے' }; // ur: needs fluent-Urdu review

const NO_ITEMS_ON_BOOK_ACTIVITIES = 'Never set an item on a "Create and Connect" or "Discovery Playground" activity unless this slot says so.';

// ───────────────────────────── Mathematics ─────────────────────────────

const MATHS = {
  key: 'maths',
  medium: 'en',
  name_en: 'Mathematics',
  name_ur: 'ریاضی', // needs fluent-Urdu review
  total_marks: 100,
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · Mathematics · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · ریاضی · FDE طرز کا مشقی پرچہ', // needs fluent-Urdu review
    time_line_en: 'Time Allowed: 3 Hrs.',
    total_line_en: 'Total Marks: {t:100}',
    note_en: 'Note: This paper consists of THREE Sections. Section – A needs to be solved on the Question Paper. Section B, C to be solved on the Answer Sheet. Cutting, erasing and overwriting is not allowed.',
  },
  scope: {
    page_ranges: '1-12, 14-40, 42-66, 68-90, 92-116, 118-144, 155-168, 171-180, 218-226, 239-244, 254-257, 267-271',
    chapter_numbers: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12],
    display_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    excluded: [9, 10],
    topics_only: [6, 11, 12],
    held: [],
    unit_ranges: [
      { chapter: 1, ranges: '1-12' }, { chapter: 2, ranges: '14-40' }, { chapter: 3, ranges: '42-66' },
      { chapter: 4, ranges: '68-90' }, { chapter: 5, ranges: '92-116' }, { chapter: 6, ranges: '118-144' },
      { chapter: 7, ranges: '155-168' }, { chapter: 8, ranges: '171-180' },
      { chapter: 11, ranges: '218-226, 239-244' }, { chapter: 12, ranges: '254-257, 267-271' },
    ],
    label_en: 'FDE syllabus 2026–27',
    label_ur: 'FDE نصاب 2026–27', // needs fluent-Urdu review
    line_en: 'Units 1–8, 11, 12 · FDE topics only',
    line_ur: 'ابواب 1–8، 11، 12 · صرف FDE کے موضوعات', // needs fluent-Urdu review
    excluded_pages_note: 'Create and Connect pages and Unit 6 Topic 6 are left out; Unit 11 Topics 1 and 4 and Unit 12 bar graphs and averages only.',
  },
  sections: [
    {
      id: 'A',
      time_en: 'Time Allowed: 1 Hr.',
      label_en: 'SECTION - A',
      marks_en: 'Total Marks: {t:40}',
      marks: 40,
      answer_on: 'question_paper',
      note_en: null,
      slots: [
        {
          slot: 'maths.A.Q1a', label_en: 'Q1. (a)', label_ur: 'سوال 1 (الف)', // needs fluent-Urdu review
          instruction_en: 'Choose the correct option.',
          marks_line_en: '({t:20})',
          type: 'MCQs', category: 'objective', shape: 'mcq',
          generate: 20, attempt: 20, marks_each: 1, parts: null,
          numbering: 'roman', option_labels: 'a', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'one concept per item: place value, rounding, factors, fraction and decimal comparison, percent to fraction, unitary cost, area, averages', number_size: 'whole numbers up to 7 digits; decimals to 3 places; fractions with denominators up to 10', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Twenty four-option MCQs across all included units, one concept each; 3 to 5 of them pure recall (a fact or a name). Options are short (a number or a few words). ' + NO_ITEMS_ON_BOOK_ACTIVITIES,
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'maths.A.Q1b', label_en: 'Q1. (b)', label_ur: 'سوال 1 (ب)', // needs fluent-Urdu review
          instruction_en: 'Solve the following.',
          marks_line_en: 'Marks: (2×{n:10}={t:20})',
          type: 'Short Questions', category: 'subjective', shape: 'short',
          generate: 10, attempt: 10, marks_each: 2, parts: null,
          numbering: 'roman', compulsory: true, lines: 2, work_mm: 30,
          section_pages: 'scope',
          grain: { kind: 'one-step skill check, one topic each: expanded form, 5-digit × 1-digit, compare two fractions, HCF of two small numbers, fraction × fraction, fraction to decimal, decimal addition, percent to decimal, average of five numbers, draw an angle', number_size: 'up to 6 digits; 3-place decimals; denominators 2 to 5', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Ten one-step items, one per topic, in this order of kinds where the pages allow: expanded form; multiplication 5-digit × 1-digit; compare two fractions; HCF of two numbers; fraction × fraction; fraction to decimal; decimal addition; percent to decimal; average of five numbers; "Draw an angle of N° with a protractor." (construction only, never "and name it"). 2 marks each: M1 + A1. ' + NO_ITEMS_ON_BOOK_ACTIVITIES,
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'B',
      time_en: 'Time: 2 Hrs.',
      label_en: 'Section-B',
      marks_en: '({t:40} marks)',
      marks: 40,
      answer_on: 'answer_sheet',
      note_en: null,
      slots: [
        {
          slot: 'maths.B.Q2', label_en: 'Q2.', label_ur: 'سوال 2', // needs fluent-Urdu review
          instruction_en: 'Attempt any {w:eight} questions. All questions carry equal marks.',
          marks_line_en: '({n:8}×5={t:40})',
          type: 'Word Problems', category: 'subjective', shape: 'word_problem',
          generate: 12, attempt: 8, marks_each: 5, parts: null,
          numbering: 'roman', compulsory: false, lines: 0, work_mm: null,
          section_pages: 'units:1-8',
          grain: { kind: '5-mark worked problem: number in words, a budget subtraction, long division by a 2-digit number, long multiplication, LCM by the division method, mixed-number subtraction, a fraction word problem, a decimal word problem, decimal division, a percentage word problem, two unitary-method problems', number_size: 'up to 7 digits; 5-digit ÷ 2-digit; 5-digit × 2-digit; decimals to 2 places', steps: 2, unit_choice: false },
          families: [
            { units: '1-2', kinds: ['number_sense', 'computation', 'word_problem'] },
            { units: '3-4', kinds: ['number_sense', 'computation', 'word_problem'] },
            { units: '5-6', kinds: ['number_sense', 'computation', 'word_problem'] },
            { units: '7-8', kinds: ['number_sense', 'computation', 'word_problem'] },
          ],
          kinds: null,
          prompt_rule: 'Twelve 5-mark items from Units 1–8 as four families of three: for Units 1–2, 3–4, 5–6 and 7–8 one number-sense item, one computation and one word problem each. Include long division, long multiplication, LCM by the division method, a mixed-number subtraction and two unitary-method problems (many from one, one from many). Every word problem names its unit (Rs., km, litres) in the question.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'C',
      time_en: null,
      label_en: 'Section-C',
      marks_en: '({t:20} marks)',
      marks: 20,
      answer_on: 'answer_sheet',
      note_en: 'Note: Q3 is compulsory. Attempt any {w:three} from the remaining questions. All questions carry 5 marks each. ({n:4} × 5 = {t:20})',
      note_slot: 'maths.C.Q4-8',
      slots: [
        {
          slot: 'maths.C.Q3', label_en: 'Q3.', label_ur: 'سوال 3', // needs fluent-Urdu review
          instruction_en: null,
          marks_line_en: null,
          type: 'Graphs & Geometric Problems', category: 'subjective', shape: 'draw',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'continue:3', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'units:12',
          grain: { kind: 'draw a bar graph from a 5-row table', number_size: '2-digit values, multiples of 5', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: a sentence naming the data, then "Draw a bar graph to represent the given data." Put the data in `table` as {"headers": [label, quantity with unit], "rows": five [label, value]}. Never describe or refer to a printed graph.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'maths.C.Q4-8', label_en: 'Q4–Q8', label_ur: 'سوال 4 تا 8', // needs fluent-Urdu review
          instruction_en: null,
          marks_line_en: null,
          type: 'Graphs & Geometric Problems', category: 'subjective', shape: 'word_problem',
          generate: 5, attempt: 3, marks_each: 5, parts: null,
          numbering: 'continue:4', compulsory: false, lines: 0, work_mm: null,
          section_pages: 'units:11-12',
          grain: { kind: 'one each: draw and identify angles, area, perimeter, average, missing angle', number_size: 'single or 2-digit lengths and values', steps: 2, unit_choice: true },
          families: null,
          kinds: ['draw', 'area', 'perimeter', 'average', 'missing_angle'],
          prompt_rule: 'Five items in this order, one of each kind: draw and identify any two of three named angles (obtuse, supplementary, straight); the area of a parallelogram or a triangle; the perimeter of a rectangle or a square; the average of five values; a missing angle stated in WORDS ("Two angles are supplementary. One of them is 115°. Find the other angle and name the pair."). Never send the child to a figure that is not printed.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
  ],
};

// ────────────────────────────── Science ──────────────────────────────

const SCIENCE = {
  key: 'science',
  medium: 'en',
  name_en: 'Science',
  name_ur: 'سائنس', // needs fluent-Urdu review
  total_marks: 100,
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · Science · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · سائنس · FDE طرز کا مشقی پرچہ', // needs fluent-Urdu review
    time_line_en: 'Time Allowed: 3 Hours',
    total_line_en: 'Total Marks: {t:100}',
    note_en: 'Note: This paper consists of THREE Sections. Section – A needs to be solved on the Question Paper. Section B&C to be solved on the Answer Sheet. Cutting, erasing and overwriting is not allowed.',
  },
  scope: {
    page_ranges: '1-26, 28-136, 138-161, 168-169, 179-180',
    chapter_numbers: [1, 2, 3, 4, 5, 6, 7],
    display_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    excluded: [8, 9],
    topics_only: [7],
    held: [],
    unit_ranges: [],
    label_en: 'FDE syllabus 2026–27',
    label_ur: 'FDE نصاب 2026–27', // needs fluent-Urdu review
    line_en: 'Chapters 1–6 · Ch 7 diagrams',
    line_ur: 'ابواب 1–6 · باب 7 کے خاکے', // needs fluent-Urdu review
    excluded_pages_note: 'Project pages 27 and 137 left out; Chapter 7 only the layers of the Earth (pp 168–169) and of soil (pp 179–180), for diagrams.',
  },
  sections: [
    {
      id: 'A',
      time_en: 'Time Allowed: 30 minutes',
      label_en: 'Section A',
      marks_en: 'Total Marks: {t:25}',
      marks: 25,
      answer_on: 'question_paper',
      note_en: null,
      slots: [
        {
          slot: 'science.A.Q1a', label_en: 'Q1 (a):', label_ur: 'سوال 1 (الف)', // needs fluent-Urdu review
          instruction_en: 'Encircle the correct answer.',
          marks_line_en: '(1×{n:20}={t:20})',
          type: 'MCQs', category: 'objective', shape: 'mcq',
          generate: 20, attempt: 20, marks_each: 1, parts: null,
          numbering: 'roman', option_labels: 'a', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'one concept per item across chapters 1–6: body systems, diseases, food chains, pollution, physical and chemical change, light, sound, magnets, circuits', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Twenty four-option MCQs from chapters 1–6 only (Skill Sharpener and Mastery Challenge included); 3 to 5 of them pure recall. Never set an item on chapter 7 here. Detailed respiratory (alveoli) or circulatory (chambers, valves) knowledge is not required.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'science.A.Q1b', label_en: 'Q1 (b):', label_ur: 'سوال 1 (ب)', // needs fluent-Urdu review
          instruction_en: 'Label the given Diagram',
          marks_line_en: '({t:5} Marks)',
          type: 'Label the Diagram', category: 'subjective', shape: 'frame',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'label an unlabelled book diagram with 5 parts (chapters 1–7)', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` is the NAME of a diagram printed in the book (e.g. "Layers of the Earth"), `book_page` the book page it is on, `answer` the five labels in order. The paper prints an empty frame with five label lines; the teacher draws or pastes the diagram. Never describe the picture and never send the child to a picture.',
          frame: { kind: 'diagram', title_en: 'Diagram: {q}', title_ur: 'خاکہ: {q}', height_mm: 70, lines: 5, book_page: 168, word_bank: false }, // ur: needs fluent-Urdu review
          teacher_note_en: 'Draw this diagram on the board or paste the book\'s figure into the frame before photocopying.',
          teacher_note_ur: 'فوٹو کاپی سے پہلے یہ خاکہ بورڈ پر بنائیں یا کتاب سے چسپاں کریں۔', // needs fluent-Urdu review
          alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'B',
      time_en: 'Time Allowed: 2 hrs. 30 min',
      label_en: 'Section B',
      marks_en: 'Total Marks: {t:17}',
      marks: 17,
      answer_on: 'answer_sheet',
      note_en: 'NOTE: Section B consists of 2 parts (a) and (b)',
      slots: [
        {
          slot: 'science.B.Q2a', label_en: 'Q2 (a)', label_ur: 'سوال 2 (الف)', // needs fluent-Urdu review
          instruction_en: 'Draw and label any {w:one} of the following:',
          marks_line_en: '({t:7} Marks)',
          type: 'Draw and Label', category: 'subjective', shape: 'draw',
          generate: 2, attempt: 1, marks_each: 7, parts: null,
          numbering: 'paren_roman', compulsory: false, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'name a body or ecology diagram the child can draw and label from the book', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Two items, each just the name of a diagram the child draws and labels from chapters 1–7 (e.g. "Respiratory System", "Food Chain"). The scheme lists the labels expected (L points). Not the detailed alveoli or heart chambers.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
        {
          slot: 'science.B.Q2b', label_en: 'Q2 (b)', label_ur: 'سوال 2 (ب)', // needs fluent-Urdu review
          instruction_en: 'Read and attempt any {w:TWO} of the following given situations carefully.',
          marks_line_en: '({n:2} × 5 = {t:10})',
          type: 'Logical Reasoning', category: 'subjective', shape: 'situation',
          generate: 3, attempt: 2, marks_each: 5, parts: null,
          item_parts: { per_item: 3, attempt: 2, marks_each: 2.5, line_en: 'Answer any two of the given questions.', marks_line_en: '(2 × 2.5 = 5)' },
          numbering: 'paren_roman', compulsory: false, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'an activity situation in words, then three sub-questions (a, b, c), answer any two', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Three situations, each from a different one of these book activities only: textures and sounds; spreading diseases; microorganisms at work; how pollution affects our world; solubility and state changes; rusting; physical vs chemical change; shadow and transparency; magnets. Each item: `question` = the situation in words (what the child does and sees), `questions` = three sub-questions a, b, c. Never refer to a picture.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'C',
      time_en: null,
      label_en: 'Section C',
      marks_en: 'Total Marks: {t:58}',
      marks: 58,
      answer_on: 'answer_sheet',
      note_en: 'Note: Section C consists of two parts: Q3 (a) and Q3 (b)',
      slots: [
        {
          slot: 'science.C.Q3a', label_en: 'Q3 (a).', label_ur: 'سوال 3 (الف)', // needs fluent-Urdu review
          instruction_en: 'Answer any {w:eight} of the following questions briefly.',
          marks_line_en: '({n:8}×5={t:40})',
          type: 'Brief Answers', category: 'subjective', shape: 'short',
          generate: 10, attempt: 8, marks_each: 5, parts: null,
          numbering: 'arabic', compulsory: false, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'short constructed response, 1 to 3 sentences, recall or explain', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Ten short-answer questions from chapters 1–6, one or two per chapter. Key points (K) that add to 5 marks each.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'science.C.Q3b', label_en: 'Q3 (b).', label_ur: 'سوال 3 (ب)', // needs fluent-Urdu review
          instruction_en: 'Answer any {w:two} of the following questions comprehensively.',
          marks_line_en: '({n:2} × 9 = {t:18})',
          type: 'Long Question', category: 'subjective', shape: 'short',
          generate: 5, attempt: 2, marks_each: 9, parts: null,
          numbering: 'arabic', compulsory: false, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'extended response: explain a process or relationship in a paragraph', number_size: 'none', steps: 3, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Five explain/discuss questions from chapters 1–6 needing a 6–10 sentence answer; the scheme lists the key points (K) a full answer contains, adding to 9.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
  ],
};

// ────────────────────────────── English ──────────────────────────────

const ENGLISH = {
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی', // needs fluent-Urdu review
  total_marks: 100,
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · English · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · انگریزی · FDE طرز کا مشقی پرچہ', // needs fluent-Urdu review
    time_line_en: 'Time Allowed: 3 Hours',
    total_line_en: 'Total Marks: {t:100}',
    note_en: 'Note: This paper consists of THREE Sections. Section – A needs to be solved on the Question Paper. Sections B & C are to be solved on the Answer Sheet. Cutting, erasing and overwriting is not allowed.',
  },
  closed_lists: {
    paragraphs: ['My Aim in Life', 'My Super Hero', 'My Responsibility as a Student', 'A Visit to the Zoo', 'A Cultural Festival', 'My Country', 'Recycling'],
    informal_letters: ['Birthday party invitation', 'To your sister congratulating her on passing the examination', 'Thanking a friend for a gift', 'Inviting your friend to spend summer holidays with you', 'To your friend telling them about your favourite book'],
    applications: ['Sick leave', 'School leaving certificate', 'Leave to attend your brother\'s marriage ceremony', 'Remission of fine', 'Urgent piece of work', 'To your principal to upgrade your school library'],
  },
  scope: {
    page_ranges: '1-138',
    chapter_numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    display_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    excluded: [11, 12, 13, 14],
    topics_only: [],
    held: [],
    unit_ranges: [],
    label_en: 'FDE syllabus 2026–27',
    label_ur: 'FDE نصاب 2026–27', // needs fluent-Urdu review
    line_en: 'Units 1–10',
    line_ur: 'یونٹ 1–10', // needs fluent-Urdu review
    excluded_pages_note: 'Units 11–14 are not in the FDE exam.',
  },
  sections: [
    {
      id: 'A',
      time_en: 'Time allowed: 30 Minutes',
      label_en: 'SECTION A: OBJECTIVE',
      marks_en: 'Total Marks: {t:25}',
      marks: 25,
      answer_on: 'question_paper',
      note_en: null,
      slots: [
        {
          slot: 'english.A.Q1a', label_en: 'Q1 (a):', label_ur: 'سوال 1 (الف)', // needs fluent-Urdu review
          instruction_en: 'Read each question carefully and choose the correct option. Each question carries 1 mark.',
          marks_line_en: '({t:20})',
          type: 'MCQs', category: 'objective', shape: 'mcq',
          generate: 20, attempt: 20, marks_each: 1, parts: null,
          numbering: 'arabic', option_labels: 'A', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'one grammar or vocabulary point per item', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Twenty four-option MCQs, one point each, covering: collective and proper nouns, articles, irregular plurals, antonyms, pronouns, syllables, adverbs, suffixes, tenses, homophones, compound words, degrees of adjectives, modals, apostrophe, spelling, anagrams, sentence types, quantifiers, adjectives. Never refer to an underline the paper cannot show; quote the word instead.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.A.Q1b', label_en: 'Q1 (b).', label_ur: 'سوال 1 (ب)', // needs fluent-Urdu review
          instruction_en: 'Do as directed.',
          marks_line_en: '({t:5})',
          type: 'Rewrite Sentences', category: 'objective', shape: 'short',
          generate: 5, attempt: 5, marks_each: 1, parts: null,
          numbering: 'roman_dot', compulsory: true, lines: 2, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'one-line transformation: rewrite as a simile, identify subject + verb + object, change the tense, simile or metaphor', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Five one-line items, each ending with the direction in round brackets, e.g. "The baby is sleeping. (Change into simple past)". Cover similes/metaphors, S+V+O and simple present/past.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'B',
      time_en: 'Time allowed: 30 min',
      label_en: 'SECTION B: COMPREHENSION',
      marks_en: 'Total Marks: {t:20}',
      marks: 20,
      answer_on: 'answer_sheet',
      note_en: null,
      slots: [
        {
          slot: 'english.B.Q2', label_en: 'Q.2:', label_ur: 'سوال 2', // needs fluent-Urdu review
          instruction_en: 'Read the following passage and answer the questions given at the end.',
          marks_line_en: null,
          type: 'Comprehension Passage', category: 'subjective', shape: 'comprehension',
          generate: 1, attempt: 1, marks_each: 20, parts: [10, 4, 6],
          parts_spec: [
            { key: 'questions', label: 'i.', instruction_en: 'Answer the following questions.', marks_line_en: '(2 × 5 = 10)', n: 5, marks_each: 2, numbering: 'alpha_paren' },
            { key: 'do_as_directed', label: 'ii.', instruction_en: 'Do as directed.', marks_line_en: '(4)', n: 4, marks_each: 1, numbering: 'alpha_paren' },
            { key: 'pick', label: 'iii.', instruction_en: 'Choose three nouns and three verbs from the given passage.', marks_line_en: '(6)', n: 6, marks_each: 1, pick: { Nouns: 3, Verbs: 3 } },
          ],
          numbering: 'none', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'an unseen narrative passage of about 120 words; five literal or inference questions; four do-as-directed items tied to the passage; three nouns and three verbs', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `passage` = an unseen story of 120–160 words; `parts` = [{key:"questions", questions:[5]}, {key:"do_as_directed", questions:[4: a part of speech of a quoted word, a tense change, a fill-in from the passage, a true/false]}, {key:"pick", pick:{"Nouns":[≥3 nouns that appear in the passage], "Verbs":[≥3 verbs that appear in the passage]}}].',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'C',
      time_en: 'Time allowed: 2 Hrs.',
      label_en: 'SECTION C: SUBJECTIVE',
      marks_en: 'Total Marks: {t:55}',
      marks: 55,
      answer_on: 'answer_sheet',
      note_en: null,
      slots: [
        {
          slot: 'english.C.Q3', label_en: 'Q.3:', label_ur: 'سوال 3', // needs fluent-Urdu review
          instruction_en: 'Punctuate the following passage.', marks_line_en: '({t:5})',
          type: 'Punctuation', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'one or two sentences (about 25 words) with capitals, full stops, a question or exclamation mark, commas and an apostrophe removed', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = the unpunctuated passage (lower case, no punctuation), `answer` = the punctuated passage. A points only, one per mark.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q4', label_en: 'Q.4:', label_ur: 'سوال 4', // needs fluent-Urdu review
          instruction_en: 'Use any five of the following words in meaningful sentences.', marks_line_en: '({t:10})',
          type: 'Word Sentences', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'six unit vocabulary words, any five used in sentences', number_size: 'six words', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `words` = exactly six words from units 1–10; `answer` = one model sentence per word. 2 marks a word (meaning shown 1 + correct sentence 1).',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q5', label_en: 'Q.5', label_ur: 'سوال 5', // needs fluent-Urdu review
          instruction_en: 'Write down FOUR rhyming words from the poem “{q}”', marks_line_en: '({t:4})',
          type: 'Rhyming Words', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 4, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'match four cue words to their rhymes in a 9–10 line poem from the book', number_size: 'four cue words', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = the title of a poem from units 1–10 exactly as in the book; `passage` = 6–10 of its lines exactly as printed in the book; `words` = four cue words from those lines; `answer` = each cue word with its rhyme.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q6', label_en: 'Q.6:', label_ur: 'سوال 6', // needs fluent-Urdu review
          instruction_en: 'Develop a mind map about “{q}”.', marks_line_en: '({t:5})',
          type: 'Mind Map', category: 'subjective', shape: 'composition',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a textbook topic; the child draws a map with five branches', number_size: 'five branches', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = a short topic from units 1–10 (2–4 words). The child draws the map; never refer to boxes or branches printed on the paper. `answer` = five possible branches.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q7', label_en: 'Q.7:', label_ur: 'سوال 7', // needs fluent-Urdu review
          instruction_en: 'Attempt {w:ONE} of the following.', marks_line_en: '({t:10})',
          type: 'Application Writing', category: 'subjective', shape: 'composition',
          generate: 2, attempt: 1, marks_each: 10, parts: null,
          numbering: 'alpha_paren', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a formal application OR an informal letter from FDE\'s closed lists', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['application', 'letter'],
          prompt_rule: 'Two items: (a) "Write an application to your principal for …" with a topic from closed_lists.applications; (b) "Write a letter …" with a topic from closed_lists.informal_letters.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
        {
          slot: 'english.C.Q8', label_en: 'Q.8:', label_ur: 'سوال 8', // needs fluent-Urdu review
          instruction_en: 'Write a paragraph on any ONE of the following topics.', marks_line_en: '({t:10})',
          type: 'Paragraph Writing', category: 'subjective', shape: 'composition',
          generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'three paragraph topics from FDE\'s closed list; the child writes one', number_size: 'three topics', steps: 1, unit_choice: false },
          families: null, kinds: ['paragraph'],
          prompt_rule: 'One item: `topics` = three different titles from closed_lists.paragraphs, exactly as listed.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q9', label_en: 'Q.9:', label_ur: 'سوال 9', // needs fluent-Urdu review
          instruction_en: 'Develop a story with a moral from the given outline. Also suggest a suitable title.', marks_line_en: '({t:5})',
          type: 'Story Writing', category: 'subjective', shape: 'composition',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'an outline of 8–12 cues separated by dashes, ending with "Moral"', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['story_outline'],
          prompt_rule: 'One item: `question` = the outline, 8–12 short cues separated by " — ", ending "— Moral". No title.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q10', label_en: 'Q.10:', label_ur: 'سوال 10', // needs fluent-Urdu review
          instruction_en: 'Describe the picture with the help of the given word bank. Also suggest a suitable title.', marks_line_en: '({t:6})',
          type: 'Picture Description', category: 'subjective', shape: 'frame',
          generate: 1, attempt: 1, marks_each: 6, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a nine-word bank for an everyday scene (classroom, park, market)', number_size: 'eight to ten words', steps: 1, unit_choice: false },
          families: null, kinds: ['picture_description'],
          prompt_rule: 'One item: `question` = a one-line scene for the teacher (e.g. "children painting in an art lesson"), `words` = 8–10 words a child would use to describe that scene. The paper prints a frame and the word bank; the teacher adds any picture that fits. Never describe the picture to the child.',
          frame: { kind: 'picture', title_en: 'Picture', title_ur: 'تصویر', height_mm: 70, lines: 0, book_page: null, word_bank: true }, // ur: needs fluent-Urdu review
          teacher_note_en: 'Paste or draw a picture that fits the word bank in the frame before photocopying.',
          teacher_note_ur: 'فوٹو کاپی سے پہلے مددگار الفاظ سے میل کھاتی کوئی تصویر خانے میں چسپاں کریں یا بنائیں۔', // needs fluent-Urdu review
          alternatives: null, or: false,
        },
      ],
    },
  ],
};

// ─────────────────────────────── Urdu ───────────────────────────────

const URDU = {
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  total_marks: 100,
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · Urdu · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · اردو · FDE طرز کا مشقی پرچہ', // needs fluent-Urdu review
    // FDE's Urdu paper prints no overall time, total or note; these are ours.
    time_line_ur: 'وقت: 3 گھنٹے', // needs fluent-Urdu review
    total_line_ur: 'کل نمبر: {t:100}', // needs fluent-Urdu review
    note_ur: 'نوٹ: اس پرچے کے تین حصے ہیں۔ حصہ الف سوالیہ پرچے پر حل کریں۔ باقی حصے جوابی کاپی پر حل کریں۔ کاٹ چھانٹ، مٹانا اور اوور رائٹنگ کی اجازت نہیں۔', // needs fluent-Urdu review
  },
  closed_lists: {
    paragraphs: ['خوش رہیں خوشیاں بانٹیں', 'ماحولیاتی آلودگی', 'والدین ایک نعمت', 'میرا وطن', 'قائداعظم'], // transcribed (FDE pp 48–50)
    applications: ['library books', 'sick leave', 'certificate', 'fee remission', 'brother\'s wedding'],
    letters: ['birthday invitation to a friend', 'thanks to an uncle for a gift', 'to a younger brother on studies', 'to mother on her health', 'to father for money for books'],
  },
  scope: {
    page_ranges: '28-107',
    chapter_numbers: [4, 5, 6, 7, 8, 9, 10],
    display_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    excluded: [11, 12, 13, 14, 15, 16],
    topics_only: [],
    held: [1, 2, 3],
    unit_ranges: [],
    label_en: 'FDE syllabus 2026–27',
    label_ur: 'FDE نصاب 2026–27', // needs fluent-Urdu review
    line_en: 'Lessons 4–10 · grammar · 1–3 from the book',
    line_ur: 'اسباق 4–10 · قواعد · 1–3 کتاب سے', // needs fluent-Urdu review
    excluded_pages_note: 'Items are set from lessons 4–10 (book pp 28–107) only; lessons 1–3 are practised from the book. The grammar FDE tests is inside these lessons\' exercises.',
  },
  sections: [
    {
      id: 'A',
      time_ur: 'وقت: 20 منٹ', // transcribed (FDE p.54)
      label_ur: 'حصہ الف معروضی', // transcribed (FDE p.54)
      marks_ur: '(کل نمبر {t:20})', // transcribed (FDE p.54)
      label_en: 'Section A (objective)',
      marks: 20,
      answer_on: 'question_paper',
      note_ur: null,
      slots: [
        {
          slot: 'urdu.A.Q1', label_en: 'Q1', label_ur: 'سوال نمبر 1', // transcribed
          instruction_ur: 'درج ذیل میں سے درست جواب کا انتخاب کریں۔', // transcribed (FDE p.54)
          marks_line_ur: '{t:20}',
          type: 'MCQs', category: 'objective', shape: 'mcq',
          generate: 20, attempt: 20, marks_each: 1, parts: null,
          numbering: 'urdu', option_labels: 'ur', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'one point per item: lesson facts and word meanings from lessons 4–10, and grammar (اسم معرفہ، اسم صوت، حروف، محاورے، املا، متضاد)', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Twenty four-option MCQs: about half lesson facts and word meanings from lessons 4–10, half grammar found in those lessons\' exercises. Never lessons 1, 2 or 3 (pp 1–27). Options of similar length; the right answer is not the longest.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'B',
      time_ur: 'وقت: 20 منٹ', // transcribed (FDE p.56)
      label_ur: 'حصہ ب موضوعی', // transcribed (FDE p.56)
      marks_ur: '(کل نمبر {t:20})', // transcribed (FDE p.56)
      label_en: 'Section B (subjective)',
      marks: 20,
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        {
          slot: 'urdu.B.Q2', label_en: 'Q2', label_ur: 'سوال نمبر 2',
          // FDE prints the passage with no number or instruction; this line is ours.
          instruction_ur: 'درج ذیل پیراگراف کو غور سے پڑھیں اور سوالات کے جواب دیں۔', // needs fluent-Urdu review
          marks_line_ur: '{t:20}',
          type: 'Comprehension Passage', category: 'subjective', shape: 'comprehension',
          generate: 1, attempt: 1, marks_each: 20, parts: [10, 8, 2],
          parts_spec: [
            { key: 'questions', label: 'الف:', instruction_ur: 'سوالات', marks_line_ur: '10', n: 5, marks_each: 2, numbering: 'urdu' }, // transcribed (FDE p.56)
            { key: 'pick', label: 'ب:', instruction_ur: 'سوال: پیراگراف سے چن کر لکھیں۔', marks_line_ur: '08', n: 8, marks_each: 1, pick: { 'اسم معرفہ': 2, 'اسم نکرہ': 2, 'اسم صفت': 2, 'فعل': 2 } }, // transcribed (FDE p.56)
            { key: 'antonyms', label: '', instruction_ur: 'دیے گئے الفاظ کے متضاد لکھیں۔', marks_line_ur: '02', n: 2, marks_each: 1 }, // transcribed (FDE p.56)
          ],
          numbering: 'none', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'an unseen paragraph of 100–140 words; four questions and a title; two of each word class picked from the paragraph; two antonyms', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `passage` = an unseen paragraph of 100–140 words about everyday school or family life (no real people, no religious text); `parts` = [{key:"questions", questions:[5, the fifth asks for a suitable title (مناسب عنوان)]}, {key:"pick", pick:{"اسم معرفہ":[≥2], "اسم نکرہ":[≥2], "اسم صفت":[≥2], "فعل":[≥2]}} — every word copied exactly as it appears in the paragraph, {key:"antonyms", antonyms:[[word from the paragraph, its antonym], two pairs]}].',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'C',
      time_ur: 'وقت: 2 گھنٹے 20 منٹ', // transcribed (FDE p.57)
      label_ur: 'حصہ ج موضوعی', // transcribed (FDE p.57)
      marks_ur: '(کل نمبر {t:60})', // transcribed (FDE p.57)
      label_en: 'Section C (subjective)',
      marks: 60,
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        {
          slot: 'urdu.C.Q3', label_en: 'Q3', label_ur: 'سوال نمبر 3',
          instruction_ur: 'مندرجہ ذیل الفاظ کے معنی لکھیں۔ (کوئی سے پانچ)', // transcribed (FDE p.57)
          marks_line_ur: '{t:5}',
          type: 'Word Meanings', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'seven words from the lessons\' new-word lists; any five', number_size: 'seven words', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `words` = exactly seven words from the نئے الفاظ lists of lessons 4–10; `answer` = each word with its meaning from the book. 1 mark a word.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'urdu.C.Q4', label_en: 'Q4', label_ur: 'سوال نمبر 4',
          instruction_ur: 'ہدایات کے مطابق حل کریں۔', // transcribed (FDE p.57)
          marks_line_ur: '{t:5}',
          type: 'Rewrite Sentences', category: 'subjective', shape: 'short',
          generate: 4, attempt: 4, marks_each: 1.25, parts: null,
          numbering: 'urdu', option_labels: 'ur_paren', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'grammar as directed, one each: گروہی الفاظ (choose), حروفِ شرط و جزا (choose), present to future tense, ارکان سازی of two words', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['group_words', 'conditional', 'tense', 'syllables'],
          prompt_rule: 'Four items in this order: (1) گروہی الفاظ — a stem with four options; (2) حروفِ شرط و جزا — a sentence and four options; (3) فعلِ حال کو فعلِ مستقبل میں تبدیل کریں — one sentence; (4) ارکان سازی — two words. A points only.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'urdu.C.Q5', label_en: 'Q5', label_ur: 'سوال نمبر 5',
          instruction_ur: 'درج ذیل الفاظ اور محاورات میں سے کوئی سے پانچ کے جملے بنائیں۔', // transcribed (FDE p.57)
          marks_line_ur: '{t:5}',
          type: 'Word Sentences', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'four words and three idioms from lessons 4–10; any five in sentences', number_size: 'seven entries', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `words` = four words and three محاورات from lessons 4–10 (seven entries); `answer` = one model sentence each. 1 mark each (1 / ½ / 0).',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'urdu.C.Q6', label_en: 'Q6', label_ur: 'سوال نمبر 6',
          instruction_ur: null,
          marks_line_ur: '{t:5}',
          type: 'Poem Explanation', category: 'subjective', shape: 'fixed',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'central idea of the Naat (from the book) OR explain four quoted lines of lesson 7', number_size: 'four lines', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item only, from lesson 7 «ندی کی فریاد»: `passage` = four consecutive lines of the poem copied exactly from the book; `question` = «درج ذیل اشعار کا مفہوم واضح کریں۔»; `answer` = the meaning in simple Urdu. Never use lessons 1, 2 or 3.',
          frame: null, teacher_note_en: null, teacher_note_ur: null,
          or: true,
          alternatives: [
            {
              kind: 'fixed',
              // FDE p.57 prints this line with no full stop; the stop is ours.
              instruction_ur: 'نظم "نعت" کا مرکزی خیال لکھیں۔', // transcribed (FDE p.57)
              key: null,
              split: [3, 1, 1],
              book_lesson: 2,
              book_page: 13, // lesson 2 opens on book p.13 and runs to p.24
              book_pages: '13-24',
            },
            {
              kind: 'seen_verses',
              instruction_ur: 'درج ذیل اشعار کا مفہوم واضح کریں۔', // transcribed (FDE p.57)
              source_chapter: 7,
              generate: true,
            },
          ],
        },
        {
          slot: 'urdu.C.Q7', label_en: 'Q7', label_ur: 'سوال نمبر 7',
          instruction_ur: 'مددگار الفاظ کی مدد سے تصویر کی وضاحت مکمل کریں۔', // transcribed (FDE p.58)
          marks_line_ur: '{t:10}',
          type: 'Picture Description', category: 'subjective', shape: 'frame',
          generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'seven helper words for an everyday scene (park, zoo, market)', number_size: 'seven words', steps: 1, unit_choice: false },
          families: null, kinds: ['picture_description'],
          prompt_rule: 'One item: `question` = a one-line scene for the teacher (e.g. «چڑیا گھر کی سیر»), `words` = seven helper words a child would use for it. The paper prints a frame and the helper words; the teacher adds any picture that fits. Never describe the picture to the child.',
          frame: { kind: 'picture', title_en: 'Picture', title_ur: 'تصویر', height_mm: 70, lines: 0, book_page: null, word_bank: true }, // ur: needs fluent-Urdu review
          teacher_note_en: 'Paste or draw a picture that fits the helper words in the frame before photocopying.',
          teacher_note_ur: 'فوٹو کاپی سے پہلے مددگار الفاظ سے میل کھاتی کوئی تصویر خانے میں چسپاں کریں یا بنائیں۔', // needs fluent-Urdu review
          alternatives: null, or: false,
        },
        {
          slot: 'urdu.C.Q8', label_en: 'Q8', label_ur: 'سوال نمبر 8',
          instruction_ur: null,
          or_parts_ur: ['نیچے دیے گئے موضوع پر دس سے بارہ جملے تحریر کریں۔', null], // transcribed (FDE p.58)
          marks_line_ur: '{t:10}',
          type: 'Paragraph Writing', category: 'subjective', shape: 'composition',
          generate: 2, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a paragraph of 10–12 sentences on a closed-list title OR a dialogue between two friends on an everyday topic', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['paragraph', 'dialogue'],
          prompt_rule: 'Two items: (a) `question` = one title from closed_lists.paragraphs exactly as listed; (b) `question` = «دو دوستوں کے درمیان … پر مکالمہ تحریر کریں۔» with an everyday topic (punctuality, cleanliness, a school trip).',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
        {
          slot: 'urdu.C.Q9', label_en: 'Q9', label_ur: 'سوال نمبر 9',
          instruction_ur: null,
          or_parts_ur: ['دیے گئے عنوان پر کہانی تحریر کریں اور نتیجہ بھی لکھیں۔', 'ابتدائی جملے کی مدد سے کہانی مکمل کریں اور نتیجہ بھی تحریر کریں۔'], // transcribed (FDE p.58)
          marks_line_ur: '{t:10}',
          type: 'Story Writing', category: 'subjective', shape: 'composition',
          generate: 2, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a story on a given title with its moral OR a story completed from an opening line with its moral', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['story_title', 'story_opening'],
          prompt_rule: 'Two items: (a) `question` = a proverb-like title in quotes (e.g. «اتفاق میں برکت ہے»); (b) `question` = an opening line of one or two sentences that stops mid-way with «…». Fictional names only.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
        {
          slot: 'urdu.C.Q10', label_en: 'Q10', label_ur: 'سوال نمبر 10',
          instruction_ur: null,
          or_parts_ur: [null, null],
          marks_line_ur: '{t:10}',
          type: 'Letter Writing', category: 'subjective', shape: 'composition',
          generate: 2, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a letter OR an application on a closed-list topic, each one line', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['letter', 'application'],
          prompt_rule: 'Two items, each one full instruction line in Urdu: (a) a letter from closed_lists.letters (e.g. «اپنی والدہ کے نام خط لکھ کر انھیں اپنی صحت پر توجہ دینے کی تلقین کریں۔»); (b) an application from closed_lists.applications addressed «ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب».',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
      ],
    },
  ],
};

// ─────────────────────── Social Studies (Urdu medium) ───────────────────────

const SST = {
  key: 'social_studies',
  medium: 'ur',
  name_en: 'Social Studies',
  name_ur: 'معاشرتی علوم', // needs fluent-Urdu review
  total_marks: 100,
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · Social Studies · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · معاشرتی علوم · FDE طرز کا مشقی پرچہ', // needs fluent-Urdu review
    time_line_ur: 'وقت: 3 گھنٹے', // needs fluent-Urdu review
    total_line_ur: 'کل نمبر {t:100}', // transcribed (FDE p.75)
    note_ur: 'نوٹ: اس پرچے کے چار حصے ہیں۔ حصہ اول سوالیہ پرچے پر حل کریں۔ باقی حصے جوابی کاپی پر حل کریں۔ کاٹ چھانٹ، مٹانا اور اوور رائٹنگ کی اجازت نہیں۔', // needs fluent-Urdu review
  },
  scope: {
    page_ranges: '1-33, 40-85, 94-104',
    chapter_numbers: [1, 2, 3, 4, 6, 7, 8, 9, 11],
    display_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    excluded: [5, 10],
    topics_only: [],
    held: [],
    unit_ranges: [],
    label_en: 'FDE syllabus 2026–27',
    label_ur: 'FDE نصاب 2026–27', // needs fluent-Urdu review
    line_en: 'Chapters 1–4, 6–9, 11',
    line_ur: 'ابواب 1–4، 6–9، 11', // needs fluent-Urdu review
    excluded_pages_note: 'Chapter 5 (beginning of civilisations) and chapter 10 (economics) are not in the FDE exam.',
  },
  sections: [
    {
      id: 'A',
      time_ur: 'کل وقت: 30 منٹ', // transcribed (FDE p.75)
      label_ur: '(حصہ اول) معروضی', // transcribed (FDE p.75)
      marks_ur: null,
      label_en: 'Section 1 (objective)',
      marks: 30,
      answer_on: 'question_paper',
      note_ur: null,
      slots: [
        {
          slot: 'social_studies.A.Q1', label_en: 'Q1', label_ur: 'سوال نمبر 1', // transcribed
          instruction_ur: 'درست جواب کا انتخاب کریں اور (✓) کا نشان لگائیں۔', // transcribed (FDE p.75)
          marks_line_ur: '{t:20} نمبر', // transcribed (FDE p.75)
          type: 'MCQs', category: 'objective', shape: 'mcq',
          generate: 20, attempt: 20, marks_each: 1, parts: null,
          numbering: 'urdu', option_labels: 'ur', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'one point per item across the included chapters: citizenship, culture, government, personalities, geography, money', number_size: 'years and simple numbers', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Twenty four-option MCQs across chapters 1–4, 6–9 and 11, weighted to geography (chapters 7–9 about 40%); 3 to 5 pure recall.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'social_studies.A.Q2', label_en: 'Q2', label_ur: 'سوال نمبر 2', // transcribed
          instruction_ur: 'دیے گئے پاکستان کے نقشے پر ہمسایہ ممالک اور صوبوں کی نشاندہی کریں۔', // transcribed (FDE p.77)
          marks_line_ur: '{t:10}',
          type: 'Map Labelling', category: 'subjective', shape: 'frame',
          generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'label ten places on a blank outline map of Pakistan: four neighbouring countries, provinces and territories, the sea', number_size: 'ten labels', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = «پاکستان کا نقشہ», `answer` = the ten places to label (four neighbouring countries, the provinces and territories, the Arabian Sea). The paper prints an empty frame with ten label lines; the teacher pastes a blank outline map.',
          frame: { kind: 'map', title_en: 'Map of Pakistan', title_ur: 'پاکستان کا نقشہ', height_mm: 110, lines: 10, book_page: null, word_bank: false }, // ur: needs fluent-Urdu review
          teacher_note_en: 'Paste or photocopy a blank outline map of Pakistan into the frame before photocopying.',
          teacher_note_ur: 'فوٹو کاپی سے پہلے پاکستان کا خالی خاکہ نقشہ خانے میں چسپاں کریں۔', // needs fluent-Urdu review
          alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'B',
      time_ur: 'کل وقت: 2 گھنٹے 30 منٹ', // transcribed (FDE p.78)
      label_ur: '(حصہ دوم موضوعی)', // transcribed (FDE p.78)
      marks_ur: 'کل نمبر {t:16}', // transcribed (FDE p.78)
      label_en: 'Section 2 (subjective)',
      marks: 16,
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        {
          slot: 'social_studies.B.Q3', label_en: 'Q3', label_ur: 'سوال نمبر 3',
          instruction_ur: 'دیے گئے موضوع پر بہاؤ چارٹ بنائیں۔', // transcribed (FDE p.78)
          marks_line_ur: '{t:10}',
          type: 'Flow Chart', category: 'subjective', shape: 'composition',
          generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a geography topic the child turns into a flow chart (title, four boxes, examples, arrows)', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = a topic from chapter 8 or 9 in quotes (e.g. «پاکستان کے طبعی خدوخال»); the child draws the chart; `answer` = the boxes in order with an example under each.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'social_studies.B.Q4', label_en: 'Q4', label_ur: 'سوال نمبر 4',
          instruction_ur: "'{q}' پر مشتمل ذہنی خاکہ بنائیں۔", // transcribed (FDE p.78)
          marks_line_ur: '{t:6}',
          type: 'Mind Map', category: 'subjective', shape: 'composition',
          generate: 1, attempt: 1, marks_each: 6, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a citizenship topic the child turns into a mind map of 4–6 branches', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = a short topic from chapters 1–2 (e.g. «پاکستان کے ڈیجیٹل شہری کی ذمہ داریاں»), with no quote marks; `answer` = six possible branches.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'C',
      time_ur: null,
      label_ur: '(حصہ سوم)', // transcribed (FDE p.79)
      marks_ur: 'کل نمبر {t:18}', // transcribed (FDE p.79)
      label_en: 'Section 3',
      marks: 18,
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        {
          slot: 'social_studies.C.Q5', label_en: 'Q5', label_ur: 'سوال نمبر 5',
          instruction_ur: 'دیے گئے سوالات میں سے کوئی سے {w:چھ} کے مختصر جواب لکھیں۔', // transcribed (FDE p.79)
          marks_line_ur: null,
          type: 'Short Questions', category: 'subjective', shape: 'short',
          generate: 9, attempt: 6, marks_each: 3, parts: null,
          numbering: 'arabic', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'short answer of 2–3 sentences', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Nine short-answer questions spread over the included chapters; key points (K) adding to 3 each.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
    {
      id: 'D',
      time_ur: null,
      label_ur: '(حصہ چہارم)', // transcribed (FDE p.80)
      marks_ur: 'کل نمبر {t:36}', // transcribed (FDE p.80)
      label_en: 'Section 4',
      marks: 36,
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        {
          slot: 'social_studies.D.Q6', label_en: 'Q6', label_ur: 'سوال نمبر 6',
          // FDE p.80 reads «کی» here; «کے» is the grammatical form the line means.
          instruction_ur: 'دیے گئے سوالات میں سے صرف {w:چار} کے تفصیلی جواب لکھیں۔', // transcribed (FDE p.80)
          marks_line_ur: '{t:24}',
          type: 'Long Question', category: 'subjective', shape: 'short',
          generate: 6, attempt: 4, marks_each: 6, parts: null,
          numbering: 'arabic', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'detailed answer of 6–8 sentences', number_size: 'none', steps: 2, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Six detailed questions over the included chapters, at least two from geography (chapters 7–9); key points (K) adding to 6 each.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'social_studies.D.Q7', label_en: 'Q7', label_ur: 'سوال نمبر 7',
          instruction_ur: 'دیے گئے سوالات کے ایک سطری / دو سطری جواب لکھیں۔ (کوئی سے {w:چھ})', // transcribed (FDE p.80)
          marks_line_ur: '{t:12}',
          type: 'Short Questions', category: 'subjective', shape: 'short',
          generate: 8, attempt: 6, marks_each: 2, parts: null,
          numbering: 'arabic', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'one-fact question answered in one or two lines', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Eight one-fact questions (who, where, what is) from chapter 6 and chapters 7–9, of the kind found in the books\' information boxes; the key answers each in one line.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
  ],
};

// Summary lines the app shows (Check row and Inside tray). App language, Western digits.
const SUMMARY = {
  maths: {
    en: { sections: ['1 hr · 40 · 20 MCQs · 10 short "Solve"', '2 hrs · 40 · Q2: attempt any 8 of 12 · 5 each', '(B + C) · 20 · Q3 bar graph · any 3 of Q4–Q8'], choice: 'Q2: attempt any 8 of 12 · 5 each' },
    // needs fluent-Urdu review
    ur: { sections: ['1 گھنٹہ · 40 · 20 معروضی · 10 مختصر «حل کریں»', '2 گھنٹے · 40 · سوال 2: 12 میں سے کوئی سے 8 · ہر ایک 5', '(ب + ج) · 20 · سوال 3 بار گراف · سوال 4 تا 8 میں سے کوئی سے 3'], choice: 'سوال 2: 12 میں سے کوئی سے 8 · ہر ایک 5' },
  },
  science: {
    en: { sections: ['30 min · 25 · 20 MCQs · label a diagram', '2 hrs 30 min · 17 · draw and label one of 2 · any 2 of 3 situations', '(B + C) · 58 · any 8 of 10 short · any 2 of 5 long'], choice: 'Q3 (a): any 8 of 10 · 5 each' },
    // needs fluent-Urdu review
    ur: { sections: ['30 منٹ · 25 · 20 معروضی · خاکے پر نام', '2 گھنٹے 30 منٹ · 17 · 2 میں سے ایک خاکہ · 3 میں سے کوئی سی 2 صورتیں', '(ب + ج) · 58 · 10 میں سے کوئی سے 8 مختصر · 5 میں سے کوئی سے 2 تفصیلی'], choice: 'سوال 3 (الف): 10 میں سے کوئی سے 8 · ہر ایک 5' },
  },
  english: {
    en: { sections: ['30 min · 25 · 20 MCQs · 5 do as directed', '30 min · 20 · a passage with questions', '2 hrs · 55 · writing: Q3 to Q10'], choice: 'Q7: one of 2 · application or letter' },
    // needs fluent-Urdu review
    ur: { sections: ['30 منٹ · 25 · 20 معروضی · 5 ہدایات کے مطابق', '30 منٹ · 20 · پیراگراف اور سوالات', '2 گھنٹے · 55 · تحریر: سوال 3 تا 10'], choice: 'سوال 7: 2 میں سے ایک · درخواست یا خط' },
  },
  urdu: {
    en: { sections: ['20 min · 20 · 20 MCQs', '20 min · 20 · a paragraph with questions', '2 hrs 20 min · 60 · Q3 to Q10'], choice: 'Q8–Q10: one of 2 each' },
    // needs fluent-Urdu review
    ur: { sections: ['20 منٹ · 20 · 20 معروضی', '20 منٹ · 20 · پیراگراف اور سوالات', '2 گھنٹے 20 منٹ · 60 · سوال 3 تا 10'], choice: 'سوال 8 تا 10: ہر ایک میں 2 میں سے ایک' },
  },
  social_studies: {
    en: { sections: ['30 min · 30 · 20 MCQs · the map of Pakistan', '2 hrs 30 min · 16 · flow chart · mind map', '(2–4) · 18 · any 6 of 9 short', '(2–4) · 36 · any 4 of 6 detailed · any 6 of 8 brief'], choice: 'Q5: any 6 of 9 · 3 each' },
    // needs fluent-Urdu review
    ur: { sections: ['30 منٹ · 30 · 20 معروضی · پاکستان کا نقشہ', '2 گھنٹے 30 منٹ · 16 · بہاؤ چارٹ · ذہنی خاکہ', '(دوم تا چہارم) · 18 · 9 میں سے کوئی سے 6 مختصر', '(دوم تا چہارم) · 36 · 6 میں سے 4 تفصیلی · 8 میں سے 6 مختصر'], choice: 'سوال 5: 9 میں سے کوئی سے 6 · ہر ایک 3' },
  },
};

const SUBJECTS = { maths: MATHS, science: SCIENCE, english: ENGLISH, urdu: URDU, social_studies: SST };
for (const [key, subject] of Object.entries(SUBJECTS)) {
  const header = {};
  for (const [k, v] of Object.entries(COMMON_EN)) header[`${k}_en`] = v;
  for (const [k, v] of Object.entries(COMMON_UR)) header[`${k}_ur`] = v;
  subject.header = { ...header, ...subject.header };
  subject.legend = LEGEND;
  subject.before_exam = BEFORE_EXAM;
  subject.supplies = SUPPLIES;
  subject.summary_lines = SUMMARY[key];
}

function deepFreeze(node) {
  if (node && typeof node === 'object' && !Object.isFrozen(node)) {
    Object.freeze(node);
    Object.values(node).forEach(deepFreeze);
  }
  return node;
}

module.exports = deepFreeze({
  id: 'fde_g5_2027',
  grade: 5,
  exam: { name_en: 'FDE Grade V Centralised Annual Examination', session: 'Feb 2027' },
  you_add: YOU_ADD,
  files: FILES,
  name: NAME,
  wait_hint: WAIT,
  total_time: TIME3,
  subjects: SUBJECTS,
});
