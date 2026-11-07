'use strict';
// Part of fde-g5-2027.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

// ─────────────────────── Social Studies (Urdu medium) ───────────────────────

const SST = {
  key: 'social_studies',
  medium: 'ur',
  name_en: 'Social Studies',
  name_ur: 'معاشرتی علوم', // needs fluent-Urdu review
  total_marks: 100,
  tos: { Remember: 30, Understand: 40, Apply: 30 }, // FDE's table of specification, % of marks by level (GRADE V MODEL PAPERS CAE 2026)
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    covers_partial_en: 'Covers {units}; every section set from these chapters.',
    title_en: 'Grade 5 · Social Studies · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · معاشرتی علوم · FDE pattern کا مشقی پرچہ', // operator rule 15 Oct: «pattern» in Latin, never طرز; rest needs fluent-Urdu review
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
      levels: { Remember: 18, Understand: 6, Apply: 6 }, // a target for the prompt, not FDE's printed split (its SST table by question is not in hand); counted by tags (bd-5jmnfj.27)
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
          frame: {
            kind: 'map', height_mm: 100, lines: 10, book_page: null, word_bank: false,
            title_en: 'Map of Pakistan (paste or photocopy a blank outline map; label here)',
            title_ur: 'پاکستان کا نقشہ (خالی خاکہ چسپاں یا فوٹو کاپی کریں؛ نشاندہی یہاں کریں)', // needs fluent-Urdu review
            supply_en: 'Map of Pakistan', supply_ur: 'پاکستان کا نقشہ', // ur: needs fluent-Urdu review
            duty_en: 'the map of Pakistan', duty_ur: 'پاکستان کا نقشہ', // ur: needs fluent-Urdu review
          },
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
      levels: { Remember: 0, Understand: 16, Apply: 0 }, // a target for the prompt, not FDE's printed split (its SST table by question is not in hand); counted by tags (bd-5jmnfj.27)
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
          // What the chart must hold, from the pattern whatever the reply writes: the scheme marks a title,
          // four boxes, an example under each and the arrows.
          topic_line_ur: '«{q}»: چارٹ میں عنوان، چار خانے، ہر خانے کے نیچے ایک مثال اور خانوں کو جوڑنے والے تیر بنائیں۔', // needs fluent-Urdu review
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
      levels: { Remember: 0, Understand: 18, Apply: 0 }, // a target for the prompt, not FDE's printed split (its SST table by question is not in hand); counted by tags (bd-5jmnfj.27)
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
      levels: { Remember: 12, Understand: 0, Apply: 24 }, // a target for the prompt, not FDE's printed split (its SST table by question is not in hand); counted by tags (bd-5jmnfj.27)
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
  islamiat: {
    en: { sections: ['Nazra (oral) · 40 · the teacher writes the ayat, words, surahs, hadith and dua', '20 min · 20 · 5 fill in the blanks · 15 MCQs', '1 hr 40 min · 40 · Q3 translation (teacher writes it) · any 5 of 8 short · any 2 of 5 detailed'], choice: 'Q4: any 5 of 8 · 4 each' },
    // needs fluent-Urdu review
    ur: { sections: ['ناظرہ (زبانی) · 40 · آیات، الفاظ، سورتیں، حدیث اور دعا استاد لکھیں', '20 منٹ · 20 · 5 خالی جگہیں · 15 معروضی', '1 گھنٹہ 40 منٹ · 40 · سوال 3 ترجمہ (استاد لکھیں) · 8 میں سے کوئی سے 5 مختصر · 5 میں سے کوئی سے 2 تفصیلی'], choice: 'سوال 4: 8 میں سے کوئی سے 5 · ہر ایک 4' },
  },
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

module.exports = {
  SST, SUMMARY,
};
