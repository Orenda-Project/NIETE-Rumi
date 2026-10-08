/**
 * bd-fmf24g.3 — ONE subject vocabulary for the teacher app v2.
 *
 * The same subject reaches the portal under five spellings, one per source:
 *
 *   her classes          class_teacher_subjects.subject_code   maths · science · social_studies
 *   K-5 lesson plans     catalogue subject_key / name          math · general_science / Math · General Science
 *   6-12 lesson plans    corpus free text                      Mathematics · mathematics · Pak Studies · Physics
 *   assessment           subject_key / label                   maths · science / Maths · Science
 *   Digital Coaching     analysis_data.subject_resolution      maths · science (registry codes)
 *
 * The grade·subject picker shows HER classes and then opens a lesson plan, a paper or a DC
 * recording for the one she picked — so every one of those must land on the same subject, in
 * both directions: a source spelling → one key (subjectKey), and a key → the catalogue's own
 * entry for it (matchCatalogue). This file holds the module to that.
 */

const V = require('../../dashboard/services/subject-vocabulary.service');

describe('subjectKey — any source spelling → one key', () => {
  test.each([
    // her classes (class_teacher_subjects.subject_code) — already keys
    ['urdu', 'urdu'], ['english', 'english'], ['maths', 'maths'], ['science', 'science'],
    ['social_studies', 'social_studies'], ['general_knowledge', 'general_knowledge'],
    // K-5 lesson-plan catalogue: subject_key and display name
    ['math', 'maths'], ['general_science', 'science'], ['Math', 'maths'], ['General Science', 'science'],
    // 6-12 corpus free text, as spelled in the import
    ['Mathematics', 'maths'], ['mathematics', 'maths'], ['  General   Science ', 'science'],
    ['Islamiyat', 'islamiat'], ['Social Studies', 'social_studies'],
    ['Physics', 'physics'], ['Chemistry', 'chemistry'], ['Biology', 'biology'],
    ['Computer Science', 'computer_science'], ['Computer Studies', 'computer_science'],
    ['Pakistan Studies', 'pakistan_studies'], ['Pak Studies', 'pakistan_studies'],
    ['History', 'history'], ['Geography', 'geography'],
    // assessment labels
    ['Maths', 'maths'], ['Science', 'science'], ['Islamiat', 'islamiat'],
    // Urdu-script names the corpus and the coaching pipeline carry
    ['ریاضی', 'maths'], ['اردو', 'urdu'],
  ])('%j → %s', (raw, key) => {
    expect(V.subjectKey(raw)).toBe(key);
  });

  test('a subject no list names is KEPT under its own slug, never dropped or guessed', () => {
    expect(V.subjectKey('Art')).toBe('art');
    expect(V.subjectKey('Woodwork Basics')).toBe('woodwork_basics');
  });

  test.each([[''], ['   '], [null], [undefined], [42], [{}]])('nothing usable (%j) → null', (raw) => {
    expect(V.subjectKey(raw)).toBeNull();
  });
});

describe('subjectName — a key → her word for it', () => {
  test.each([
    ['maths', 'Mathematics'], ['science', 'General Science'], ['english', 'English'], ['urdu', 'Urdu'],
    ['social_studies', 'Social Studies'], ['general_knowledge', 'General Knowledge'],
    ['islamiat', 'Islamiat'], ['physics', 'Physics'], ['computer_science', 'Computer Science'],
    ['pakistan_studies', 'Pakistan Studies'], ['art', 'Art'],
  ])('en: %s → %s', (key, name) => {
    expect(V.subjectName(key, 'en')).toBe(name);
  });

  test.each([
    ['maths', 'ریاضی'], ['science', 'سائنس'], ['urdu', 'اردو'], ['physics', 'طبیعیات'],
    ['pakistan_studies', 'مطالعہ پاکستان'],
  ])('ur: %s → %s', (key, name) => {
    expect(V.subjectName(key, 'ur')).toBe(name);
  });

  test('ur with no Urdu name keeps the English word (untranslated, not wrong)', () => {
    expect(V.subjectName('art', 'ur')).toBe('Art');
  });

  test('a language outside the offer reads as English', () => {
    expect(V.subjectName('maths', 'sw')).toBe('Mathematics');
    expect(V.subjectName('maths')).toBe('Mathematics');
  });
});

describe('matchCatalogue — a key → that catalogue\'s own entry (the reverse direction)', () => {
  const K5_GRADE_4 = [
    { key: 'english', name: 'English' }, { key: 'general_science', name: 'General Science' },
    { key: 'math', name: 'Math' }, { key: 'urdu', name: 'Urdu' },
  ];
  const G612_GRADE_9 = [
    { key: 'English', name: 'English' }, { key: 'Mathematics', name: 'Mathematics' },
    { key: 'Physics', name: 'Physics' }, { key: 'Pakistan Studies', name: 'Pakistan Studies' },
  ];
  const ASSESSMENT_GRADE_4 = [
    { key: 'english', name: 'English' }, { key: 'maths', name: 'Maths' }, { key: 'science', name: 'Science' },
  ];

  test('her class code reaches the K-5 lesson-plan key', () => {
    expect(V.matchCatalogue('maths', K5_GRADE_4)).toEqual({ key: 'math', name: 'Math' });
    expect(V.matchCatalogue('science', K5_GRADE_4)).toEqual({ key: 'general_science', name: 'General Science' });
  });

  test('her class code reaches the 6-12 corpus name', () => {
    expect(V.matchCatalogue('maths', G612_GRADE_9)).toEqual({ key: 'Mathematics', name: 'Mathematics' });
    expect(V.matchCatalogue('pakistan_studies', G612_GRADE_9).key).toBe('Pakistan Studies');
  });

  test('her class code reaches the assessment subject_key', () => {
    expect(V.matchCatalogue('maths', ASSESSMENT_GRADE_4)).toEqual({ key: 'maths', name: 'Maths' });
  });

  test('a subject the catalogue does not hold is null — never the nearest one', () => {
    expect(V.matchCatalogue('science', G612_GRADE_9)).toBeNull();
    expect(V.matchCatalogue('social_studies', K5_GRADE_4)).toBeNull();
    expect(V.matchCatalogue(null, K5_GRADE_4)).toBeNull();
    expect(V.matchCatalogue('maths', null)).toBeNull();
  });

  test('round trip: every K-5 catalogue entry folds back to a key that finds it again', () => {
    for (const entry of K5_GRADE_4) {
      expect(V.matchCatalogue(V.subjectKey(entry.key), K5_GRADE_4)).toBe(entry);
    }
  });
});

describe('gradeOf — a class grade_code or a number → a grade', () => {
  test.each([
    ['grade_4', { grade: 4, gradeCode: 'grade_4' }],
    ['grade_12', { grade: 12, gradeCode: 'grade_12' }],
    [4, { grade: 4, gradeCode: 'grade_4' }],
    ['9', { grade: 9, gradeCode: 'grade_9' }],
  ])('%j → %j', (raw, out) => {
    expect(V.gradeOf(raw)).toEqual(out);
  });

  test('early years is kept, with no grade number (no lesson plan or paper has one)', () => {
    expect(V.gradeOf('early_years')).toEqual({ grade: null, gradeCode: 'early_years' });
  });

  test.each([[null], [''], ['grade_x'], [0], [13], ['abc']])('nothing usable (%j) → null', (raw) => {
    expect(V.gradeOf(raw)).toBeNull();
  });
});
