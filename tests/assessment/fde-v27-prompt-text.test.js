/**
 * bd-5jmnfj.4.58.2 (v26 review), G5 Urdu prompt and pattern text.
 *
 * 1. Q4: v26 items carried the task only in `main_question`, so the paper printed four bare items.
 *    The Q4 rule says each `question` begins with its task phrase. Q1's "plain stem" rule sits in
 *    Section A and never reaches Section C's prompt.
 * 2. Q7: the paper's instruction asks for any six helper words, as the marking scheme does.
 * 3. Q8: Urdu is Pakistan's national language, never the mother tongue; the model answer has the
 *    asked ten to twelve sentences.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const section = (id) => U.sections.find((s) => s.id === id);
const prompt = (id) => Gen.buildPatternUserPrompt({
  grade: 5, subject: 'urdu', pageContent: 'BOOK', pageReference: 'p', section: section(id), slots: section(id).slots, lang: 'ur', P: U, scope: FDE,
});
const slot = (id) => U.sections.flatMap((s) => s.slots).find((s) => s.slot === id);

describe('Q4 items carry their task in the question', () => {
  test('the Section C prompt tells the model each Q4 `question` begins with its task phrase', () => {
    const rule = slot('urdu.C.Q4').prompt_rule;
    expect(rule).toMatch(/`question` begins with its task/);
    expect(prompt('C')).toContain('`question` begins with its task');
  });

  test('Q1\'s plain-stem rule is in Section A only and does not reach Section C', () => {
    expect(prompt('A')).toContain('no decorative lead-in');
    expect(prompt('C')).not.toContain('no decorative lead-in');
  });
});

describe('Q7 instruction asks for any six helper words', () => {
  test('instruction_ur reads کوئی سے چھ مددگار الفاظ', () => {
    expect(slot('urdu.C.Q7').instruction_ur).toMatch(/^کوئی سے چھ مددگار الفاظ/);
  });
});

describe('Q8 model paragraph', () => {
  test('the rule names Urdu the national language, never the mother tongue, and asks ten to twelve sentences', () => {
    const rule = slot('urdu.C.Q8').prompt_rule;
    expect(rule).toContain('قومی زبان');
    expect(rule).toContain('مادری زبان');
    expect(rule).toMatch(/never مادری زبان/);
    expect(rule).toMatch(/10 to 12 sentences/);
  });
});
