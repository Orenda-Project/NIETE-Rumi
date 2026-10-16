/**
 * Real board-pattern replies, replayed: the two ways the first real papers failed.
 *
 * 1. Urdu. The held-lessons filter matched 12-character windows, and twelve characters of Urdu is
 *    two or three words, so the book's stock exercise wording ("answer the questions", "the meaning
 *    of the idiom is", "an application for leave") dropped good items and every real Urdu paper
 *    failed as a short slot. The longest held-page run in any real item was 21 characters; a line of
 *    verse is 25 or more. So a quote is now 24 characters, and the pattern's own Urdu strings (its
 *    instructions, closed lists and rules, which the model is told to copy) are never a quote.
 * 2. Length. The job's model reasons before it answers, and the reasoning spends the same output
 *    budget: a full-syllabus Maths section ran out at 11,986 of 12,000 tokens, 7,927 of them
 *    reasoning, and the paper failed TRUNCATED. A section now has 24,000 tokens and 300 s, and asks
 *    for low reasoning effort.
 *
 * The replies are recorded from real runs (fixtures/fde/urdu-gen-full.json, maths-cutoff-A.json).
 * The held pages here are FICTIONAL: the stock exercise wording those runs matched, and one made-up
 * line no lesson carries. No text of the held lessons enters this repo.
 *
 * Mocked at the boundary only: the model client and the book loader.
 */

const fs = require('fs');
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

const FIXTURES = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const URDU = fixture('urdu-gen-full');

// The stock wording the real runs matched on the held pages, set in made-up sentences.
const STOCK = [
  'اس محاورے کا مطلب ہے کہ آدمی خوش ہو۔',
  'گڑیا کو کھیلنا بہت پسند ہے۔',
  'وہ دیر تک باغ میں تھا اور وہ ہنستا رہا۔',
  'نیچے دیے گئے سوالات کے جواب دیں۔',
  'ان اشعار میں شاعر نے صبح کا منظر لکھا ہے اور اس کو یاد کریں۔',
  'استاد کے نام ایک چھٹی کی درخواست لکھیں۔',
  'خط کا آغاز: جناب عالی! گزارش ہے',
];
// The pattern's own example letter line (Q10's rule, which the model copies word for word),
// printed here as if a held lesson's exercise also set it.
const PATTERN_LINE = 'اپنی والدہ کے نام خط لکھ کر انھیں اپنی صحت پر توجہ دینے کی تلقین کریں۔';
// Made up: a line only the held pages carry, 30 characters.
const HELD_ONLY = 'پہلے سبق کی یہ آزمائشی سطر کہیں اور نہیں';

const HELD_PAGES = `=== Page 9 ===\n${STOCK.slice(0, 4).join(' ')}\n\n=== Page 22 ===\n${STOCK.slice(4).join(' ')} ${PATTERN_LINE}\n\n`
  + `=== Page 25 ===\n${HELD_ONLY}`;
const LESSON_PAGES = '=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات کا متن';

const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const reply = (content, usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 }, finish = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finish }], usage,
});
const sectionOf = (params) => /\*\*SECTION (\w+)\*\*/.exec(params.messages[1].content)[1];
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);

const ARGS = (subject) => ({
  grade: 5, subject, pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null,
});

/** The recorded Urdu paper, section by section; `edit(sectionId, tree)` may change a reply. */
function recordedUrdu(edit = (s, tree) => tree) {
  mockLoadPages.mockImplementation(async ({ pageRanges }) => (pageRanges === '1-27'
    ? loaded(HELD_PAGES, '1-27') : loaded(LESSON_PAGES, String(pageRanges))));
  mockCreate.mockImplementation(async (params) => {
    const s = sectionOf(params);
    return reply(JSON.stringify(edit(s, JSON.parse(URDU.sections[s]))));
  });
}

beforeEach(() => {
  mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset();
});

describe('the recorded Urdu paper', () => {
  test('stock exercise wording and the pattern\'s own strings never drop an item: the paper lays out with no short slot', async () => {
    recordedUrdu();
    const out = await Gen.generatePatternExam(ARGS('urdu'));
    expect(logged('[assessment] held item dropped')).toEqual([]);
    expect(out.examJson._layout.medium).toBe('ur');
    const [line] = logged('[assessment] layout applied');
    expect(line).toMatchObject({ dropped: 0, shortfall: [] });
  });

  test('an item quoting a held-only line of 24+ characters is still dropped, and still fails the slot', async () => {
    recordedUrdu((s, tree) => {
      if (s === 'A') tree.unseen.objective.MCQs[3].question = `مکمل کریں: «${HELD_ONLY}»`;
      return tree;
    });
    const err = await Gen.generatePatternExam(ARGS('urdu')).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    expect(logged('[assessment] held item dropped')).toEqual([{ slot: 'urdu.A.Q1', reason: 'lesson_1_3' }]);
  });

  test('a 23-character run from the held pages is shared wording, not a quote', async () => {
    const run = 'نیچے دیے گئے سوالات کے ج'.slice(0, 23);
    expect([...run]).toHaveLength(23);
    recordedUrdu((s, tree) => {
      if (s === 'A') tree.unseen.objective.MCQs[3].question = `${run}؟`;
      return tree;
    });
    await Gen.generatePatternExam(ARGS('urdu'));
    expect(logged('[assessment] held item dropped')).toEqual([]);
  });
});

describe('a section has room to reason and still answer', () => {
  const CUTOFF = fixture('maths-cutoff-A');
  const MATHS = fixture('maths');
  const MATHS_PAGES = '=== Page 5 ===\nPlace value.\n\n=== Page 220 ===\nAngles.';

  /** The worked maths fixture, cut to the slots one section's prompt asks for. */
  function mathsSection(prompt) {
    const tree = { unseen: {} };
    for (const [category, types] of Object.entries(MATHS.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
        if (!mine.length) continue;
        tree.unseen[category] = tree.unseen[category] || {};
        tree.unseen[category][type] = mine;
      }
    }
    return tree;
  }

  test('every section call: max_tokens 24000 (no maths section sizes above it), timeout 300000, low reasoning effort', async () => {
    mockLoadPages.mockResolvedValue(loaded(MATHS_PAGES, '1-270'));
    mockCreate.mockImplementation(async (params) => reply(JSON.stringify(mathsSection(params.messages[1].content))));
    await Gen.generatePatternExam(ARGS('maths'));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    for (const [params, options] of mockCreate.mock.calls) {
      expect(params.max_tokens).toBe(24000);
      expect(params.reasoning).toEqual({ effort: 'low' });
      expect(options).toEqual({ timeout: 300000 });
    }
  });

  test('the recorded Section A that ran out at 11,986 tokens is written whole under the new ceiling', async () => {
    mockLoadPages.mockResolvedValue(loaded(MATHS_PAGES, '1-270'));
    // The recorded reply ran out under a 12,000 ceiling: under that budget the model answers with
    // what it wrote before the cut; with room, it finishes.
    const needed = CUTOFF.max_tokens + 1;
    mockCreate.mockImplementation(async (params) => {
      if (sectionOf(params) === 'A' && params.max_tokens < needed) {
        return reply(CUTOFF.content, { ...CUTOFF.usage, completion_tokens: params.max_tokens }, 'length');
      }
      return reply(JSON.stringify(mathsSection(params.messages[1].content)));
    });
    const out = await Gen.generatePatternExam(ARGS('maths'));
    expect(out.examJson._layout).toBeDefined();
    expect(logged('[assessment] model ran out of room')).toEqual([]);
  });

  test('a reply that still reaches the ceiling is TRUNCATED, without a second try', async () => {
    mockLoadPages.mockResolvedValue(loaded(MATHS_PAGES, '1-270'));
    mockCreate.mockImplementation(async (params) => (sectionOf(params) === 'A'
      ? reply(CUTOFF.content, { ...CUTOFF.usage, completion_tokens: params.max_tokens }, 'length')
      : reply(JSON.stringify(mathsSection(params.messages[1].content)))));
    const err = await Gen.generatePatternExam(ARGS('maths')).catch((e) => e);
    expect(err.code).toBe('TRUNCATED');
    expect(mockCreate.mock.calls.filter(([p]) => sectionOf(p) === 'A')).toHaveLength(1);
  });
});
