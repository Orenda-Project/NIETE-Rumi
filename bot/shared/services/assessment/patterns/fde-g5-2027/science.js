'use strict';
// Part of fde-g5-2027.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

// ────────────────────────────── Science ──────────────────────────────

const SCIENCE = {
  key: 'science',
  medium: 'en',
  name_en: 'Science',
  name_ur: 'سائنس', // needs fluent-Urdu review
  total_marks: 100,
  tos: { Remember: 30, Understand: 30, Apply: 40 }, // FDE's table of specification, % of marks by level (GRADE V MODEL PAPERS CAE 2026)
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    covers_partial_en: 'Covers {units}; every section set from these chapters.',
    title_en: 'Grade 5 · Science · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · سائنس · FDE pattern کا مشقی پرچہ', // operator rule 15 Oct: «pattern» in Latin, never طرز; rest needs fluent-Urdu review
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
          prompt_rule: 'Twenty four-option MCQs from chapters 1–6 only (Skill Sharpener and Mastery Challenge included); 3 to 5 of them pure recall. Never set an item on chapter 7 here. Detailed respiratory (alveoli) or circulatory (chambers, valves) knowledge is not required. An item never states a marking point of a Section C answer, nor a key of a Section B answer: no stem or option prints a word, a number or a name that another item\'s key asks for (the fuels a child names, the feeding order or a label of a food chain, the group a microorganism belongs to, the parts of a body system, a conductor or the gap in a circuit). Physical or chemical change is tested in at most 2 items of the whole paper, transparent, translucent and opaque in at most 2, the respiratory system is labelled once, and the Sun\'s heat trapped by greenhouse gases is a key point of one item only. A disease item never asks which disease is contagious or non-contagious with malaria (carried by a mosquito) or cholera (carried by water) among the options: set diabetes against measles, influenza, chickenpox or mumps. No MCQ tests a concept that a Section B or Section C question of this paper asks, and no stem or option states a fact that a later question asks the child to explain. Each concept (physical or chemical change, vaccines, light and materials) is asked at most twice in the whole paper, never by two items of one section; a stem never states another item\'s answer. Round 6 (v37): Section A uses its own objects and settings, never an object or example named in Section B or C (a ceramic mug in an MCQ is not also the written example). Biodegradable and non-biodegradable is asked in at most two items of the whole paper. Round 7 (v37): an item never prints the word a Section B or C key asks for, in the stem or in any option: a window that is frosted with blurry shapes (the key is translucent), a vaccine that teaches the body to recognise and fight a germ, tiny organisms that turn leaves into soil, banana peel that rots, waves with the lowest crests (the key is a low amplitude) are all another item\'s answer, so Section A asks those concepts through a different object, a different setting and different words, or leaves them to Sections B and C. Round 8 (v38): no stem or option names a word that is the answer to a Section B or Section C item; check every stem and option against the keys of Q2 (b) and Q3 before writing it, and set the item on another word.',
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
          prompt_rule: 'One item, and always the symbols of a circuit diagram, because the paper draws that picture itself: `question` is "Symbols used in a circuit diagram", `book_page` the book page it is on, `answer` exactly the five labels in this order: "1. Wire, 2. Cell, 3. Closed switch, 4. Open switch, 5. Lamp" (wire, cell, closed switch, open switch and lamp). The paper draws the five numbered symbols in the frame, so no item depends on a picture a teacher must draw or paste: never another diagram here (never the layers of the Earth, a food chain or a body part). Never describe the picture and never send the child to a picture.',
          frame: {
            kind: 'diagram', height_mm: 70, lines: 5, word_bank: false,
            title_en: 'Diagram: {q}',
            title_ur: 'خاکہ: {q}', // needs fluent-Urdu review
            supply_en: 'Diagram: {q}', supply_ur: 'خاکہ: {q}', // ur: needs fluent-Urdu review
            duty_en: 'the diagram to label', duty_ur: 'نشان دہی والا خاکہ', // ur: needs fluent-Urdu review
          },
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
          prompt_rule: 'Two items, each just the name of a diagram the child draws and labels from chapters 1–7 (e.g. "Respiratory System", "Food Chain"). The scheme lists the labels expected (L points). Not the detailed alveoli or heart chambers. A food chain names exactly four living things, starting with a plant; the scheme lists exactly the asked count of labels and never the word "arrows". The two alternatives are equal: the labels a stem asks are exactly the label marks its scheme pays (for a 7-mark item with a 2-mark drawing, 5 labels), and both alternatives carry the same drawing marks and label marks. The respiratory system is drawn and labelled here only, so Q1 (b) is never the respiratory system. Round 7 (v37): labels are the Grade 5 book\'s own terms: the layers of the Earth are keyed crust, mantle, outer core and inner core, never continental or oceanic plate, and crust is never listed as a common error; the stem asks only as many labels as the scheme pays.',
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
          prompt_rule: 'Three situations, each from a different one of these book activities only: textures and sounds; spreading diseases; microorganisms at work; how pollution affects our world; solubility and state changes; rusting; physical vs chemical change; shadow and transparency; magnets. Each item: `question` = the situation in words (what the child does and sees), `questions` = three sub-questions, each an object {question, answer, scheme: {points, accept, common_error}} whose points add up to 2.5; a sub-question\'s `question` carries no letter or number in front (the paper letters them a, b, c). Never refer to a picture. Each concept (physical or chemical change, vaccines, light and materials) is asked at most twice in the whole paper, never by two items of one section; a stem never states another item\'s answer. Round 6 (v37): biodegradable and non-biodegradable is asked in at most two items of the whole paper. Round 7 (v37): a stem states only true science (warm milk left two days does not stay as milk: it sours or spoils, so a control jar is a jar with no yoghurt that stays unchanged for the hour of the activity, never "two days as milk"). Every sub-question writes its `scheme.points`, one point per idea the answer needs (two or three), adding to 2.5; never leave `points` empty and never one point that copies the model answer. A "how do you know" or "why" key accepts each reasonable idea the question allows (a child who says the bird sound differs from the car horn in pitch or loudness is right as well as the child who says the ears send signals to the brain), each idea its own point or accept line. Two items of the paper never pay the same key fact: bacteria turning milk into yoghurt, or fungi breaking down dead matter, is the key of one item only (Q3 (a) 4 asks microorganisms, so no situation here repeats it). Round 8 (v38): Q2 (b) offers one level of choice: the child answers any two of the three sub-questions, and no sub-question offers a choice inside it. Every item in an "any N of M" set asks for the same kind and amount of work at the same marks. The marks are given in whole marks per part where the key allows (a part of 2.5 is two points, 1.5 and 1), never one all-or-nothing half-mark row. An accept line belongs to the part it names, and a common_error fits its own part (a wrong idea a child could hold about that part). A key pays only what the stem asks and pays one fact once.',
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
          prompt_rule: 'Ten short-answer questions from chapters 1–6, one or two per chapter. Key points (K) that add to 5 marks each. A point pays only what the stem asks: never the form a thing comes in (an injection, a pill), never a restatement of the stem. Accept lines name what a child in Islamabad meets (petrol, diesel and LPG as fossil fuels; the polio vaccine drops). A feeding order in a key is true (a hawk never eats a fox). A question asks for one thing of a topic another item pays for: the Sun\'s heat trapped by greenhouse gases is paid in one item only. Each concept (physical or chemical change, vaccines, light and materials) is asked at most twice in the whole paper, never by two items of one section; a stem never states another item\'s answer. Round 6 (v37): a compare item has exactly one difference point and one likeness point, so the marks match the demand. Contagious means passing from person to person: malaria is carried by a mosquito and cholera by contaminated water, so neither is keyed as contagious. For protection against polio, polio is prevented by the vaccine (polio drops); clean water is the second way. Round 7 (v37): a question never fixes a count for a classification the paper extends elsewhere: pollution is air, water and soil, and noise is also pollution, so ask for "any three" kinds, never "the three main forms". Two items never pay the same key fact: what a microorganism does (bacteria turn milk to yoghurt, fungi break down dead matter) is the key of one item only, so a Section B situation that already asks it means Q3 (a) asks another topic. Round 8 (v38): each mark is one distinct point the question asks for: a key never splits one idea into several marks, pays one fact once, and pays only what the stem asks (never a point the stem does not ask for). Every item in an "any N of M" set asks for the same kind and amount of work at the same marks. A stem never prints the keyed answer of another Section B or Section C item. Section C never re-asks a topic task already in Section B: if a Section B item asks for the respiratory parts, what a magnet picks up or what fossil fuels do to the Earth\'s temperature, no Section C item asks the same task in other words.',
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
          prompt_rule: 'Five explain/discuss questions from chapters 1–6 needing a 6–10 sentence answer; the scheme lists the key points (K) a full answer contains, adding to 9. A key pays only for points the stem asks: never a point that repeats the stem (stroking in one direction, a cork) and never an unasked point (the magnetism fading; reuse or plastic substitutes when the stem asks about sorting, recycling and biodegradable items). A model answer never says that animals hear louder noises than humans; it says loud noise harms animals. Never pay for battery direction (positive and negative terminals) in a one-battery, one-bulb circuit; there only a closed loop, a working battery and a conductor matter. Each concept (physical or chemical change, vaccines, light and materials) is asked at most twice in the whole paper, never by two items of one section; a stem never states another item\'s answer. Round 6 (v37): compass answers keep the poles straight: the needle has a north-seeking end that is pulled towards Earth\'s magnetic pole in the north, never that Earth\'s magnetic north attracts the needle\'s north end. A bulb that does not glow has a fused or loose bulb as one cause, never wires made of plastic or wood. Note that cholera spreads by contaminated water, not from person to person. Marks follow demand: a point that asks more earns more. Round 8 (v38): each mark is one distinct point the question asks for: a key never splits one idea into several marks, pays one fact once, and pays only what the stem asks (never a point the stem does not ask for). Every item in an "any N of M" set asks for the same kind and amount of work at the same marks. A stem never prints the keyed answer of another Section B or Section C item. Section C never re-asks a topic task already in Section B: if a Section B item asks for the respiratory parts, what a magnet picks up or what fossil fuels do to the Earth\'s temperature, no Section C item asks the same task in other words. Physical or chemical change: the test the key pays is whether a new substance forms (chemical) or no new substance forms (physical); reversibility is only a supporting sign, never the test.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
  ],
};

module.exports = {
  SCIENCE,
};
