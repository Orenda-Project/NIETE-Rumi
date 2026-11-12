/**
 * bd-ipoxhx.1 — AG sheet row 24 (20 Oct, Grade 2 Maths, "Both"): she chose objective types only, but the
 * questions taken from the textbook came back as short/long answers. The seen half must stay inside the
 * categories she chose: told so in the prompt, and enforced on the paper when the writer ignores it.
 */
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { seenCategoriesOf, seenCategoryLine, keepSeenCategories } = require('../../bot/shared/services/assessment/seen-categories');
const { buildUserPrompt } = require('../../bot/shared/services/assessment/assessment-generation.service');

const OBJ_ONLY = [
  { id: 'MCQs', count: 3, category: 'objective' },
  { id: 'Fill in the Blanks', count: 3, category: 'objective' },
];
const SUBJ_ONLY = [{ id: 'Short Questions', count: 4, category: 'subjective' }];
const MIXED = [...OBJ_ONLY, ...SUBJ_ONLY];

const paper = () => ({
  seen: {
    objective: { MCQs: [{ question: 'a', marks: 1 }] },
    subjective: { 'Short Questions': [{ question: 'b', marks: 3 }], 'Long Question': { Part: [{ question: 'c', marks: 4 }] } },
  },
  unseen: { objective: { MCQs: [{ question: 'd', marks: 1 }] } },
});

describe('seenCategoriesOf', () => {
  test('objective-only, subjective-only, mixed, none', () => {
    expect(seenCategoriesOf(OBJ_ONLY)).toEqual(['objective']);
    expect(seenCategoriesOf(SUBJ_ONLY)).toEqual(['subjective']);
    expect(seenCategoriesOf(MIXED)).toEqual(['objective', 'subjective']);
    expect(seenCategoriesOf([])).toEqual(['objective', 'subjective']);
    expect(seenCategoriesOf(undefined)).toEqual(['objective', 'subjective']);
  });
});

describe('seenCategoryLine', () => {
  test('objective-only names objective and forbids short/long answers', () => {
    const line = seenCategoryLine(OBJ_ONLY);
    expect(line).toMatch(/objective/i);
    expect(line).toMatch(/no short or long answer/i);
  });
  test('subjective-only names subjective', () => {
    expect(seenCategoryLine(SUBJ_ONLY)).toMatch(/subjective questions only/i);
  });
  test('mixed or no types: empty, so those prompts are unchanged', () => {
    expect(seenCategoryLine(MIXED)).toBe('');
    expect(seenCategoryLine([])).toBe('');
  });
});

describe('keepSeenCategories', () => {
  test('objective-only drops every seen subjective question, leaves unseen alone', () => {
    const p = paper();
    expect(keepSeenCategories(p, OBJ_ONLY)).toBe(2);
    expect(p.seen.subjective).toBeUndefined();
    expect(p.seen.objective.MCQs).toHaveLength(1);
    expect(p.unseen.objective.MCQs).toHaveLength(1);
  });
  test('subjective-only drops seen objective', () => {
    const p = paper();
    expect(keepSeenCategories(p, SUBJ_ONLY)).toBe(1);
    expect(p.seen.objective).toBeUndefined();
    expect(p.seen.subjective).toBeDefined();
  });
  test('mixed: nothing removed', () => {
    const p = paper();
    expect(keepSeenCategories(p, MIXED)).toBe(0);
    expect(p).toEqual(paper());
  });
  test('no seen branch: 0, no throw', () => {
    expect(keepSeenCategories({ unseen: {} }, OBJ_ONLY)).toBe(0);
    expect(keepSeenCategories(null, OBJ_ONLY)).toBe(0);
  });
});

describe('buildUserPrompt, Both mode', () => {
  const base = { grade: 2, subject: 'maths', pageContent: 'x', pageReference: 'p1', contentSource: 'both', questionCount: 10 };
  test('objective-only: the seen line carries the objective-only restriction', () => {
    const p = buildUserPrompt({ ...base, questionTypes: OBJ_ONLY, seenCount: 4 });
    expect(p).toMatch(/Seen questions[^\n]*objective questions only/i);
  });
  test('mixed: the seen line is as it always was', () => {
    const p = buildUserPrompt({ ...base, questionTypes: MIXED, seenCount: 4 });
    expect(p).not.toMatch(/questions only/i);
  });
});
