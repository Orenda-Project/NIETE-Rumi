/**
 * Urdu board-pattern papers: Section A gave Section C away in three shapes on the sandbox papers.
 *
 * 1. One MCQ printed twice. full_2 Q1 ۱ and Q1 ۲۰ «محترمہ فاطمہ جناح کا پیدائشی نام کیا تھا؟»,
 *    both keyed «فاطمہ علی جناح», one distractor changed. The in-slot dedupe compared the option
 *    sets first, so the repeated stem looked new. Same stem and same key is one question.
 *
 * 2. The paper printed its own answer. chapters_2 Q6 prints the verse «پانی جو صاف ہوگا بیماری
 *    سے بچوگے» and Q1 ۱۰ «ندی کا پانی صاف ہو گا تو ہم کس چیز سے بچیں گے؟» is keyed «بیماری».
 *    A Q1 item whose key is in a Q6 verse line, and whose stem asks about that line, is held.
 *
 * 3. Q1 asked the meaning of a Q3/Q5 word, its key the meaning Q3 wants (full_2: 5 of 20). A Q1
 *    item that quotes a Q3 or Q5 word and asks its meaning (or is keyed on Q3's meaning of it) is
 *    held, and the re-asked Section A is told the Q3/Q5 words and the Q6 verse.
 *
 * Q3, Q4, Q5 and Q6 are never touched. The recorded papers are sandbox replies (content only).
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds lesson 7's poem (the verses full_2's Q6 prints) for any page range asked.
const mockPages = ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی',
  'پاکیزہ مجھ کو کر دو کرکے مری صفائی', 'میرا بھی فائدہ ہے انساں کی بھی بھلائی',
  'تم مجھ کو صاف رکھ کے خود بھی سکھی رہوگے', 'پانی جو صاف ہوگا بیماری سے بچوگے'].join('\n\n');
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '63' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r13-urdu-sandbox-${name}.json`), 'utf8'));
const papers = Object.fromEntries(['full_1', 'full_2', 'chapters_1', 'chapters_2'].map((n) => [n, read(n)]));
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
const laid = (name, reasked = false) => applyLayout(clone(papers[name]), U, FDE, { reasked }).examJson;

// The Q1 items the panel counted as giving Section C away, per paper; every other Q1 item stays.
const HELD = {
  full_1: ["'حریص' کا کیا مطلب ہے؟", "'غلاظت' کا مطلب کیا ہے؟", "'شرم سے پانی پانی ہونا' کا کیا مطلب ہے؟"],
  full_2: ['لفظ «غلاظت» کا مطلب کیا ہے؟', 'لفظ «اقلیت» کا مطلب کیا ہے؟', 'لفظ «بوسیدہ» کا مطلب کیا ہے؟',
    'لفظ «لبریز» کا مطلب کیا ہے؟', 'محاورہ «شرم سے پانی پانی ہونا» کا مطلب کیا ہے؟'],
  chapters_1: ['لفظ «شانہ بشانہ» کا مطلب کیا ہے؟', 'لفظ «کڑا» کا مطلب کیا ہے؟', 'لفظ «اقتصادی» کا تعلق کس چیز سے ہے؟',
    'لفظ «حریص» کا کیا مطلب ہے؟', 'لفظ «شاطر» کا کیا مطلب ہے؟'],
  chapters_2: ['لفظ «تاب کاری» کا کیا مطلب ہے؟', 'لفظ «بین الاقوامی» کا کیا مطلب ہے؟', 'لفظ «جھکڑ» کا کیا مطلب ہے؟',
    'لفظ «غلاظت» کا کیا مطلب ہے؟', 'لفظ «بے نوا» کا کیا مطلب ہے؟', 'ندی کا پانی صاف ہو گا تو ہم کس چیز سے بچیں گے؟'],
};
const BIRTH_NAME = 'محترمہ فاطمہ جناح کا پیدائشی نام کیا تھا؟';

describe('one question once: the same stem and key is a twin whatever its distractors', () => {
  test.each([false, true])('full_2 prints «%s» reasked: the birth-name MCQ once', (reasked) => {
    expect(q1Stems(laid('full_2', reasked)).filter((s) => s === BIRTH_NAME)).toHaveLength(1);
  });

  test('the same stem with a different key stays two questions', () => {
    const exam = clone(papers.full_2);
    const [, , , , , , , , , , , , , , , , , , , last] = items(exam, 'urdu.A.Q1');
    last.question = 'درست املا کون سا ہے؟';
    last.options = ['الف) کتاب', 'ب) کتآب', 'ج) کتاپ', 'د) کطاب'];
    last.answer = 'الف) کتاب';
    expect(q1Stems(applyLayout(exam, U, FDE, { reasked: false }).examJson).filter((s) => s === 'درست املا کون سا ہے؟')).toHaveLength(2);
  });
});

describe('Section A never gives Section C away', () => {
  test.each(Object.keys(HELD))('%s: exactly the give-away Q1 items are held before the re-ask', (name) => {
    const after = q1Stems(laid(name));
    for (const s of HELD[name]) expect(after).not.toContain(s);
    // Nothing else is held: every other first-reply item stays (full_2's repeated MCQ once).
    const kept = q1Stems(papers[name]).filter((s) => !HELD[name].includes(s));
    if (name === 'full_2') kept.splice(kept.lastIndexOf(BIRTH_NAME), 1);
    expect(after.slice().sort()).toEqual(kept.sort());
  });

  test('chapters_2: Q1 ۱۰ is held for the Q6 verse alone (no Q3/Q5 word in it)', () => {
    const exam = clone(papers.chapters_2);
    for (const slot of ['urdu.C.Q3', 'urdu.C.Q5']) items(exam, slot).forEach((q) => { q.words = ['قلم']; q.answer = 'قلم: لکھنے کی چیز'; });
    expect(q1Stems(applyLayout(exam, U, FDE, { reasked: false }).examJson)).not.toContain('ندی کا پانی صاف ہو گا تو ہم کس چیز سے بچیں گے؟');
  });

  test('a short key inside the verse is not held when the stem asks about something else', () => {
    const exam = clone(papers.chapters_2);
    const q = items(exam, 'urdu.A.Q1').find((x) => x.question.startsWith('ندی کا پانی'));
    q.question = 'کون سا لفظ مرض کا ہم معنی ہے؟';
    expect(q1Stems(applyLayout(exam, U, FDE, { reasked: false }).examJson)).toContain('کون سا لفظ مرض کا ہم معنی ہے؟');
  });

  test('Q3, Q4, Q5 and Q6 are untouched', () => {
    for (const name of Object.keys(papers)) {
      const out = laid(name);
      for (const slot of ['urdu.C.Q3', 'urdu.C.Q4', 'urdu.C.Q5', 'urdu.C.Q6']) expect(items(out, slot)).toEqual(items(papers[name], slot));
    }
  });

  test('after the one re-ask a held item comes back only for a place nothing else takes', () => {
    expect(items(laid('full_1', true), 'urdu.A.Q1')).toHaveLength(20);
  });

  test('the re-asked Section A is told the Q3/Q5 words and the Q6 verse; B and C are not', () => {
    const sec = (id) => U.sections.find((s) => s.id === id);
    const note = takenNote(U, sec('A'), papers.full_2);
    expect(note).toContain('Q4 of this paper');
    for (const w of ['غلاظت', 'اقلیت', 'بوسیدہ', 'لبریز', 'شرم سے پانی پانی ہونا', 'دودھ کا دودھ اور پانی کا پانی']) expect(note).toContain(w);
    expect(note).toContain('پانی جو صاف ہوگا بیماری سے بچوگے');
    expect(takenNote(U, sec('B'), papers.full_2)).toBeNull();
    expect(takenNote(U, sec('C'), papers.full_2)).toBeNull();
  });
});

describe('through generatePatternExam: the give-aways send Section A back, told Section C', () => {
  beforeEach(() => mockCreate.mockReset());
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const treeFor = (sec) => {
    const tree = {};
    for (const [cat, types] of Object.entries(papers.full_2.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => q.slot.startsWith(`urdu.${sec}.`));
        if (mine.length) (tree[cat] ||= {})[type] = clone(mine);
      }
    }
    return tree;
  };
  // Section A first writes full_2's Q1 as recorded; asked again, it writes plain items in their place.
  const FRESH = Array.from({ length: 24 }, (_, i) => ({
    slot: 'urdu.A.Q1', question: `سوال نمبر ${['ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس', 'بیس', 'اکیس', 'بائیس', 'تئیس', 'چوبیس'][i]} میں کون سا لفظ اسم آلہ ہے؟`,
    options: ['الف) قینچی', 'ب) کرسی', 'ج) دریا', 'د) بادل'], answer: 'الف) قینچی',
  }));
  function serve() {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
      asked.push({ sec, prompt });
      const tree = treeFor(sec);
      if (sec === 'A' && asked.filter((a) => a.sec === 'A').length > 1) tree.objective.MCQs = clone(FRESH);
      return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
    });
    return asked;
  }

  test('full_2: Section A is asked once more, told Q3/Q5\'s words and Q6\'s verse; no give-away is printed', async () => {
    const asked = serve();
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: FDE, requestId: 'req-r13u' })
      .then((r) => ({ ok: r }), (err) => ({ err }));
    const a = asked.filter((x) => x.sec === 'A');
    expect(a).toHaveLength(2);
    expect(a[0].prompt).not.toContain('Q3 and Q5 of this paper');
    expect(a[1].prompt).toContain('Q3 and Q5 of this paper');
    expect(a[1].prompt).toContain('بوسیدہ');
    expect(a[1].prompt).toContain('Q6 of this paper prints these verses');
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const q1 = q1Stems(out.ok.examJson);
    expect(q1).toHaveLength(20);
    for (const s of HELD.full_2) expect(q1).not.toContain(s);
    expect(q1.filter((s) => s === BIRTH_NAME)).toHaveLength(1);
  });
});
