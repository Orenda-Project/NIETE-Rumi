/**
 * Urdu board-pattern papers on chosen lessons, two follow-ups to the lesson-scoped Q1:
 *
 * 1. Section A's RULES block names only the chosen lessons' grammar concepts. On lessons 6–7 the
 *    concept-once and grammar-term rules used to list lesson-10 terms (اسم صوت، اسم آلہ، اسم معرفہ،
 *    صفت …) and lesson 8's حرفِ عطف right under a Q1 rule that allows متشابہ الفاظ only: every such
 *    item the model wrote was a hold, and a hold is a top-up. Q4's kinds stay listed as "never in Q1".
 *    The full syllabus keeps both rules word for word.
 * 2. The holds of every layout reach the log, not only the first layout's: the `[assessment] layout
 *    applied` line carries the final layout's `held`, so a hold made after a re-ask is counted.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds lesson 7's poem (the verses the paper's Q6 prints) for any page range asked.
const mockPages = ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی',
  'پاکیزہ مجھ کو کر دو کرکے مری صفائی', 'میرا بھی فائدہ ہے انساں کی بھی بھلائی',
  'تم مجھ کو صاف رکھ کے خود بھی سکھی رہوگے', 'پانی جو صاف ہوگا بیماری سے بچوگے'].join('\n\n');
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '63' }),
}));

const { logToFile } = require('../../bot/shared/utils/logger');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const clone = (x) => JSON.parse(JSON.stringify(x));
const paper = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r21-urdu-sandbox-chapters_2.json'), 'utf8'));

const sectionA = U.sections.find((s) => s.id === 'A');
const promptA = (scope) => Gen.buildPatternUserPrompt({
  grade: 5, subject: 'urdu', pageContent: mockPages, pageReference: 'p', section: sectionA, slots: sectionA.slots, lang: 'ur', P: U, scope,
});
const rulesOf = (p) => p.slice(p.indexOf('**RULES:**'));
// Lesson 10's grammar (and its definition example), lesson 8's حرفِ عطف, lesson 5's شکیہ / تمنائی.
const LESSON10 = /اسم صوت|اسم آلہ|معرفہ|نکرہ|صفت|موصوف|آواز ظاہر/;
const OTHER = /عطف|شکیہ|تمنائی/;
const Q4_NEVER = 'Q4 on this paper asks گروہی الفاظ, حروفِ شرط و جزا, a present-to-future tense change and ارکان سازی; no Q1 item asks any of these.';
// The full syllabus's two rules, word for word.
const FULL_ONCE = 'Q1 asks each grammar concept (شکیہ، تمنائی، شرط و جزا، حرفِ عطف, and so on) in one item only: no other Q1 item names its words, states its rule or gives its example. Each of these is a concept of its own: اسم صوت، اسم آلہ، اسم معرفہ، اسم نکرہ، صفت، موصوف; a definition item asks its concept, so an item that says what a term is («جو لفظ … آواز ظاہر کرے») and an item that asks for that term are one concept asked twice. ' + Q4_NEVER;
const FULL_TERM = 'A grammar-term item (اسم صفت، حرفِ عطف، فعل …) never prints a word of its own answer in its stem: describe what the term does, and quote an example.';

describe('Section A rules on chosen lessons name only those lessons\' grammar', () => {
  test('lessons 6–7: no lesson-10, lesson-8 or lesson-5 concept anywhere in the prompt; متشابہ is the concept, Q4\'s kinds stay never-in-Q1', () => {
    const p = promptA(ch(6, 7));
    expect(p).not.toMatch(LESSON10);
    expect(p).not.toMatch(OTHER);
    expect(rulesOf(p)).toMatch(/متشابہ الفاظ/);
    expect(rulesOf(p)).toContain(Q4_NEVER);
    expect(p).not.toContain(FULL_ONCE);
    expect(p).not.toContain(FULL_TERM);
  });

  test('a pages scope (pp 50–70) reads as lessons 6–7', () => {
    const p = promptA({ kind: 'pages', chapters: null, pages: '50-70' });
    expect(p).not.toMatch(LESSON10);
    expect(rulesOf(p)).toMatch(/متشابہ الفاظ/);
  });

  test('lessons 4–5: their own concepts (تمنائی اور شکیہ جملے, متضاد, مترادف) and no lesson-10 term', () => {
    const r = rulesOf(promptA(ch(4, 5)));
    expect(r).toMatch(/تمنائی اور شکیہ جملے/);
    expect(r).toMatch(/مترادف الفاظ/);
    expect(r).not.toMatch(LESSON10);
    expect(r).toContain(Q4_NEVER);
  });

  test('lesson 10: its own four concepts are named', () => {
    const r = rulesOf(promptA(ch(10)));
    for (const t of ['اسم معرفہ و نکرہ', 'صفت و موصوف', 'اسم صوت', 'اسم آلہ']) expect(r).toContain(t);
    expect(r).not.toMatch(OTHER);
  });

  test('lesson 7 alone (its grammar is Q4\'s): Q1 is told it has no grammar concept, and no grammar-term rule is given', () => {
    const r = rulesOf(promptA(ch(7)));
    expect(r).not.toMatch(LESSON10);
    expect(r).not.toMatch(OTHER);
    expect(r).toContain(Q4_NEVER);
    expect(r).not.toMatch(/grammar-term item/);
  });

  test('the full syllabus keeps both rules word for word', () => {
    const p = promptA(FDE);
    expect(p).toContain(FULL_ONCE);
    expect(p).toContain(FULL_TERM);
  });
});

describe('through generatePatternExam: a hold made after the re-ask reaches the log', () => {
  beforeEach(() => { mockCreate.mockReset(); logToFile.mockClear(); });
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const treeFor = (sec) => {
    const tree = {};
    for (const [cat, types] of Object.entries(paper.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => q.slot.startsWith(`urdu.${sec}.`));
        if (mine.length) (tree[cat] ||= {})[type] = clone(mine);
      }
    }
    return tree;
  };
  // Asked again, Section A writes antonym items from the lessons' word lists, and one اسم آلہ item
  // (lesson 10's grammar): only the layouts after the re-ask see it.
  const TOOL = { slot: 'urdu.A.Q1', question: 'جس لفظ سے کسی اوزار کا نام ظاہر ہو، اسے کیا کہتے ہیں؟', options: ['الف) اسم آلہ', 'ب) اسم ظرف', 'ج) فعل', 'د) حرف'], answer: 'الف) اسم آلہ' };
  const SPARES = [['صلح', 'جنگ'], ['اجالا', 'اندھیرا'], ['آزاد', 'قید'], ['دوست', 'دشمن'], ['امید', 'مایوسی'], ['آغاز', 'انجام'], ['قریب', 'دور'], ['ہنسی', 'رونا']]
    .map(([w, k]) => ({ slot: 'urdu.A.Q1', question: `لفظ «${w}» کا متضاد کون سا ہے؟`, options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}` }));
  function serve() {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
      asked.push(sec);
      const tree = treeFor(sec);
      if (sec === 'A' && asked.filter((a) => a === 'A').length > 1) tree.objective.MCQs = [clone(TOOL), ...clone(SPARES)];
      return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
    });
    return asked;
  }

  test('the re-asked اسم آلہ item is held, never prints, and the layout-applied line names it', async () => {
    const asked = serve();
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: { kind: 'chapters', chapters: [6, 7], pages: '50-70' }, requestId: 'req-held' })
      .then((r) => ({ ok: r }), (err) => ({ err }));
    expect(asked.filter((a) => a === 'A').length).toBeGreaterThan(1);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const printed = JSON.stringify(out.ok.examJson);
    expect(printed).not.toContain(TOOL.question);
    // The paper keeps the hold as a count only ({ slot, rule, n }): no item, no concept.
    const { holds, ...rest } = out.ok.examJson._layout;
    expect(JSON.stringify({ ...out.ok.examJson, _layout: rest })).not.toMatch(/grammar_outside_lessons/);
    (holds || []).forEach((h) => expect(Object.keys(h).sort()).toEqual(['n', 'rule', 'slot']));
    // The first layout never saw the re-asked item: its line cannot name it.
    const first = logToFile.mock.calls.find(([msg]) => msg === '[assessment] held items');
    expect(JSON.stringify(first ? first[1].held : [])).not.toMatch(/"tool"/);
    const applied = logToFile.mock.calls.find(([msg]) => msg === '[assessment] layout applied');
    expect(applied && applied[1]).toEqual(expect.objectContaining({
      requestId: 'req-held',
      held: expect.arrayContaining([expect.objectContaining({ slot: 'urdu.A.Q1', rule: 'grammar_outside_lessons', concept: 'tool' })]),
    }));
  });

  test('the full syllabus holds nothing for scope: the layout-applied line has no held key', async () => {
    serve();
    await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: FDE, requestId: 'req-full' }).catch(() => null);
    const applied = logToFile.mock.calls.find(([msg]) => msg === '[assessment] layout applied');
    expect(applied).toBeDefined();
    expect(applied[1]).not.toHaveProperty('held');
  });
});
