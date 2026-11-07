'use strict';
// Part of fde-g5-2027.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

// ────────────────────────────── English ──────────────────────────────

const ENGLISH = {
  key: 'english',
  medium: 'en',
  name_en: 'English',
  name_ur: 'انگریزی', // needs fluent-Urdu review
  total_marks: 100,
  tos: { Remember: 40, Understand: 30, Apply: 30 }, // FDE's table of specification, % of marks by level (GRADE V MODEL PAPERS CAE 2026)
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · English · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · انگریزی · FDE pattern کا مشقی پرچہ', // operator rule 15 Oct: «pattern» in Latin, never طرز; rest needs fluent-Urdu review
    time_line_en: 'Time Allowed: 3 Hours',
    total_line_en: 'Total Marks: {t:100}',
    note_en: 'Note: This paper consists of THREE Sections. Section – A needs to be solved on the Question Paper. Sections B & C are to be solved on the Answer Sheet. Cutting, erasing and overwriting is not allowed.',
  },
  closed_lists: {
    paragraphs: ['My Aim in Life', 'My Super Hero', 'My Responsibility as a Student', 'A Visit to the Zoo', 'A Cultural Festival', 'My Country', 'Recycling'],
    informal_letters: ['Birthday party invitation', 'To your sister congratulating her on passing the examination', 'Thanking a friend for a gift', 'Inviting your friend to spend summer holidays with you', 'To your friend telling them about your favourite book'],
    applications: ['Sick leave', 'School leaving certificate', 'Leave to attend your brother\'s marriage ceremony', 'Remission of fine', 'Urgent piece of work', 'To your principal to upgrade your school library'],
  },
  // The book's rhyming poems, for Q5 when the chosen pages hold none. Titles and pages as printed:
  // p.20 «Colours by Shel Silverstein»; pp.100–101 the unit 8 poem (p.99 is its pre-reading,
  // p.102 a second poem with no rhyming pairs).
  poems: [
    { unit: 2, pages: '20', title: 'Colours' },
    { unit: 8, pages: '100-101', title: 'City Life vs. Farm Life: A Friendly Debate' },
  ],
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
      levels: { Remember: 10, Understand: 7, Apply: 8 }, // FDE ToS by question, CAE 2026 pp.34-36 (bd-5jmnfj.26)
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
          prompt_rule: 'Twenty four-option MCQs, one point each, covering: collective and proper nouns, articles, irregular plurals, antonyms, pronouns, syllables, adverbs, suffixes, tenses, homophones, compound words, degrees of adjectives, modals, apostrophe, spelling, anagrams, sentence types, quantifiers, adjectives. Never refer to an underline the paper cannot show; quote the word instead. An antonym item has one exact opposite among its options. Each stem is one grammatical question with exactly one true option: two options that are both correct (should and could both give advice) is a fault, so a modal item names the one meaning only that modal has. The right answer is never the longest option and never repeats a word of its stem. A stem never prints a word that another question asks the child to find or use (a word-box word, an exclamation mark, a tense name). Ask for a tense change at most twice on the whole paper, counting this question and Q1 (b) and Q2.',
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
          prompt_rule: 'Five one-line items, each ending with the direction in round brackets, e.g. "The baby is sleeping. (Change into simple past)". Cover similes/metaphors, S+V+O and simple present/past. At most two of the five items ask for a tense change, and each item tests a different tense or form: never two items with the same direction (v37 i and v both said "Change into simple past"). Every simile or metaphor item (the child writes the sentence) carries `scheme.accept`, an accept line of at least two different correct rewrites (for "as fast as a cheetah" also "as fast as the wind"), because many sentences are right (v35 Q1(b) i-iii had one model and no accept line).',
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
      levels: { Remember: 8, Understand: 6, Apply: 6 }, // FDE ToS by question, CAE 2026 pp.34-36 (bd-5jmnfj.26)
      answer_on: 'answer_sheet',
      note_en: null,
      slots: [
        {
          slot: 'english.B.Q2', label_en: 'Q.2:', label_ur: 'سوال 2', // needs fluent-Urdu review
          levels: { Remember: 8, Understand: 6, Apply: 6 }, // FDE splits this question across levels (bd-5jmnfj.26)
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
          prompt_rule: 'One item: `passage` = an unseen story of 120–160 words; `parts` = [{key:"questions", questions:[5]}, {key:"do_as_directed", questions:[4: a part of speech of a quoted word, a tense change, a fill-in from the passage, a true/false]}, {key:"pick", pick:{"Nouns":[5 nouns], "Verbs":[5 verbs]}}]. Every picked word is copied exactly as written in the passage, inflection included ("walked", never "walk"); two spares of each kind, the scheme keeps the first three that are in the passage. Never refer to an underlined, bold or italic word; quote the word instead (What part of speech is "quickly"?). A tense rewrite\'s `accept` never holds another tense. A true/false item never restates the fact a part i question asks (v35: i(c) asked why Maya ran to the shop and ii(d) said she went to buy a rope); it tests a different sentence of the passage. A False statement is contradicted by a sentence the passage states, never one the passage merely leaves out; a True statement repeats a stated fact in other words. A "why do you think" item asks for a reason the passage does not state; when the passage states the reason, ask it as a plain "why" and every point can be earned by copying the passage, with no second point for an extra reason (v35 i(b)). Each model answer answers the question as asked, from the passage: re-read each model answer against its question before returning it (v37 i(e) asked about being on time and the key said "carry one bucket at a time"). The passage shares no theme or events with the Q9 story outline: it is not about an animal helped by a child and carries no kindness moral, so the writing task cannot be copied from it. Part i: when a scheme pays "Answers in a complete sentence", the stem says "Answer in complete sentences." and every accept line is a full sentence, never a fragment; otherwise the scheme pays content only.',
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
      levels: { Remember: 22, Understand: 17, Apply: 16 }, // FDE ToS by question, CAE 2026 pp.34-36 (bd-5jmnfj.26)
      answer_on: 'answer_sheet',
      note_en: null,
      slots: [
        {
          slot: 'english.C.Q3', label_en: 'Q.3:', label_ur: 'سوال 3', // needs fluent-Urdu review
          levels: { Remember: 2, Understand: 2, Apply: 1 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Punctuate the following passage.', marks_line_en: '({t:5})',
          type: 'Punctuation', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'one or two sentences (about 25 words) with capitals, full stops, a question or exclamation mark, commas and an apostrophe removed', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = the unpunctuated passage (lower case, no punctuation), `answer` = the punctuated passage: the printed words exactly, only capitals and punctuation added, nothing reworded, added or dropped; never turn a reported question into direct speech. A points only, one per mark, each for punctuation the printed words can carry (a question mark only where the printed words ask a direct question). No point pays a mark already printed in `question`: the printed passage keeps any apostrophe it shows, so no point is for that apostrophe (v35: "it\'s" was printed and paid). An end-mark point never needs one particular mark where two are right: it accepts a full stop or an exclamation mark after a statement, and asks for a question mark only after the direct question.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q4', label_en: 'Q.4:', label_ur: 'سوال 4', // needs fluent-Urdu review
          levels: { Remember: 4, Understand: 3, Apply: 3 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Use any five of the following words in meaningful sentences.', marks_line_en: '({t:10})',
          type: 'Word Sentences', category: 'subjective', shape: 'words',
          in_item_choice: { n: 5, g: 6 }, generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'six unit vocabulary words, any five used in sentences', number_size: 'six words', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `words` = exactly six words from units 1–10; `answer` = one model sentence per word, no definitions. 2 marks a word: the sentence shows what the word means 1 + the sentence is correct 1. The paper asks only for sentences, so never ask for, or mark, a written meaning.',
          print_words: true,
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q5', label_en: 'Q.5', label_ur: 'سوال 5', // needs fluent-Urdu review
          levels: { Remember: 2, Understand: 1, Apply: 1 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Write down FOUR rhyming words from the poem “{q}”', marks_line_en: '({t:4})',
          type: 'Rhyming Words', category: 'subjective', shape: 'words',
          generate: 1, attempt: 1, marks_each: 4, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'match four cue words to their rhymes in a 9–10 line poem from the book', number_size: 'four cue words', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'One item: `question` = the title of a poem from units 1–10 exactly as in the book; `passage` = 6–10 of its lines exactly as printed in the book, holding at least two rhyming pairs; no `words` (the four rhyming words are the answer, so nothing on the paper may list them); `answer` = the four rhyming words as two pairs, each word copied from the passage (e.g. "white – night; wet – yet").',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q6', label_en: 'Q.6:', label_ur: 'سوال 6', // needs fluent-Urdu review
          levels: { Remember: 2, Understand: 2, Apply: 1 }, // FDE splits this question across levels (bd-5jmnfj.26)
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
          levels: { Remember: 4, Understand: 3, Apply: 3 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Attempt {w:ONE} of the following.', marks_line_en: '({t:10})',
          type: 'Application Writing', category: 'subjective', shape: 'composition',
          generate: 2, attempt: 1, marks_each: 10, parts: null,
          numbering: 'alpha_paren', compulsory: false, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a formal application OR an informal letter from FDE\'s closed lists', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['application', 'letter'],
          prompt_rule: 'Two items: (a) "Write an application to your principal for …" with a topic from closed_lists.applications; (b) "Write a letter …" with a topic from closed_lists.informal_letters. The paper sets no length, so the key awards no mark for length and states no sentence or word count.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: true,
        },
        {
          slot: 'english.C.Q8', label_en: 'Q.8:', label_ur: 'سوال 8', // needs fluent-Urdu review
          levels: { Remember: 4, Understand: 3, Apply: 3 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Write a paragraph on any ONE of the following topics.', marks_line_en: '({t:10})',
          type: 'Paragraph Writing', category: 'subjective', shape: 'composition',
          in_item_choice: { n: 1, g: 3 }, generate: 1, attempt: 1, marks_each: 10, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'three paragraph topics from FDE\'s closed list; the child writes one', number_size: 'three topics', steps: 1, unit_choice: false },
          families: null, kinds: ['paragraph'],
          prompt_rule: 'One item: `topics` = three different titles from closed_lists.paragraphs, exactly as listed. The paper sets no length, so the key awards no mark for length, and the model answer states no sentence count or range (never "three to five supporting sentences"); a content point pays any N relevant ideas, 1 each, up to the marks it carries, and says so.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q9', label_en: 'Q.9:', label_ur: 'سوال 9', // needs fluent-Urdu review
          levels: { Remember: 2, Understand: 1, Apply: 2 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Develop a story with a moral from the given outline. Also suggest a suitable title.', marks_line_en: '({t:5})',
          type: 'Story Writing', category: 'subjective', shape: 'composition',
          generate: 1, attempt: 1, marks_each: 5, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'an outline of 8–12 cues separated by dashes, ending with "Moral"', number_size: 'none', steps: 1, unit_choice: false },
          families: null, kinds: ['story_outline'],
          prompt_rule: 'One item: `question` = the outline, 8–12 short cues separated by " — ", ending "— Moral". No title. The outline shares the theme or events of the Q2 passage with no other part of the paper: write it about a different place, characters and moral from the Q2 passage (v37: both were a child freeing a hurt bird, kindness, the bird singing next morning).',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
        {
          slot: 'english.C.Q10', label_en: 'Q.10:', label_ur: 'سوال 10', // needs fluent-Urdu review
          levels: { Remember: 2, Understand: 2, Apply: 2 }, // FDE splits this question across levels (bd-5jmnfj.26)
          instruction_en: 'Describe the picture with the help of the given word bank. Use at least four of the words. Also suggest a suitable title.', marks_line_en: '({t:6})',
          type: 'Picture Description', category: 'subjective', shape: 'frame',
          generate: 1, attempt: 1, marks_each: 6, parts: null,
          numbering: 'none', compulsory: true, lines: 0, work_mm: null, section_pages: 'scope',
          grain: { kind: 'a nine-word bank for an everyday scene (classroom, park, market)', number_size: 'eight to ten words', steps: 1, unit_choice: false },
          families: null, kinds: ['picture_description'],
          prompt_rule: 'One item: `question` = a one-line scene for the teacher (e.g. "children painting in an art lesson"), `words` = 8–10 words a child would use to describe that scene. The paper prints a frame and the word bank; a picture of the scene prints in the frame (the teacher adds one if it cannot be drawn). Never describe the picture to the child. `describe_en` = a short English description of the scene that names the things behind the words, drawn as a plain black outline picture in the frame; it is never shown to the child. The model answer states only what `describe_en` lists, so `describe_en` says how many of each person or thing there are, where they are, and whether a seat is empty ("two children on the swings, an empty bench beside the slide"), and the answer adds no person, count or place it leaves out (v35: the key put a child on a bench the picture shows empty).',
          frame: {
            kind: 'picture', height_mm: 70, lines: 0, book_page: null, word_bank: true,
            title_en: 'Picture (pasted or drawn by the teacher)',
            title_ur: 'تصویر (استاد چسپاں کریں یا بنائیں)', // needs fluent-Urdu review
            supply_en: 'Picture: {q}', supply_ur: 'تصویر: {q}', // ur: needs fluent-Urdu review
            duty_en: 'the picture', duty_ur: 'تصویر', // ur: needs fluent-Urdu review
          },
          teacher_note_en: 'Paste or draw a picture that fits the word bank in the frame before photocopying.',
          teacher_note_ur: 'فوٹو کاپی سے پہلے مددگار الفاظ سے میل کھاتی کوئی تصویر خانے میں چسپاں کریں یا بنائیں۔', // needs fluent-Urdu review
          alternatives: null, or: false,
        },
      ],
    },
  ],
};

module.exports = {
  ENGLISH,
};
