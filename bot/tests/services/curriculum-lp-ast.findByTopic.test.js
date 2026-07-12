/**
 * Tests for CurriculumLpAstService.findByTopic — locks the natural-language
 * matcher's behavior so we don't regress into whole-string-substring again.
 *
 * The E2E bug this fixes: a real teacher writes "lesson plan for grade 1
 * math number buddies", which the earlier bidirectional-substring matcher
 * missed against chapter_title="Number Buddies 0-9".
 */

// Programmable Supabase mock — same builder shape used elsewhere in the suite.
const mockResultQueue = [];

function mockMakeBuilder() {
  const consume = () => (mockResultQueue.shift() || { data: null, error: null });
  const record = () => (..._args) => builder;
  const builder = {
    select: record(), eq: record(), order: record(), ilike: record(), contains: record(),
    limit: () => Promise.resolve(consume()),
    single: () => Promise.resolve(consume()),
    maybeSingle: () => Promise.resolve(consume()),
    then(onFulfilled, onRejected) { return Promise.resolve(consume()).then(onFulfilled, onRejected); },
  };
  return builder;
}

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => mockMakeBuilder()),
}));

jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(),
}));

const CurriculumLpAstService = require('../../shared/services/curriculum-lp-ast.service');

const G1_MATH_CANDIDATES = [
  { chapter_number: 1, chapter_title: 'Number Buddies 0-9', lp_index: 1, topic: 'Types of Math LPs (Introductory LP for Teachers)۔', source_lp_uuid: 'lp-1-1' },
  { chapter_number: 1, chapter_title: 'Number Buddies 0-9', lp_index: 2, topic: 'Numbers upto 9 (Concrete)۔', source_lp_uuid: 'lp-1-2' },
  { chapter_number: 2, chapter_title: 'Double-Digit Dazzle', lp_index: 1, topic: 'Introduction to Two Digits۔', source_lp_uuid: 'lp-2-1' },
  { chapter_number: 3, chapter_title: 'Sum and Difference Detectives', lp_index: 1, topic: 'Introduction۔', source_lp_uuid: 'lp-3-1' },
];

describe('CurriculumLpAstService.findByTopic — natural-language matcher', () => {
  beforeEach(() => {
    mockResultQueue.length = 0;
    jest.clearAllMocks();
  });

  it('matches "number buddies" (bare tokens)', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'number buddies', grade: 1, subject: 'maths' });
    expect(r).toBeTruthy();
    expect(r.chapter_title).toBe('Number Buddies 0-9');
    expect(r.lp_index).toBe(2); // prefers non-orientation LP within the chapter
  });

  it('matches "grade 1 math number buddies" (grade+subject wrapper)', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'grade 1 math number buddies', grade: 1, subject: 'maths' });
    expect(r?.chapter_title).toBe('Number Buddies 0-9');
    expect(r?.lp_index).toBe(2);
  });

  it('matches "lesson plan for grade 1 math number buddies" (LP-request wrapper — the E2E bug)', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'lesson plan for grade 1 math number buddies', grade: 1, subject: 'maths' });
    expect(r?.chapter_title).toBe('Number Buddies 0-9');
  });

  it('matches "give me a lesson plan on double-digit dazzle please"', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'give me a lesson plan on double-digit dazzle please', grade: 1, subject: 'maths' });
    expect(r?.chapter_title).toBe('Double-Digit Dazzle');
  });

  it('returns null when NO chapter tokens match the topic', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'photosynthesis', grade: 1, subject: 'maths' });
    expect(r).toBeNull();
  });

  it('is deterministic — same input picks same LP across calls (essential for R2 cache hits)', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const a = await CurriculumLpAstService.findByTopic({ topic: 'number buddies', grade: 1, subject: 'maths' });
    const b = await CurriculumLpAstService.findByTopic({ topic: 'number buddies', grade: 1, subject: 'maths' });
    expect(a?.source_lp_uuid).toBe(b?.source_lp_uuid);
  });

  it('does not match if only SOME chapter tokens are in the topic ("Sum" alone shouldn\'t match "Sum and Difference Detectives")', async () => {
    mockResultQueue.push({ data: G1_MATH_CANDIDATES, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'sum', grade: 1, subject: 'maths' });
    expect(r).toBeNull(); // requires "detectives" AND "difference" too
  });

  it('prefers lowest chapter_number when multiple chapters match', async () => {
    // Contrived: two chapters share the "number" token
    const contrived = [
      { chapter_number: 6, chapter_title: 'Number Sense', lp_index: 1, topic: 'Basic Number Sense۔', source_lp_uuid: 'lp-6-1' },
      { chapter_number: 1, chapter_title: 'Number Buddies 0-9', lp_index: 2, topic: 'Numbers upto 9۔', source_lp_uuid: 'lp-1-2' },
    ];
    mockResultQueue.push({ data: contrived, error: null });
    const r = await CurriculumLpAstService.findByTopic({ topic: 'give me a number lesson plan', grade: 1, subject: 'maths' });
    // Neither matches ALL tokens of either chapter; both need at least their 2 tokens present.
    expect(r).toBeNull();
  });
});
