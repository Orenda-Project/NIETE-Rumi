/**
 * bd-5jmnfj.4.58.2: v26 G5 Urdu Q8 (میرا وطن) printed a seven-sentence model answer under a question
 * asking ten to twelve. A paragraph model answer off its asked length now re-asks its section once,
 * with lengthNote, and the second reply makes the paper. A second miss is logged, never failed: the
 * teacher still gets a paper.
 *
 * Mocked at the boundary only (model client, book loader, logger); the prompts, the pattern, the
 * layout and the filters are the real modules, as in fde-r9-urdu-b.test.js.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));
const mockLoadPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockLoadPages(...a),
  loadChapterContent: jest.fn(),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const SLOT = 'urdu.C.Q8';
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const URDU_PAGES = '=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات: ندی کی فریاد';
const HELD_PAGES = '=== Page 26 ===\nسرور کونین کی مدحت میں یہ اشعار پڑھے جاتے ہیں';

// Seven sentences on the paragraph's topic: the v26 shape, under a question that asks ten to twelve.
const SEVEN = 'ماحولیاتی آلودگی کا مطلب ہے کہ ہمارے ارد گرد کی ہوا، پانی اور زمین گندی ہو جائیں۔ گاڑیوں اور کارخانوں کا دھواں ہوا کو آلودہ کرتا ہے۔ کچرا اور گندا پانی ندیوں میں پھینکنے سے پانی خراب ہوتا ہے۔ آلودگی سے لوگ بیمار ہو جاتے ہیں۔ ہمیں زیادہ سے زیادہ درخت لگانے چاہئیں۔ کچرا ہمیشہ کوڑے دان میں ڈالنا چاہیے۔ مل کر کوشش کریں تو ہمارا ماحول صاف ہو سکتا ہے۔';

const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});
const textOf = (params) => params.messages
  .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

function sectionTree(userPrompt) {
  const src = fixture('urdu');
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(src.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => userPrompt.includes(`"slot": "${q.slot}"`));
      if (!mine.length) continue;
      tree.unseen[category] = tree.unseen[category] || {};
      tree.unseen[category][type] = mine;
    }
  }
  return tree;
}

/** Q8 paragraph items (the dialogue choice is not measured). */
const paragraphs = (examJson) => {
  const out = [];
  for (const types of Object.values(examJson.unseen || {})) {
    for (const list of Object.values(types)) out.push(...list.filter((q) => q.slot === SLOT && !/مکالمہ/.test(q.question)));
  }
  return out;
};

/** The model answers from the fixture; the first `times` Section C replies carry `answer` on the Q8 paragraph. */
function fakeModel({ answer, times }) {
  let left = times;
  mockCreate.mockImplementation(async (params) => {
    const prompt = textOf(params);
    const tree = sectionTree(prompt);
    if (prompt.includes(`"slot": "${SLOT}"`) && left > 0) {
      left -= 1;
      paragraphs(tree).forEach((q) => { q.answer = answer; });
    }
    return reply(JSON.stringify(tree));
  });
}

const sectionCCalls = () => mockCreate.mock.calls.map(([p]) => textOf(p)).filter((t) => t.includes(`"slot": "${SLOT}"`));
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);
const AGAIN = 'Write the answer again with 10 to 12 sentences.';

const ARGS = { grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null };

beforeEach(() => {
  mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset();
  mockLoadPages.mockImplementation(async ({ pageRanges }) => (pageRanges === '1-27'
    ? loaded(HELD_PAGES, '1-27')
    : loaded(URDU_PAGES, String(pageRanges))));
});

test('the fixture paper is clean: the Q8 paragraph answer has 10 to 12 sentences and nothing is re-asked', async () => {
  fakeModel({ answer: null, times: 0 });
  const out = await Gen.generatePatternExam(ARGS);
  expect(logged('[assessment] section re-asked')).toEqual([]);
  expect(logged('[assessment] paragraph length off')).toEqual([]);
  expect(paragraphs(out.examJson)).toHaveLength(1);
  expect(sectionCCalls()).toHaveLength(1);
});

test('a seven-sentence Q8 paragraph once: Section C is re-asked with the length note and the clean reply makes the paper', async () => {
  fakeModel({ answer: SEVEN, times: 1 });
  const out = await Gen.generatePatternExam(ARGS);
  expect(logged('[assessment] section re-asked')).toEqual([
    expect.objectContaining({ section: 'C', shortfall: [expect.objectContaining({ slot: SLOT, reason: 'length' })] }),
  ]);
  const calls = sectionCCalls();
  expect(calls).toHaveLength(2);
  expect(calls[0]).not.toContain(AGAIN);
  expect(calls[1]).toContain('the model answer has 7 sentences');
  expect(calls[1]).toContain(AGAIN);
  expect(paragraphs(out.examJson).map((q) => q.answer)).not.toContain(SEVEN);
  expect(logged('[assessment] paragraph length off')).toEqual([]);
});

test('seven sentences in both replies: one re-ask only, the paper still comes out and the miss is logged', async () => {
  fakeModel({ answer: SEVEN, times: 2 });
  const out = await Gen.generatePatternExam(ARGS);
  expect(sectionCCalls()).toHaveLength(2);
  expect(logged('[assessment] section re-asked')).toHaveLength(1);
  expect(paragraphs(out.examJson).map((q) => q.answer)).toContain(SEVEN);
  expect(logged('[assessment] paragraph length off')).toEqual([
    expect.objectContaining({ lengths: [expect.objectContaining({ slot: SLOT, reason: 'length' })] }),
  ]);
});
