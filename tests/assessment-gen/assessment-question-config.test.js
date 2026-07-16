/**
 * Assessment Question-Type config tests.
 *
 * Locks the per-{subject, grade, category} question-type surface to
 * Orenda-Project/UG_EG's `docs/question-types-ict.md`. If UG_EG edits that
 * doc, either these tests or the config service (or both) need to move.
 */

const QuestionConfig = require('../../bot/shared/services/assessment-question-config.service');

const idsFor = (subject, grade, category) =>
  QuestionConfig.getQuestionTypes({ subject, grade, category }).map((t) => t.id);

describe('getQuestionTypes — English (Grades 1-5)', () => {
  test('objective list matches UG_EG Eng doc', () => {
    // Grade 3 chosen arbitrarily — objective list is grade-independent for Eng.
    const ids = idsFor('Eng', 3, 'objective');
    expect(ids).toEqual(expect.arrayContaining([
      'MCQs', 'MSQs', 'Fill in the Blanks', 'Missing Letters', 'True/False',
      'Match the Column', 'Circle the Correct Answer', 'Rewrite Sentences',
      'Brief Answers', 'Listening', 'Speaking', 'Reading',
    ]));
    // Subjective-only shouldn't leak
    expect(ids).not.toContain('Comprehension Passage');
    expect(ids).not.toContain('Word Meanings');
  });

  test('grades 1-2 use the "early" subjective band', () => {
    const ids = idsFor('Eng', 2, 'subjective');
    expect(ids).toEqual(expect.arrayContaining([
      'Word Meanings', 'Word Sentences', 'Comprehension Passage',
      'Rewriting', 'Story Completion', 'Simple Writing',
    ]));
    // Late-band-only types don't appear for grade 2
    expect(ids).not.toContain('Essay Writing');
    expect(ids).not.toContain('Letter Writing');
  });

  test('grades 3-5 use the "late" subjective band', () => {
    const ids = idsFor('Eng', 4, 'subjective');
    expect(ids).toEqual(expect.arrayContaining([
      'Word Meanings', 'Word Sentences', 'Comprehension Passage',
      'Letter Writing', 'Application Writing', 'Story Writing',
      'Essay Writing', 'Paragraph Writing', 'Picture Description',
    ]));
    // Early-band-only types don't appear for grade 4
    expect(ids).not.toContain('Rewriting');
    expect(ids).not.toContain('Story Completion');
  });
});

describe('getQuestionTypes — Urdu mirrors English', () => {
  test('Urdu objective matches Eng objective', () => {
    expect(idsFor('Urdu', 3, 'objective').sort()).toEqual(idsFor('Eng', 3, 'objective').sort());
  });
  test('Urdu subjective grade 1 matches Eng grade 1', () => {
    expect(idsFor('Urdu', 1, 'subjective').sort()).toEqual(idsFor('Eng', 1, 'subjective').sort());
  });
});

describe('getQuestionTypes — Maths (Grades 1-5)', () => {
  test('objective', () => {
    expect(idsFor('Maths', 3, 'objective')).toEqual([
      'MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column',
      'Mental Math (Viva)', 'Sequences',
    ]);
  });
  test('subjective includes Word Problems', () => {
    const ids = idsFor('Maths', 5, 'subjective');
    expect(ids).toEqual(expect.arrayContaining([
      'Short Questions', 'Restricted Response Question', 'Word Problems',
      'Graphs & Geometric Problems',
    ]));
    // Not an Eng/Urdu subjective type
    expect(ids).not.toContain('Comprehension Passage');
  });
});

describe('getQuestionTypes — Science (Grades 4-5 only)', () => {
  test('objective', () => {
    expect(idsFor('Science', 4, 'objective')).toEqual([
      'MCQs', 'MSQs', 'Fill in the Blanks', 'True/False',
    ]);
  });
  test('subjective — Brief Answers appears here as SUBJECTIVE (not objective like Eng)', () => {
    const ids = idsFor('Science', 5, 'subjective');
    expect(ids).toEqual([
      'Brief Answers', 'Mind Map', 'Flow Chart',
      'Label the Diagram', 'Logical Reasoning',
    ]);
  });
  test('grade gating — no types below grade 4', () => {
    expect(idsFor('Science', 1, 'objective')).toEqual([]);
    expect(idsFor('Science', 3, 'subjective')).toEqual([]);
  });
});

describe('getQuestionTypes — SST (Grades 4-5 only)', () => {
  test('objective for grade 4', () => {
    expect(idsFor('SST', 4, 'objective')).toEqual([
      'MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column',
    ]);
  });
  test('subjective for grade 5', () => {
    expect(idsFor('SST', 5, 'subjective')).toEqual([
      'Short Questions', 'Long Question', 'Mind Map', 'Flow Chart',
    ]);
  });
  test('grade gating — no types below grade 4', () => {
    expect(idsFor('SST', 3, 'objective')).toEqual([]);
  });
});

describe('getQuestionTypes — Islamiat (Grades 1-5)', () => {
  test('objective', () => {
    expect(idsFor('Islamiat', 2, 'objective')).toEqual([
      'MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Match the Column',
      'Listening', 'Reading',
    ]);
  });
  test('subjective', () => {
    expect(idsFor('Islamiat', 2, 'subjective')).toEqual([
      'Short Questions', 'Long Question',
    ]);
  });
});

describe('getQuestionTypes — GenK (Grades 1-3 only)', () => {
  test('objective for grade 1', () => {
    expect(idsFor('GenK', 1, 'objective')).toEqual([
      'MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Match the Column',
    ]);
  });
  test('subjective for grade 2', () => {
    expect(idsFor('GenK', 2, 'subjective')).toEqual([
      'Short Questions', 'Long Question', 'Mind Map',
    ]);
  });
  test('grade gating — no types above grade 3', () => {
    expect(idsFor('GenK', 4, 'objective')).toEqual([]);
    expect(idsFor('GenK', 5, 'subjective')).toEqual([]);
  });
});

describe('getQuestionTypes — invalid inputs', () => {
  test('unknown subject returns empty', () => {
    expect(idsFor('Bogus', 3, 'objective')).toEqual([]);
  });
  test('unknown category returns empty', () => {
    expect(idsFor('Eng', 3, 'both')).toEqual([]);
  });
  test('non-numeric grade returns empty', () => {
    expect(idsFor('Eng', 'K', 'objective')).toEqual([]);
  });
});

describe('isSupported — all UG_EG catalogue ids resolve', () => {
  const ALL_IDS = [
    'MCQs', 'MSQs', 'Fill in the Blanks', 'Missing Letters', 'True/False',
    'Match the Column', 'Circle the Correct Answer', 'Rewrite Sentences',
    'Brief Answers', 'Listening', 'Speaking', 'Reading',
    'Word Meanings', 'Word Sentences', 'Comprehension Passage', 'Rewriting',
    'Story Completion', 'Simple Writing', 'Letter Writing', 'Application Writing',
    'Story Writing', 'Essay Writing', 'Paragraph Writing', 'Picture Description',
    'Mental Math (Viva)', 'Sequences', 'Short Questions',
    'Restricted Response Question', 'Word Problems', 'Graphs & Geometric Problems',
    'Long Question', 'Mind Map', 'Flow Chart', 'Label the Diagram',
    'Logical Reasoning',
  ];
  test.each(ALL_IDS)('%s is supported', (id) => {
    expect(QuestionConfig.isSupported(id)).toBe(true);
  });
  test('unknown ids are not supported', () => {
    expect(QuestionConfig.isSupported('Not A Thing')).toBe(false);
  });
});
