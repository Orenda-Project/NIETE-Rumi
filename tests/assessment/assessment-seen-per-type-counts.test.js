/**
 * bd-e5n2jf — Seen questions get per-type counts, like Unseen (Mubashar Zia, 20 Nov).
 *
 * A teacher sets "3 MCQs, 2 True/False" for the book's own questions. Amena's rulings:
 *   - the same type list as Unseen, subjective types included;
 *   - when the pages hold too few of a type, other exercise content from those pages is
 *     reshaped into that type, so every count is exact.
 * Jobs with no `seenTypes` (old Flow, old portal, queued jobs) are untouched.
 */
const SeenTypes = require('../../bot/shared/services/assessment/seen-types');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const TYPES = [
  { id: 'MCQs', count: 3, category: 'objective' },
  { id: 'True/False', count: 2, category: 'objective' },
  { id: 'Short Questions', count: 2, category: 'subjective' },
];

describe('seen-types: clean', () => {
  test('keeps id, whole count and category', () => {
    expect(SeenTypes.clean(TYPES)).toEqual(TYPES);
  });
  test('absent, empty or unusable lists are null — the old path', () => {
    for (const v of [null, undefined, [], 'x', [{ id: '' }], [{ id: 'MCQs', count: 0 }]]) {
      expect(SeenTypes.clean(v)).toBeNull();
    }
  });
  test('sums the counts', () => {
    expect(SeenTypes.total(TYPES)).toBe(7);
  });
});

describe('planCounts with seenTypes', () => {
  test('Seen only: the paper is the sum of her Seen counts', () => {
    const plan = Gen.planCounts({ contentSource: 'seen', questionCount: 20, seenTypes: TYPES });
    expect(plan).toMatchObject({ total: 7, seenTarget: 7, unseenTarget: 0, questionTypes: [] });
    expect(plan.seenTypes).toEqual(TYPES);
  });
  test('Both: Seen counts plus her Unseen counts', () => {
    const unseen = [{ id: 'MCQs', count: 4, category: 'objective' }];
    const plan = Gen.planCounts({ contentSource: 'both', questionCount: 11, questionTypes: unseen,
      seenCount: 7, seenTypes: TYPES });
    expect(plan).toMatchObject({ total: 11, seenTarget: 7, unseenTarget: 4, questionTypes: unseen });
  });
  test('without seenTypes the plan is exactly what it was', () => {
    expect(Gen.planCounts({ contentSource: 'seen', questionCount: 12 }))
      .toEqual({ total: 12, seenTarget: 12, unseenTarget: 0, questionTypes: [] });
  });
});

describe('the prompt names each Seen count and the reshape rule', () => {
  const base = { grade: 4, subject: 'science', pageContent: 'text', pageReference: 'p34-41' };
  test('Seen only', () => {
    const p = Gen.buildUserPrompt({ ...base, contentSource: 'seen', questionCount: 7, seenTypes: TYPES });
    expect(p).toMatch(/Seen Objective questions — 3 MCQs, 2 True\/False/);
    expect(p).toMatch(/Seen Subjective questions — 2 Short Questions/);
    expect(p).toMatch(/fewer .* turn other exercise content from these same pages into that type/);
    expect(p).toMatch(/exactly 7 questions/);
  });
  test('Both: exact Seen counts, not "at most"', () => {
    const p = Gen.buildUserPrompt({ ...base, contentSource: 'both', questionCount: 9, seenCount: 7,
      questionTypes: [{ id: 'MCQs', count: 2, category: 'objective' }], seenTypes: TYPES });
    expect(p).toMatch(/Seen Objective questions — 3 MCQs/);
    expect(p).not.toMatch(/at most 7/);
    expect(p).toMatch(/Unseen Objective questions — 2 MCQs/);
  });
  test('no seenTypes: the old Seen line', () => {
    const p = Gen.buildUserPrompt({ ...base, contentSource: 'seen', questionCount: 7 });
    expect(p).toMatch(/Seen questions — exactly 7/);
    expect(p).not.toMatch(/Seen Objective questions/);
  });
});

describe('seen-types: trim caps each type and drops types she did not ask for', () => {
  const q = (n) => Array.from({ length: n }, (_, i) => ({ question: `q${i}` }));
  test('per-type cap, unseen untouched', () => {
    const exam = {
      seen: {
        objective: { MCQs: q(5), 'True/False': q(1), 'Fill in the Blanks': q(3) },
        subjective: { 'Short Questions': q(4) },
      },
      unseen: { objective: { MCQs: q(6) } },
    };
    const removed = SeenTypes.trim(exam, TYPES);
    expect(exam.seen.objective.MCQs).toHaveLength(3);
    expect(exam.seen.objective['True/False']).toHaveLength(1);
    // not asked for: only fills the one True/False the pages were short of (total 7)
    expect(exam.seen.objective['Fill in the Blanks']).toHaveLength(1);
    expect(exam.seen.subjective['Short Questions']).toHaveLength(2);
    expect(exam.unseen.objective.MCQs).toHaveLength(6);
    expect(removed).toBe(2 + 2 + 2);
  });
  test('a sub-typed entry (Long Question) is capped across its sub-lists', () => {
    const exam = { seen: { subjective: { 'Long Question': { a: q(2), b: q(2) } } } };
    SeenTypes.trim(exam, [{ id: 'Long Question', count: 3, category: 'subjective' }]);
    expect(exam.seen.subjective['Long Question'].a).toHaveLength(2);
    expect(exam.seen.subjective['Long Question'].b).toHaveLength(1);
  });
  test('a key that names the type differently still counts as that type (6-12 ids vs names)', () => {
    const exam = { seen: { objective: { 'Multiple Choice Questions': q(5) } } };
    SeenTypes.trim(exam, [{ id: 'mcq', label: 'Multiple Choice Questions', count: 2, category: 'objective' }]);
    expect(exam.seen.objective['Multiple Choice Questions']).toHaveLength(2);
  });
  test('a key matching no asked type is kept, inside her Seen total — never wiped', () => {
    const exam = { seen: { objective: { 'Odd Name': q(4) } } };
    const removed = SeenTypes.trim(exam, [{ id: 'mcq', count: 3, category: 'objective' }]);
    expect(exam.seen.objective['Odd Name']).toHaveLength(3);
    expect(removed).toBe(1);
  });
  test('loose matching: case, spaces and plurals', () => {
    const exam = { seen: { objective: { 'true / false': q(4), mcq: q(4) } } };
    SeenTypes.trim(exam, [{ id: 'True/False', count: 1, category: 'objective' }, { id: 'MCQs', count: 2, category: 'objective' }]);
    expect(exam.seen.objective['true / false']).toHaveLength(1);
    expect(exam.seen.objective.mcq).toHaveLength(2);
  });
  test('clean keeps a label when one is given', () => {
    expect(SeenTypes.clean([{ id: 'mcq', label: 'MCQs', count: 2, category: 'objective' }]))
      .toEqual([{ id: 'mcq', label: 'MCQs', count: 2, category: 'objective' }]);
  });
  test('no seen branch: nothing removed', () => {
    expect(SeenTypes.trim({}, TYPES)).toBe(0);
  });
});
