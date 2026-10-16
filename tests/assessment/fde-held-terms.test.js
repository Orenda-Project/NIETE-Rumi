/**
 * Held content on a board-pattern paper.
 *
 * 1. Social Studies is set in Urdu, and its book carries a lesson on the Farewell Sermon. No item
 *    may quote, explain or evaluate a religious text, the book's own "importance of" questions
 *    included. So a Social Studies item that names one (the Farewell Sermon, a hadith, a verse, the
 *    Quran, a dua, a naat, a hamd) is dropped, and the slot it leaves is a shortfall: the paper
 *    fails, it is never refilled. The replayed paper is a real Social Studies reply in which three
 *    items name the Sermon.
 * 2. Urdu keeps its own check (a 24-character run from lessons 1–3). The stock exercise wording
 *    those runs once tripped on still passes; a line only the held lessons carry still fails.
 *    The held pages here are FICTIONAL. No text of the held lessons enters this repo.
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
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');
const FIXTURES = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);
const ARGS = (subject) => ({
  grade: 5, subject, pattern: 'fde_g5_2027', scope: { kind: 'fde', chapters: null, pages: null },
  pageRanges: null, chapterNumber: null,
});

/** The section's share of a recorded paper: the items whose slot the prompt asked for. */
function sectionReply(src, prompt) {
  const tree = { unseen: {} };
  for (const [category, types] of Object.entries(src.unseen)) {
    for (const [type, list] of Object.entries(types)) {
      const mine = list.filter((q) => prompt.includes(`"slot": "${q.slot}"`));
      if (!mine.length) continue;
      tree.unseen[category] = tree.unseen[category] || {};
      tree.unseen[category][type] = mine;
    }
  }
  return tree;
}

function replay(src, bookPages = '=== Page 40 ===\nسبق کا متن') {
  mockCreate.mockImplementation(async (params) => reply(JSON.stringify(sectionReply(src, params.messages[1].content))));
  mockLoadPages.mockImplementation(async ({ pageRanges }) => loaded(bookPages, String(pageRanges)));
}

beforeEach(() => {
  mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset();
});

// ───────────────────────────── Social Studies ─────────────────────────────

const SST_REAL = () => fixture('r6-sst-held');
// Where the three Sermon items sit in the recorded reply.
const SERMON = [
  ['objective', 'MCQs', 4],
  ['subjective', 'Short Questions', 4],
  ['subjective', 'Short Questions (2)', 1],
];

// Clean stand-ins for those three, each carrying a word a careless match would take for a held
// term: a name with «حمد» inside it, the month «ذی الحجہ», «ہدایت», «روایت», «نعمت», «مدعا»,
// «دعوت», «قرارداد», «حمایت».
const INNOCENT = [
  {
    slot: 'social_studies.A.Q1', lines: 0, marks: 1, blooms: 'Remember', main_question: 'درست جواب کا انتخاب کریں',
    question: 'سر سید احمد خان نے علی گڑھ میں کون سا ادارہ قائم کیا؟',
    options: ['الف) مدرسۃ العلوم', 'ب) پنجاب یونیورسٹی', 'ج) سندھ مدرسہ', 'د) اسلامیہ کالج'],
    answer: 'الف) مدرسۃ العلوم',
  },
  {
    slot: 'social_studies.C.Q5', lines: 0, marks: 3, blooms: 'Understand', main_question: 'درج ذیل سوالات کے مختصر جواب لکھیں',
    question: 'اچھا شہری بزرگوں کی ہدایت اور اچھی روایت کی پاسداری کیوں کرتا ہے؟',
    answer: 'ہدایت پر عمل اور روایت کی پاسداری معاشرے کو جوڑتی ہے۔ صاف پانی ایک نعمت ہے، اسے بچانے کی دعوت سب کو دی جاتی ہے۔',
    scheme: {
      accept: ['کوئی بھی درست وجہ'],
      points: [{ kind: 'K', text: 'ہدایت پر عمل', marks: 1.5 }, { kind: 'K', text: 'روایت کی پاسداری', marks: 1.5 }],
      checked: null, common_error: 'صرف ایک وجہ لکھنا',
    },
  },
  {
    slot: 'social_studies.D.Q7', lines: 0, marks: 2, blooms: 'Remember', main_question: 'درج ذیل میں سے کوئی چھ سوالات کے مختصر جواب دیں',
    question: 'قرارداد لاہور کس شہر میں منظور ہوئی اور اس کا مدعا کیا تھا؟',
    answer: 'لاہور میں؛ اس کا مدعا الگ وطن کی حمایت تھا، ذی الحجہ کے مہینے کا اس سے تعلق نہیں۔',
  },
];

describe('Social Studies: an item that names a religious text is held, and the paper fails', () => {
  test('the recorded paper with three Farewell Sermon items fails PATTERN_SHORT_SLOT on all three slots', async () => {
    replay(SST_REAL());
    const err = await Gen.generatePatternExam(ARGS('social_studies')).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual(expect.arrayContaining([
      { slot: 'social_studies.A.Q1', missing: 1 },
      { slot: 'social_studies.C.Q5', missing: 1 },
      { slot: 'social_studies.D.Q7', missing: 1 },
    ]));
    expect(err.shortfall).toHaveLength(3);
    const drops = logged('[assessment] held item dropped');
    expect(drops.map((d) => d.slot).sort()).toEqual(['social_studies.A.Q1', 'social_studies.C.Q5', 'social_studies.D.Q7']);
    for (const d of drops) expect(d).toMatchObject({ reason: 'religious_text', term: 'حجۃ الوداع' });
    const [line] = logged('[assessment] layout applied');
    expect(line).toMatchObject({ dropped: 3 });
    // Social Studies has no held pages to load: the book is read once, for the paper itself.
    expect(mockLoadPages).toHaveBeenCalledTimes(1);
  });

  test('the same paper with clean items in those three places is whole: no near-miss word drops anything', async () => {
    const src = SST_REAL();
    SERMON.forEach(([category, type, i], k) => { src.unseen[category][type][i] = INNOCENT[k]; });
    replay(src);
    const out = await Gen.generatePatternExam(ARGS('social_studies'));
    expect(logged('[assessment] held item dropped')).toEqual([]);
    expect(out.examJson._layout.medium).toBe('ur');
    const [line] = logged('[assessment] layout applied');
    expect(line).toMatchObject({ dropped: 0, shortfall: [] });
  });

  test('every listed term, in any field and in its written variants, is held', async () => {
    const SST = P.subjects.social_studies;
    const named = [
      ['question', 'خطبہ حجۃ الوداع کب دیا گیا؟', 'حجۃ الوداع'],
      ['question', 'خطبہ حجتہ الوداع کہاں دیا گیا؟', 'حجۃ الوداع'],
      ['question', 'خطبۂ حجة الوداع کی ایک بات لکھیں۔', 'حجۃ الوداع'], // Arabic taa marbuta
      ['answer', 'یہ حجّۃُ‌الوداع کا پیغام ہے۔', 'حجۃ الوداع'], // diacritics and a zero-width joiner
      ['question', 'ایک حدیث کا مفہوم لکھیں۔', 'حدیث'],
      ['answer', 'یہ بات احادیث میں ہے۔', 'حدیث'],
      ['question', 'حديث کا مطلب لکھیں۔', 'حدیث'], // Arabic yeh
      ['question', 'اس آیت کا ترجمہ کریں۔', 'آیت'],
      ['options', ['الف) آیات', 'ب) دریا', 'ج) پہاڑ', 'د) شہر'], 'آیت'],
      ['question', 'آیت کی وضاحت کریں۔', 'آیت'], // alef + combining madda
      ['question', 'قرآن پاک کی اہمیت بیان کریں۔', 'قرآن'],
      ['answer', 'قرآنی تعلیمات پر عمل کریں۔', 'قرآن'],
      ['question', 'قران کے بارے میں لکھیں۔', 'قرآن'],
      ['question', 'سفر سے پہلے کون سی دعا پڑھی جاتی ہے؟', 'دعا'],
      ['answer', 'بزرگ دعائیں دیتے ہیں۔', 'دعا'],
      ['question', 'ایک نعت کا شعر لکھیں۔', 'نعت'],
      ['answer', 'نعتیں پڑھی گئیں۔', 'نعت'],
      ['question', 'حمد کسے کہتے ہیں؟', 'حمد'],
      ['answer', 'یہ حمدیہ کلام ہے۔', 'حمد'],
      ['scheme', { points: [{ kind: 'K', text: 'حدیث کا حوالہ', marks: 3 }], accept: [], common_error: null }, 'حدیث'],
    ];
    const items = named.map(([field, value]) => ({ slot: 'social_studies.C.Q5', question: 'سوال', answer: 'جواب', [field]: value }));
    const clean = INNOCENT.map((q) => ({ ...q }));
    const exam = { unseen: { subjective: { 'Short Questions': [...items, ...clean] } } };
    const dropped = await Gen.religiousFilter(exam, SST, { grade: 5, subject: 'social_studies' });
    expect(dropped.map((d) => d.term)).toEqual(named.map(([, , term]) => term));
    for (const d of dropped) expect(d).toMatchObject({ slot: 'social_studies.C.Q5', reason: 'religious_text' });
    expect(exam.unseen.subjective['Short Questions']).toEqual(clean);
    expect(mockLoadPages).not.toHaveBeenCalled();
  });

  test('english, maths and science are untouched, even when an item names one', async () => {
    for (const key of ['english', 'maths', 'science']) {
      const exam = { unseen: { objective: { MCQs: [{ slot: `${key}.A.Q1`, question: 'What is a hadith? قرآن حدیث دعا', answer: 'x' }] } } };
      expect(await Gen.religiousFilter(exam, P.subjects[key], { grade: 5, subject: key })).toEqual([]);
      expect(exam.unseen.objective.MCQs).toHaveLength(1);
    }
    expect(mockLoadPages).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────── Urdu ─────────────────────────────────

// gen-local's list: the stock wording the first real Urdu papers were refused on.
const GEN_LOCAL_STOCK = ['محاورے کا مطلب ہے', 'سوالات کے جواب دیں', 'ان اشعار میں', 'جناب عالی! گزارش ہے', 'چھٹی کی درخواست لکھیں'];
// Made up: a line only the held pages carry, 30 characters.
const HELD_ONLY = 'پہلے سبق کی یہ آزمائشی سطر کہیں اور نہیں';
// Fictional held pages: each stock phrase in a made-up sentence, and the held-only line.
const HELD_PAGES = `=== Page 9 ===\n${GEN_LOCAL_STOCK.map((s) => `پچھلے سبق میں ${s} اور یاد رکھیں۔`).join(' ')}\n\n=== Page 25 ===\n${HELD_ONLY}`;
const LESSON_PAGES = '=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات کا متن';

function replayUrdu(edit) {
  const src = fixture('urdu');
  edit(src.unseen.objective.MCQs);
  mockCreate.mockImplementation(async (params) => reply(JSON.stringify(sectionReply(src, params.messages[1].content))));
  mockLoadPages.mockImplementation(async ({ pageRanges }) => (pageRanges === '1-27'
    ? loaded(HELD_PAGES, '1-27') : loaded(LESSON_PAGES, String(pageRanges))));
}

describe('Urdu: stock exercise wording passes the held filter; a held-only line still fails the section', () => {
  test('every phrase on gen-local\'s list, in an item, drops nothing', async () => {
    replayUrdu((mcqs) => GEN_LOCAL_STOCK.forEach((s, i) => { mcqs[i].question = `${s}: درست جواب چنیں؟`; }));
    const out = await Gen.generatePatternExam(ARGS('urdu'));
    expect(logged('[assessment] held item dropped')).toEqual([]);
    expect(out.examJson.unseen.objective.MCQs.map((q) => q.question)).toEqual(
      expect.arrayContaining(GEN_LOCAL_STOCK.map((s) => `${s}: درست جواب چنیں؟`)),
    );
  });

  test('a held-only line in the same paper is dropped and fails the slot', async () => {
    replayUrdu((mcqs) => {
      GEN_LOCAL_STOCK.forEach((s, i) => { mcqs[i].question = `${s}: درست جواب چنیں؟`; });
      mcqs[7].question = `مکمل کریں: «${HELD_ONLY}»`;
    });
    const err = await Gen.generatePatternExam(ARGS('urdu')).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    expect(logged('[assessment] held item dropped')).toEqual([{ slot: 'urdu.A.Q1', reason: 'lesson_1_3', kind: 'MCQs', match: expect.any(String) }]);
  });
});
