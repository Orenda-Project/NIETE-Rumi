/**
 * Give-aways that survived v24 (bd-5jmnfj.4.55, Phase 1: red tests), writer cases. Pure cases: fde-v25-repeats.test.js.
 *   1 G1 Urdu: «چاند» keys Q3 iv and Q5 v on every reply; the paper was marked ready with only a log.
 *     A repeat never fails a paper: the later item is asked once more, then the paper ships with a log.
 *   3 G2 Urdu: Q1 ix asks the oral poem's question (oral answer «باغ میں»); Section A is never re-asked.
 *   4 G1 English: a read-aloud word still given away after the oral re-ask is never checked again.
 *   8 G5 Science: _writePatternPaper has no end check; a printed give-away on every reply is asked once more, then logged.
 * Harness as fde-v23-repeats.test.js (early writer with fake deps; G5 through the openai mock).
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
function deps(P, family, reply, oralItem) {
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
          slot: sl.slot, question: `Question ${i + 1} for ${sl.slot}`, marks: sl.marks_each, blooms: 'Remember',
          ...(sl.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three'], answer: 'a) one' } : { answer: String(i + 1) }),
          ...(reply(section.id, n[section.id], sl.slot, i) || {}),
          scheme: { points: [{ kind: 'A', text: 'correct', marks: sl.marks_each }] },
          ...(sl.picture ? { picture: sl.picture[0] === 'object' ? { kind: 'object', name: `${sl.slot} thing ${i}` }
            : sl.picture[0] === 'scene' ? { kind: 'scene', describe: 'a park' } : { kind: 'clock', hour: 3, minute: 0 } } : {}),
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
const write = (pattern, grade, subject, reply, oralItem) => {
  const P = Patterns.get(pattern).subjects[subject];
  const h = deps(P, subject, reply, oralItem);
  return writeEarlyPaper({ grade, subject, pattern, P }, h.d).then((out) => ({ out, ...h }), (err) => ({ err, ...h }));
};

describe('item 1: G1 Urdu «چاند» keyed in Q3 iv and Q5 v on every reply', () => {
  const reply = (stuck) => (id, nth, slot, i) => {
    if (slot === 'g1.urdu.A.Q3' && i === 3) return { question: 'چ + ا + ن + د', answer: 'چاند' };
    if (slot === 'g1.urdu.B.Q5' && i === 4 && (stuck || nth < 2)) return { question: 'ستاروں کے ساتھ آسمان پر ___ بھی ہوتا ہے۔', answer: 'چاند' };
    return null;
  };

  // A repeat never costs the teacher a paper (lead's v25 redesign: no ANSWER_GIVEAWAY failure). A printed
  // give-away left after the late re-ask is asked exactly once more; still there, the paper ships and is logged.
  test('a printed give-away left after the late re-ask is asked once more, then the paper is returned and logged', async () => {
    const { err, out, calls, d } = await write('fde_g1_2026', 1, 'urdu', reply(true));
    expect(err).toBeUndefined();
    expect(out.examJson).toBeTruthy();
    const b = calls.filter((c) => c.id === 'B');
    expect(b).toHaveLength(4); // first reply, re-ask, late re-ask, and exactly one more
    expect(b[3].user).toMatch(/چاند/);
    const logged = d.logToFile.mock.calls.filter(([m]) => m === '[assessment] answers given away');
    expect(logged).toHaveLength(1);
    expect(logged[0][1].giveaways).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: 'g1.urdu.B.Q5', words: expect.arrayContaining(['چاند']) })]));
  });

  test('control: a give-away fixed by the first re-ask still yields a paper', async () => {
    const { err, out, calls } = await write('fde_g1_2026', 1, 'urdu', reply(false));
    expect(err).toBeUndefined();
    expect(out.examJson).toBeTruthy();
    expect(calls.filter((c) => c.id === 'B')).toHaveLength(2); // no late re-ask, so no last one either
  });
});

describe('item 3: G2 Urdu Q1 ix asks the oral poem\'s question', () => {
  const ask = 'بچہ صبح سویرے اٹھ کر کہاں پہنچتا ہے؟';
  const reply = (id, nth, slot, i) => (slot === 'g2.urdu.A.Q1' && i === 8 && nth === 1
    ? { question: `«نظم: صبح کی مسرت» میں ${ask}`, options: ['الف) باغ', 'ب) گھر', 'ج) سکول'], answer: 'الف) باغ' } : null);
  const oral = (answer) => (task, nth, i) => (task === 'poem' && i === 0 ? { ask, answer } : null);

  test('Section A is asked again, and its note names «باغ»', async () => {
    const { err, calls } = await write('fde_g2_2026', 2, 'urdu', reply, oral('باغ میں'));
    expect(err).toBeUndefined();
    const a = calls.filter((c) => c.id === 'A');
    expect(a).toHaveLength(2);
    expect(a[1].user).toMatch(/باغ/);
  });

  test('control: an oral answer that is not the written key leaves Section A asked once', async () => {
    const { err, calls } = await write('fde_g2_2026', 2, 'urdu', reply, oral('اسکول میں'));
    expect(err).toBeUndefined();
    expect(calls.filter((c) => c.id === 'A')).toHaveLength(1);
  });
});

describe('item 4: G1 English read-aloud give-away still there after the oral re-ask', () => {
  const reply = (id, nth, slot, i) => (slot === 'g1.english.A.Q3' && i === 0 ? { answer: 'cat' } : null);
  const oral = (stuckUntil) => (task, nth, i) => (task === 'read_aloud' && i === 0 ? { ask: nth <= stuckUntil ? 'cat' : 'bed' } : null);

  test('the oral sheet is checked again and re-asked once more, naming cat', async () => {
    const { err, oralCalls } = await write('fde_g1_2026', 1, 'english', reply, oral(2));
    expect(err).toBeUndefined();
    expect(oralCalls).toHaveLength(3);
    expect(oralCalls[2]).toMatch(/cat/);
  });

  test('control: an oral re-ask that comes back clean is not asked a third time', async () => {
    const { err, oralCalls } = await write('fde_g1_2026', 1, 'english', reply, oral(1));
    expect(err).toBeUndefined();
    expect(oralCalls).toHaveLength(2);
  });
});

describe('item 8: the G5 generation path checks give-aways at the end', () => {
  const science = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'science.json'), 'utf8'));
  // Section A keys «Decibels» on Q1(a) i; Section C's Q3(a) 1 carries «decibels» on EVERY reply, in the stem or the answer.
  const replyWith = (where) => (sec, prompt) => {
    const tree = { unseen: {} };
    for (const [category, types] of Object.entries(science.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = JSON.parse(JSON.stringify(list.filter((q) => prompt.includes(`"slot": "${q.slot}"`))));
        if (!mine.length) continue;
        if (mine[0].slot === 'science.A.Q1a') Object.assign(mine[0], { question: 'Which unit measures loudness?', options: ['a) Metre', 'b) Decibels', 'c) Litre', 'd) Gram'], answer: 'b) Decibels' });
        if (mine[0].slot === 'science.C.Q3a' && where === 'stem') mine[0].question = 'Name the unit of loudness, which is decibels, and say what it measures.';
        if (mine[0].slot === 'science.C.Q3a' && where === 'answer') mine[0].answer = 'Loudness is measured with a sound meter that reads decibels.';
        (tree.unseen[category] ||= {})[type] = mine;
      }
    }
    return tree;
  };
  const generate = async (where) => {
    jest.resetModules();
    Object.assign(process.env, { OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' });
    for (const k of ['LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_FDE']) delete process.env[k];
    Object.assign(mockState, { logs: [], openrouter: [], n: {}, reply: replyWith(where) });
    await require('../../bot/shared/config/model-settings').refresh();
    const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
    return Gen.generatePatternExam({ grade: 5, subject: 'science', pattern: 'fde_g5_2027',
      scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null, requestId: `req-v25-${where}` });
  };

  // As item 1: asked exactly once more after the late re-ask, then returned with the give-away logged.
  test('a key printed in another stem after every re-ask is asked once more, then the paper is returned and logged', async () => {
    const out = await generate('stem');
    expect(out.examJson).toBeTruthy();
    expect(mockState.n.C).toBe(4); // first reply, re-ask, late re-ask, and exactly one more
    const lastC = mockState.openrouter.filter((p) => /\*\*SECTION C\*\*/.test(p.messages[1].content)).pop();
    expect(lastC.messages[1].content).toMatch(/decibels/i);
    const logged = mockState.logs.filter(([m]) => m === '[assessment] answers given away');
    expect(logged).toHaveLength(1);
    expect(logged[0][1].giveaways).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: 'science.C.Q3a', printed: true })]));
  });

  test('control: a key found only in another item\'s answer text does not fail the paper', async () => {
    const out = await generate('answer');
    expect(out.examJson).toBeTruthy();
    expect(mockState.n.C).toBe(3); // answer text only: not asked the last time
  });
});
