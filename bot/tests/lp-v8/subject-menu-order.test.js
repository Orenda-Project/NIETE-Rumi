/**
 * bd-6640j.1.8.7 — the subject menu lists the core books first, then the electives, in one fixed order (TDD, red first).
 *
 * Amena, 9 Oct 2026: "make sure the menu shows English, Urdu, Math Science, GK Urdu, GK, SST English, SST Urdu,
 * Islamiat ... not just random subjects, first core and then electives". The catalog holds its books alphabetically,
 * so the menu mixed electives in among the core subjects.
 */
const C = require('../../shared/services/lp-v8-catalog.service');

const book = (grade, subject_key) => ({ grade, subject: subject_key, subject_key,
  chapters: [{ number: 1, title: 't', lessons: [{ lesson_id: `${grade}_${subject_key}_1` }] }] });
const KEYS = ['english', 'general_knowledge', 'general_knowledge_ur', 'general_science', 'islamiat', 'math',
  'social_studies_en', 'social_studies_ur', 'urdu'];

describe('buildSubjectItems — fixed order, core then electives', () => {
  afterAll(() => C.__setCatalogForTests(null));

  test('a grade with every book lists them core first, then the electives', () => {
    C.__setCatalogForTests({ books: [...KEYS, 'zz_new'].map((k) => book(4, k)) });
    const available = new Set([...KEYS, 'zz_new'].map((k) => `4_${k}_1`));
    expect(C.buildSubjectItems(4, available).map((i) => i.id)).toEqual(['english', 'urdu', 'math', 'general_science',
      'general_knowledge_ur', 'general_knowledge', 'social_studies_en', 'social_studies_ur', 'islamiat', 'zz_new']);
  });

  test('a book with nothing available is still left out', () => {
    C.__setCatalogForTests({ books: ['islamiat', 'math', 'english'].map((k) => book(1, k)) });
    expect(C.buildSubjectItems(1, new Set(['1_islamiat_1', '1_english_1'])).map((i) => i.id)).toEqual(['english', 'islamiat']);
  });
});
