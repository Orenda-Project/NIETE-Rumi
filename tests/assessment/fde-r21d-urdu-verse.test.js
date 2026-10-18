/**
 * Urdu board-pattern papers on chosen lessons: Q6's verses, given from a lesson the paper does not
 * cover (lessons 4–5 hold no poem, so lesson 7's «ندی کی فریاد» is given), print their lesson and
 * pages under them, as English Q5 prints «<title> (Unit n)». Nothing prints when the verses are from
 * the chosen lessons or the full syllabus.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
// The book store: lessons 4–5's pages for the paper, lesson 7's poem when its pages are asked for.
const mockPoem = ['=== Page 63 ===', 'ندی کی فریاد', 'شاعر: کوثر صدیقی',
  'پاکیزہ مجھ کو کر دو کرکے مری صفائی', 'میرا بھی فائدہ ہے انساں کی بھی بھلائی',
  'تم مجھ کو صاف رکھ کے خود بھی سکھی رہوگے', 'پانی جو صاف ہوگا بیماری سے بچوگے'].join('\n\n');
const mockLesson = ['=== Page 30 ===', 'محترمہ فاطمہ جناح نے دندان سازی کی تعلیم حاصل کی۔', '=== Page 40 ===', 'لومڑی جنگل میں رہتی تھی۔'].join('\n\n');
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: String(pageRanges) === '63-64' ? mockPoem : mockLesson, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockLesson, pageReference: '30' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const clone = (x) => JSON.parse(JSON.stringify(x));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r21d-urdu-chapters_${n}.json`), 'utf8'));
const lay = (exam, scope, opts = {}) => applyLayout(clone(exam), U, scope, { now: 'x', ...opts });

describe('(g) verses given from outside the chosen lessons print their source', () => {
  const p = fixture(1); // lessons 4–5 with lesson 7's verses in Q6 (ب)
  const html = (source) => {
    const out = lay(p, ch(4, 5)).examJson;
    if (source) out._layout.verse_source = source;
    return Renderer.renderPaper({ examJson: out, grade: 5, subject: 'urdu', allowShort: true });
  };

  test('«(سبق ۷، ص ۶۳ تا ۶۴)» prints under the verses', () => {
    const page = html({ lesson: 7, pages: '63-64' });
    // Each number prints as its own run of Urdu digits.
    const plainPage = page.replace(/<span class="num">([^<]*)<\/span>/g, '$1');
    expect(plainPage).toMatch(/<div class="verse">[^<]*(?:<br>[^<]*)*<\/div><div class="verse verse-src">\(سبق ۷، ص ۶۳ تا ۶۴\)<\/div>/);
  });

  test('no source line without a recorded source (control)', () => {
    expect(html(null)).not.toMatch(/verse-src"|سبق ۷، ص/);
  });
});

describe('(g) through generatePatternExam: the engine records the given verses\' source', () => {
  const KEYS = ['کتاب', 'دریا', 'بادل', 'پہاڑ', 'باغ', 'چراغ', 'قلم', 'کرسی', 'دروازہ', 'کھڑکی',
    'گھوڑا', 'کشتی', 'پتنگ', 'گھڑی', 'چادر', 'پیالہ', 'ٹوپی', 'جوتا', 'تالا', 'سیڑھی'];
  const q1 = KEYS.map((k, i) => ({
    slot: 'urdu.A.Q1', question: `سبق کی کہانی کا سوال ${i + 1}: درست جواب چنیں؟`,
    options: [`الف) ${k}`, `ب) ${KEYS[(i + 1) % 20]}`, `ج) ${KEYS[(i + 2) % 20]}`, `د) ${KEYS[(i + 3) % 20]}`], answer: `الف) ${k}`,
  }));
  const p = fixture(1);
  const treeFor = (sec) => {
    const tree = {};
    for (const [cat, types] of Object.entries(p.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => q.slot.startsWith(`urdu.${sec}.`));
        if (mine.length) (tree[cat] ||= {})[type] = clone(mine);
      }
    }
    if (sec === 'A') tree.objective.MCQs = clone(q1);
    // The sandbox paper's ارکان key splits «تواضع» against its own accept; this one agrees with it.
    Object.values(tree).flatMap((t) => Object.values(t)).flat()
      .filter((q) => q.slot === 'urdu.C.Q4' && q.answer.includes('+')).forEach((q) => { q.answer = 'مشغول: مش + غول\nتواضع: ت + وا + ضع'; });
    return tree;
  };
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

  test('lessons 4–5: `_layout.verse_source` names lesson 7, pp 63–64', async () => {
    mockCreate.mockImplementation(async (req) => {
      const sec = ['A', 'B', 'C'].find((x) => textOf(req).includes(`"slot": "urdu.${x}.`));
      return { choices: [{ message: { content: JSON.stringify({ unseen: treeFor(sec) }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
    });
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: { kind: 'chapters', chapters: [4, 5], pages: '28-49' }, requestId: 'req-verse' })
      .then((r) => ({ ok: r }), (err) => ({ err }));
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall, message: out.err.message }).toBeUndefined();
    expect(out.ok.examJson._layout.verse_source).toEqual({ lesson: 7, pages: '63-64' });
  });
});
