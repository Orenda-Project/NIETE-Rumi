/**
 * bd-5jmnfj.4.58.2, v26 G1 English: a spoon is the picture of Q7 v and of Q12 i. The re-ask for a repeated picture was
 * followed by no check, so a repeat left after it was only logged. A repeat never costs the teacher a paper: the later
 * section is asked once more, and one still there ships with a log. Harness as fde-v25-repeats-writers.test.js,
 * with the picture name set by the test.
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockState.logs.push(a) }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 10 ===\nPlants make food.', pageReference: String(pageRanges) }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { writeEarlyPaper } = require('../../bot/shared/services/assessment/fde-early-writer');
const { NO_PICTURES } = require('../../bot/shared/services/assessment/fde-early-prompt');

// `reply(sectionId, nth, slot, i)` edits one written item; `oralItem(taskId, nth, i)` edits one oral item.
function deps(P, family, reply, oralItem, pic) {
  const calls = [];
  const oralCalls = [];
  const n = {};
  let oralN = 0;
  const d = {
    family,
    loadPatternContent: async () => ({ content: 'BOOK', pageReference: '1-50' }),
    patternModel: () => ({ model: 'test/model', job: 'assessment.generate' }),
    resolveModelForJob: () => ({ model: 'test/model' }),
    buildSystemPrompt: () => 'SYSTEM',
    sectionText: (s, loaded) => ({ content: loaded.content, pageReference: loaded.pageReference }),
    buildPatternUserPrompt: ({ section }) => `PROMPT ${section.id}\n${NO_PICTURES}`,
    sectionMessages: ({ system, user }) => [{ role: 'system', content: system }, { role: 'user', content: user }],
    warmSharedPrefixes: async () => [],
    writeSection: jest.fn(async ({ messages, section }) => {
      const usages = [{ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 }];
      if (section.id === 'oral') {
        oralN += 1;
        oralCalls.push(messages[1].content);
        return { usages, tree: { oral: P.oral.tasks.map((t) => ({ id: t.id, script: 'Story.',
          items: Array.from({ length: t.n || 0 }, (_, i) => ({ ask: `ask ${i}`, ...((oralItem && oralItem(t.id, oralN, i)) || {}) })) })) } };
      }
      calls.push({ id: section.id, user: messages[1].content });
      n[section.id] = (n[section.id] || 0) + 1;
      const tree = { unseen: { objective: {}, subjective: {} } };
      section.slots.forEach((sl) => {
        const list = Array.from({ length: sl.generate }, (_, i) => ({
          slot: sl.slot, question: `Question ${i + 1} for ${sl.slot} qq${i}z`, marks: sl.marks_each, blooms: 'Remember',
          ...(sl.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three'], answer: 'a) one' } : { answer: `ans${sl.slot.replace(/\W/g, '')}x${i}` }),
          ...((reply && reply(section.id, n[section.id], sl.slot, i)) || {}),
          scheme: { points: [{ kind: 'A', text: 'correct', marks: sl.marks_each }] },
          ...(sl.picture ? { picture: sl.picture[0] === 'object' ? { kind: 'object', name: (pic && pic(section.id, n[section.id], sl.slot, i)) || `${sl.slot} thing ${i}` }
            : sl.picture[0] === 'scene' ? { kind: 'scene', describe: 'a park, the child who speaks on the right' } : { kind: 'clock', hour: 3, minute: 0 } } : {}),
        }));
        (tree.unseen[sl.category][sl.type] = tree.unseen[sl.category][sl.type] || []).push(...list);
      });
      return { tree, usages };
    }),
    mergeSections: (trees) => {
      const out = { unseen: { objective: {}, subjective: {} } };
      trees.forEach((t) => Object.entries(t.unseen).forEach(([cat, types]) => Object.entries(types).forEach(([type, list]) => {
        out.unseen[cat][type] = (out.unseen[cat][type] || []).concat(JSON.parse(JSON.stringify(list)));
      })));
      return out;
    },
    stripImageKeys: () => {},
    normaliseAnswers: () => {},
    emptyQuestionParts: () => [],
    topUp: (first, second) => second,
    sumUsage: () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 }),
    countQuestions: () => 1,
    fail: (code, message, extra) => Object.assign(new Error(message), { code }, extra),
    logToFile: jest.fn(),
    resolvePictures: async (examJson) => examJson,
  };
  return { d, calls, oralCalls };
}
const write = (pattern, grade, subject, reply, oralItem, pic) => {
  const P = Patterns.get(pattern).subjects[subject];
  const h = deps(P, subject, reply, oralItem, pic);
  return writeEarlyPaper({ grade, subject, pattern, P }, h.d).then((out) => ({ out, ...h }), (err) => ({ err, ...h }));
};

describe('G1 English: the spoon in Q7 v and Q12 i (bd-5jmnfj.4.58.2)', () => {
  const spoon = (stuck) => (id, nth, slot, i) => {
    if (slot === 'g1.english.B.Q7' && i === 4) return 'spoon';
    if (slot === 'g1.english.C.Q12' && i === 0 && (stuck || nth < 2)) return 'a spoon';
    return null;
  };

  test('a repeat left after the first re-ask is asked once more, then the paper ships and is logged', async () => {
    const { err, out, calls, d } = await write('fde_g1_2026', 1, 'english', null, null, spoon(true));
    expect(err).toBeUndefined();
    expect(out.examJson).toBeTruthy();
    const c = calls.filter((x) => x.id === 'C');
    expect(c).toHaveLength(3); // first reply, re-ask, and exactly one more
    expect(c[2].user).toMatch(/spoon/);
    const logged = d.logToFile.mock.calls.filter(([m]) => m === '[assessment] repeated pictures');
    expect(logged).toHaveLength(1);
  });

  test('control: a repeat fixed by the first re-ask is not asked again', async () => {
    const { err, calls, d } = await write('fde_g1_2026', 1, 'english', null, null, spoon(false));
    expect(err).toBeUndefined();
    expect(calls.filter((x) => x.id === 'C')).toHaveLength(2);
    expect(d.logToFile.mock.calls.filter(([m]) => m === '[assessment] repeated pictures')).toHaveLength(0);
  });
});
