/**
 * The round-9 cross-section hold through the real generator (generatePatternExam), mocked at the
 * edges only (the model client, the logger, the book text): a held item makes its section short,
 * the section is asked once more, and the second reply's item takes the held item's place.
 *
 * Stored papers are sandbox / local generations with no person in them; the extra items are
 * fictional.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
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
  // Since round 17 the three held Q6s never print, so Q6 ends short of four and the paper fails as a
  // short paper; the laid-out paper rides on the error.
  const err = await Gen.generatePatternExam(ARGS('social_studies')).catch((e) => e);
  expect(err.code).toBe('PATTERN_SHORT_SLOT');
  // Q1 is short as well: two Q1 items are given away by a C/D stem that prints their key on the same
  // topic (Q1 «… لفظ "قوم" کس رہنما نے …» → سرسید احمد خان beside a Q6 on his two-nation theory; Q1
  // «… اونٹ پالتے ہیں۔ یہ کون سا طبعی خطہ ہے؟» → صحرائی علاقہ beside Q5 «صحرائی علاقے کے لوگ … اونٹ کیوں
  // پالتے ہیں؟»), and this mock answers every re-ask with the stored paper, so nothing new takes their place.
  expect(err.shortfall.map((f) => f.slot)).toEqual(['social_studies.A.Q1', 'social_studies.D.Q6']);
  const out = err;
  // Round 15: the re-ask brings new Q7s but the same three held Q6s, so D is asked once more.
  expect(dCalls).toBe(3);
  // Section C is asked again too: its Q5 «کثیر الثقافتی معاشرے … کیا فائدہ» is Q1's «مختلف ثقافتی گروہوں
  // … کیا فائدہ → رواداری اور بھائی چارہ» with its key as the answer, held since round 12.
  // Since round 13 D is asked after C, and three Q6 items answered with a Q5 item's points are
  // held too (the angry social-media post is Q5 and Q6 both).
  expect(logged('[assessment] section re-asked')).toEqual([
    // One more is held because a C/D stem names its key, a name. A term the chapter teaches that a stem only
    // names is not held: the stem tells the child nothing the Q1 asks.
    expect.objectContaining({ section: 'A', shortfall: [{ slot: 'social_studies.A.Q1', missing: 3 }] }),
    expect.objectContaining({ section: 'C', shortfall: [{ slot: 'social_studies.C.Q5', missing: 1 }] }),
    // Round 15: Q7 «سرسید … 1875ء … کون سا اسکول» is held too; Q6's model answer names the school.
    expect.objectContaining({ section: 'D', shortfall: [{ slot: 'social_studies.D.Q6', missing: 3 }, { slot: 'social_studies.D.Q7', missing: 2 }] }),
    expect.objectContaining({ section: 'D', shortfall: [expect.objectContaining({ slot: 'social_studies.D.Q6' })] }),
  ]);
  const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
  expect(q7.length).toBeGreaterThanOrEqual(6);
  expect(q7.some((t) => t.includes('دنیا کی دوسری بڑی نمک کی کان'))).toBe(false);
  expect(q7).toContain('پاکستان کا قومی پھول کون سا ہے؟');
  // Section A is topped up once more before the paper fails, as Urdu's is.
  expect(logged('[assessment] section topped up again').map((l) => l.section)).toEqual(['A']);
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

test('Social Studies: when the re-asked section writes the same questions again, no question prints twice and nothing held prints', async () => {
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
  // Since round 17 nothing held comes back: with nothing new, the paper is short and fails.
  const out = await Gen.generatePatternExam(ARGS('social_studies')).catch((e) => e);
  expect(out.code).toBe('PATTERN_SHORT_SLOT');
  // Round 15: the blind re-ask leaves D's held items held, so D is asked once more.
  expect(dCalls).toBe(3);
  const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
  expect(new Set(q7).size).toBe(q7.length);
  expect(q7.filter((t) => t.includes('دنیا کی دوسری بڑی نمک کی کان'))).toHaveLength(0);
});
