'use strict';
// Part of fde-g5-2027.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

// ─────────────────────────────── Urdu ───────────────────────────────

const URDU = {
  key: 'urdu',
  medium: 'ur',
  name_en: 'Urdu',
  name_ur: 'اردو',
  total_marks: 100,
  tos: { Remember: 30, Understand: 30, Apply: 40 }, // FDE's table of specification, % of marks by level (GRADE V MODEL PAPERS CAE 2026)
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    covers_partial_en: 'Covers {units}; every section set from these lessons.',
    covers_partial_ur: 'احاطہ: {units}؛ ہر حصہ انہی اسباق سے۔', // needs fluent-Urdu review
    title_en: 'Grade 5 · Urdu · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · اردو · FDE pattern کا مشقی پرچہ', // operator rule 15 Oct: «pattern» in Latin, never طرز; rest needs fluent-Urdu review
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
  // The book's poems in lessons 4–10, for Q6's verses when the chosen lessons hold none. Title, poet
  // and pages as printed: lesson 7 «ندی کی فریاد», «شاعر: کوثر صدیقی», couplets on pp 63–64. It is
  // the only poem in these lessons; the Naat (lesson 2) is FDE's instruction only, never given.
  poems: [
    { unit: 7, pages: '63-64', title: 'ندی کی فریاد', poet: 'کوثر صدیقی' },
  ],
  // The book's own worked ارکان splits, as the page store prints them: each lesson's ارکان exercise
  // splits only its first word, and these two are the ones whose parts the store has whole (p.51
  // «دامن» دا / من; p.62 «غلاظت» غ / لا / ظت). A Q4 key that splits one of these words splits it so.
  syllables: [
    { word: 'دامن', parts: ['دا', 'من'], page: 51 },
    { word: 'غلاظت', parts: ['غ', 'لا', 'ظت'], page: 62 },
  ],
  // Each lesson's book pages and the grammar its own «قواعد کا میدان» section teaches, as the page
  // store has them. On chosen lessons or pages, Q1 asks grammar from the chosen lessons' list only.
  // `tags` are the layout's names for a concept it can recognise in an item; `q4` marks a kind Q4 asks
  // on every paper, which Q1 never asks.
  // `poem`: the lesson's text is a poem, not prose (lesson 7, «ندی کی فریاد»); lessons with one prose text
  // among them are one story.
  lessons: [
    { lesson: 4, pages: '28-37', grammar: [{ ur: 'متضاد الفاظ', tags: ['antonym'] }] },
    { lesson: 5, pages: '38-49', grammar: [{ ur: 'مترادف الفاظ', tags: ['synonym'] }, { ur: 'متضاد الفاظ', tags: ['antonym'] }, { ur: 'تمنائی اور شکیہ جملے', tags: ['wish', 'doubt'] }] },
    { lesson: 6, pages: '50-60', grammar: [{ ur: 'متشابہ الفاظ', tags: ['homograph'] }] },
    { lesson: 7, pages: '61-70', poem: true, grammar: [{ ur: 'گروہی الفاظ', q4: true }] },
    { lesson: 8, pages: '71-82', grammar: [{ ur: 'حروفِ عطف', tags: ['conjunction'] }, { ur: 'حروفِ شرط و جزا', tags: ['condition'], q4: true }] },
    { lesson: 9, pages: '83-94', grammar: [{ ur: 'رموزِ اوقاف' }] },
    {
      lesson: 10,
      pages: '95-107',
      grammar: [
        { ur: 'اسم معرفہ و نکرہ', tags: ['naming'] }, { ur: 'صفت و موصوف', tags: ['adjective', 'qualified'] },
        { ur: 'اسم صوت', tags: ['sound'] }, { ur: 'اسم آلہ', tags: ['tool'] },
      ],
    },
  ],
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
      // FDE's split for this section (ToS PDF p.50-53; how R30 divides between A and C is ours; bd-5jmnfj.19).
      levels: { Remember: 20, Understand: 0, Apply: 0 },
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
          prompt_rule: 'Twenty four-option MCQs: about half lesson facts and word meanings from lessons 4–10, half grammar found in those lessons\' exercises. Never lessons 1, 2 or 3 (pp 1–27). Options of similar length; the right answer is not the longest and never repeats a word of its stem. Each stem is one grammatical question with exactly one true option: never place a city or country «outside a house», and never give two options that are both true by the same fact (ہیروشیما and ناگاساکی, بوستان and گلستان). A stem never prints a word that the word-box question (Q3) asks the child to use (لقب). Each stem is plain and states the task directly, with no decorative lead-in phrase before it. Every stem is complete on its own: it never points at text the paper does not print («یہ حکایات», «مذکورہ سبق»), and a book or author item names a fact only the keyed book has. An idiom item prints the idiom\'s meaning and asks which idiom it is, or prints the idiom and asks its meaning; it never quotes a sentence that does not use the idiom, and never says «جیسا سادہ مطلب رکھنے والا». A homophone item reads «ایسا لفظ جس کے دو معنی ہوں: ایک … اور دوسرا …۔ وہ لفظ کون سا ہے؟» with no lead-in about shopping or any other story (and «آواز اور املا ایک جیسی», املا is feminine). A punctuation item names each mark in words in its option, e.g. «۔ (ختمہ)», «؟ (سوالیہ نشان)», «، (سکتہ)», never a bare mark, and its stem describes the mark the key wants. An idiom item\'s keyed option means exactly what the stem describes: check the key\'s own meaning before writing the stem (v37 xx: a stem about shame at one\'s own deed keyed «دودھ کا دودھ اور پانی کا پانی», which means exact justice; the idiom for that stem is «شرم سے پانی پانی ہونا»). A two-meaning item names a word that holds دونوں معنی in the book\'s own usage: every meaning the stem lists is a meaning of the keyed word (v37 vii: ڈالی is a branch, never throwing). Never offer both «اگر، تو» and «جب، تب» as options of one item: both complete a future condition.',
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
      levels: { Remember: 0, Understand: 20, Apply: 0 }, // FDE ToS (bd-5jmnfj.19)
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
            { key: 'pick', label: 'ب:', group_head: { label: 'ب:', instruction_ur: 'دی گئی ہدایات کے مطابق حل کریں۔', marks_line_ur: '10' }, instruction_ur: 'سوال: پیراگراف سے چن کر لکھیں۔', marks_line_ur: '08', n: 8, marks_each: 1, pick: { 'اسم معرفہ': 2, 'اسم نکرہ': 2, 'اسم صفت': 2, 'فعل': 2 } }, // transcribed (FDE p.56)
            { key: 'antonyms', label: '', instruction_ur: 'دیے گئے الفاظ کے متضاد لکھیں۔', marks_line_ur: '02', n: 2, marks_each: 1 }, // transcribed (FDE p.56)
          ],
          numbering: 'none', compulsory: true, lines: 0, work_mm: null,
          section_pages: 'scope',
          grain: { kind: 'an unseen paragraph of 100–140 words; four questions and a title; two of each word class picked from the paragraph; two antonyms', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `passage` = an unseen paragraph of 100–140 words about everyday school or family life (no real people, no religious text); `parts` = [{key:"questions", questions:[5, the fifth asks for a suitable title (مناسب عنوان)]}, {key:"pick", pick:{"اسم معرفہ":[4], "اسم نکرہ":[4], "اسم صفت":[4], "فعل":[4]}} — every word copied exactly as written in the paragraph, inflection included (two spares of each kind; the scheme keeps the first two that are in the paragraph), {key:"antonyms", antonyms:[[word from the paragraph, its antonym], two pairs]}]. A question that asks what comes first («سب سے پہلے») has a one-action answer: name only the first action, never two actions joined by «اور» (v37r4: «زینب صبح اٹھ کر سب سے پہلے کیا کرتی ہے؟» was keyed «بستہ تیار کرتی ہے اور ناشتہ کرتی ہے»). Each antonym pair has a common opposite; the key and `accept` name every standard opposite a child may write (صبح: رات or شام).',
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
      // FDE ToS; the writing tasks Q7-Q10 are Apply, Q4-Q5 Understand, Q3 and Q6 Remember (bd-5jmnfj.19).
      levels: { Remember: 10, Understand: 10, Apply: 40 },
      answer_on: 'answer_sheet',
      note_ur: null,
      slots: [
        {
          slot: 'urdu.C.Q3', label_en: 'Q3', label_ur: 'سوال نمبر 3',
          instruction_ur: 'مندرجہ ذیل الفاظ کے معنی لکھیں۔ (کوئی سے پانچ)', // transcribed (FDE p.57)
          marks_line_ur: '{t:5}',
          type: 'Word Meanings', category: 'subjective', shape: 'words',
          in_item_choice: { n: 5, g: 7 }, generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'seven words from the lessons\' new-word lists; any five', number_size: 'seven words', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `words` = exactly seven words from the نئے الفاظ lists of lessons 4–10; `answer` = each word with its meaning from the book. 1 mark a word. Meanings are respectful: never اپاہج or لنگڑا for a person; use the book\'s own respectful word. Accepted meanings share the word\'s meaning: never a look-alike word from the same root letters (تمثیلی is never «مثالی»). A Q3 word is printed nowhere else on the paper: not in a Q4 item and not in the Q6 poem lines (v37 غلاظت was in Q3, Q4 and Q6, and the Q3 meaning gave away the Q6 meaning); choose words that the Q4 items and the Q6 poem do not print.',
          print_words: true,
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
          prompt_rule: 'Four items in this order: (1) گروہی الفاظ — a stem with four options; (2) حروفِ شرط و جزا — a sentence and four options; (3) فعلِ حال کو فعلِ مستقبل میں تبدیل کریں — one sentence; (4) ارکان سازی — two words. Each item\'s `question` begins with its task phrase in Urdu (e.g. «گروہی الفاظ کی پہچان کریں: …», «درست حرفِ شرط و جزا کا انتخاب کریں: …», «فعلِ حال کو فعلِ مستقبل میں تبدیل کریں: …», «ارکان الگ کریں (لفظ کے حصے): …»), because the paper prints only `question` under the instruction «ہدایات کے مطابق حل کریں»; never leave the task in `main_question` alone. A points only. Item (2) offers only one of the pairs «اگر، تو» and «جب، تب», never both, since both complete a future condition (v37: «تم محنت کرو گے» took both); the other options are pairs that cannot fit. Code shares the five marks as whole or half marks (1.5, 1.5, 1, 1); never split a mark below a half. A حرفِ شرط item offers only one pair that fits the sentence\'s tense and meaning: never «اگر، تو» beside «چوں کہ، اس لیے» for a past fact («تم وقت پر پہنچے» took both). One skill per item: item (4) gives two words that split the same way, both into compound parts («راہ گیر») or both into syllables, never one of each, since the two methods are different skills for one mark (v37r4 «راہ گیر، بوسیدہ»).',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'urdu.C.Q5', label_en: 'Q5', label_ur: 'سوال نمبر 5',
          instruction_ur: 'درج ذیل الفاظ اور محاورات میں سے کوئی سے پانچ کے جملے بنائیں۔', // transcribed (FDE p.57)
          marks_line_ur: '{t:5}',
          type: 'Word Sentences', category: 'subjective', shape: 'words',
          in_item_choice: { n: 5, g: 7 }, generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'four words and three idioms from lessons 4–10; any five in sentences', number_size: 'seven entries', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `words` = four words and three محاورات from lessons 4–10 (seven entries); `answer` = one model sentence each. 1 mark each (1 / ½ / 0).',
          print_words: true,
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'urdu.C.Q6', label_en: 'Q6', label_ur: 'سوال نمبر 6',
          instruction_ur: null,
          marks_line_ur: '{t:5}',
          type: 'Poem Explanation', category: 'subjective', shape: 'fixed',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'explain four quoted lines of lesson 7', number_size: 'four lines', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item only, from lesson 7 «ندی کی فریاد»: `passage`: the first line of `passage` is the poem\'s title «ندی کی فریاد», then four consecutive lines of the poem copied exactly from the book, so the child sees who speaks; `question` = «درج ذیل اشعار کا مفہوم واضح کریں۔»; `answer` = the meaning in simple Urdu, relying only on what is printed (a speaker or subject the answer names must appear in the printed title or verses). Never use lessons 1, 2 or 3. The scheme pays the meaning, never the verses: no point restates a printed line or paraphrases one line by line; the points are what is wrong, how the speaker feels and the child\'s own wording. A scheme point is never met by copying a printed line: it names an idea the child must put in their own words, never a line or phrase of the poem. The title line already tells the child who speaks, so no scheme point pays for naming the speaker or for anything the title states («ندی کی فریاد» gives away «بولنے والا ندی ہے», v37r4 paid 1.5 of 5 for it); the points are what is wrong and how the speaker feels, in the child\'s own words.',
          frame: null, teacher_note_en: null, teacher_note_ur: null,
          // FDE p.57 offers the Naat's central idea OR these lines. The book prints no central idea
          // and asks teachers to give non-Muslim students another lesson in its place, so the
          // paper sets the lesson-7 lines alone (Amena, 29 Oct; bd-5jmnfj.4.51.11).
          or: false,
          alternatives: [
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
          instruction_ur: 'کوئی سے چھ مددگار الفاظ کی مدد سے تصویر کی وضاحت مکمل کریں۔', // FDE p.58 plus «کوئی سے چھ» to match the marking row (v26)
          marks_line_ur: '{t:10}',
          type: 'Picture Description', category: 'subjective', shape: 'frame',
          generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'seven helper words for an everyday scene (park, zoo, market)', number_size: 'seven words', steps: 1, unit_choice: false },
          families: null, kinds: ['picture_description'],
          prompt_rule: 'One item: `question` = a one-line scene for the teacher (e.g. «چڑیا گھر کی سیر»), `words` = seven helper words a child would use for it. The paper prints a frame and the helper words; a picture of the scene prints in the frame (the teacher adds one if it cannot be drawn). Never describe the picture to the child. `describe_en` = a short English description of the scene that names the things behind the words, drawn as a plain black outline picture in the frame; it is never shown to the child. The scheme pays for the six words and the sentences, never a title (عنوان); the model answer states only what `describe_en` lists, so `describe_en` says how many of each person or thing there are, where they are, and whether a seat is empty or an object is held (a balloon floating free, a bench with nobody on it), and the answer adds no person, count or place it leaves out (v35: an elder on the bench and a balloon in a child\'s hand, neither in the picture). `describe_en` is required: an item without it prints an empty frame while the key describes a scene the page never shows, so it is asked again.',
          frame: {
            kind: 'picture', height_mm: 70, lines: 0, book_page: null, word_bank: true,
            title_en: 'Picture (pasted or drawn by the teacher)',
            title_ur: 'تصویر (استاد چسپاں کریں یا بنائیں)', // needs fluent-Urdu review
            supply_en: 'Picture: {q}', supply_ur: 'تصویر: {q}', // ur: needs fluent-Urdu review
            duty_en: 'the picture', duty_ur: 'تصویر', // ur: needs fluent-Urdu review
          },
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
          prompt_rule: 'Two items: (a) `question` = one title from closed_lists.paragraphs exactly as listed; (b) `question` = «دو دوستوں کے درمیان … پر مکالمہ تحریر کریں۔» with an everyday topic (punctuality, cleanliness, a school trip). Model answers carry no prayer, no thanks to God and no supplication (never دعا گو, never «اللہ کا شکر ادا کیا»); each ends on a plain sentence about the topic. The model answer to (a) is a paragraph of 10 to 12 sentences, each ending ۔, never fewer; the answer to (b) is a dialogue of دس سے بارہ جملے (turns), never «آٹھ باتیں», with no concluding result, since the paper asks for none. It states only true facts: Urdu is Pakistan\'s قومی زبان (national language), never مادری زبان (mother tongue) as a national fact.',
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
          prompt_rule: 'Two items: (a) `question` = a proverb-like title in quotes (e.g. «اتفاق میں برکت ہے»); (b) `question` = an opening line of one or two sentences that stops mid-way with «…». Fictional names only. Model answers carry no prayer, no thanks to God and no supplication (never «اللہ کا شکر ادا کیا»); the story ends on a plain sentence.',
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
          prompt_rule: 'Two items, each one full instruction line in Urdu: (a) a letter from closed_lists.letters (e.g. «اپنی والدہ کے نام خط لکھ کر انھیں اپنی صحت پر توجہ دینے کی تلقین کریں۔»); (b) an application from closed_lists.applications addressed «ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب». Each model answer has one fixed sender name (علی or فاطمہ) and one gender, so every verb and the closing agree; never a slash gender form («بیٹا/بیٹی», «آپ کا/کی»), never a placeholder name such as «(الف، ب، ج)», and, where a date is written, the current year 2026 (never ۲۰۲۴). The rubric pays the form, so each model answer carries every form item it names: a letter has a date line («تاریخ: ...»), the salutation (القاب و آداب), the body and the closing; an application opens «بخدمت ...», then a line «عنوان: ...» (the subject), then the salutation «جناب عالی!» (not «محترمہ!»), the body, the closing and a date line (v37r4 had no عنوان, no «جناب عالی!» and no date). A date line is in the current year 2026.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
      ],
    },
  ],
};

module.exports = {
  URDU,
};
