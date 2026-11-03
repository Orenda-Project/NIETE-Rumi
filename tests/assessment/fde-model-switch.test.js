/**
 * A board-pattern paper can run on its own model, with nothing changing until someone sets it.
 *
 * Pattern papers are one call per section, and a bake-off found that a different model writes
 * them better for less. So they have their own job, `assessment.generate.fde`, read from
 * ASSESSMENT_GEN_MODEL_FDE. Unset (every tier today), a pattern paper resolves its model exactly
 * as before: the per-language variables, the job variable, the settings rows. Set, every section
 * of every subject uses it, with the paper's own model behind it on a failure. Plain papers never
 * read it.
 *
 * Also here: the per-section output ceiling, which is now sized from the section's own slots
 * rather than one flat number, and the request id on the section and layout log lines.
 *
 * Mocked at the boundary only: the model client and the book loader. The registry, the settings
 * reader, the prompts, the pattern data and the layout are real.
 */

const mockCreate = jest.fn();
// The cache warm call on the direct lane (see fde-prompt-cache.test.js for the real client).
const mockWarm = jest.fn(async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }],
  usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5, cost: 0.001 } }));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
  getClientForModel: (model) => ({ client: { chat: { completions: { create: mockWarm } } }, model }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
// The science fixture predates the v29 whole-paper give-away checks (MCQ/concept/fraction); they are pinned in fde-v29-g5-*.test.js (bd-5jmnfj.4.58.4).
jest.mock('../../bot/shared/services/assessment/fde-g5-paper-giveaways', () => ({ paperGiveaways: () => [] }));
// Same for the Science give-away flags (bd-5jmnfj.4.58 v37 round 8): the stock science fixture overlaps topically (lungs, brain, living things), so first-pass flags would add re-asks this test does not count. The flags are pinned in fde-v37-science-r3.test.js.
jest.mock('../../bot/shared/services/assessment/fde-science-giveaway-drop', () => ({ ...jest.requireActual('../../bot/shared/services/assessment/fde-science-giveaway-drop'), scienceGiverFlags: () => [] }));
jest.mock('../../bot/shared/services/assessment/fde-science-key-stem', () => ({ ...jest.requireActual('../../bot/shared/services/assessment/fde-science-key-stem'), keyStemFlags: () => [] })); // stock science replies restate their stems; pinned in fde-science-key-stem.test.js (bd-5jmnfj.4.58 v37r4)
const mockLoadPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockLoadPages(...a),
  loadChapterContent: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const PATTERN = 'fde_g5_2027';
const P = Patterns.get(PATTERN);
const DEFAULT = 'google/gemini-3.1-pro-preview';
const FDE = 'anthropic-direct/claude-sonnet-5-5';
const VARS = ['ASSESSMENT_GEN_MODEL_FDE', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG', 'ASSESSMENT_GEN_MODEL_URDU', 'LLM_JOB_MODELS'];

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const BOOK = {
  maths: '=== Page 5 ===\nPlace value.\n\n=== Page 100 ===\nDecimals.\n\n=== Page 220 ===\nAngles.\n\n=== Page 255 ===\nAverages.',
  science: '=== Page 10 ===\nPlants make food.\n\n=== Page 60 ===\nForces.',
  urdu: '=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات کا متن',
};
const sectionOf = (params) => {
  const user = params.messages[1].content;
  const text = Array.isArray(user) ? user.map((p) => p.text).join('') : user;
  return /\*\*SECTION (\w+)\*\*/.exec(text)[1];
};

/** Each section answered from the subject's worked fixture paper. */
function fakeModel(subject) {
  mockLoadPages.mockImplementation(async ({ pageRanges }) => (pageRanges === '1-27'
    ? loaded('=== Page 3 ===\nسبق اول', '1-27') : loaded(BOOK[subject], String(pageRanges))));
  mockCreate.mockImplementation(async (params) => {
    const user = params.messages[1].content;
    const prompt = Array.isArray(user) ? user.map((p) => p.text).join('') : user;
    const tree = { unseen: {} };
    for (const [category, types] of Object.entries(fixture(subject).unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
        if (mine.length) ((tree.unseen[category] ||= {})[type] = mine);
      }
    }
    return { choices: [{ message: { content: JSON.stringify(tree) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 } };
  });
}

const ARGS = (subject, extra = {}) => ({
  grade: 5, subject, pattern: PATTERN, scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null, ...extra,
});
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);

let saved;
beforeEach(() => {
  saved = {};
  VARS.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
  mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset(); mockWarm.mockClear();
});
afterEach(() => VARS.forEach((v) => { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v]; }));

describe('the FDE model switch', () => {
  test('pattern section model unchanged when ASSESSMENT_GEN_MODEL_FDE unset', async () => {
    fakeModel('maths');
    await Gen.generatePatternExam(ARGS('maths'));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    for (const [params] of mockCreate.mock.calls) {
      expect(params.model).toBe(DEFAULT);
      expect(params.job).toBe('assessment.generate');
      expect('fallbackModel' in params).toBe(false);
    }

    // The per-language variable still moves an Urdu pattern paper, and only it.
    mockCreate.mockReset();
    process.env.ASSESSMENT_GEN_MODEL_URDU = 'openai/gpt-5.4';
    fakeModel('urdu');
    await Gen.generatePatternExam(ARGS('urdu'));
    for (const [params] of mockCreate.mock.calls) {
      expect(params.model).toBe('openai/gpt-5.4');
      expect(params.job).toBe('assessment.generate');
    }
  });

  test('pattern section uses ASSESSMENT_GEN_MODEL_FDE when set', async () => {
    process.env.ASSESSMENT_GEN_MODEL_FDE = FDE;
    fakeModel('maths');
    const out = await Gen.generatePatternExam(ARGS('maths'));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    for (const [params] of mockCreate.mock.calls) {
      expect(params.model).toBe(FDE);
      expect(params.job).toBe('assessment.generate.fde');
      // The paper's own model stands behind it.
      expect(params.fallbackModel).toBe(DEFAULT);
    }
    expect(out.tokenData.model).toBe(FDE);

    // Both families: an Urdu paper moves too, with ITS own model behind it.
    mockCreate.mockReset();
    process.env.ASSESSMENT_GEN_MODEL_URDU = 'openai/gpt-5.4';
    fakeModel('urdu');
    await Gen.generatePatternExam(ARGS('urdu'));
    for (const [params] of mockCreate.mock.calls) {
      expect(params.model).toBe(FDE);
      expect(params.fallbackModel).toBe('openai/gpt-5.4');
    }
  });

  test('a model off the direct lane gets today\'s messages: two strings, no cache marks', async () => {
    for (const fde of [null, 'anthropic/claude-sonnet-5']) {
      mockCreate.mockReset();
      if (fde) process.env.ASSESSMENT_GEN_MODEL_FDE = fde;
      fakeModel('science');
      await Gen.generatePatternExam(ARGS('science'));
      for (const [params] of mockCreate.mock.calls) {
        expect(params.messages).toHaveLength(2);
        expect(params.messages[0]).toEqual({ role: 'system', content: Gen.buildSystemPrompt({ subject: 'science', includeAnswerKey: true }) });
        expect(typeof params.messages[1].content).toBe('string');
        expect(JSON.stringify(params)).not.toMatch(/cache_control/);
      }
      // No warm call off the direct lane.
      expect(mockWarm).not.toHaveBeenCalled();
    }
  });

  test('on the direct lane the system prompt and the book text are marked for caching, text unchanged', async () => {
    fakeModel('science');
    await Gen.generatePatternExam(ARGS('science'));
    const plain = Object.fromEntries(mockCreate.mock.calls.map(([p]) => [sectionOf(p), p.messages]));

    mockCreate.mockReset();
    process.env.ASSESSMENT_GEN_MODEL_FDE = FDE;
    fakeModel('science');
    await Gen.generatePatternExam(ARGS('science'));
    // One warm call for the prefix all three sections share.
    expect(mockWarm).toHaveBeenCalledTimes(1);
    expect(mockWarm.mock.calls[0][0].max_tokens).toBe(1);
    for (const [params] of mockCreate.mock.calls) {
      const [system, user] = params.messages;
      const today = plain[sectionOf(params)];
      expect(system.content).toEqual([{ type: 'text', text: today[0].content, cache_control: { type: 'ephemeral' } }]);
      // Concatenated, the parts are today's prompt byte for byte.
      expect(user.content.map((p) => p.text).join('')).toBe(today[1].content);
      expect(user.content[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(user.content[0].text.endsWith(`${BOOK.science}\n\`\`\`\n`)).toBe(true);
      expect(user.content[1].cache_control).toBeUndefined();
      expect(user.content[1].text).toMatch(/^\n\*\*SECTION /);
    }
  });

  test('plain papers unchanged when ASSESSMENT_GEN_MODEL_FDE is set', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', answer: 'a', marks: 1 }] } } }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    const args = {
      grade: 5, subject: 'maths', pageContent: '=== Page 12 ===\nFractions', pageReference: '12',
      contentSource: 'unseen', questionCount: 1, questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }],
    };
    await Gen.generateExam(args);
    const without = mockCreate.mock.calls[0];
    mockCreate.mockClear();
    process.env.ASSESSMENT_GEN_MODEL_FDE = FDE;
    await Gen.generateExam(args);
    const withIt = mockCreate.mock.calls[0];
    expect(withIt).toEqual(without);
    expect(withIt[0].model).toBe(DEFAULT);
  });
});

describe('the per-section output ceiling: today\'s 24,000 or more, never less', () => {
  // About 1,000 tokens per written item and 400 per MCQ, never under 24,000 and never over 32,000.
  const ceilings = () => Object.fromEntries(mockCreate.mock.calls.map(([p]) => [sectionOf(p), p.max_tokens]));

  test('maths: A (20 MCQs + 10 written = 18,000) and C (6 written) both keep 24,000', async () => {
    fakeModel('maths');
    await Gen.generatePatternExam(ARGS('maths'));
    expect(P.subjects.maths.sections.find((s) => s.id === 'C').slots.map((s) => [s.shape, s.generate]))
      .toEqual([['draw', 1], ['word_problem', 5]]);
    expect(ceilings()).toEqual({ A: 24000, B: 24000, C: 24000 });
  });

  test('science: A (20 MCQs + 1 frame = 9,000) keeps 24,000', async () => {
    fakeModel('science');
    await Gen.generatePatternExam(ARGS('science'));
    expect(P.subjects.science.sections.find((s) => s.id === 'A').slots.map((s) => [s.shape, s.generate]))
      .toEqual([['mcq', 20], ['frame', 1]]);
    expect(ceilings().A).toBe(24000);
  });

  test('no section of the current pattern sizes above 24,000, so every one keeps it', () => {
    for (const S of Object.values(P.subjects)) {
      for (const section of S.sections) expect([section.id, Gen.sectionMaxTokens(section)]).toEqual([section.id, 24000]);
    }
  });

  test('a section that needs more than 24,000 gets what it needs: 28 written items = 28,000', () => {
    expect(Gen.sectionMaxTokens({ id: 'X', slots: [{ slot: 'x', shape: 'short', generate: 28 }] })).toBe(28000);
  });

  test('a section with more items than the cap is held at 32,000', async () => {
    const big = { id: 'X', slots: [{ slot: 'x', shape: 'short', generate: 40 }] };
    expect(Gen.sectionMaxTokens(big)).toBe(32000);
  });

  test('a cut-off section still fails TRUNCATED', async () => {
    fakeModel('maths');
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 18000 } });
    await expect(Gen.generatePatternExam(ARGS('maths'))).rejects.toMatchObject({ code: 'TRUNCATED' });
  });
});

describe('the request id is on the section and layout log lines', () => {
  test('generating and layout applied carry requestId', async () => {
    fakeModel('maths');
    await Gen.generatePatternExam(ARGS('maths', { requestId: 'req-42' }));
    const sections = logged('[assessment] generating');
    expect(sections).toHaveLength(3);
    sections.forEach((s) => expect(s.requestId).toBe('req-42'));
    expect(logged('[assessment] layout applied')[0].requestId).toBe('req-42');
  });
});
