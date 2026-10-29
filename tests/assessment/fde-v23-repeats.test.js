/**
 * Give-aways that survived v23 (bd-5jmnfj.4.51.3, Phase 1: red tests).
 *   1 G1 English: the oral read-aloud words cat, sun, pen are also written answers in Q3/Q4.
 *   2 G1 Urdu: the same parrot picture and word in Q3 ii and Q4 i (one re-ask, never re-checked).
 *   3 G2 Urdu: the poem title in Q1 vii holds «بادل», the blank answer of Q3 ii.
 *   4 G5 Urdu: «بگولا» is a Q4 syllable word and inside Q5's idiom «آگ بگولا ہونا».
 *   5 G5 Science: Q1(a) iv prints Virus, Q3(a) 3 asks it again; Q1(a) xi (salt water) gives Q2(b)(i) away;
 *     and the G5 generation path never re-asks for a give-away at all.
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
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockState.logs.push(a) }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 10 ===\nPlants make food.', pageReference: String(pageRanges) }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const { writeEarlyPaper } = require('../../bot/shared/services/assessment/fde-early-writer');
const { NO_PICTURES } = require('../../bot/shared/services/assessment/fde-early-prompt');

const exam = (...items) => ({ unseen: { subjective: { Q: items } } });
const flagged = (flags, slot) => flags.find((f) => f.slot === slot);

// The early writer with fake deps (as fde-answer-repeats.test.js): `reply(sectionId, nth, slot, i)` edits one item,
// `oralItems(nth)` replaces the read-aloud items. Records every section call and every oral call.
function deps(P, family, reply, oralItems) {
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
          items: Array.from({ length: t.n || 0 }, (_, i) => ({ ask: (t.id === 'read_aloud' && oralItems && oralItems(oralN)[i]) || `ask ${i}` })) })) } };
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
const write = (pattern, grade, subject, family, reply, oralItems) => {
  const P = Patterns.get(pattern).subjects[subject];
  const h = deps(P, family, reply, oralItems);
  return writeEarlyPaper({ grade, subject, pattern, P }, h.d).then((out) => ({ out, ...h }));
};

describe('case 1: G1 English oral read-aloud words are written answers', () => {
  const Q3 = ['cat', 'pin', 'van', 'mop'];
  const Q4 = ['sun', 'pen', 'hat', 'cup', 'dog'];
  const reply = (id, nth, slot, i) => (slot === 'g1.english.A.Q3' && Q3[i] ? { answer: Q3[i] } : slot === 'g1.english.A.Q4' && Q4[i] ? { answer: Q4[i] } : null);
  const oral = (nth) => (nth === 1 ? ['cat', 'sun', 'pen', 'the', 'and', 'she'] : ['bed', 'jug', 'map', 'the', 'and', 'she']);

  test('the oral read-aloud is re-asked once, told the written words, and the paper ends clean', async () => {
    const { out, calls, oralCalls } = await write('fde_g1_2026', 1, 'english', 'english', reply, oral);
    expect(oralCalls).toHaveLength(2);
    expect(oralCalls[1]).toMatch(/cat/);
    expect(oralCalls[1]).toMatch(/sun/);
    expect(oralCalls[1]).toMatch(/pen/);
    expect(calls.filter((c) => c.id === 'A')).toHaveLength(1);
    expect(answerRepeats(out.examJson)).toEqual([]);
  });
});

describe('case 2: G1 Urdu parrot, one re-ask is not the end of it', () => {
  // Q3 ii keys «طوطا» (a picture item); Q4 i keys it too, however often Section B is asked, until the 3rd time.
  const reply = (id, nth, slot, i) => {
    if (slot === 'g1.urdu.A.Q3' && i === 1) return { question: 'ط + و + ط + ا', answer: 'طوطا' };
    if (slot === 'g1.urdu.B.Q4' && i === 0 && nth < 3) return { question: 'اس تصویر کا نام لکھیں۔', answer: 'طوطا' };
    return null;
  };

  test('a give-away still there after the first re-ask is asked again, and the paper ends clean', async () => {
    const { out, calls, d } = await write('fde_g1_2026', 1, 'urdu', 'urdu', reply);
    expect(calls.filter((c) => c.id === 'B')).toHaveLength(3);
    expect(calls[calls.length - 1].user).toMatch(/طوطا/);
    expect(answerRepeats(out.examJson)).toEqual([]);
    expect(d.logToFile).not.toHaveBeenCalledWith('[assessment] answers given away', expect.anything());
  });

  test('a picture subject printed on one item counts against another item that keys it', () => {
    const flags = answerRepeats(exam(
      { slot: 'g1.urdu.A.Q3', question: 'ط + و + ط + ا', answer: 'طوطا', picture: { kind: 'object', name: 'parrot' } },
      { slot: 'g1.urdu.B.Q4', question: 'اس تصویر کا نام لکھیں۔', answer: 'parrot', picture: { kind: 'object', name: 'طوطا' } },
    ));
    expect(flagged(flags, 'g1.urdu.B.Q4')).toBeTruthy();
  });
});

describe('case 3: G2 Urdu poem title holds the blank answer', () => {
  const reply = (id, nth, slot, i) => {
    if (slot === 'g2.urdu.A.Q1' && i === 0) return { question: 'نظم "کالے بادل آئیں گے" کے شاعر کون ہیں؟', options: ['الف) قیوم نظر', 'ب) صوفی تبسم', 'ج) نادیہ نغمان'], answer: 'ب) صوفی تبسم' };
    if (slot === 'g2.urdu.A.Q3' && i === 1) return { question: 'آسمان پر کالے ___________ آئیں گے۔', answer: nth < 3 ? 'بادل' : 'گھٹائیں' };
    return null;
  };

  test('same-section give-away: the flagged blank is re-asked until the title no longer gives it away', async () => {
    const { out, calls } = await write('fde_g2_2026', 2, 'urdu', 'urdu', reply);
    expect(calls.filter((c) => c.id === 'A')).toHaveLength(3);
    expect(answerRepeats(out.examJson)).toEqual([]);
  });
});

describe('case 4: G5 Urdu «بگولا» in Q4 and inside Q5\'s idiom', () => {
  const Q4 = { slot: 'urdu.C.Q4', kind: 'syllables', question: 'درج ذیل الفاظ کو ان کے ارکان میں الگ کر کے لکھیں: بگولا، رضامند', answer: 'بگولا: ب – گو – لا\nرضامند: رضا – مند' };
  const Q5 = { slot: 'urdu.C.Q5', question: 'ان الفاظ کے معنی لکھیں۔', words: ['راہ گیر', 'بوسیدہ', 'اہل وعیال', 'کرکرا', 'آگ بگولا ہونا'], answer: 'آگ بگولا ہونا: بہت غصے میں آنا' };

  test('a word the syllable question lists is flagged on the later question that uses it', () => {
    const f = flagged(answerRepeats(exam(Q4, Q5)), 'urdu.C.Q5');
    expect(f).toBeTruthy();
    expect(f.words).toContain('بگولا');
  });

  test('unrelated Urdu items stay clean', () => {
    expect(answerRepeats(exam(Q4, { ...Q5, words: ['راہ گیر', 'بوسیدہ', 'کرکرا'], answer: 'راہ گیر: مسافر' }))).toEqual([]);
  });
});

describe('case 5: G5 Science give-aways', () => {
  const Q1a = (question, options, answer) => ({ slot: 'science.A.Q1a', question, options, answer });

  test('Q1(a) iv\'s key (Virus) is what Q3(a) 3 answers', () => {
    const flags = answerRepeats(exam(
      Q1a('Which type of microorganism must live inside the cells of other living things to grow?', ['a) Yeast', 'b) Virus', 'c) Bacteria', 'd) Fungi'], 'b) Virus'),
      { slot: 'science.C.Q3a', question: 'Name the three main groups of microorganisms. Which group must live inside the cells of other living things to grow?',
        answer: 'The three main groups are bacteria, viruses and fungi. Viruses must live inside the cells of other living things to grow.' },
    ));
    const f = flagged(flags, 'science.C.Q3a');
    expect(f).toBeTruthy();
    expect(f.words.some((w) => /^virus/.test(w))).toBe(true);
  });

  test('Q1(a) xi (salt water rusts nails fastest) gives Q2(b)(i) away', () => {
    const flags = answerRepeats(exam(
      Q1a('Four identical iron nails are kept in four jars. In which jar will the nails rust fastest?', ['a) A dry jar', 'b) A jar with oil', 'c) A jar with plain water', 'd) A jar with salt water'], 'd) A jar with salt water'),
      { slot: 'science.B.Q2b', question: 'A child puts two iron nails in two jars, one with plain water and one with salty water.',
        questions: [{ question: 'In which jar do the nails rust faster, and why?', answer: 'The jar with salty water, because salt makes iron rust faster.' }], answer: '' },
    ));
    expect(flagged(flags, 'science.B.Q2b')).toBeTruthy();
  });

  test('two unrelated science items stay clean', () => {
    expect(answerRepeats(exam(
      Q1a('Which unit measures loudness?', ['a) Metre', 'b) Decibel', 'c) Litre'], 'b) Decibel'),
      { slot: 'science.C.Q3a', question: 'Name two states of matter.', answer: 'Solid and liquid.' },
    ))).toEqual([]);
  });
});

describe('case 5: the G5 generation path re-asks for a give-away', () => {
  const science = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'science.json'), 'utf8'));
  // Section A keys «Decibels» on Q1(a) i; Section C's first reply prints it in Q3(a) 1; its second does not.
  mockState.reply = (sec, prompt, nth) => {
    const tree = { unseen: {} };
    for (const [category, types] of Object.entries(science.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = JSON.parse(JSON.stringify(list.filter((q) => prompt.includes(`"slot": "${q.slot}"`))));
        if (!mine.length) continue;
        if (mine[0].slot === 'science.A.Q1a') Object.assign(mine[0], { question: 'Which unit measures loudness?', options: ['a) Metre', 'b) Decibels', 'c) Litre', 'd) Gram'], answer: 'b) Decibels' });
        if (mine[0].slot === 'science.C.Q3a' && nth === 1) mine[0].question = 'Name the unit of loudness, which is decibels, and say what it measures.';
        (tree.unseen[category] ||= {})[type] = mine;
      }
    }
    return tree;
  };

  test('Section C is asked again with a note naming the word, and the paper ends clean', async () => {
    jest.resetModules();
    Object.assign(process.env, { OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' });
    for (const k of ['LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_FDE']) delete process.env[k];
    Object.assign(mockState, { logs: [], openrouter: [], n: {} });
    await require('../../bot/shared/config/model-settings').refresh();
    const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'science', pattern: 'fde_g5_2027',
      scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null, requestId: 'req-v23-g5' });
    const c = mockState.openrouter.filter((p) => /\*\*SECTION C\*\*/.test(p.messages[1].content));
    expect(c).toHaveLength(2);
    expect(c[1].messages[1].content).toMatch(/already appear elsewhere on this paper: decibels/);
    expect(answerRepeats(out.examJson)).toEqual([]);
  });
});
