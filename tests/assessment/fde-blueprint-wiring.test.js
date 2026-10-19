/**
 * The blueprint check, wired in (bd-5jmnfj.2). The thinking-level target comes from the pattern —
 * FDE sets it per grade and subject — not from one table per subject in the generator, and every
 * board-pattern paper carries the check's result. Report-only: a paper off its split still ships.
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
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');
const MATHS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
const LEVELS = ['Remember', 'Understand', 'Apply'];

const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);

/** The worked maths fixture, cut to the slots one section's prompt asks for. */
function mathsSection(prompt) {
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(MATHS.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
      if (!mine.length) continue;
      tree.unseen[category] = tree.unseen[category] || {};
      tree.unseen[category][type] = mine;
    }
  }
  return tree;
}

const ARGS = {
  grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null,
};

beforeEach(() => {
  mockCreate.mockReset();
  mockLog.mockReset();
  mockLoadPages.mockResolvedValue({ content: '=== Page 5 ===\nPlace value.', pageReference: '1-270', pageCount: 1, pagesFound: [], pagesMissing: [] });
});

describe('the level target lives in the pattern', () => {
  it.each(Object.keys(P.subjects))('%s carries a split by level that sums to 100', (subject) => {
    const { tos } = P.subjects[subject];
    expect(Object.keys(tos).sort()).toEqual([...LEVELS].sort());
    expect(LEVELS.reduce((sum, band) => sum + tos[band], 0)).toBe(100);
  });

  it('the maths prompt states the pattern\'s split', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(mathsSection(params.messages[1].content))));
    await Gen.generatePatternExam(ARGS);
    const { tos } = P.subjects.maths;
    const split = LEVELS.map((band) => `${band} ${tos[band]}%`).join(', ');
    for (const [params] of mockCreate.mock.calls) expect(params.messages[1].content).toContain(split);
  });
});

describe('every board-pattern paper carries its blueprint', () => {
  it('reads the recorded maths paper against the pattern\'s target and logs it', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(mathsSection(params.messages[1].content))));
    const { examJson } = await Gen.generatePatternExam(ARGS);
    const bp = examJson._layout.blueprint;
    expect(bp.total).toBe(100);
    for (const band of LEVELS) expect(bp.levels[band].target).toBe(P.subjects.maths.tos[band]);
    const [line] = logged('[assessment] blueprint checked');
    expect(line).toMatchObject({ pattern: 'fde_g5_2027', subject: 'maths', ok: bp.ok, total: 100 });
  });

  it('a paper off its split still comes back: the check reports, it never fails a paper', async () => {
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(mathsSection(params.messages[1].content))));
    const { examJson } = await Gen.generatePatternExam(ARGS);
    // The recorded paper is 60% Understand against FDE's 50.
    expect(examJson._layout.blueprint.problems).toContainEqual(expect.objectContaining({ code: 'LEVEL', level: 'Understand' }));
  });
});
