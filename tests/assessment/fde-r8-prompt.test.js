/**
 * Round-4 prompt rules for board-pattern sections (the panel's round-3 paper defects).
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
const ALL_SCOPES = [FDE, CHAPTERS, PAGES];
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
const slotOf = (subject, id) => P[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);

const Q2_WORDS = 'In Q2, at least 7 of the 12 items are short word problems set in a situation a Grade 5 child knows (shopping, measuring, time, sharing, travel), in which the child decides which operation(s) to use; the other items stay calculations.';
const Q2_FAMILIES = 'Each Q2 family keeps its word problem; set 3 more of the families\' number-sense or computation items as such word problems, keeping the skill they test.';
const Q1B_WORDS = 'In Q1(b), at least 4 of the 10 items are one-step word problems set in a situation a Grade 5 child knows (shopping, measuring, time, sharing, travel), in which the child decides which operation to use.';
const PAGES_POINTS = 'Q1(a) and Q1(b) test only the grammar and word-study points these pages teach. Before writing, list those points to yourself; the reply is still the JSON only.';
const PAGES_REST = 'If the pages teach fewer points than there are items, set the rest on the pages\' vocabulary and comprehension. Never test grammar the pages do not teach.';
const ONE_KEY_EN = 'A homophone or spelling MCQ has exactly one option that satisfies the stem.';
const ONE_KEY_ANAGRAM = 'An anagram, homophone or spelling MCQ has exactly one option that satisfies the stem.';
const Q5_POEM = 'Q5 uses a poem printed in the book. If these pages hold no poem, take the nearest poem in the syllabus, name its unit in the title, and print its lines verbatim; never write verse and never call prose a poem.';
// Maths on chosen chapters or pages: FDE's Q1(b) and Q2 topic lists go; the topics come from the pages.
const MATHS_PAGES_AB = 'Q1(b) and Q2 are set from the pages above: keep each slot\'s marks and item shape (a word problem stays a word problem, a calculation a calculation) and take every topic from these pages. The word-problem counts above still apply.';
const Q1B_MODEL_TOPICS = ['expanded form', 'HCF', 'fraction × fraction', 'percent to decimal', 'average of five numbers', 'Draw an angle'];
const Q2_MODEL_TOPICS = ['Units 1–8', 'four families', 'Families, in this order', 'family', 'long division', 'long multiplication', 'LCM', 'mixed-number subtraction', 'unitary-method', 'a percentage word problem'];
const NO_ANAGRAM = 'Never set an item that asks the child to rearrange, unscramble or reorder letters to make a word.';
// FDE's model-paper topic lists for Q1(a) and Q1(b), as the pattern module carries them.
const Q1A_TOPICS = 'covering: collective and proper nouns, articles, irregular plurals, antonyms';
const Q1B_TOPICS = 'Cover similes/metaphors, S+V+O and simple present/past.';
const Q1B_GRAIN = 'rewrite as a simile, identify subject + verb + object, change the tense';

describe('round-4 pattern prompt rules', () => {
  test('maths Q2: counted word-problem slots, every scope', () => {
    // The count is read from the pattern, not typed: half of Q2's generated items, rounded up, plus one.
    const q2 = slotOf('maths', 'maths.B.Q2');
    expect(Math.ceil(q2.generate / 2) + 1).toBe(7);
    for (const scope of ALL_SCOPES) {
      const text = prompt('maths', 'B', scope);
      expect(text).toContain(Q2_WORDS);
      // Marks and counts stay as the pattern has them.
      expect(text).toContain('generate EXACTLY 12 items');
      expect(text).toContain('5 marks each');
      for (const id of ['A', 'C']) {
        expect(prompt('maths', id, scope)).not.toContain(Q2_WORDS);
        expect(prompt('maths', id, scope)).not.toContain(Q2_FAMILIES);
      }
    }
    // Four families carry four word problems; the other three of the seven come from their other items.
    // Families are FDE's syllabus, so the sentence is asked on FDE scope only.
    expect(q2.families).toHaveLength(4);
    expect(prompt('maths', 'B', FDE)).toContain(Q2_FAMILIES);
  });

  test('maths chapter scope: Q1(b) and Q2 from the pages, not the model topics', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      const a = prompt('maths', 'A', scope);
      const b = prompt('maths', 'B', scope);
      for (const text of [a, b]) expect(text).toContain(MATHS_PAGES_AB);
      for (const t of Q1B_MODEL_TOPICS) expect(a).not.toContain(t);
      for (const t of Q2_MODEL_TOPICS) expect(b).not.toContain(t);
      expect(b).not.toContain(Q2_FAMILIES);
      // Slots, counts, marks and the word-problem counts stay.
      expect(a).toContain('tag every item "slot": "maths.A.Q1b"');
      expect(a).toContain('generate EXACTLY 10 items');
      expect(a).toContain(Q1B_WORDS);
      expect(b).toContain('tag every item "slot": "maths.B.Q2"');
      expect(b).toContain('Choice: the child chooses 8 of 12');
      expect(b).toContain(Q2_WORDS);
      expect(b).toContain('Every word problem names its unit');
      expect(prompt('maths', 'C', scope)).not.toContain(MATHS_PAGES_AB);
    }
  });

  test('maths fde scope keeps the model topics', () => {
    const a = prompt('maths', 'A', FDE);
    const b = prompt('maths', 'B', FDE);
    for (const t of Q1B_MODEL_TOPICS) expect(a).toContain(t);
    for (const t of Q2_MODEL_TOPICS) expect(b).toContain(t);
    for (const id of sectionIds('maths')) expect(prompt('maths', id, FDE)).not.toContain(MATHS_PAGES_AB);
    for (const s of SUBJECTS.filter((x) => x !== 'maths')) {
      for (const id of sectionIds(s)) for (const scope of ALL_SCOPES) expect(prompt(s, id, scope)).not.toContain(MATHS_PAGES_AB);
    }
    // The pattern module itself is not edited: the lists are dropped at assembly only.
    expect(slotOf('maths', 'maths.B.Q2').prompt_rule).toContain('Units 1–8');
    expect(slotOf('maths', 'maths.A.Q1b').prompt_rule).toContain('HCF of two numbers');
  });

  test('maths Q1(b): at least 3 one-step word problems, every scope', () => {
    for (const scope of ALL_SCOPES) {
      const text = prompt('maths', 'A', scope);
      expect(text).toContain(Q1B_WORDS);
      expect(text).toContain('generate EXACTLY 10 items');
      expect(text).toContain('2 marks each');
      for (const id of ['B', 'C']) expect(prompt('maths', id, scope)).not.toContain(Q1B_WORDS);
    }
  });

  test('maths Section C kinds unchanged', () => {
    expect(prompt('maths', 'C', FDE)).toContain('Kinds, one each in this order: draw, area, perimeter, average, missing_angle');
    for (const scope of ALL_SCOPES) {
      expect(prompt('maths', 'C', scope)).not.toContain(Q2_WORDS);
      expect(prompt('maths', 'C', scope)).not.toContain(Q1B_WORDS);
    }
  });

  test('counted word-problem rules are maths only', () => {
    for (const s of SUBJECTS.filter((x) => x !== 'maths')) {
      for (const id of sectionIds(s)) {
        for (const scope of ALL_SCOPES) {
          const text = prompt(s, id, scope);
          expect(text).not.toContain(Q2_WORDS);
          expect(text).not.toContain(Q1B_WORDS);
        }
      }
    }
  });

  test('english chapter scope: FDE topic list dropped, points from the pages', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      const text = prompt('english', 'A', scope);
      expect(text).not.toContain(Q1A_TOPICS);
      expect(text).not.toContain(Q1B_TOPICS);
      expect(text).not.toContain(Q1B_GRAIN);
      expect(text).toContain(PAGES_POINTS);
      expect(text).toContain(PAGES_REST);
      // Slots, counts and marks stay.
      expect(text).toContain('tag every item "slot": "english.A.Q1a"');
      expect(text).toContain('tag every item "slot": "english.A.Q1b"');
      expect(text).toContain('generate EXACTLY 20 items');
      expect(text).toContain('generate EXACTLY 5 items');
      for (const id of sectionIds('english').filter((x) => x !== 'A')) {
        expect(prompt('english', id, scope)).not.toContain(PAGES_POINTS);
      }
    }
  });

  test('english fde scope keeps the topic list', () => {
    const text = prompt('english', 'A', FDE);
    expect(text).toContain(Q1A_TOPICS);
    expect(text).toContain(Q1B_TOPICS);
    expect(text).toContain(Q1B_GRAIN);
    expect(text).not.toContain(PAGES_POINTS);
    expect(text).not.toContain(PAGES_REST);
    // The pattern module itself is not edited: the lists are dropped at assembly only.
    expect(slotOf('english', 'english.A.Q1a').prompt_rule).toContain(Q1A_TOPICS);
    expect(slotOf('english', 'english.A.Q1b').prompt_rule).toContain(Q1B_TOPICS);
  });

  test('english anagram ban, every scope and section', () => {
    for (const scope of ALL_SCOPES) {
      for (const id of sectionIds('english')) expect(prompt('english', id, scope)).toContain(NO_ANAGRAM);
    }
    for (const s of SUBJECTS.filter((x) => x !== 'english')) {
      for (const id of sectionIds(s)) expect(prompt(s, id)).not.toContain(NO_ANAGRAM);
    }
  });

  test('english prompts never name anagrams, every scope', () => {
    for (const scope of ALL_SCOPES) {
      for (const id of sectionIds('english')) {
        const text = prompt('english', id, scope);
        // The only mention left is the ban itself.
        expect(text.replace(NO_ANAGRAM, '')).not.toMatch(/anagram/i);
      }
      expect(prompt('english', 'A', scope)).toContain(ONE_KEY_EN);
      expect(prompt('english', 'A', scope)).not.toContain(ONE_KEY_ANAGRAM);
    }
    // FDE scope keeps the rest of the Q1(a) topic list.
    expect(prompt('english', 'A', FDE)).toContain('modals, apostrophe, spelling, sentence types, quantifiers, adjectives');
    // Urdu keeps its one-key sentence unchanged; the pattern module keeps its wording.
    expect(prompt('urdu', 'A', FDE)).toContain(ONE_KEY_ANAGRAM);
    expect(slotOf('english', 'english.A.Q1a').prompt_rule).toContain('spelling, anagrams, sentence types');
  });

  test('english chapter scope: Q5 poem from the book', () => {
    for (const scope of [CHAPTERS, PAGES]) {
      const text = prompt('english', 'C', scope);
      expect(text).toContain(Q5_POEM);
      for (const id of sectionIds('english').filter((x) => x !== 'C')) expect(prompt('english', id, scope)).not.toContain(Q5_POEM);
    }
    expect(prompt('english', 'C', FDE)).not.toContain(Q5_POEM);
    for (const s of SUBJECTS.filter((x) => x !== 'english')) {
      for (const id of sectionIds(s)) expect(prompt(s, id, CHAPTERS)).not.toContain(Q5_POEM);
    }
  });

  test('plain prompt untouched by the round-4 rules', () => {
    for (const subject of SUBJECTS) {
      const text = Gen.buildUserPrompt({
        grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
        questionCount: 10, questionTypes: [], includeAnswerKey: true,
      });
      for (const s of [Q2_WORDS, Q2_FAMILIES, Q1B_WORDS, MATHS_PAGES_AB, PAGES_POINTS, PAGES_REST, NO_ANAGRAM, ONE_KEY_EN, Q5_POEM]) expect(text).not.toContain(s);
    }
  });
});
