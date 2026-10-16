/**
 * Round-3 prompt rules for board-pattern sections (the panel's round-2 paper defects).
 * Each test builds one section's user prompt through buildPatternUserPrompt, the same
 * assembly the engine sends, and asserts the sentence is present where it applies and
 * absent where it does not.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const CHAPTERS = { kind: 'chapters', chapters: [1, 2], pages: null };
const PAGES = { kind: 'pages', chapters: null, pages: '171-180' };
const SUBJECTS = ['maths', 'english', 'science', 'social_studies', 'urdu'];

function prompt(subject, sectionId, scope = FDE) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope,
  });
}
const sectionIds = (subject) => P[subject].sections.map((s) => s.id);

const SECTION_C = 'Section C is also set from the pages above: keep each slot\'s marks and item shape (a word problem stays a word problem, a calculation a calculation) and take the topic from these pages.';
const KINDS_LINE = 'Kinds, one each in this order:';
const FIXED_KINDS = 'Five items in this order, one of each kind';
const FAMILIES = 'Q2\'s twelve items are four families of three';
const GRAMMAR = 'Q1(a) grammar MCQs test only the grammar these pages teach. If the pages teach fewer grammar points than there are MCQs, set the rest on the pages\' vocabulary and comprehension. Never test grammar the pages do not teach.';
const TOS_FLOOR = 'Of the 100 marks, 8–12 are Remember (at least 8 of the 20 MCQs recall a definition, fact, formula or property name), at most 60 Understand, at least 30 Apply.';
const PROPERTY = 'For an MCQ that tests a property (divisible by, prime, factor, multiple, even, odd, greatest, smallest, rounded to, place value) exactly ONE option satisfies the stem; check every option before writing it.';
const UNITS = 'Every measurement stem names its unit (cm, m, kg, litres, rupees, degrees). Write mixed numbers as numerals, e.g. 5 2/3, never \'five and two thirds\' or \'5 and 2/3\'.';
const FRAME = 'Key labels come only from the book\'s figure; if the figure carries fewer parts than the frame has leader lines, ask for that smaller number.';
const GRADE5 = 'Use Grade 5 vocabulary; a term the book does not use (e.g. \'lactic acid\', \'electrons\') is replaced by the book\'s word.';

describe('round-3 pattern prompt rules', () => {
  test('maths chapter scope: Section C from pages, no fixed-kinds rule', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      const text = prompt('maths', 'C', scope);
      expect(text).toContain(SECTION_C);
      expect(text).not.toContain(KINDS_LINE);
      expect(text).not.toContain(FIXED_KINDS);
      expect(text).not.toContain(FAMILIES);
      // Every slot keeps its marks, count and shape.
      expect(text).toContain('tag every item "slot": "maths.C.Q4-8"');
      expect(text).toContain('tag every item "slot": "maths.C.Q3"');
      // Only Section C carries the sentence.
      for (const id of ['A', 'B']) expect(prompt('maths', id, scope)).not.toContain(SECTION_C);
    }
  });

  test('fde scope unchanged', () => {
    const text = prompt('maths', 'C', FDE);
    expect(text).not.toContain(SECTION_C);
    expect(text).toContain(`${KINDS_LINE} draw, area, perimeter, average, missing_angle`);
    expect(text).toContain(FIXED_KINDS);
    expect(text).toContain(FAMILIES);
    expect(prompt('english', 'A', FDE)).not.toContain(GRAMMAR);
  });

  test('english chapter scope: grammar-from-pages rule', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      expect(prompt('english', 'A', scope)).toContain(GRAMMAR);
      for (const id of ['B', 'C']) expect(prompt('english', id, scope)).not.toContain(GRAMMAR);
      expect(prompt('maths', 'A', scope)).not.toContain(GRAMMAR);
    }
  });

  test('maths ToS floor rule', () => {
    for (const scope of [FDE, CHAPTERS, PAGES]) {
      for (const id of sectionIds('maths')) expect(prompt('maths', id, scope)).toContain(TOS_FLOOR);
    }
    for (const s of SUBJECTS.filter((x) => x !== 'maths')) expect(prompt(s, 'A')).not.toContain(TOS_FLOOR);
  });

  test('maths recall count is one number', () => {
    // The floor's "at least 8 of the 20" is the only recall count a Maths MCQ section is given.
    for (const scope of [FDE, CHAPTERS]) {
      const text = prompt('maths', 'A', scope);
      expect(text).toContain(TOS_FLOOR);
      expect(text).not.toContain('include 3–5 straight recall MCQs');
      expect(text).not.toMatch(/3 to 5 of them pure recall/);
      expect(text).toContain('at least 8 of them pure recall (a fact or a name)');
    }
    // Every other subject keeps the 3–5 recall line.
    for (const s of ['science', 'english', 'social_studies', 'urdu']) {
      expect(prompt(s, 'A')).toContain('include 3–5 straight recall MCQs');
    }
  });

  test('one-key property MCQ rule', () => {
    for (const scope of [FDE, CHAPTERS]) expect(prompt('maths', 'A', scope)).toContain(PROPERTY);
    expect(prompt('maths', 'B')).not.toContain(PROPERTY);
    for (const s of SUBJECTS.filter((x) => x !== 'maths')) expect(prompt(s, 'A')).not.toContain(PROPERTY);
  });

  test('units and numerals rule', () => {
    for (const scope of [FDE, CHAPTERS]) {
      for (const id of sectionIds('maths')) expect(prompt('maths', id, scope)).toContain(UNITS);
    }
    for (const s of SUBJECTS.filter((x) => x !== 'maths')) expect(prompt(s, 'A')).not.toContain(UNITS);
  });

  test('frame labels from the figure rule', () => {
    // Science Q1(b) and Social Studies Q2 are frames, both in Section A.
    for (const scope of [FDE, CHAPTERS]) {
      expect(prompt('science', 'A', scope)).toContain(FRAME);
      expect(prompt('social_studies', 'A', scope)).toContain(FRAME);
    }
    expect(prompt('science', 'C')).not.toContain(FRAME);
    expect(prompt('social_studies', 'C')).not.toContain(FRAME);
    // English Q10 is a frame too, but the rule is the Science/SST one.
    expect(prompt('english', 'C')).not.toContain(FRAME);
  });

  test('grade-5 vocabulary rule', () => {
    for (const s of ['science', 'english']) {
      for (const id of sectionIds(s)) expect(prompt(s, id)).toContain(GRADE5);
    }
    for (const s of ['maths', 'social_studies', 'urdu']) expect(prompt(s, 'A')).not.toContain(GRADE5);
  });
});
