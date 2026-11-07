'use strict';
/**
 * The FDE Grade V Islamiat paper (Nazra + Islamiat, CAE 2026 model paper: design p95, ToS p84),
 * as data for fde-g5-2027.js, which adds the common header and freezes it.
 *
 * FDE's 100 marks are Nazra 40 (oral) + a written paper of 60 (objective 20, subjective 40).
 * Religious text is never authored (Amena, 7 Nov 2026, bd-5jmnfj.39):
 *   - every Nazra task is the teacher's to fill: the sheet asks her to write the ayat, the
 *     words, the surahs, the hadith and the dua; nothing is generated for it (no `ask`);
 *   - Part 2 Q3 (translate a Quranic dua or the durood) is a teacher-filled slot, generate 0;
 *   - every generated slot is told never to quote or ask for that text or its translation.
 * Islamiat has no true/false item anywhere (Amena, 7 Nov 2026).
 *
 * FDE's own Urdu lines were not transcribed: every Urdu line here needs fluent-Urdu review.
 */
// No require of early/chrome: it requires fde-g5-2027, which requires this file (a cycle).

// The oral block as early/chrome's makeOral builds it: each task names how its rubric is read
// ('each' one row per item, 'criteria' rows add up), and the part's marks are the tasks' sum.
const oral = (o) => ({ ...o, marks: o.tasks.reduce((n, t) => n + t.marks, 0) });

const SACRED = 'Never quote, complete, or ask the child to write the text of any ayat, hadith, dua or durood, nor its translation, and never write Arabic: ask about meaning, events, people and practice as the book explains them in Urdu.';
const NO_TF = 'No true/false items, in any form.';
const rule = (s) => `${s} ${SACRED} ${NO_TF}`;

const SLOT = { // the fields every slot carries; each slot overrides what it needs
  parts: null, numbering: 'urdu', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
  families: null, kinds: null, frame: null, teacher_note_en: null, teacher_note_ur: null,
  teacher_fills: false, alternatives: null, or: false,
};

const fill = (o) => ({
  label_en: 'Teacher writes this', label_ur: 'یہ استاد لکھیں', // needs fluent-Urdu review
  teacher_fills: true,
  ...o,
});

const ISLAMIAT = {
  key: 'islamiat',
  medium: 'ur',
  name_en: 'Islamiat',
  name_ur: 'اسلامیات',
  total_marks: 60, // written; Nazra (oral) is the other 40
  oral_marks: 40,
  tos: { Remember: 40, Understand: 30, Apply: 30 }, // FDE's table of specification (GRADE V MODEL PAPERS CAE 2026, p84)
  total_time_en: '2 hrs written · Nazra (oral) separately',
  total_time_ur: 'تحریری 2 گھنٹے · ناظرہ (زبانی) الگ', // needs fluent-Urdu review
  header: {
    covers_partial_en: 'Covers {units}; every section set from these lessons.',
    covers_partial_ur: 'احاطہ: {units}؛ ہر حصہ انہی اسباق سے۔', // needs fluent-Urdu review
    title_en: 'Grade 5 · Islamiat · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · اسلامیات · FDE pattern کا مشقی پرچہ', // «pattern» in Latin (operator rule 15 Oct); rest needs fluent-Urdu review
    time_line_ur: 'وقت: 2 گھنٹے (تحریری)', // needs fluent-Urdu review
    total_line_ur: 'کل نمبر: {t:60} (ناظرہ کے 40 نمبر الگ)', // needs fluent-Urdu review
    note_ur: 'نوٹ: حصہ اول سوالیہ پرچے پر اور حصہ دوم جوابی کاپی پر حل کریں۔', // needs fluent-Urdu review
  },
  // FDE syllabus 2026–27 (printed book pages): ch2–3 whole, ch4 units 1–2, ch5 units 1 and 3,
  // ch6 whole, ch7 unit 1. Chapter 1 (Nazra, hifz, hadith, duas) is the oral part only.
  scope: {
    page_ranges: '15-77, 83-86, 91-110',
    chapter_numbers: [2, 3, 4, 5, 6, 7],
    display_chapters: [1, 2, 3, 4, 5, 6, 7],
    excluded: [],
    topics_only: [],
    held: [1],
    unit_ranges: [],
    label_en: 'FDE syllabus 2026–27',
    label_ur: 'FDE نصاب 2026–27', // needs fluent-Urdu review
    line_en: 'Chapters 2–7 (FDE units) · chapter 1 is the Nazra oral',
    line_ur: 'ابواب 2–7 (FDE کے اسباق) · باب 1 ناظرہ زبانی', // needs fluent-Urdu review
    excluded_pages_note: 'Items are set from book pp 15–77, 83–86 and 91–110 only: frugality (ch4 u3, pp 78–82), brotherhood (ch5 u2, pp 87–90) and plants (ch7 u2, pp 111+) are outside FDE\'s syllabus. Chapter 1 (pp 1–14) is examined orally as Nazra, and its text is written by the teacher.',
  },
  oral: oral({
    title_en: 'Nazra (oral) · teacher sheet',
    title_ur: 'ناظرہ (زبانی) · استاد کی شیٹ', // needs fluent-Urdu review
    note_en: 'Write each task\'s text in the space before the test, from the book\'s chapter 1. Take Nazra one child at a time.',
    note_ur: 'ٹیسٹ سے پہلے ہر حصے کا متن کتاب کے باب 1 سے خالی جگہ میں خود لکھیں۔ ناظرہ ہر بچے سے الگ لیں۔', // needs fluent-Urdu review
    tasks: [
      fill({ id: 'ayat', scoring: 'criteria', kind: 'recite', marks: 20, lines: 6, label_en: 'Recite the given ayat', label_ur: 'دی گئی آیات کی تلاوت',
        instruction_en: 'Write the ayat from the book. The child recites them from the Quran.',
        instruction_ur: 'کتاب سے آیات یہاں لکھیں۔ بچہ قرآن پاک سے ان کی تلاوت کرے۔', // needs fluent-Urdu review
        rubric: [
          { marks: 10, en: 'Correct pronunciation of letters', ur: 'حروف کی درست ادائیگی' },
          { marks: 5, en: 'Fluency without stopping', ur: 'روانی' },
          { marks: 5, en: 'Observes the stops', ur: 'رموزِ اوقاف کا خیال' },
        ] }),
      fill({ id: 'words', scoring: 'each', kind: 'read', marks: 5, n: 5, lines: 2, label_en: 'Read any 5 of 8 Quranic words', label_ur: '8 میں سے کوئی سے 5 قرآنی الفاظ پڑھیں',
        instruction_en: 'Write 8 Quranic words from the book. The child reads any 5.',
        instruction_ur: 'کتاب سے 8 قرآنی الفاظ لکھیں۔ بچہ ان میں سے کوئی سے 5 پڑھے۔', // needs fluent-Urdu review
        rubric: [{ marks: 1, en: 'Each word read right', ur: 'ہر درست پڑھا گیا لفظ' }] }),
      fill({ id: 'by_heart', scoring: 'each', kind: 'recite', marks: 10, n: 2, lines: 2, label_en: 'Recite any 2 surahs by heart', label_ur: 'کوئی سی 2 سورتیں زبانی سنائیں',
        instruction_en: 'Write the names of the surahs the book has the child learn by heart. The child recites any 2.',
        instruction_ur: 'کتاب کی حفظ والی سورتوں کے نام لکھیں۔ بچہ کوئی سی 2 زبانی سنائے۔', // needs fluent-Urdu review
        rubric: [{ marks: 5, en: 'Each surah recited right', ur: 'ہر درست سنائی گئی سورت' }] }),
      fill({ id: 'hadith_dua', scoring: 'criteria', kind: 'recite', marks: 5, lines: 4, label_en: 'One hadith with its translation, and one dua', label_ur: 'ایک حدیث مع ترجمہ اور ایک دعا',
        instruction_en: 'Write one hadith and one dua from the book. The child says the hadith with its translation, then the dua.',
        instruction_ur: 'کتاب سے ایک حدیث اور ایک دعا لکھیں۔ بچہ حدیث ترجمے کے ساتھ اور پھر دعا سنائے۔', // needs fluent-Urdu review
        rubric: [
          { marks: 2.5, en: 'Hadith with its translation', ur: 'حدیث مع ترجمہ' },
          { marks: 2.5, en: 'The dua', ur: 'دعا' },
        ] }),
    ],
  }),
  sections: [
    {
      id: 'A',
      time_ur: 'وقت: 20 منٹ', // needs fluent-Urdu review
      label_ur: '(حصہ اول معروضی)', // needs fluent-Urdu review
      marks_ur: 'کل نمبر {t:20}', // needs fluent-Urdu review
      label_en: 'Part 1 (objective)',
      marks: 20,
      answer_on: 'question_paper',
      note_ur: null,
      slots: [
        { ...SLOT,
          slot: 'islamiat.A.Q1', label_en: 'Q1', label_ur: 'سوال نمبر 1',
          instruction_ur: 'خالی جگہ پُر کریں۔', // needs fluent-Urdu review
          marks_line_ur: '{t:5}',
          type: 'Fill in the Blanks', category: 'objective', shape: 'short',
          generate: 5, attempt: 5, marks_each: 1, lines: 1,
          grain: { kind: 'one Urdu sentence from the book\'s prose with one key word blanked: a name, place, event or practice', number_size: 'none', steps: 1, unit_choice: false },
          prompt_rule: rule('Five one-line Urdu sentences from the included chapters, each with one blank (____) for a single word or name the book states; `answer` = that word.'),
        },
        { ...SLOT,
          slot: 'islamiat.A.Q2', label_en: 'Q2', label_ur: 'سوال نمبر 2',
          instruction_ur: 'درست جواب کا انتخاب کریں۔', // needs fluent-Urdu review
          marks_line_ur: '{t:15}',
          type: 'MCQs', category: 'objective', shape: 'mcq',
          generate: 15, attempt: 15, marks_each: 1, option_labels: 'ur',
          grain: { kind: 'one point per item across the included chapters: beliefs, worship, seerah, morals, personalities', number_size: 'years and simple numbers', steps: 1, unit_choice: false },
          prompt_rule: rule('Fifteen four-option Urdu MCQs spread across chapters 2–7, at least two from each chapter.'),
        },
      ],
    },
    {
      id: 'B',
      time_ur: 'وقت: 1 گھنٹہ 40 منٹ', // needs fluent-Urdu review
      label_ur: '(حصہ دوم موضوعی)', // needs fluent-Urdu review
      marks_ur: 'کل نمبر {t:40}', // needs fluent-Urdu review
      label_en: 'Part 2 (subjective)',
      marks: 40,
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        { ...SLOT,
          slot: 'islamiat.B.Q3', label_en: 'Q3', label_ur: 'سوال نمبر 3',
          instruction_ur: 'درج ذیل کا ترجمہ کریں۔', // needs fluent-Urdu review
          marks_line_ur: '{t:10}',
          type: 'Translation', category: 'subjective', shape: 'teacher_fills',
          generate: 0, attempt: 1, marks_each: 10, numbering: 'none', lines: 6,
          grain: null, prompt_rule: null, teacher_fills: true,
          teacher_note_en: 'Write the dua of Ibrahim (AS) or the durood from the book in this space before photocopying. The child translates it.',
          teacher_note_ur: 'فوٹو کاپی سے پہلے کتاب سے حضرت ابراہیمؑ کی دعا یا درود شریف اس جگہ استاد خود لکھیں۔ بچہ اس کا ترجمہ کرے۔', // needs fluent-Urdu review
        },
        { ...SLOT,
          slot: 'islamiat.B.Q4', label_en: 'Q4', label_ur: 'سوال نمبر 4',
          instruction_ur: 'کوئی سے {w:پانچ} سوالات کے مختصر جوابات لکھیں۔', // needs fluent-Urdu review
          marks_line_ur: '{n:5} × 4 = {t:20}',
          type: 'Short Questions', category: 'subjective', shape: 'short',
          generate: 8, attempt: 5, marks_each: 4, compulsory: false, lines: 4,
          grain: { kind: 'a short answer of three or four sentences on one lesson', number_size: 'none', steps: 1, unit_choice: false },
          prompt_rule: rule('Eight short Urdu questions, each from a different lesson of chapters 2–7; `answer` = four points the book states.'),
        },
        { ...SLOT,
          slot: 'islamiat.B.Q5', label_en: 'Q5', label_ur: 'سوال نمبر 5',
          instruction_ur: 'کوئی سے {w:دو} سوالات کے تفصیلی جوابات لکھیں۔', // needs fluent-Urdu review
          marks_line_ur: '{n:2} × 5 = {t:10}',
          type: 'Long Question', category: 'subjective', shape: 'short',
          generate: 5, attempt: 2, marks_each: 5, compulsory: false, lines: 8,
          grain: { kind: 'a detailed answer on one lesson: an event, a teaching and its lesson for us', number_size: 'none', steps: 1, unit_choice: false },
          prompt_rule: rule('Five detailed Urdu questions, each from a different chapter, none on a lesson Q4 asks; `answer` = five points the book states.'),
        },
      ],
    },
  ],
};

module.exports = ISLAMIAT;
