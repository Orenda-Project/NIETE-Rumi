/**
 * Urdu board-pattern papers on chosen lessons: Q1 asks grammar only from those lessons.
 *
 * The book closes each of lessons 4–10 with its own «قواعد کا میدان» section (L4 متضاد · L5 مترادف،
 * متضاد · L6 متشابہ · L7 گروہی الفاظ · L8 حروفِ عطف، شرط و جزا · L9 رموزِ اوقاف · L10 اسم معرفہ/نکرہ،
 * صفت و موصوف، اسم صوت، اسم آلہ). A teacher who picked lessons 6–7 has taught lessons 6–7's grammar,
 * and the paper's own covers line says every section is set from those lessons. So on a chapter or
 * pages paper:
 *
 * 1. The Section A prompt names only the chosen lessons' grammar for Q1 (less Q4's kinds, which Q1
 *    never asks), drops "half grammar", and fills the rest from those lessons' vocabulary, word
 *    meanings and comprehension. The full syllabus keeps its prompt.
 * 2. A Q1 item that asks a grammar concept of another lesson is held (rule `grammar_outside_lessons`),
 *    recorded on the layout and logged with the held items; Section A is topped up. It never comes back.
 *
 * The recorded paper is sandbox lessons 6–7 (content only): Q1 ۷ asks اسم معرفہ, ۸ asks اسم صوت.
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
const { applyLayout, conceptOf, conceptNames } = require('../../bot/shared/services/assessment/fde-layout');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const L67 = { kind: 'chapters', chapters: [6, 7], pages: '50-70' };
const L10 = { kind: 'chapters', chapters: [10], pages: '95-107' };
const clone = (x) => JSON.parse(JSON.stringify(x));
const paper = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r21-urdu-sandbox-chapters_2.json'), 'utf8'));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const stems = (laid) => items(laid.examJson, 'urdu.A.Q1').map((q) => q.question);
const laidOn = (scope) => applyLayout(clone(paper), U, scope, { reasked: false });
const NAMING = /مخصوص نام ظاہر کرے، وہ کیا کہلاتا ہے/; // Q1 ۷ → اسم معرفہ (lesson 10)
const SOUND = /جو لفظ آواز کو ظاہر کرے، وہ کون سا اسم ہے/; // Q1 ۸ → اسم صوت (lesson 10)
const sectionA = PAT.subjects.urdu.sections.find((s) => s.id === 'A');
const promptA = (scope) => Gen.buildPatternUserPrompt({
  grade: 5, subject: 'urdu', pageContent: mockPages, pageReference: '50-70', section: sectionA, slots: sectionA.slots, lang: 'ur', P: U, scope,
});
const slotBlock = (prompt) => prompt.slice(prompt.indexOf('**GENERATE THE FOLLOWING:**'), prompt.indexOf('**RULES:**'));

describe('the layout holds a Q1 grammar item from outside the chosen lessons', () => {
  test('lessons 6–7: Q1 ۷ (اسم معرفہ) and ۸ (اسم صوت), lesson-10 grammar, are held and recorded', () => {
    const laid = laidOn(L67);
    expect(stems(laid).some((s) => NAMING.test(s))).toBe(false);
    expect(stems(laid).some((s) => SOUND.test(s))).toBe(false);
    expect(laid.held).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: 'urdu.A.Q1', rule: 'grammar_outside_lessons', concept: 'naming' }),
      expect.objectContaining({ slot: 'urdu.A.Q1', rule: 'grammar_outside_lessons', concept: 'sound' }),
    ]));
  });

  test('lessons 6–7: the lessons\' own grammar (a متشابہ item) and the vocabulary items stay', () => {
    const out = stems(laidOn(L67));
    expect(out.some((s) => /ایک ہی املا اور مختلف معنی والے الفاظ کیا کہلاتے ہیں/.test(s))).toBe(true);
    expect(out.some((s) => /«جنگ» کا متضاد/.test(s))).toBe(true);
    expect(out.some((s) => /کے شاعر کون ہیں/.test(s))).toBe(true);
  });

  test('a held item never comes back after the re-ask', () => {
    const laid = applyLayout(clone(paper), U, L67, { reasked: true });
    expect(stems(laid).some((s) => NAMING.test(s) || SOUND.test(s))).toBe(false);
  });

  test('lesson 10: the same two items are its own grammar and stay; lesson 6\'s متشابہ item is the one held', () => {
    const laid = laidOn(L10);
    expect(stems(laid).some((s) => NAMING.test(s))).toBe(true);
    expect(stems(laid).some((s) => SOUND.test(s))).toBe(true);
    expect(stems(laid).some((s) => /ایک ہی املا اور مختلف معنی والے الفاظ کیا کہلاتے ہیں/.test(s))).toBe(false);
    expect((laid.held || []).map((h) => h.concept)).toEqual(['homograph']);
  });

  test('a pages paper maps its pages to lessons: pp 50–70 hold them, pp 96–100 (lesson 10) keep them', () => {
    expect(stems(laidOn({ kind: 'pages', chapters: null, pages: '50-70' })).some((s) => NAMING.test(s))).toBe(false);
    expect(stems(laidOn({ kind: 'pages', chapters: null, pages: '96-100' })).some((s) => NAMING.test(s))).toBe(true);
  });

  test('lesson 5\'s قواعد section also teaches تمنائی اور شکیہ جملے (book p.47): a شکیہ item stays on lessons 4–5, is held on 6–7', () => {
    const doubt = { slot: 'urdu.A.Q1', question: 'ان میں سے شکیہ جملہ کون سا ہے؟', options: ['الف) کاش میں بھی جا سکتا', 'ب) شاید کل بارش ہو', 'ج) وہ گھر گیا', 'د) پانی پیو'], answer: 'ب) شاید کل بارش ہو' };
    const one = (scope) => applyLayout({ unseen: { objective: { MCQs: [clone(doubt)] } } }, U, scope, { reasked: false });
    expect(one({ kind: 'chapters', chapters: [4, 5], pages: '28-49' }).held).toBeUndefined();
    expect(one(L67).held).toEqual([expect.objectContaining({ rule: 'grammar_outside_lessons', concept: 'doubt' })]);
    expect(slotBlock(promptA({ kind: 'chapters', chapters: [4, 5], pages: '28-49' }))).toContain('تمنائی اور شکیہ جملے');
  });

  test('the full syllabus is unchanged: both items stay and nothing is held for scope', () => {
    const laid = laidOn(FDE);
    expect(stems(laid).some((s) => NAMING.test(s))).toBe(true);
    expect(stems(laid).some((s) => SOUND.test(s))).toBe(true);
    expect(laid.held).toBeUndefined();
  });
});

describe('the Section A prompt on chosen lessons', () => {
  test('lessons 6–7: Q1 names متشابہ الفاظ only, says grammar only from these lessons\' قواعد sections, and drops "half grammar"', () => {
    const block = slotBlock(promptA(L67));
    expect(block).toContain('متشابہ الفاظ');
    expect(block).toContain('قواعد');
    expect(block).toMatch(/vocabulary, word meaning or comprehension from these lessons/);
    expect(block).not.toMatch(/half grammar/);
    expect(block).not.toMatch(/اسم معرفہ|اسم صوت|اسم آلہ|حروف عطف|حروفِ عطف/);
    // Q4 asks گروہی الفاظ on every paper, so lesson 7's grammar is not offered to Q1.
    expect(block).not.toContain('گروہی الفاظ');
  });

  test('lesson 10: Q1 names lesson 10\'s grammar', () => {
    const block = slotBlock(promptA(L10));
    for (const term of ['اسم صوت', 'اسم آلہ', 'صفت و موصوف']) expect(block).toContain(term);
    expect(block).not.toContain('متشابہ');
  });

  test('lesson 7 alone: no grammar point is offered to Q1; every item is vocabulary, meaning or comprehension', () => {
    const block = slotBlock(promptA({ kind: 'chapters', chapters: [7], pages: '61-70' }));
    expect(block).toMatch(/no grammar point/);
    expect(block).not.toMatch(/half grammar/);
  });

  test('Section A asks every واحد/جمع or مذکر/مؤنث option from the asked word\'s family, on every scope', () => {
    for (const scope of [FDE, L67]) expect(promptA(scope)).toContain('In a واحد/جمع or مذکر/مؤنث item, every option is a form of the asked word\'s family.');
  });

  test('the full syllabus keeps FDE\'s Q1 rule and grain word for word', () => {
    const block = slotBlock(promptA(FDE));
    const q1 = sectionA.slots.find((s) => s.slot === 'urdu.A.Q1');
    expect(block).toContain(q1.prompt_rule);
    expect(block).toContain(q1.grain.kind);
  });
});

describe('through generatePatternExam: lessons 6–7 never print lesson-10 grammar', () => {
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
  // Asked again, Section A writes vocabulary items from the lessons' own word lists.
  const SPARES = [['صلح', 'جنگ'], ['اجالا', 'اندھیرا'], ['آزاد', 'قید'], ['دوست', 'دشمن'], ['امید', 'مایوسی'], ['آغاز', 'انجام'], ['قریب', 'دور'], ['ہنسی', 'رونا']]
    .map(([w, k]) => ({ slot: 'urdu.A.Q1', question: `لفظ «${w}» کا متضاد کون سا ہے؟`, options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}` }));
  function serve() {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
      asked.push({ sec, prompt });
      const tree = treeFor(sec);
      if (sec === 'A' && asked.filter((a) => a.sec === 'A').length > 1) tree.objective.MCQs = clone(SPARES);
      return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
    });
    return asked;
  }

  test('Section A is asked with the lessons\' grammar; ۷ and ۸ are held, logged, and Q1 prints whole without them', async () => {
    const asked = serve();
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: L67, requestId: 'req-r21b' })
      .then((r) => ({ ok: r }), (err) => ({ err }));
    const a = asked.filter((x) => x.sec === 'A');
    expect(a[0].prompt).toContain('متشابہ الفاظ');
    expect(a[0].prompt).not.toMatch(/half grammar/);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const q1 = items(out.ok.examJson, 'urdu.A.Q1').map((q) => q.question);
    expect(q1).toHaveLength(20);
    expect(q1.some((s) => NAMING.test(s) || SOUND.test(s))).toBe(false);
    const line = logToFile.mock.calls.find(([msg]) => msg === '[assessment] held items');
    expect(line && line[1]).toEqual(expect.objectContaining({
      requestId: 'req-r21b',
      held: expect.arrayContaining([expect.objectContaining({ rule: 'grammar_outside_lessons', concept: 'naming' })]),
    }));
  });
});

describe('every grammar-concept row tags its own term, and a twin of it is held', () => {
  // One term per row, as the book writes it (آ, ئ, zer and all).
  const ROWS = {
    naming: 'اسم معرفہ', sound: 'اسم صوت', tool: 'اسم آلہ', place: 'اسم ظرف', adjective: 'اسم صفت', qualified: 'موصوف',
    conjunction: 'حرفِ عطف', condition: 'حرفِ شرط', doubt: 'شکیہ جملہ', wish: 'تمنائی جملہ', homograph: 'متشابہ الفاظ',
  };
  const keyed = (question, term, others) => ({ slot: 'urdu.A.Q1', question, options: [`الف) ${term}`, ...others.map((o, i) => `${['ب', 'ج', 'د'][i]}) ${o}`)], answer: `الف) ${term}` });
  const full2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r21-urdu-sandbox-full_2.json'), 'utf8'));

  test('the guard names every row', () => {
    expect(Object.keys(ROWS).sort()).toEqual([...conceptNames].sort());
  });

  test.each(Object.entries(ROWS))('%s: an item keyed «%s» is tagged with its row', (name, term) => {
    expect(conceptOf(keyed('درج ذیل میں سے درست جواب کون سا ہے؟', term, ['کتاب', 'دریا', 'بادل']))).toBe(name);
  });

  test('a word-meaning item keyed «آرزو» asks no concept', () => {
    expect(conceptOf(keyed('لفظ «تمنا» کا مطلب کیا ہے؟', 'آرزو', ['غم', 'سفر', 'دولت']))).toBeNull();
  });

  // Positive control for the "distinct concepts stay" tests: on a recorded paper with its other grammar
  // items taken out, two items of one row, keyed alike but sharing no stem word, print once.
  test.each(Object.entries(ROWS))('%s: a second item asking «%s» is held on the recorded full_2', (name, term) => {
    const exam = clone(full2);
    for (const types of Object.values(exam.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        if (!list.some((q) => q.slot === 'urdu.A.Q1')) continue;
        const rest = list.filter((q) => q.slot !== 'urdu.A.Q1' || !conceptOf(q));
        types[type] = [
          keyed('استاد نے تختے پر جو مثال لکھی، وہ کیا ہے؟', term, ['فعل', 'ضمیر', 'مصدر']),
          keyed('سبق کے آخر میں دیا گیا نمونہ کس قسم کا ہے؟', term, ['حرف', 'مرکب', 'جملہ']),
          ...rest,
        ];
      }
    }
    const out = stems(applyLayout(exam, U, FDE, { reasked: false }));
    expect([/تختے پر جو مثال/, /دیا گیا نمونہ/].filter((re) => out.some((x) => re.test(x)))).toHaveLength(1);
  });
});
