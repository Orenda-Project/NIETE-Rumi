/**
 * The rules a board-pattern section prompt carries (the panel's paper defects, turned into
 * prompt sentences). Each test builds the user prompt for one section through
 * buildPatternUserPrompt and asserts the sentence is present or absent.
 */

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const CHAPTERS = { kind: 'chapters', chapters: [3], pages: null };
const PAGES = { kind: 'pages', chapters: null, pages: '40-52' };

function prompt(subject, sectionId, scope = FDE) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope,
  });
}

const CHAPTER_ONLY = 'Set every item only from the pages above. Where a slot\'s rule names a unit or topic outside them, keep the slot\'s kind and marks and set the item from these pages (the nearest skill they hold).';
const FAMILIES = 'Q2\'s twelve items are four families of three';
const SCAFFOLD = 'Never write scaffold phrases such as \'based on the passage\', \'based on the text\', \'mentioned in the text\', \'according to the passage\' in a stem. Ask the question directly.';
const Q2B = 'Write each situation\'s three sub-questions as objects { question, answer, marks: 2.5, scheme } where scheme.points sum to 2.5; do not prefix a sub-question with a letter.';
const PICKS = 'For each pick kind ask for the count needed plus two extra, copied exactly as the words appear in the passage (same spelling, same form).';
const GENDER_EN = 'A child or a person in a stem is \'a child\', \'a student\', \'they\', or a named character. Never she/he, his/her for an unnamed person.';
const GENDER_UR = 'کسی نامعلوم شخص کے لیے صنفی فعل استعمال نہ کریں؛ \'آپ … کریں\' یا نام والا کردار استعمال کریں۔';
const ANAGRAM = 'An anagram, homophone or spelling MCQ has exactly one option that satisfies the stem.';
const UNDERLINE = 'Never refer to an underlined, bold or italic word; name the word in the stem instead.';
const SCIENCE_Q3 = 'Q3(a): two of the three long questions are Remember (state, name, define with the book\'s wording); one is Understand. Q3(b): the short questions are reasoning items (\'Why…\', \'What would happen if…\', \'Is … natural or artificial? Give a reason\') so that the paper carries Apply marks.';
const UNEQUAL = 'MCQ options are pairwise unequal in value (no two options that simplify to the same number, no 2/5 and 6/15) and written in simplest form.';
const NO_REPEATS = 'No item repeats another item\'s content, numbers or answer on this paper, in any section.';
const SPREAD = 'Spread the correct options across a, b, c and d; no letter holds more than a third of the keys.';
const SST_Q56 = 'Q5 and Q6 are situations, \'why\' questions and comparisons that need the child to use a concept, not name or list it; at most one of each slot\'s items is a list.';
const ACCEPT = '`accept` lists real alternative answers or methods, never \'as per the book\' or \'any correct answer\'.';

describe('pattern prompt rules', () => {
  test('chapter scope: no families rule, the chapter-only sentence present', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      for (const id of ['B', 'C']) {
        const text = prompt('maths', id, scope);
        expect(text).not.toContain(FAMILIES);
        expect(text).toContain(CHAPTER_ONLY);
      }
    }
  });

  test('fde scope: families rule present, no chapter-only sentence', () => {
    for (const id of ['B', 'C']) {
      const text = prompt('maths', id, FDE);
      expect(text).toContain(FAMILIES);
      expect(text).not.toContain(CHAPTER_ONLY);
    }
  });

  test('urdu chapter scope: no pages 28–107 sentence', () => {
    const pages = `Set items only from book pages ${P.urdu.scope.page_ranges}`;
    expect(prompt('urdu', 'A', FDE)).toContain(pages);
    const text = prompt('urdu', 'A', CHAPTERS);
    expect(text).not.toContain(pages);
    expect(text).toContain('never lessons 1, 2 or 3');
    expect(text).toContain(CHAPTER_ONLY);
  });

  test('scaffold phrases forbidden', () => {
    for (const [s, id] of [['english', 'B'], ['science', 'C'], ['urdu', 'B']]) expect(prompt(s, id)).toContain(SCAFFOLD);
  });

  test('science Q2(b) asks for objects with a 2.5 scheme', () => {
    expect(prompt('science', 'B')).toContain(Q2B);
    expect(prompt('science', 'C')).not.toContain(Q2B);
    expect(prompt('maths', 'B')).not.toContain(Q2B);
  });

  test('picks need plus two verbatim', () => {
    expect(prompt('english', 'B')).toContain(PICKS);
    expect(prompt('urdu', 'B')).toContain(PICKS);
    expect(prompt('english', 'A')).not.toContain(PICKS);
  });

  test('gender-neutral stems rule present (en)', () => {
    for (const s of ['english', 'science', 'maths', 'social_studies']) expect(prompt(s, 'A')).toContain(GENDER_EN);
    expect(prompt('english', 'A')).not.toContain(GENDER_UR);
  });

  test('gender-neutral stems rule present (ur)', () => {
    const text = prompt('urdu', 'A');
    expect(text).toContain(GENDER_UR);
    expect(text).toContain(GENDER_EN);
  });

  test('one-key anagram rule', () => {
    expect(prompt('english', 'A')).toContain(ANAGRAM);
    expect(prompt('urdu', 'A')).toContain(ANAGRAM);
    expect(prompt('english', 'C')).not.toContain(ANAGRAM);
  });

  test('no underline reference', () => {
    for (const [s, id] of [['english', 'A'], ['english', 'C'], ['urdu', 'C'], ['science', 'C']]) expect(prompt(s, id)).toContain(UNDERLINE);
  });

  test('science Q3 kinds rule', () => {
    expect(prompt('science', 'C')).toContain(SCIENCE_Q3);
    expect(prompt('science', 'B')).not.toContain(SCIENCE_Q3);
    expect(prompt('social_studies', 'C')).not.toContain(SCIENCE_Q3);
  });

  test('options pairwise unequal', () => {
    expect(prompt('maths', 'A')).toContain(UNEQUAL);
    expect(prompt('maths', 'B')).not.toContain(UNEQUAL);
  });

  test('no repeats rule', () => {
    for (const [s, id] of [['maths', 'A'], ['maths', 'C'], ['social_studies', 'D']]) expect(prompt(s, id)).toContain(NO_REPEATS);
  });

  test('spread keys rule', () => {
    expect(prompt('science', 'A')).toContain(SPREAD);
    expect(prompt('science', 'C')).not.toContain(SPREAD);
  });

  test('sst Q5-Q6 kinds rule', () => {
    expect(prompt('social_studies', 'C')).toContain(SST_Q56);
    expect(prompt('social_studies', 'D')).toContain(SST_Q56);
    expect(prompt('social_studies', 'B')).not.toContain(SST_Q56);
    expect(prompt('science', 'C')).not.toContain(SST_Q56);
  });

  test('accept means alternatives', () => {
    expect(prompt('maths', 'C')).toContain(ACCEPT);
    expect(prompt('science', 'B')).toContain(ACCEPT);
  });

  test('the plain prompt carries none of the pattern rules', () => {
    const plain = Gen.buildUserPrompt({ grade: 5, subject: 'maths', pageContent: 'Book text.', pageReference: '1-20' });
    for (const rule of [CHAPTER_ONLY, SCAFFOLD, GENDER_EN, UNDERLINE, NO_REPEATS, ACCEPT, SPREAD]) expect(plain).not.toContain(rule);
  });
});
