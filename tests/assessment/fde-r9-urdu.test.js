/**
 * Urdu Q3/Q5 (`shape: 'words'`, words printed, FDE's instruction carries no {q}): the paper prints
 * FDE's transcribed instruction and the word list. A `question` the model writes for such an item is
 * a restatement of that instruction, and stock exercise wording ("use these words in your own
 * sentences") also sits on the held pages (lessons 1–3), so the held-lessons filter read it as a
 * quote, dropped the whole item and failed the paper as a short slot. Every Urdu paper failed so.
 *
 * Mocked at the boundary only: the model client and the book loader. The prompts, the pattern data,
 * the layout, the held-lessons filter and the renderer are the real modules.
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
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const PATTERN = 'fde_g5_2027';
const P = Patterns.get(PATTERN);
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));

// The model's restatement as the sandbox replies carried it, and the same stock wording in a
// held lesson's exercise (p.9): every 24-character run of it is a held run.
const RESTATED = 'درج ذیل الفاظ کو اپنے جملوں میں استعمال کریں۔';
const RESTATED_SHORT = 'درج ذیل الفاظ کو جملوں میں استعمال کریں۔';
const HELD_PAGE_26 = 'سرور کونین کی مدحت میں یہ اشعار پڑھے جاتے ہیں';
const HELD_PAGES = `=== Page 9 ===\nمشق: ${RESTATED} ${RESTATED_SHORT}\n\n=== Page 26 ===\n${HELD_PAGE_26}`;
const URDU_PAGES = '=== Page 30 ===\nسبق چار کا متن\n\n=== Page 80 ===\nسبق سات: ندی کی فریاد';

const loaded = (content, pageReference) => ({ content, pageReference, pageCount: 1, pagesFound: [], pagesMissing: [] });
const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, cost: 0.01 },
});

function sectionReply(userPrompt, edit) {
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
  return edit(tree);
}

/** Every Section C item of `slot` gets `patch` applied; other sections answer from the fixture. */
function fakeModel(patches) {
  mockCreate.mockImplementation(async (params) => {
    const prompt = params.messages[1].content;
    return reply(JSON.stringify(sectionReply(prompt, (tree) => {
      for (const types of Object.values(tree.unseen)) {
        for (const list of Object.values(types)) {
          list.forEach((q) => { if (patches[q.slot]) patches[q.slot](q); });
        }
      }
      return tree;
    })));
  });
}

function book() {
  mockLoadPages.mockImplementation(async ({ pageRanges }) => (pageRanges === '1-27'
    ? loaded(HELD_PAGES, '1-27')
    : loaded(URDU_PAGES, String(pageRanges))));
}

const ARGS = { grade: 5, subject: 'urdu', pattern: PATTERN, scope: { kind: 'fde', chapters: null, pages: null }, pageRanges: null, chapterNumber: null };
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, data]) => data);
const itemOf = (examJson, slot) => {
  for (const types of Object.values(examJson.unseen || {})) {
    for (const list of Object.values(types)) {
      const hit = list.find((q) => q.slot === slot);
      if (hit) return hit;
    }
  }
  return null;
};

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockLoadPages.mockReset(); });

describe('urdu words slots: the model\'s restated instruction is not a quote', () => {
  test('Q5 with a restated instruction makes a whole paper, its question blanked', async () => {
    book();
    fakeModel({ 'urdu.C.Q5': (q) => { q.question = RESTATED; }, 'urdu.C.Q3': (q) => { q.question = RESTATED_SHORT; } });
    const out = await Gen.generatePatternExam(ARGS);
    expect(logged('[assessment] held item dropped')).toEqual([]);
    expect(out.layout).toEqual({ placed: 35, unplaced: 0 });
    expect(itemOf(out.examJson, 'urdu.C.Q5').question).toBe('');
    expect(itemOf(out.examJson, 'urdu.C.Q3').question).toBe('');
    // The words and the answer are the item; they are untouched.
    expect(itemOf(out.examJson, 'urdu.C.Q5').words).toEqual(itemOf(fixture('urdu'), 'urdu.C.Q5').words);
  });

  test('a real held quote in a Q5 word list is still dropped and fails the paper', async () => {
    book();
    fakeModel({ 'urdu.C.Q5': (q) => { q.question = RESTATED; q.answer = HELD_PAGE_26; } });
    const err = await Gen.generatePatternExam(ARGS).catch((e) => e);
    expect(err.code).toBe('PATTERN_SHORT_SLOT');
    expect(err.shortfall).toEqual([{ slot: 'urdu.C.Q5', missing: 1 }]);
    expect(logged('[assessment] held item dropped')).toEqual([
      { slot: 'urdu.C.Q5', reason: 'lesson_1_3', kind: 'Word Sentences', match: expect.any(String) },
    ]);
  });

  test('Q7 (a frame whose topic is the question) keeps its question', async () => {
    book();
    fakeModel({ 'urdu.C.Q5': (q) => { q.question = RESTATED; } });
    const out = await Gen.generatePatternExam(ARGS);
    expect(itemOf(out.examJson, 'urdu.C.Q7').question).toBe(itemOf(fixture('urdu'), 'urdu.C.Q7').question);
  });

  test('the printed paper shows FDE\'s Q5 instruction once and no restatement', async () => {
    book();
    fakeModel({ 'urdu.C.Q5': (q) => { q.question = RESTATED; } });
    const out = await Gen.generatePatternExam(ARGS);
    const html = R.renderPaper({ examJson: out.examJson, grade: 5, subject: 'urdu', answerLines: true });
    const q5 = P.subjects.urdu.sections.find((s) => s.id === 'C').slots.find((s) => s.slot === 'urdu.C.Q5');
    expect(html.split(q5.instruction_ur).length - 1).toBe(1);
    expect(html).not.toContain('اپنے جملوں میں استعمال');
    // No stem text is printed for the blanked item: its block opens straight on the word list.
    expect(html).toMatch(/data-slot="urdu\.C\.Q5"><(?!\/)/);
    // The same paper with the restatement put back prints it as a stem: the check above can fail.
    itemOf(out.examJson, 'urdu.C.Q5').question = RESTATED;
    const withStem = R.renderPaper({ examJson: out.examJson, grade: 5, subject: 'urdu', answerLines: true });
    expect(withStem).toContain('اپنے جملوں میں استعمال');
    expect(withStem).not.toMatch(/data-slot="urdu\.C\.Q5"><(?!\/)/);
  });
});

describe('other subjects are untouched', () => {
  test('english Q3 keeps the model\'s question (it is the passage); Q4 (printed words) is blanked as Urdu\'s', () => {
    const tree = () => ({
      unseen: {
        subjective: {
          Punctuation: [{ slot: 'english.C.Q3', question: 'the boy said where is my bag', answer: 'The boy said, "Where is my bag?"' }],
          'Word Sentences': [{ slot: 'english.C.Q4', question: 'Use these words in sentences.', words: ['brave', 'quiet', 'shine', 'gift', 'clean', 'share'] }],
        },
      },
    });
    const exam = tree();
    Gen._blankWordsStems(exam, P.subjects.english, 'english');
    const want = tree();
    want.unseen.subjective['Word Sentences'][0].question = '';
    expect(exam).toEqual(want);
  });

  test('the urdu fixture without a restatement is unchanged by the blanking', () => {
    const U = P.subjects.urdu;
    const laid = applyLayout(fixture('urdu'), U, { kind: 'fde' }).examJson;
    const before = JSON.parse(JSON.stringify(laid));
    Gen._blankWordsStems(laid, U, 'urdu');
    expect(laid).toEqual(before);
  });
});
