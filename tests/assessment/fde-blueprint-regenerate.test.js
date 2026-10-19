/**
 * A paper off FDE's split is written once more (bd-5jmnfj.18). The second run is told the first
 * paper's split and the target; the paper nearer the target is the one returned, and both runs
 * are billed. A second run that fails, or a paper already on its split, leaves the first alone.
 *
 * Mocked at the boundary only: the model client and the book loader.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockLoadPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockLoadPages(...a),
  loadChapterContent: jest.fn(),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const MATHS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
const NOTE = 'came out at';

const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);

/** The worked maths fixture, cut to one section's slots; `retag(q, i)` rewrites an item's level. */
function mathsSection(prompt, retag = (q) => q) {
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(MATHS.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`)).map((q, i) => retag({ ...q }, i));
      if (!mine.length) continue;
      tree.unseen[category] = tree.unseen[category] || {};
      tree.unseen[category][type] = mine;
    }
  }
  return tree;
}
const asked = (params) => params.messages[1].content;
const reaskedRuns = () => mockCreate.mock.calls.filter(([p]) => asked(p).includes(NOTE));
// The recorded paper is Remember 5, Understand 60, Apply 35 against FDE's 10/50/40.
// Every item Understand: further off than the recorded paper.
const allUnderstand = (q) => ({ ...q, blooms: 'Understand' });
// The first n Q1(b) items (2 marks each, all Understand) moved to Apply: 3 is nearer, 4 is on the split.
const q1bToApply = (n) => (q, i) => (q.slot === 'maths.A.Q1b' && i < n ? { ...q, blooms: 'Apply' } : q);
const nearer = q1bToApply(3);
const onSplit = q1bToApply(4);

const ARGS = {
  grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null, splitRetry: true,
};

beforeEach(() => {
  mockCreate.mockReset();
  mockLog.mockReset();
  mockLoadPages.mockResolvedValue({ content: '=== Page 5 ===\nPlace value.', pageReference: '1-270', pageCount: 1, pagesFound: [], pagesMissing: [] });
});

describe('a paper off its split is written once more', () => {
  it('the second run is told the first paper\'s split and FDE\'s, and the nearer paper comes back', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(
      mathsSection(asked(params), asked(params).includes(NOTE) ? nearer : undefined),
    )));
    const { examJson, tokenData } = await Gen.generatePatternExam(ARGS);

    const runs = reaskedRuns();
    expect(runs.length).toBeGreaterThan(0);
    for (const [params] of runs) {
      expect(asked(params)).toMatch(/Understand 60%/);
      expect(asked(params)).toMatch(/Remember 10%, Understand 50%, Apply 40%/);
    }
    const [line] = logged('[assessment] paper re-asked for its level split');
    expect(line).toMatchObject({ pattern: 'fde_g5_2027', subject: 'maths' });
    const [kept] = logged('[assessment] level split re-ask kept');
    expect(kept).toMatchObject({ kept: 'second' });
    expect(examJson._layout.blueprint.levels.Understand.pct).toBeLessThan(60);
    // Both runs are billed: every model call made is in the paper's cost.
    expect(tokenData.cost).toBeCloseTo(mockCreate.mock.calls.length * 0.01, 5);
  });

  it('a second paper further off is thrown away: the first comes back', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(
      mathsSection(asked(params), asked(params).includes(NOTE) ? allUnderstand : undefined),
    )));
    const { examJson, tokenData } = await Gen.generatePatternExam(ARGS);
    expect(reaskedRuns().length).toBeGreaterThan(0);
    expect(logged('[assessment] level split re-ask kept')[0]).toMatchObject({ kept: 'first' });
    expect(examJson._layout.blueprint.levels.Understand.pct).toBeCloseTo(60, 5);
    expect(tokenData.cost).toBeCloseTo(mockCreate.mock.calls.length * 0.01, 5);
  });

  it('a second run that fails leaves the first paper standing', async () => {
    mockCreate.mockImplementation(async (params) => {
      if (asked(params).includes(NOTE)) throw new Error('model down');
      return reply(JSON.stringify(mathsSection(asked(params))));
    });
    const { examJson } = await Gen.generatePatternExam(ARGS);
    expect(examJson._layout.blueprint.levels.Understand.pct).toBeCloseTo(60, 5);
    expect(logged('[assessment] level split re-ask failed')).toHaveLength(1);
  });
});

describe('a paper written once', () => {
  it('makes no second run', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(mathsSection(asked(params), onSplit))));
    const { examJson } = await Gen.generatePatternExam(ARGS);
    expect(examJson._layout.blueprint.problems).toEqual([]);
    expect(reaskedRuns()).toHaveLength(0);
    expect(logged('[assessment] paper re-asked for its level split')).toHaveLength(0);
  });

  it('off its split, when the caller does not ask for the retry', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(mathsSection(asked(params)))));
    const { examJson } = await Gen.generatePatternExam({ ...ARGS, splitRetry: false });
    expect(examJson._layout.blueprint.problems).toContainEqual(expect.objectContaining({ code: 'LEVEL' }));
    expect(reaskedRuns()).toHaveLength(0);
  });
});
