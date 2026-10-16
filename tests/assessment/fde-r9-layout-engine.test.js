/**
 * The round-9 cross-section hold through the real generator (generatePatternExam), mocked at the
 * edges only (the model client, the logger, the book text): a held item makes its section short,
 * the section is asked once more, and the second reply's item takes the held item's place.
 *
 * Stored papers are sandbox / local generations with no person in them; the extra items are
 * fictional.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 40 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
});
const ARGS = (subject) => ({ grade: 5, subject, pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null }, requestId: 'req-9' });
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, d]) => d);

// One section's reply: the stored paper's items for the slots the prompt asks for, plus `extra`.
function sectionReply(src, prompt, extra) {
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(src.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
      if (mine.length) (tree.unseen[category] ||= {})[type] = mine.concat(extra(mine));
    }
  }
  return reply(JSON.stringify(tree));
}

function slotItems(exam, slot) {
  const out = [];
  for (const types of Object.values(exam.unseen || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q.slot === slot));
  return out;
}

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

test('Social Studies: the Q7 item asking a Q1 fact is held, Section D is asked again, and its new item takes the place', async () => {
  const src = fixture('r9-sst-full2');
  const fresh = [['پاکستان کا قومی پھول کون سا ہے؟', 'چنبیلی'], ['پاکستان کا قومی پرندہ کون سا ہے؟', 'چکور']]
    .map(([question, answer]) => ({
      slot: 'social_studies.D.Q7', question, answer, lines: 0, marks: 2, blooms: 'Remember',
      scheme: { accept: [], points: [{ kind: 'K', text: answer, marks: 2 }], checked: null, common_error: null },
    }));
  let dCalls = 0;
  mockCreate.mockImplementation(async (req) => {
    const prompt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const isD = prompt.includes('"slot": "social_studies.D.Q7"');
    if (isD) dCalls += 1;
    return sectionReply(src, prompt, (mine) => (isD && dCalls === 2 && mine.some((q) => q.slot === 'social_studies.D.Q7') ? fresh : []));
  });
  const out = await Gen.generatePatternExam(ARGS('social_studies'));
  expect(dCalls).toBe(2);
  expect(logged('[assessment] section re-asked')).toEqual([
    expect.objectContaining({ section: 'D', shortfall: [{ slot: 'social_studies.D.Q7', missing: 1 }] }),
  ]);
  const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
  expect(q7).toHaveLength(8);
  expect(q7.some((t) => t.includes('دنیا کی دوسری بڑی نمک کی کان'))).toBe(false);
  expect(q7).toContain('پاکستان کا قومی پھول کون سا ہے؟');
});

test('English: the Q1(a) MCQs carrying Q4 words are held, Section A is asked again, and its new MCQs take their places', async () => {
  const src = fixture('r9-english-giveaway');
  const fresh = ['Pick the plural of box.', 'Which word is a verb?', 'Choose the article: ___ umbrella.', 'Which word is a colour?']
    .map((question, i) => ({
      slot: 'english.A.Q1a', question, options: [`a) one${i}`, `b) two${i}`, `c) three${i}`, `d) four${i}`], answer: `b) two${i}`,
      marks: 1, lines: 0, blooms: 'Remember',
    }));
  let aCalls = 0;
  mockCreate.mockImplementation(async (req) => {
    const prompt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const isA = prompt.includes('"slot": "english.A.Q1a"');
    if (isA) aCalls += 1;
    return sectionReply(src, prompt, (mine) => (isA && aCalls === 2 && mine.some((q) => q.slot === 'english.A.Q1a') ? fresh : []));
  });
  const out = await Gen.generatePatternExam(ARGS('english'));
  expect(aCalls).toBe(2);
  const q1a = slotItems(out.examJson, 'english.A.Q1a');
  const words = slotItems(out.examJson, 'english.C.Q4')[0].words;
  expect(q1a).toHaveLength(20);
  for (const q of q1a) {
    const text = [q.question, ...(q.options || [])].join(' ');
    for (const w of words) expect(text).not.toMatch(new RegExp(`(?<![A-Za-z])${w}(?![A-Za-z])`, 'i'));
  }
  expect(q1a.filter((q) => fresh.some((f) => f.question === q.question))).toHaveLength(3);
});

test('Social Studies: when the re-asked section writes the same questions again, the paper is still made, with no question twice', async () => {
  const src = fixture('r9-sst-full2');
  let dCalls = 0;
  mockCreate.mockImplementation(async (req) => {
    const prompt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const isD = prompt.includes('"slot": "social_studies.D.Q7"');
    if (isD) dCalls += 1;
    if (!isD || dCalls === 1) return sectionReply(src, prompt, () => []);
    // The blind re-ask: every Q7 stem again, each answer worded a little differently.
    const again = JSON.parse(JSON.stringify(src));
    for (const types of Object.values(again.unseen)) {
      for (const list of Object.values(types)) list.forEach((q) => { if (q.slot === 'social_studies.D.Q7') q.answer = `${q.answer} (دوبارہ)`; });
    }
    return sectionReply(again, prompt, () => []);
  });
  const out = await Gen.generatePatternExam(ARGS('social_studies'));
  expect(dCalls).toBe(2);
  const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
  expect(q7).toHaveLength(8);
  expect(new Set(q7).size).toBe(8);
  // Nothing new came back, so the one repeat fills its own place again: a paper with a repeat beats no paper.
  expect(q7.filter((t) => t.includes('دنیا کی دوسری بڑی نمک کی کان'))).toHaveLength(1);
});
