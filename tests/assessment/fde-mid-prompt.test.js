/**
 * Grade 3-4 mid patterns skip the Grade-5-only prompt rules (bd-5jmnfj.33.1): the Urdu held-lesson
 * rule, the Maths 100-marks floor and the "Grade 5 vocabulary" line. Grade 5 keeps all three.
 */

jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const C = require('../../bot/shared/services/assessment/patterns/mid/chrome');

const TOS = { Remember: 20, Understand: 30, Apply: 50 };
const mcq = (key) => ({ slot: `${key}.A.Q1`, label_en: 'Q1.', type: 'MCQs', shape: 'mcq', generate: 5, marks_each: 1, prompt_rule: 'r' });
const mid = (grade, key, name) => C.makeSubject({
  grade, key, medium: key === 'urdu' ? 'ur' : 'en', name_en: name, name_ur: name, tos: TOS,
  sections: [{ id: 'A', label_en: 'A', levels: { Remember: 5 }, slots: [mcq(key)] }],
});
const SCOPE = { kind: 'chapters', chapters: [5], pages: '40-48' };
const promptFor = (P, scope = SCOPE) => {
  const section = P.sections[0];
  return Gen.buildPatternUserPrompt({
    grade: P.grade || 5, subject: P.key, pageContent: 'page text', pageReference: '40-48', section, slots: section.slots,
    lang: P.medium, P, scope,
  });
};

const HELD = 'Urdu: never lessons 1, 2 or 3';
const FLOOR = 'Of the 100 marks, 8–12 are Remember';
const G5_WORDS = 'Use Grade 5 vocabulary';

describe('a Grade 3 or 4 mid subject', () => {
  const maths = promptFor(mid(3, 'maths', 'Mathematics'));
  const urdu = promptFor(mid(4, 'urdu', 'Urdu'));
  const science = promptFor(mid(4, 'science', 'Science'));
  const english = promptFor(mid(3, 'english', 'English'));

  test('does not get the Maths 100-marks floor, and keeps the units rule', () => {
    expect(maths).not.toContain(FLOOR);
    expect(maths).toContain('Every measurement stem names its unit');
  });

  test('does not get the Grade 5 Urdu held-lessons rule', () => {
    expect(urdu).not.toContain(HELD);
  });

  test('gets its own grade vocabulary line, never Grade 5', () => {
    expect(science).toContain('Use Grade 4 vocabulary; a term the book does not use is replaced by the book\'s word.');
    expect(english).toContain('Use Grade 3 vocabulary; a term the book does not use is replaced by the book\'s word.');
    [maths, urdu, science, english].forEach((p) => expect(p).not.toContain(G5_WORDS));
  });

  test('the vocabulary line is pushed for every subject key', () => {
    expect(maths).toContain('Use Grade 3 vocabulary;');
    expect(urdu).toContain('Use Grade 4 vocabulary;');
  });
});

describe('Grade 5 subjects keep the Grade 5 rules', () => {
  const g5 = (key) => Patterns.subjectOf('fde_g5_2027', key);
  const fdeScope = { kind: 'fde', chapters: null, pages: null };

  test('Maths keeps the floor', () => {
    expect(promptFor(g5('maths'), fdeScope)).toContain(FLOOR);
  });

  test('Urdu keeps the held rule, and Science and English the Grade 5 vocabulary line', () => {
    const held = promptFor(g5('urdu'), fdeScope);
    expect(held).toContain(HELD);
    expect(held).toContain(`Set items only from book pages ${g5('urdu').scope.page_ranges}.`);
    expect(promptFor(g5('science'), fdeScope)).toContain(G5_WORDS);
    expect(promptFor(g5('english'), fdeScope)).toContain(G5_WORDS);
  });
});
