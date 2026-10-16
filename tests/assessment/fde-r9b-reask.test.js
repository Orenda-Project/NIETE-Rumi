/**
 * The one re-ask after the cross-section hold is told what the paper already tests, through the
 * real generator (generatePatternExam), mocked at the edges only (the model client, the logger,
 * the book text):
 *
 *   - Social Studies: a re-asked Section C/D carries Section A's questions and answers, so the
 *     refill is a new fact instead of the same Q1 fact again (Ch 4 + 6 papers printed Q7 = Q1).
 *   - English: a re-asked Section A carries Q4's words.
 *   - The first call of every section is unchanged: nothing is added until the re-ask.
 *   - One question once in Q5/Q7 also when the two are worded with different endings
 *     («پہلے وزیر اعظم … تھے» / «پہلا وزیر اعظم … تھا»); «کب» and «کہاں» stay two questions.
 *
 * The recorded replies are a local Sonnet generation for chapters 4 + 6 (content only, no person
 * in them); the extra items are fictional.
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 40 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
});
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const NOTE_SST = 'Section A of this paper already asks';
const NOTE_EN = 'Q4 of this paper asks the child to use these words';

beforeEach(() => { mockCreate.mockReset(); });

function slotItems(exam, slot) {
  const out = [];
  for (const types of Object.values(exam.unseen || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q.slot === slot));
  return out;
}

test('Social Studies, chapters 4 + 6: the re-asked Section D is told Section A\'s questions and answers; its first call is not', async () => {
  // The recorded calls, served by section in the order they were made.
  const replies = {};
  for (const r of fixture('r9b-sst-ch46-replies')) {
    const sec = ['A', 'B', 'C', 'D'].find((s) => r.content.includes(`social_studies.${s}.`));
    (replies[sec] ||= []).push(r.content);
  }
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    const sec = ['A', 'B', 'C', 'D'].find((s) => prompt.includes(`"slot": "social_studies.${s}.`));
    asked.push({ sec, prompt });
    return reply((replies[sec] || []).length > 1 ? replies[sec].shift() : replies[sec][0]);
  });
  await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027',
    scope: { kind: 'chapters', chapters: [4, 6], pages: '26-33,40-48' }, pageRanges: '26-33,40-48', requestId: 'req-9b',
  });
  const d = asked.filter((a) => a.sec === 'D');
  expect(d).toHaveLength(2);
  expect(d[0].prompt).not.toContain(NOTE_SST);
  expect(d[1].prompt).toContain(NOTE_SST);
  // Every Q1 question of the first Section A reply is named, with its answer.
  const firstA = JSON.parse(fixture('r9b-sst-ch46-replies').find((r) => r.content.includes('social_studies.A.')).content.replace(/^```json\s*|```\s*$/g, ''));
  const q1 = Object.values(firstA.unseen || {}).flatMap((t) => Object.values(t)).flat().filter((q) => q.slot === 'social_studies.A.Q1');
  expect(q1.length).toBeGreaterThan(0);
  for (const q of q1) expect(d[1].prompt).toContain(q.question);
  // No other section's first call carries a note either.
  for (const a of asked.filter((x, i) => asked.findIndex((y) => y.sec === x.sec) === i)) {
    expect(a.prompt).not.toContain(NOTE_SST);
    expect(a.prompt).not.toContain(NOTE_EN);
  }
});

test('English: the re-asked Section A is told Q4\'s words; the first call is not', async () => {
  const src = fixture('r9-english-giveaway');
  const words = slotItems(src, 'english.C.Q4')[0].words;
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    const isA = prompt.includes('"slot": "english.A.Q1a"');
    asked.push({ isA, prompt });
    const tree = { unseen: {} };
    for (const [category, types] of Object.entries(src.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
        if (mine.length) (tree.unseen[category] ||= {})[type] = mine;
      }
    }
    return reply(JSON.stringify(tree));
  });
  await Gen.generatePatternExam({ grade: 5, subject: 'english', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null }, requestId: 'req-9b' });
  const a = asked.filter((x) => x.isA);
  expect(a).toHaveLength(2);
  expect(a[0].prompt).not.toContain(NOTE_EN);
  expect(a[1].prompt).toContain(NOTE_EN);
  for (const w of words) expect(a[1].prompt).toContain(w);
});

test('one question once in Q7 when only the endings differ; «کب» and «کہاں» stay two questions', () => {
  const P = Patterns.get('fde_g5_2027').subjects.social_studies;
  const exam = JSON.parse(JSON.stringify(fixture('r9-sst-chapters2')));
  const list = Object.values(exam.unseen).flatMap((t) => Object.values(t)).find((l) => l.some((q) => q.slot === 'social_studies.D.Q7'));
  list.push(
    { slot: 'social_studies.D.Q7', question: 'پاکستان کا پہلا وزیر اعظم کون تھا؟', answer: 'لیاقت علی خان۔' },
    { slot: 'social_studies.D.Q7', question: 'قائد اعظم کب پیدا ہوئے؟', answer: '25 دسمبر 1876ء کو۔' },
    { slot: 'social_studies.D.Q7', question: 'قائد اعظم کہاں پیدا ہوئے؟', answer: 'کراچی میں۔' },
  );
  const out = applyLayout(exam, P, { kind: 'chapters', chapters: [4, 6], pages: null }, { now: '2026-10-20T07:12:00.000Z', reasked: true });
  const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
  // The recorded paper already has «پاکستان کے پہلے وزیر اعظم کون تھے؟».
  expect(q7).toContain('پاکستان کے پہلے وزیر اعظم کون تھے؟');
  expect(q7).not.toContain('پاکستان کا پہلا وزیر اعظم کون تھا؟');
  expect(q7).toEqual(expect.arrayContaining(['قائد اعظم کب پیدا ہوئے؟', 'قائد اعظم کہاں پیدا ہوئے؟']));
});
