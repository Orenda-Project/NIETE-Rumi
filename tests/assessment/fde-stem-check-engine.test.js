/**
 * bd-5jmnfj.22: the stem check inside the paper writer. With the setting on, a finished English-
 * medium paper is read once more; a question named as not making sense prints reworded, the paper
 * records what was changed, and the read is billed. Off, nothing is asked. A failed read keeps the
 * paper as it was.
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

const SCIENCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'science.json'), 'utf8'));
const WAS = 'Is rusting a physical or a chemical change? Give one reason.';
const FIX = 'Is rusting a physical change or a chemical change? Give one reason for your answer.';

const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});
const isStemCheck = (params) => params.messages.length === 1 && /^STEM CHECK/.test(params.messages[0].content);
const stemCalls = () => mockCreate.mock.calls.filter(([p]) => isStemCheck(p));

/** The science fixture, cut to the slots one section prompt asks for. */
function scienceSection(prompt) {
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(SCIENCE.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
      if (!mine.length) continue;
      tree.unseen[category] = tree.unseen[category] || {};
      tree.unseen[category][type] = mine;
    }
  }
  return tree;
}
function answer(stemReply) {
  mockCreate.mockImplementation(async (params) => {
    if (isStemCheck(params)) return stemReply();
    return reply(JSON.stringify(scienceSection(params.messages[1].content)));
  });
}
const flagged = () => reply(JSON.stringify({ flags: [{ label: 'Q2b.1.c', problem: 'test flag', question: FIX }] }));
const q2bc = (examJson) => Object.values(examJson.unseen).flatMap((t) => Object.values(t)).flat()
  .find((q) => q.slot === 'science.B.Q2b').questions[2].question;

const ARGS = {
  grade: 5, subject: 'science', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null,
};

beforeEach(() => {
  mockCreate.mockReset();
  mockLog.mockReset();
  mockLoadPages.mockResolvedValue({ content: '=== Page 5 ===\nLight and shadows.', pageReference: '1-270', pageCount: 1, pagesFound: [], pagesMissing: [] });
});

describe('the stem check in the paper writer (bd-5jmnfj.22)', () => {
  it('on: the flagged sub-question prints reworded, the paper records it, and the read is billed', async () => {
    answer(flagged);
    const on = await Gen.generatePatternExam({ ...ARGS, stemCheck: true });
    expect(stemCalls()).toHaveLength(1);
    expect(stemCalls()[0][0].messages[0].content).toContain(`Q2b.1.c ${WAS}`);
    expect(q2bc(on.examJson)).toBe(FIX);
    expect(on.examJson._layout.stem_check).toEqual({
      flags: [{ label: 'Q2b.1.c', problem: 'test flag', outcome: 'reworded', was: WAS }],
    });
    expect(mockLog.mock.calls.some(([l]) => l === '[assessment] stem check')).toBe(true);

    mockCreate.mockClear();
    answer(flagged);
    const off = await Gen.generatePatternExam(ARGS);
    expect(on.tokenData.cost).toBeCloseTo(off.tokenData.cost + 0.01, 5);
  });

  it('off: no read, and the paper prints as written', async () => {
    answer(flagged);
    const { examJson } = await Gen.generatePatternExam(ARGS);
    expect(stemCalls()).toHaveLength(0);
    expect(q2bc(examJson)).toBe(WAS);
    expect(examJson._layout.stem_check).toBeUndefined();
  });

  it('a failed read keeps the paper as it was and says so', async () => {
    answer(() => { throw new Error('timeout'); });
    const { examJson } = await Gen.generatePatternExam({ ...ARGS, stemCheck: true });
    expect(q2bc(examJson)).toBe(WAS);
    expect(examJson._layout.stem_check).toEqual({ failed: 'timeout' });
  });

});
