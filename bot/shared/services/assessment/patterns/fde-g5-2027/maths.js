'use strict';
// Part of fde-g5-2027.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { NO_ITEMS_ON_BOOK_ACTIVITIES } = require('./common');

// ───────────────────────────── Mathematics ─────────────────────────────

const MATHS = {
  key: 'maths',
  medium: 'en',
  name_en: 'Mathematics',
  name_ur: 'ریاضی', // needs fluent-Urdu review
  total_marks: 100,
  tos: { Remember: 10, Understand: 50, Apply: 40 }, // FDE's table of specification, % of marks by level (GRADE V MODEL PAPERS CAE 2026)
  total_time_en: '3 hrs',
  total_time_ur: '3 گھنٹے', // needs fluent-Urdu review
  header: {
    title_en: 'Grade 5 · Mathematics · FDE pattern practice paper',
    title_ur: 'جماعت پنجم · ریاضی · FDE pattern کا مشقی پرچہ', // operator rule 15 Oct: «pattern» in Latin, never طرز; rest needs fluent-Urdu review
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
      // FDE's split for this section (ToS p.5-6 mapped onto the paper design p.12; bd-5jmnfj.19).
      levels: { Remember: 10, Understand: 30, Apply: 0 },
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
          grain: { kind: 'one concept per item: place value, rounding, factors, fraction and decimal comparison, percent to fraction, multiples, averages', number_size: 'whole numbers up to 7 digits; decimals to 3 places; fractions with denominators up to 10', steps: 1, unit_choice: false },
          families: null, kinds: null,
          prompt_rule: 'Twenty four-option MCQs across all included units, one concept each; 3 to 5 of them pure recall (a fact or a name). Never define a term in the stem and then ask what that definition states: the stem must not give away its own answer. Options are short (a number or a few words). The mean (average) appears in at most one item of the whole paper; a Section A statistics item asks the mode, median or range instead. No option states a method.  An MCQ never uses the numbers or fractions that a later compare, order or arrange item uses. No stem or option states a fact that a later item keys: a right angle is 90 degrees and a straight angle is 180 degrees are not asked here (Section C names them), nor is the decimal a written item asks the child to find.' + NO_ITEMS_ON_BOOK_ACTIVITIES + ' Round 6 (v37): No MCQ asks the cost of one item from a total, the change from a payment or the area of a triangle; Section B and C own those skills, so each is asked once on the whole paper.',
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
          prompt_rule: 'Ten one-step items, one per topic, in this order of kinds where the pages allow: expanded form; multiplication 5-digit × 1-digit; compare two fractions; HCF of two numbers; fraction × fraction; fraction to decimal; decimal addition; percent to decimal (a percent Section B does not use); median or range of five numbers (the mean is asked once, in Q7); "Draw an angle of N° with a protractor." (construction only, never "and name it"). 2 marks each: M1 + A1. Round 6 loop 2 (v37r2): never print a fraction, a percent or a number with a point that another item on the paper has as its answer, and no stem of Section B starts from the answer of one of these.  Compare, order and arrange items use fractions no Section A MCQ offers.' + NO_ITEMS_ON_BOOK_ACTIVITIES,
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
      levels: { Remember: 0, Understand: 20, Apply: 20 }, // FDE ToS (bd-5jmnfj.19)
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
          prompt_rule: 'Twelve 5-mark items from Units 1–8 as four families of three: for Units 1–2, 3–4, 5–6 and 7–8 one number-sense item, one computation and one word problem each. Include long division, long multiplication, LCM by the division method, a mixed-number subtraction and two unitary-method problems (many from one, one from many). Every word problem names its unit (Rs., km, litres) in the question. The child chooses any eight, so the twelve items are of equal demand (each a 5-mark two-or-three-step worked problem of similar working length; no item made of three trivial parts, no single long-multiplication-only item beside the others; no item far longer or shorter than the rest), none repeats a conversion Section A or B asks, and every price or count is plausible (a school buys 40 chairs, not 18,764). When the stem names a method (the division method, the vertical method) the accept line allows no other method. Compare, order and arrange items use fractions no Section A MCQ offers. Round 6 (v37): the number-sense item is never a bare "write in words"; it has 3 to 5 scoring steps (for example words plus rounding), as every item does, so the choice of eight does not change the score. No Q1 (b) skill (expanded form, one-step operations) repeats here. Rule: only one item on the whole paper asks for change from a payment and only one asks the cost of one from a total. Round 6 loop 2 (v37r2): a word problem names one container and one quantity throughout (jugs and litres, or a tank and litres, never water shared into jugs and then asked about "a tank"), and its question asks about the same thing the stem sets up. Every short item is one or two steps of similar size (one operation then at most one more); never an item of four or five steps beside a one-step unitary problem, because the child chooses any eight on equal marks. Never print a fraction, a percent or a number with a point that another item on the paper has as its answer (if Q1 (b) answers 0.35, no Q2 stem begins from 0.35): a conversion item here starts from a number no other item answers. Round 7 (v37r3): a method mark pays any correct method; the key names a method only where the stem names it (never "unitary method only", "vertical method" or "regrouping" when the stem does not), and a correct answer with no working still earns the answer mark, the working mark being for steps shown. When the answer is a mixed number or an improper fraction and the stem asks for no form, the key accepts the equal other form and the simplified one, and no A line demands one written form.',
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
      levels: { Remember: 0, Understand: 0, Apply: 20 }, // FDE ToS (bd-5jmnfj.19)
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
          // FDE prints Q4's angles as i) ii) iii) so the teacher marks the two chosen (CAE 2026 p.11, bd-5jmnfj.11).
          sub_numbering: 'roman',
          section_pages: 'units:11-12',
          grain: { kind: 'one each: draw and identify angles, area, perimeter, average, missing angle', number_size: 'single or 2-digit lengths and values', steps: 2, unit_choice: true },
          families: null,
          kinds: ['draw', 'area', 'perimeter', 'average', 'missing_angle'],
          prompt_rule: 'Five items in this order, one of each kind: draw and identify any two of three named angles (three of acute, obtuse, reflex, a supplementary pair, a complementary pair): `question` = "Draw and identify any two of the following angles.", `questions` = exactly three strings chosen from "Acute angle", "Obtuse angle", "Reflex angle", "Supplementary angles", "Complementary angles" (acute, obtuse, reflex, a supplementary pair, a complementary pair), never a straight angle, with no letter or number in front (the paper numbers them i, ii, iii); the area of a parallelogram or a triangle; the perimeter of a rectangle or a square; the average of five values (the only mean on the paper); a missing angle stated in WORDS, on a pair Q4 does not name ("Two angles together make a right angle. One of them is 35°. Find the other angle and name the pair of those two angles."). A "name the pair" or "name it" request says exactly which pair or thing is to be named (the two angles that make the right angle, never "name that pair" after two different pairs have been mentioned), and the word the key expects for it is never printed in another item on the paper (the three named angles in Q4 never include the relation Q8 asks the child to name; if Q8 keys complementary, Q4 offers no "Complementary angles"). The area and perimeter items give every length with its unit (a base of 12 cm), and the answer carries the matching unit (cm², cm). Never send the child to a figure that is not printed. The missing-angle stem never names the relation it asks the child to name. Where a scheme pays for a unit, the unit is its own 1-mark point (U1), never folded into the answer point (A2). Round 6 (v37): obtuse = one angle between 90 and 180 degrees drawn with a protractor and named. Supplementary = TWO angles side by side on one straight line that add up to 180 degrees, both drawn and named. Complementary = TWO angles side by side that add up to 90 degrees, both drawn and named. Acute = one angle under 90 degrees, reflex = one angle between 180 and 360 degrees, each drawn with a protractor and named. Round 6 (v37 maths): the angle choices are of equal demand and the scheme pays each by the same steps. Pay is equal per angle: M2 for the figure drawn as described (for supplementary M1 for each of the two angles), A0.5 for the name. The key never says "first angle" or "second angle" for a single chosen angle and never describes supplementary as one angle. Every Section C item needs at least two working steps beyond one formula (a missing side, a total of two areas, a cost). Round 6 (v37 maths): every item under "any three" has two linked steps worth the 5 marks, never a one-step item beside two-part items: the average item is the average then a comparison (which value is above the average, or by how much); the missing-angle item is a missing angle then a second angle (name the pair, then find the angle that completes it). No skill (area of a triangle, perimeter) appears in both Section A and Section C. Round 6 loop 2 (v37r2): every Section C question needs at least two steps, find and use a quantity, then answer: the area item first finds a missing length (the base from a given area, or one side of a rectangle from its perimeter) then the area; the perimeter item first finds a missing side then the perimeter or the cost of fencing it; the average item the average then a comparison. Never a single formula with the numbers given, since the child may take any three and the marks are the same.',
          frame: null, teacher_note_en: null, teacher_note_ur: null, alternatives: null, or: false,
        },
      ],
    },
  ],
};

module.exports = {
  MATHS,
};
