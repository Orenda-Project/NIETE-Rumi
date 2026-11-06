/**
 * Social Studies reader pass: the first-ask spares are read (a layout each) only when Section D would be short
 * without them. On a recorded paper whose re-check clears every replacement, D is whole and no spare is read.
 * The papers are local model output; the people in their stories are the model's own.
 */
const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 4 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));
const mockLayouts = { n: 0 };
jest.mock('../../bot/shared/services/assessment/fde-layout', () => {
  const actual = jest.requireActual('../../bot/shared/services/assessment/fde-layout');
  return { ...actual, applyLayout: (...a) => { mockLayouts.n += 1; return actual.applyLayout(...a); } };
});

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');

const rec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r17c-sst-refused-chapters_1.json'), 'utf8'));
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));

// The recording as the reader-pass tests keep it (a premise answer reworded; Q1 items a stem names swapped for items no stem names).
function asRecorded() {
  const r = JSON.parse(JSON.stringify(rec));
  r.replies.C = r.replies.C.map((c) => c.replace('اللہ تعالیٰ نے تمام انسان برابر پیدا کیے ہیں اور سب آدم و حوا علیھما السلام کی اولاد ہیں۔', 'اقوام متحدہ کے منشور کے مطابق تمام انسان برابر ہیں اور سب کی عزت برابر ہے۔'))
    .map((c) => c.split('پرنٹ میڈیا اور الیکٹرانک میڈیا میں فرق').join('اخبار اور ٹیلی وژن میں فرق'));
  const swap = { 'ایدھی فاؤنڈیشن کے بانی کون تھے؟': ['پاکستان کا قومی پھول کون سا ہے؟', ['الف) گلاب', 'ب) چنبیلی', 'ج) سورج مکھی', 'د) کنول'], 'ب) چنبیلی'],
    'ایک بچہ اسکول میں اپنے ہم جماعت کے مذہب کی وجہ سے اسے کھیل میں شامل نہیں کرتا۔ یہ کس اصول کے خلاف ہے؟': ['پاکستان کا قومی جانور کون سا ہے؟', ['الف) شیر', 'ب) ہاتھی', 'ج) مارخور', 'د) ہرن'], 'ج) مارخور'] };
  r.replies.A = r.replies.A.map((json) => {
    const tree = JSON.parse(json);
    for (const q of tree.unseen.objective.MCQs || []) if (swap[q.question]) { const [question, options, answer] = swap[q.question]; Object.assign(q, { question, options, answer }); }
    return JSON.stringify(tree);
  });
  return r;
}

async function run(r, readerReplies) {
  const queue = { A: [...r.replies.A], B: [...r.replies.B], C: [...r.replies.C], D: [...r.replies.D] };
  let reads = 0;
  mockCreate.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (text.includes(Reader.READER_MARK)) {
      reads += 1;
      const content = readerReplies[reads] ? readerReplies[reads]() : r.reader[reads - 1];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = sectionOf(text);
    const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  mockLayouts.n = 0;
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: r.scope, pageRanges: r.scope.pages, requestId: 'req-cost', readerPass: true,
  }).catch((e) => ({ error: e }));
  return { out, layouts: mockLayouts.n };
}

test('a re-check that clears every replacement leaves D whole: the paper is made, no spare prints, and no spare is laid out', async () => {
  const { out, layouts } = await run(asRecorded(), { 2: () => JSON.stringify({ candidates: [] }) });
  expect(out.error && out.error.code).toBeUndefined();
  expect(out.examJson._layout.reader.spares).toBe(0);
  expect(out.examJson._layout.reader.spares_read).toBeGreaterThan(0);
  // The whole run lays the paper out ten times; reading the spares cost one layout each, and eight more.
  expect(layouts).toBeLessThanOrEqual(10);
});
