/**
 * On the direct Anthropic lane a pattern paper's shared prefix is written to the cache ONCE, before
 * the sections, so the sections read it.
 *
 * Every section of a science, English, Urdu or social-studies paper is sent the same system prompt
 * and the same book text (tens of thousands of tokens); only the section's own slots and rules
 * differ, and they come after the book text. Sections run in parallel, and a cache entry is only
 * readable once the request that writes it has started answering, so sections sent together would
 * each write the prefix and none would read it. So one warm call (the same prefix, the same model and
 * effort, `max_tokens: 1`) goes first; the sections follow it. A maths paper's sections are set from
 * different pages, share no book block, and get no warm call. Off the direct lane nothing changes.
 *
 * This drives the REAL generator through the REAL model client and the real translation to
 * /v1/messages, and stops at the network boundary: both SDKs are mocked and record what they send.
 */

const mockState = { sent: [], openrouter: [], logs: [], events: [], warmFails: false };

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async (params) => {
    mockState.openrouter.push(params);
    const sec = /\*\*SECTION (\w+)\*\*/.exec(params.messages[1].content)[1];
    return {
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(mockState.reply(sec, params.messages[1].content)) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
    };
  } } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return {
    messages: {
      create: async (body, options) => {
        mockState.sent.push({ body, options });
        if (body.max_tokens === 1) {
          mockState.events.push('warm-start');
          await new Promise((r) => setTimeout(r, 20));
          mockState.events.push('warm-end');
          if (mockState.warmFails) throw Object.assign(new Error('overloaded'), { status: 529 });
          return {
            id: 'msg_warm', model: 'claude-sonnet-5-5', stop_reason: 'max_tokens', content: [],
            usage: { input_tokens: 5, cache_creation_input_tokens: 12000, cache_read_input_tokens: 0, output_tokens: 0 },
          };
        }
        mockState.events.push('section');
        const text = body.messages[0].content.map((p) => p.text).join('');
        const sec = /\*\*SECTION (\w+)\*\*/.exec(text)[1];
        return {
          id: `msg_${sec}`, model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(mockState.reply(sec, text)) }],
          usage: { input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 12000, output_tokens: 3000 },
        };
      },
    },
  };
});
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: () => {} }));
// The science fixture predates the v29 whole-paper give-away checks (MCQ/concept/fraction); they are pinned in fde-v29-g5-*.test.js (bd-5jmnfj.4.58.4).
jest.mock('../../bot/shared/services/assessment/fde-g5-paper-giveaways', () => ({ paperGiveaways: () => [] }));
// Same for the Science give-away flags (bd-5jmnfj.4.58 v37 round 8): the stock science fixture overlaps topically (lungs, brain, living things), so first-pass flags would add re-asks this test does not count. The flags are pinned in fde-v37-science-r3.test.js.
jest.mock('../../bot/shared/services/assessment/fde-science-giveaway-drop', () => ({ ...jest.requireActual('../../bot/shared/services/assessment/fde-science-giveaway-drop'), scienceGiverFlags: () => [] }));
jest.mock('../../bot/shared/services/assessment/fde-science-key-stem', () => ({ ...jest.requireActual('../../bot/shared/services/assessment/fde-science-key-stem'), keyStemFlags: () => [] })); // stock science replies restate their stems; pinned in fde-science-key-stem.test.js (bd-5jmnfj.4.58 v37r4)
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockState.logs.push(a) }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }));

const BOOK = {
  science: '=== Page 10 ===\nPlants make food.\n\n=== Page 60 ===\nForces.',
  maths: '=== Page 5 ===\nPlace value.\n\n=== Page 100 ===\nDecimals.\n\n=== Page 220 ===\nAngles.\n\n=== Page 255 ===\nAverages.',
};
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ subject, pageRanges }) => ({ content: mockState.book[subject], pageReference: String(pageRanges) }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));
mockState.book = BOOK;

const fs = require('fs');
const path = require('path');

const FIXTURES = { science: 'science', maths: 'maths' };
mockState.reply = (sec, prompt) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${FIXTURES[mockState.subject]}.json`), 'utf8'));
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(fixture.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
      if (mine.length) ((tree.unseen[category] ||= {})[type] = mine);
    }
  }
  return tree;
};

const OLD_ENV = { ...process.env };
afterEach(() => { process.env = { ...OLD_ENV }; });

async function load(subject, { direct = true, warmFails = false } = {}) {
  jest.resetModules();
  for (const k of ['LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG', 'ASSESSMENT_GEN_MODEL_URDU', 'ASSESSMENT_GEN_MODEL_FDE']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', ANTHROPIC_API_KEY: 'test-key',
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    ...(direct ? { ASSESSMENT_GEN_MODEL_FDE: 'anthropic-direct/claude-sonnet-5-5' } : {}),
  });
  Object.assign(mockState, { subject, sent: [], openrouter: [], logs: [], events: [], warmFails });
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  // eslint-disable-next-line global-require
  const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
  return Gen.generatePatternExam({
    grade: 5, subject, pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
    pageRanges: null, chapterNumber: null, requestId: `req-${subject}`,
  });
}

const logged = (line) => mockState.logs.filter(([l]) => l === line).map(([, d]) => d);
const warms = () => mockState.sent.filter(({ body }) => body.max_tokens === 1);
const sections = () => mockState.sent.filter(({ body }) => body.max_tokens !== 1);
const cachedPrefix = (body) => JSON.stringify([body.system, body.messages[0].content[0]]);

test('(a) science on the direct lane: one warm call first, then the sections read the cache', async () => {
  const out = await load('science');
  expect(out.examJson).toBeTruthy();

  // Exactly one warm call, finished before any section was sent.
  expect(warms()).toHaveLength(1);
  expect(sections()).toHaveLength(3);
  expect(mockState.events).toEqual(['warm-start', 'warm-end', 'section', 'section', 'section']);

  // The warm call carries the sections' exact cached prefix, and their effort, with no output.
  const warm = warms()[0].body;
  expect(warm.model).toBe('claude-sonnet-5-5');
  expect(warm.output_config).toEqual({ effort: 'low' });
  expect(warm.thinking).toBeUndefined();
  expect(warm.messages[0].content).toHaveLength(2);
  expect(warm.messages[0].content[1].cache_control).toBeUndefined();
  for (const { body } of sections()) {
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    const [book, rest] = body.messages[0].content;
    expect(book.cache_control).toEqual({ type: 'ephemeral' });
    expect(book.text).toMatch(/Plants make food\.[\s\S]*Forces\.\n```\n$/);
    expect(rest.cache_control).toBeUndefined();
    expect(cachedPrefix(body)).toBe(cachedPrefix(warm));
    expect(body.output_config).toEqual(warm.output_config);
  }

  // Each section's read is mapped and logged.
  const lines = logged('[assessment] generating');
  expect(lines.map((d) => d.cachedTokens)).toEqual([12000, 12000, 12000]);
  lines.forEach((d) => expect(d.requestId).toBe('req-science'));
  out.sections.forEach((s) => expect(s.usage.cached_tokens).toBe(12000));
  expect(logged('[assessment] cache warmed')).toEqual([expect.objectContaining({ requestId: 'req-science', sections: ['A', 'B', 'C'] })]);

  // The warm call is billed, so it is in the paper's totals: 12,005 + 3 x 12,900 input.
  expect(out.tokenData.inputTokens).toBe(12005 + 3 * 12900);
  expect(out.tokenData.outputTokens).toBe(3 * 3000);
  const warmCost = (5 * 2 + 12000 * 2.5) / 1e6;
  const sectionCost = (900 * 2 + 12000 * 0.2 + 3000 * 10) / 1e6;
  expect(out.tokenData.cost).toBeCloseTo(warmCost + 3 * sectionCost, 10);
});

test('(b) maths on the direct lane: the sections share no book block, so no warm call', async () => {
  const out = await load('maths');
  expect(out.examJson).toBeTruthy();
  expect(warms()).toHaveLength(0);
  expect(sections()).toHaveLength(3);
  expect(new Set(sections().map(({ body }) => cachedPrefix(body))).size).toBe(3);
  expect(logged('[assessment] cache warmed')).toHaveLength(0);
});

test('(c) off the direct lane: no warm call, and today\'s plain string messages', async () => {
  const out = await load('science', { direct: false });
  expect(out.examJson).toBeTruthy();
  expect(mockState.sent).toHaveLength(0);
  expect(mockState.openrouter).toHaveLength(3);
  for (const params of mockState.openrouter) {
    expect(typeof params.messages[0].content).toBe('string');
    expect(typeof params.messages[1].content).toBe('string');
    expect(JSON.stringify(params)).not.toMatch(/cache_control/);
  }
  expect(logged('[assessment] cache warmed')).toHaveLength(0);
  expect(logged('[assessment] cache warm failed')).toHaveLength(0);
});

test('(d) a warm call that fails never fails the paper', async () => {
  const out = await load('science', { warmFails: true });
  expect(out.examJson).toBeTruthy();
  expect(sections()).toHaveLength(3);
  expect(logged('[assessment] cache warm failed')).toEqual([expect.objectContaining({ requestId: 'req-science', error: expect.any(String) })]);
  // Nothing billed for it, nothing added.
  expect(out.tokenData.inputTokens).toBe(3 * 12900);
});
