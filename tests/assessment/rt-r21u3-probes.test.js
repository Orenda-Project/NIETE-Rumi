/**
 * Probes for the Urdu Q1 concept rules on chosen lessons, the declared concept, the paper's hold counts,
 * the Q4 syllable hold and the verse source line.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockPages = ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی',
  'پاکیزہ مجھ کو کر دو کرکے مری صفائی', 'میرا بھی فائدہ ہے انساں کی بھی بھلائی',
  'تم مجھ کو صاف رکھ کے خود بھی سکھی رہوگے', 'پانی جو صاف ہوگا بیماری سے بچوگے'].join('\n\n');
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '63' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, conceptOf } = require('../../bot/shared/services/assessment/fde-layout');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const clone = (x) => JSON.parse(JSON.stringify(x));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r21d-urdu-chapters_${n}.json`), 'utf8'));
const q1Of = (exam) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === 'urdu.A.Q1');
const lay = (exam, scope, opts = {}) => applyLayout(clone(exam), U, scope, { now: 'x', ...opts });
const VOCAB = 'ذخیرۂ الفاظ / فہم';
const isAnt = (q) => /کا متضاد/.test(q.question);
const isSyn = (q) => /کا مترادف/.test(q.question);

// Lessons 4–5, a recorded reply (متضاد ×6, مترادف ×3). `honest`: every antonym / synonym item is tagged
// as what it asks. `byCount`: the reply keeps the prompt's "exactly 4 are grammar" by its labels: the
// first antonym and the first synonym carry their concept, the repeats are tagged vocabulary.
function tagged(mode) {
  const p = fixture(1);
  let a = 0; let s = 0;
  q1Of(p).forEach((q) => {
    if (isAnt(q)) { a += 1; q.concept = mode === 'honest' || a === 1 ? 'متضاد الفاظ' : VOCAB; return; }
    if (isSyn(q)) { s += 1; q.concept = mode === 'honest' || s === 1 ? 'مترادف الفاظ' : VOCAB; return; }
    q.concept = conceptOf(q) ? 'تمنائی اور شکیہ جملے' : VOCAB;
  });
  return p;
}

describe('RT-1 (e) a concept tag disagreeing with the stem is a hard hold, so the label decides what prints', () => {
  test('after the re-ask, lessons 4–5 print as many Q1 items whether the repeats are tagged by concept or as vocabulary', () => {
    const honest = lay(tagged('honest'), ch(4, 5), { reasked: true });
    const byCount = lay(tagged('byCount'), ch(4, 5), { reasked: true });
    expect(q1Of(byCount.examJson)).toHaveLength(q1Of(honest.examJson).length);
  });

  test('the only antonym item on a lessons 4–5 paper, tagged vocabulary, still prints (nothing else asks متضاد)', () => {
    const item = { slot: 'urdu.A.Q1', question: 'لفظ «آزاد» کا متضاد کون سا ہے؟', options: ['الف) قید', 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: 'الف) قید', concept: VOCAB };
    const other = { slot: 'urdu.A.Q1', question: 'ندی کس کی فریاد کرتی ہے؟', options: ['الف) صفائی', 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: 'الف) صفائی', concept: VOCAB };
    const r = lay({ unseen: { objective: { MCQs: [item, other] } } }, ch(4, 5), { reasked: true });
    expect(q1Of(r.examJson).map((q) => q.answer)).toContain('الف) قید');
  });
});

describe('RT-2 controls that should hold on the head', () => {
  test('the honest-tag reply prints one antonym and one synonym before the re-ask', () => {
    const out = lay(tagged('honest'), ch(4, 5)).examJson;
    expect(q1Of(out).filter(isAnt)).toHaveLength(1);
    expect(q1Of(out).filter(isSyn)).toHaveLength(1);
  });

  test('a concept field on any item, any slot, any scope, never survives the layout; a non-string tag does not throw', () => {
    for (const scope of [ch(4, 5), ch(6, 7), { kind: 'fde' }]) {
      const p = tagged('honest');
      Object.values(p.unseen).flatMap((t) => Object.values(t || {})).flat().forEach((q, i) => { if (q && !q.concept) q.concept = i % 2 ? { x: 1 } : ['متضاد']; });
      const out = lay(p, scope, { reasked: true }).examJson;
      expect(JSON.stringify(out.unseen)).not.toMatch(/"concept"/);
    }
  });

  test('_layout.holds rows carry only slot, rule and a count, and the paper and scheme render with them', () => {
    const r = lay(tagged('byCount'), ch(4, 5), { reasked: true });
    const holds = r.examJson._layout.holds || [];
    expect(holds.length).toBeGreaterThan(0);
    holds.forEach((h) => { expect(Object.keys(h).sort()).toEqual(['n', 'rule', 'slot']); expect(Number.isInteger(h.n)).toBe(true); });
    expect(() => Renderer.renderPaper({ examJson: r.examJson, grade: 5, subject: 'urdu', allowShort: true })).not.toThrow();
  });

  test('the full syllabus asks the antonym once too, tagged or not: one prints, the rest are held as concept repeats', () => {
    const full = lay(tagged('byCount'), { kind: 'fde' }, { reasked: true }).examJson;
    expect(q1Of(full).filter(isAnt)).toHaveLength(1);
    // Five antonyms and two synonyms asked again.
    expect((full._layout.holds || []).filter((h) => h.rule === 'concept_repeat').map((h) => h.n)).toEqual([7]);
  });

  test('Q4 ارکان: a key and an accept that cut the same way, written with «-» or diacritics, are not held', () => {
    const q4 = (answer, accept) => ({ slot: 'urdu.C.Q4', question: 'درج ذیل الفاظ کی ارکان سازی کریں: مشغول، حریص', answer, scheme: { accept } });
    const n = (q) => (lay({ unseen: { subjective: { 'Rewrite Sentences': [q] } } }, { kind: 'fde' }).examJson._layout.holds || [])
      .filter((h) => h.rule === 'syllable_split').length;
    expect(n(q4('مشغول: مش + غول\nحریص: حَ + ریص', ['مَش - غُول؛ حَ - رِیص']))).toBe(0);
    // positive control, same harness: a key cut apart from its accept is held
    expect(n(q4('مشغول: مش + غول\nحریص: ح + ری + ص', ['مَش غُول؛ حَ رِیص']))).toBe(1);
  });
});

describe('RT-3 through generatePatternExam (lessons 6–7, the poem is in scope): no verse source line', () => {
  const paper = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r21-urdu-sandbox-chapters_2.json'), 'utf8'));
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
  test('lessons 6–7 record no verse_source and print no «(سبق» line', async () => {
    mockCreate.mockReset();
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
      asked.push(sec);
      const tree = treeFor(sec);
      // Asked again, Section A writes fresh comprehension items from the lessons.
      if (sec === 'A' && asked.filter((a) => a === 'A').length > 1) {
        tree.objective.MCQs = Array.from({ length: 12 }, (_, i) => ({ slot: 'urdu.A.Q1', question: `سبق کے حصہ ${i + 1} میں ندی کا کون سا پیغام ${['اول', 'دوم', 'سوم', 'چہارم', 'پنجم', 'ششم', 'ہفتم', 'ہشتم', 'نہم', 'دہم', 'یازدہم', 'دوازدہم'][i]} ہے؟`,
          options: [`الف) پیغام${'ابتثجحخدذرزس'[i]}`, `ب) کتاب${i}`, `ج) دریا${i}`, `د) بادل${i}`], answer: `الف) پیغام${'ابتثجحخدذرزس'[i]}` }));
      }
      return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    });
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: { kind: 'chapters', chapters: [6, 7], pages: '50-70' }, requestId: 'rt' })
      .then((r) => ({ ok: r }), (err) => ({ err }));
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(out.ok.examJson._layout.verse_source).toBeUndefined();
    const html = Renderer.renderPaper({ examJson: out.ok.examJson, grade: 5, subject: 'urdu', allowShort: true });
    expect(String(html.html || html)).not.toMatch(/verse-src/);
  });
});

describe('RT-4 through generatePatternExam (lessons 4–5): the same printed items, labelled two ways', () => {
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const treeOf = (paper, sec) => {
    const tree = {};
    for (const [cat, types] of Object.entries(paper.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => q.slot.startsWith(`urdu.${sec}.`));
        if (mine.length) (tree[cat] ||= {})[type] = clone(mine);
      }
    }
    return tree;
  };
  // Asked again, Section A writes 6 more antonym items and 2 comprehension items, labelled as the first reply was.
  const again = (mode) => [['صلح', 'جنگ'], ['اجالا', 'اندھیرا'], ['دوست', 'دشمن'], ['امید', 'مایوسی'], ['آغاز', 'انجام'], ['قریب', 'دور']]
    .map(([w, k]) => ({ slot: 'urdu.A.Q1', question: `لفظ «${w}» کا متضاد کون سا ہے؟`, options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}`, concept: mode === 'honest' ? 'متضاد الفاظ' : VOCAB }))
    .concat([['شیر', 'جنگل'], ['لومڑی', 'چالاکی']].map(([w, k]) => ({ slot: 'urdu.A.Q1', question: `کہانی میں ${w} کس بات کی علامت ہے؟`, options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}`, concept: VOCAB })));
  const usedUp = [['ندی', 'صفائی'], ['بادل', 'بارش'], ['کسان', 'کھیت'], ['درزی', 'کپڑا'], ['مالی', 'باغ'], ['ملاح', 'کشتی'], ['ڈاکیا', 'خط'], ['چوکیدار', 'پہرا']]
    .map(([w, k]) => ({ slot: 'urdu.A.Q1', question: `سبق میں ${w} کا تعلق کس چیز سے ہے؟`, options: [`الف) ${k}`, 'ب) پہاڑ', 'ج) ستارہ', 'د) ریت'], answer: `الف) ${k}`, concept: VOCAB }));
  const run = async (mode) => {
    const paper = tagged(mode);
    const asked = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation(async (req) => {
      const sec = ['A', 'B', 'C'].find((x) => textOf(req).includes(`"slot": "urdu.${x}.`));
      asked.push(sec);
      const tree = treeOf(paper, sec);
      // Told grammar is used up, Section A writes comprehension items only.
      if (sec === 'A' && /grammar is used up/i.test(textOf(req))) tree.objective.MCQs = usedUp;
      else if (sec === 'A' && asked.filter((a) => a === 'A').length > 1) tree.objective.MCQs = again(mode);
      return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    });
    return Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: { kind: 'chapters', chapters: [4, 5], pages: '28-49' }, requestId: `rt-${mode}` })
      .then((r) => ({ ok: r, asked }), (err) => ({ err, asked }));
  };
  // A repeat never fills a place: the paper is made from the grammar-is-used-up top-up, with one antonym item.
  const antonyms = (exam) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === 'urdu.A.Q1' && /کا متضاد/.test(q.question));
  test('control: antonym repeats tagged متضاد → a paper is made, one antonym printed', async () => {
    const r = await run('honest');
    expect(r.err && { code: r.err.code, shortfall: r.err.shortfall }).toBeUndefined();
    expect(antonyms(r.ok.examJson)).toHaveLength(1);
  });
  test('the same items with the repeats tagged vocabulary → a paper is made too, one antonym printed', async () => {
    const r = await run('byCount');
    expect(r.err && { code: r.err.code, shortfall: r.err.shortfall, asked: r.asked }).toBeUndefined();
    expect(antonyms(r.ok.examJson)).toHaveLength(1);
  });
});
