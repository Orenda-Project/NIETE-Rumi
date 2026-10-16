/**
 * Urdu: a model answer, passage or dialogue the model writes itself must carry no religious maxim,
 * hadith, verse, dua or act of worship. A local Urdu paper printed «صفائی ایمان کا حصہ ہے» (a hadith
 * paraphrase, in no lesson of the book) as the Q8 dialogue's model answer in the marking scheme. The
 * held-lessons filter only finds quotes of lessons 1–3, so nothing stopped it.
 *
 * Two layers: a prompt line on every Urdu section, and a backstop. An item whose model text names
 * one of the held terms is re-asked once with its section; a second hit is held and the slot is
 * short. A run quoted from the paper's own book pages is the book, not an authored maxim, and the
 * operator-allowed classes («اللہ تعالیٰ کرے», «میری دعا ہے کہ», greetings, «دعا» in a letter)
 * never match.
 *
 * Mocked at the boundary only: the model client and the book loader. The prompts, the pattern data,
 * the layout and the filters are the real modules.
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

const PATTERN = 'fde_g5_2027';
const P = Patterns.get(PATTERN);
const U = P.subjects.urdu;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));

// The Q8 dialogue answer as the local paper printed it.
const MAXIM_DIALOGUE = 'علی: احمر، کلاس میں کچرا کیوں پڑا ہے؟ احمر: ہم نے دھیان نہیں دیا۔ علی: صفائی ایمان کا حصہ ہے۔ احمر: ٹھیک ہے، ہم مل کر صاف کریں گے۔';
// A lesson page (inside the paper's pages) whose own text says «فرمایا» about a teacher.
const BOOK_LINE = 'جہاں تک آپ کی پریشانی کا تعلق ہے، تو یقیناً مس افشاں نے ٹھیک فرمایا۔';
const URDU_PAGES = `=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات: ندی کی فریاد\n\n=== Page 90 ===\n${BOOK_LINE}`;
const HELD_PAGES = '=== Page 26 ===\nسرور کونین کی مدحت میں یہ اشعار پڑھے جاتے ہیں';

const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});

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

/**
 * The model answers every section from the fixture; the first `times` replies carrying `slot` have
 * `patch` applied to that slot's item number `index`.
 */
function fakeModel({ slot, index = 1, patch, times }) {
  let left = times;
  mockCreate.mockImplementation(async (params) => {
    const prompt = params.messages[1].content;
    const tree = sectionTree(prompt);
    if (prompt.includes(`"slot": "${slot}"`) && left > 0) {
      left -= 1;
      for (const types of Object.values(tree.unseen)) {
        for (const list of Object.values(types)) {
          const mine = list.filter((q) => q.slot === slot);
          if (mine[index]) patch(mine[index]);
        }
      }
    }
    return reply(JSON.stringify(tree));
  });
}

function book() {
  mockLoadPages.mockImplementation(async ({ pageRanges }) => (pageRanges === '1-27'
    ? loaded(HELD_PAGES, '1-27')
    : loaded(URDU_PAGES, String(pageRanges))));
}

const ARGS = { grade: 5, subject: 'urdu', pattern: PATTERN, scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null };
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);
const itemsOf = (examJson, slot) => {
  const out = [];
  for (const types of Object.values(examJson.unseen || {})) {
    for (const list of Object.values(types)) out.push(...list.filter((q) => q.slot === slot));
  }
  return out;
};

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset(); });

const LINE = 'Model answers, passages, dialogues and stories carry no religious maxim, hadith, verse, dua or act of worship; keep them to everyday life.';

describe('urdu prompt: no authored religious maxims', () => {
  test('every urdu section prompt carries the line', () => {
    for (const section of U.sections) {
      const prompt = Gen.buildPatternUserPrompt({
        grade: 5, subject: 'urdu', pageContent: 'x', pageReference: 'pp 28-107', section, slots: section.slots,
        lang: 'ur', P: U, scope: { kind: 'chapters', chapters: [6, 7], pages: null },
      });
      expect(prompt).toContain(LINE);
    }
  });

  test('no other subject\'s prompt carries it', () => {
    for (const key of ['maths', 'science', 'english', 'social_studies']) {
      for (const section of P.subjects[key].sections) {
        const prompt = Gen.buildPatternUserPrompt({
          grade: 5, subject: key, pageContent: 'x', pageReference: 'p 1', section, slots: section.slots,
          lang: P.subjects[key].medium, P: P.subjects[key], scope: { kind: 'fde' },
        });
        expect(prompt).not.toContain(LINE);
      }
    }
  });
});

describe('urdu backstop: an authored maxim in model text', () => {
  test('a maxim in a Q8 dialogue answer once → the section is re-asked and the clean reply makes the paper', async () => {
    book();
    fakeModel({ slot: 'urdu.C.Q8', patch: (q) => { q.answer = MAXIM_DIALOGUE; }, times: 1 });
    const out = await Gen.generatePatternExam(ARGS);
    const reasked = logged('[assessment] section re-asked');
    expect(reasked).toEqual([expect.objectContaining({ section: 'C', religious: { slot: 'urdu.C.Q8', term: 'ایمان کا حصہ' } })]);
    expect(itemsOf(out.examJson, 'urdu.C.Q8').map((q) => q.answer)).not.toContain(MAXIM_DIALOGUE);
    expect(logged('[assessment] held item dropped')).toEqual([]);
  });

  test('a maxim in both replies → held, the slot is short and the paper fails', async () => {
    book();
    fakeModel({ slot: 'urdu.C.Q8', patch: (q) => { q.answer = MAXIM_DIALOGUE; }, times: 2 });
    const err = await Gen.generatePatternExam(ARGS).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'urdu.C.Q8', missing: 1 }]);
    expect(logged('[assessment] held item dropped')).toEqual([
      expect.objectContaining({ slot: 'urdu.C.Q8', reason: 'authored_religious', term: 'ایمان کا حصہ' }),
    ]);
  });

  test('a maxim in a marking-scheme point is read too', async () => {
    book();
    fakeModel({ slot: 'urdu.C.Q9', index: 0, patch: (q) => { q.scheme = { points: [{ kind: 'K', marks: 10, text: 'نتیجہ: حدیث میں ہے کہ لالچ بری بلا ہے' }] }; }, times: 2 });
    const err = await Gen.generatePatternExam(ARGS).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(logged('[assessment] held item dropped')).toEqual([
      expect.objectContaining({ slot: 'urdu.C.Q9', reason: 'authored_religious', term: 'حدیث' }),
    ]);
  });

  test.each([
    ['a Quran verse named', 'قرآن کی آیت ہے کہ صفائی رکھو'],
    ['half of faith', 'صفائی نصف ایمان ہے'],
    ['an act of worship', 'علی: میں روز فجر کی نماز پڑھتا ہوں اور روزہ رکھتا ہوں'],
    ['a saying with فرمایا', 'آپ نے فرمایا کہ سچ بولو'],
    ['Arabic letter forms', 'صفائي ايمان كا حصہ ہے'],
  ])('held: %s', async (_name, text) => {
    book();
    fakeModel({ slot: 'urdu.C.Q8', patch: (q) => { q.answer = text; }, times: 2 });
    const err = await Gen.generatePatternExam(ARGS).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(logged('[assessment] held item dropped').map((d) => d.reason)).toEqual(['authored_religious']);
  });

  test.each([
    ['the book\'s wish example', 'اللہ تعالیٰ کرے تم امتحان میں کامیاب ہو جاؤ۔'],
    ['a wish in a letter', 'میری دعا ہے کہ آپ ہمیشہ خوش رہیں۔ والسلام'],
    ['a greeting', 'السلام علیکم! آپ کیسے ہیں؟ گھر والوں کو سلام۔'],
    ['honesty, not faith', 'نتیجہ: ایمان داری سب سے اچھی عادت ہے۔'],
    ['the paper\'s own book page', `استاد نے کہا: ${BOOK_LINE}`],
  ])('not held: %s', async (_name, text) => {
    book();
    fakeModel({ slot: 'urdu.C.Q8', patch: (q) => { q.answer = text; }, times: 2 });
    const out = await Gen.generatePatternExam(ARGS);
    expect(logged('[assessment] held item dropped')).toEqual([]);
    expect(logged('[assessment] section re-asked')).toEqual([]);
    expect(itemsOf(out.examJson, 'urdu.C.Q8').map((q) => q.answer)).toContain(text);
  });

  test('the question and options are not read: a stem the book sets is the held-lessons filter\'s', async () => {
    book();
    fakeModel({ slot: 'urdu.C.Q8', patch: (q) => { q.question = 'دو دوستوں کے درمیان نماز کی پابندی پر مکالمہ تحریر کریں۔'; }, times: 2 });
    const out = await Gen.generatePatternExam(ARGS);
    expect(logged('[assessment] held item dropped')).toEqual([]);
    expect(out.layout.unplaced).toBe(0);
  });
});

test('an MCQ key is its option\'s text, not model prose: a spelling item keyed «قرآن» is not held', async () => {
  book();
  fakeModel({
    slot: 'urdu.A.Q1',
    index: 0,
    patch: (q) => { q.question = 'درست املا والا لفظ کون سا ہے؟'; q.options = ['الف) قرآن', 'ب) کرآن', 'ج) گرآن', 'د) قرآںن']; q.answer = 'الف) قرآن'; },
    times: 2,
  });
  const out = await Gen.generatePatternExam(ARGS);
  expect(logged('[assessment] held item dropped')).toEqual([]);
  expect(logged('[assessment] section re-asked')).toEqual([]);
  expect(itemsOf(out.examJson, 'urdu.A.Q1').map((q) => q.answer)).toContain('الف) قرآن');
});

describe('other subjects are untouched by the urdu backstop', () => {
  test('science and maths: religiousFilter returns nothing and loads no pages', async () => {
    const tree = { unseen: { subjective: { 'Short Questions': [{ slot: 'science.B.Q2', question: 'q', answer: 'صفائی نصف ایمان ہے' }] } } };
    for (const subject of ['science', 'maths', 'english']) {
      const before = JSON.parse(JSON.stringify(tree));
      const dropped = await Gen.religiousFilter(tree, P.subjects[subject], { grade: 5, subject });
      expect(dropped).toEqual([]);
      expect(tree).toEqual(before);
    }
    expect(mockLoadPages).not.toHaveBeenCalled();
  });
});
