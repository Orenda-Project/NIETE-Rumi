/**
 * A give-away re-ask that comes back short is topped up, not failed (bd-5jmnfj.4.54).
 *
 * v24 G5 Urdu failed twice with PATTERN_SHORT_SLOT: the late give-away re-ask (bd-5jmnfj.4.51.3) takes
 * Section A's new reply whole, the new reply was 1-4 Q1 items short, and the Section A top-up had
 * already run before it. Here Section A gives «Decibels» away inside Q1(a) on its first two replies;
 * its third is clean but one item short, so the section is topped up once for the missing item.
 */

const mockState = { logs: [], openrouter: [], n: {} };

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async (params) => {
    mockState.openrouter.push(params);
    const sec = /\*\*SECTION (\w+)\*\*/.exec(params.messages[1].content)[1];
    mockState.n[sec] = (mockState.n[sec] || 0) + 1;
    return {
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(mockState.reply(sec, params.messages[1].content, mockState.n[sec])) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
    };
  } } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() { return { messages: { create: async () => { throw new Error('direct lane not used'); } } }; });
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: () => {} }));
// The science fixture predates the v29 whole-paper give-away checks (MCQ/concept/fraction); they are pinned in fde-v29-g5-*.test.js (bd-5jmnfj.4.58.4).
jest.mock('../../bot/shared/services/assessment/fde-g5-paper-giveaways', () => ({ paperGiveaways: () => [] }));
// Same for the Science give-away flags (bd-5jmnfj.4.58 v37 round 8): the stock science fixture overlaps topically (lungs, brain, living things), so first-pass flags would add re-asks this test does not count. The flags are pinned in fde-v37-science-r3.test.js.
jest.mock('../../bot/shared/services/assessment/fde-science-giveaway-drop', () => ({ ...jest.requireActual('../../bot/shared/services/assessment/fde-science-giveaway-drop'), scienceGiverFlags: () => [] }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockState.logs.push(a) }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 10 ===\nPlants make food.', pageReference: String(pageRanges) }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const fs = require('fs');
const path = require('path');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const science = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'science.json'), 'utf8'));

// Section A, reply `nth`: 1 and 2 key «Decibels» in Q1(a) i and offer it again in Q1(a) ii;
// 3 is clean but drops the last Q1(a) item; 4 (the top-up) is the whole clean section.
mockState.reply = (sec, prompt, nth) => {
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(science.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      let mine = JSON.parse(JSON.stringify(list.filter((q) => prompt.includes(`"slot": "${q.slot}"`))));
      if (!mine.length) continue;
      if (mine[0].slot === 'science.A.Q1a') {
        Object.assign(mine[0], { question: 'Which unit measures loudness?', options: ['a) Metre', 'b) Decibels', 'c) Litre', 'd) Gram'], answer: 'b) Decibels' });
        if (nth <= 2) Object.assign(mine[1], { question: 'Which unit measures how often a sound wave repeats?', options: ['a) Decibels', 'b) Hertz', 'c) Volts', 'd) Watts'], answer: 'b) Hertz' });
        if (nth === 3) mine = mine.slice(0, -1);
      }
      (tree.unseen[category] ||= {})[type] = mine;
    }
  }
  return tree;
};

describe('a give-away re-ask that comes back short (bd-5jmnfj.4.54)', () => {
  test('the section is topped up once for the missing item and the paper ends whole and clean', async () => {
    jest.resetModules();
    Object.assign(process.env, { OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' });
    for (const k of ['LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_FDE']) delete process.env[k];
    Object.assign(mockState, { logs: [], openrouter: [], n: {} });
    await require('../../bot/shared/config/model-settings').refresh();
    const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'science', pattern: 'fde_g5_2027',
      scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null, requestId: 'req-v24-topup' });
    const a = mockState.openrouter.filter((p) => /\*\*SECTION A\*\*/.test(p.messages[1].content));
    expect(a).toHaveLength(4);
    expect(out.examJson.unseen.objective.MCQs.filter((q) => q.slot === 'science.A.Q1a')).toHaveLength(20);
    expect(answerRepeats(out.examJson)).toEqual([]);
    expect(mockState.logs.some(([msg, d]) => msg === '[assessment] section topped up after give-away' && d.section === 'A')).toBe(true);
  });
});
