/**
 * bd-6640j.1.3 — electives ship in two media; the menu names each one (TDD, red first).
 *
 * Amena, 3 Oct 2026: Urdu-medium General Knowledge is "واقفیتِ عامہ" and the
 * English one stays "General Knowledge"; Social Studies is "Social Studies (Urdu)"
 * and "Social Studies (English)", so a teacher picks her book by its medium.
 * Two books of one subject must not share a subject_key, or bookFor() finds the
 * first and the second medium is unreachable.
 */

const B = require('../../scripts/build-lp-catalog');

describe('bookMenu — menu name, key and direction for one book', () => {
  test.each([
    ['General Knowledge', 'ur', 'واقفیتِ عامہ', 'general_knowledge_ur', true],
    ['General Knowledge', 'en', 'General Knowledge', 'general_knowledge', false],
    ['Social Studies', 'ur', 'Social Studies (Urdu)', 'social_studies_ur', true],
    ['Social Studies', 'en', 'Social Studies (English)', 'social_studies_en', false],
  ])('%s / %s', (subject, medium, name, key, rtl) => {
    expect(B.bookMenu({ subject, medium })).toEqual({ subject: name, subject_key: key, rtl });
  });

  test('the core books keep their names, keys and direction', () => {
    expect(B.bookMenu({ subject: 'Maths', medium: 'en' })).toEqual({ subject: 'Maths', subject_key: 'math', rtl: false });
    expect(B.bookMenu({ subject: 'English' })).toEqual({ subject: 'English', subject_key: 'english', rtl: false });
    expect(B.bookMenu({ subject: 'Urdu', medium: 'ur' })).toEqual({ subject: 'Urdu', subject_key: 'urdu', rtl: true });
  });

  test('an elective without a medium fails the build instead of colliding', () => {
    expect(() => B.bookMenu({ subject: 'Social Studies' })).toThrow(/medium/);
    expect(() => B.bookMenu({ subject: 'General Knowledge', medium: 'fr' })).toThrow(/medium/);
  });

  test('every elective menu name fits the 30-code-point title', () => {
    for (const [s, m] of [['General Knowledge', 'ur'], ['General Knowledge', 'en'], ['Social Studies', 'ur'], ['Social Studies', 'en']]) {
      expect([...B.bookMenu({ subject: s, medium: m }).subject].length).toBeLessThanOrEqual(B.TITLE_CAP);
    }
  });
});

describe('subjectTitle — the name a screen header prints', () => {
  const C = require('../../shared/services/lp-v8-catalog.service');
  beforeAll(() => C.__setCatalogForTests({ books: [{ grade: 4, subject: 'Social Studies (English)', subject_key: 'social_studies_en', chapters: [] }] }));
  afterAll(() => C.__setCatalogForTests(null));

  test('the book\'s menu name', () => expect(C.subjectTitle('4', 'social_studies_en')).toBe('Social Studies (English)'));
  test('the key itself when no book matches', () => expect(C.subjectTitle(5, 'social_studies_en')).toBe('social_studies_en'));
});
