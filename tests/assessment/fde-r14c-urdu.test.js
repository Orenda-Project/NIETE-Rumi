/**
 * Urdu board-pattern papers: the two Section A give-aways a local run printed, end to end.
 *
 * 1. A name is a topic: «امینہ نے سدرہ کے تکیے کے پاس کیا رکھا تھا؟» beside «سدرہ نے آخر میں اپنی
 *    فاختہ کس کے نام اڑائی؟ → امینہ» names the answer and its topic (a shared content word), so the
 *    two do not both print.
 * 2. A held item put back after the re-ask: chapters_2 Q1 ۲۰ «'شانہ بشانہ' کے کیا معنی ہیں؟» (a
 *    Q3/Q5 word). The first reply held two Q3 meaning items; the top-up asked for exactly two, wrote
 *    a kept twin among them, and the held item took the last place. Replayed through
 *    generatePatternExam with the replies as recorded: the re-ask is told the Q3/Q5 words and asked
 *    for two spares, and the held item stays out.
 *
 * The recorded papers are local replies (content only).
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds lesson 7's poem (the verses the recorded Q6 prints) for any range asked.
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
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r14c-urdu-local-${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const sectionA = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.A.Q1'));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);

describe('(1) a name is a topic: a stem that names another item\'s one-word answer with it gives it away', () => {
  const amina = read('amina');
  const q1 = items(amina, 'urdu.A.Q1');
  const asks = q1.find((q) => /امینہ/.test(q.answer));
  const names = q1.find((q) => /^امینہ نے سدرہ/.test(q.question));
  const laid = () => applyLayout(clone({ unseen: amina.unseen }), U, amina._scope, { reasked: false });

  test('the recorded pair is on the paper as given', () => {
    expect(asks.question).toContain('فاختہ کس کے نام اڑائی');
    expect(names.question).toContain('سدرہ');
  });

  test('chapters_4: «امینہ نے سدرہ کے …» and «سدرہ نے … کس کے نام اڑائی؟ → امینہ» do not both print', () => {
    const stems = q1Stems(laid().examJson);
    expect(stems.includes(asks.question) && stems.includes(names.question)).toBe(false);
  });

  test('every other item on the paper still prints', () => {
    expect(q1Stems(laid().examJson)).toHaveLength(19);
  });
});

describe('(2) the Section A top-up of a recorded paper: Q3/Q5 words named, two spares asked, the held item stays out', () => {
  const rec = read('shana-replies');
  const firstLayout = () => {
    const tree = {};
    for (const k of ['B', 'C', 'A1']) {
      for (const [branch, cats] of Object.entries(JSON.parse(rec.replies[k]))) {
        for (const [cat, types] of Object.entries(cats || {})) {
          for (const [type, list] of Object.entries(types || {})) if (Array.isArray(list)) (((tree[branch] ||= {})[cat] ||= {})[type] ||= []).push(...list);
        }
      }
    }
    return applyLayout(tree, U, rec.scope, { reasked: false });
  };

  test('the first reply holds the two Q3 meaning items; the top-up note names the Q3/Q5 words and asks for 5', () => {
    const laid = firstLayout();
    // The two meaning items, and the second شکیہ item (one grammar concept once).
    expect(laid.shortfall).toContainEqual({ slot: 'urdu.A.Q1', missing: 3 });
    expect(q1Stems(laid.examJson).some((s) => /شانہ بشانہ|شاطر/.test(s))).toBe(false);
    const note = takenNote(U, sectionA, laid.examJson, { topUp: true, shortfall: laid.shortfall });
    expect(note).toMatch(/Q3 and Q5 of this paper ask the meaning of[^\n]*شانہ بشانہ/);
    expect(note).toMatch(/Q3 and Q5 of this paper ask the meaning of[^\n]*شاطر/);
    expect(note).toContain('No MCQ you write in this section may ask the meaning of any of these words');
    expect(note).toMatch(/Write 5 new items/);
  });

  // The replies as recorded. The re-ask writes what its note asks for: the recorded two («دندان
  // سازی», a kept twin, and «ایران»), then spares up to the count asked.
  describe('through generatePatternExam', () => {
    beforeEach(() => mockCreate.mockReset());
    const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const SPARES = [['سچ', 'جھوٹ'], ['امیر', 'غریب']].map(([w, k]) => ({
      slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» کا متضاد کون سا ہے؟`,
      options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}`, marks: 1,
    }));
    function serve() {
      const asked = [];
      mockCreate.mockImplementation(async (req) => {
        const prompt = textOf(req);
        const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
        asked.push({ sec, prompt });
        let content = rec.replies[sec === 'A' ? 'A1' : sec];
        if (sec === 'A' && asked.filter((a) => a.sec === 'A').length > 1) {
          const second = JSON.parse(rec.replies.A2);
          const wrote = second.unseen.objective.MCQs;
          const m = prompt.match(/write (\d+) new/i);
          second.unseen.objective.MCQs = [...wrote, ...clone(SPARES)].slice(0, Math.max(m ? Number(m[1]) : 0, wrote.length));
          content = JSON.stringify(second);
        }
        return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
      });
      return asked;
    }

    test('chapters_2: «شانہ بشانہ» and «شاطر» are not put back; «ایران» and a spare take the places; Q1 is whole', async () => {
      const asked = serve();
      const out = await Gen.generatePatternExam({
        grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-r14c',
      }).then((r) => ({ ok: r }), (err) => ({ err }));
      expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
      const q1 = q1Stems(out.ok.examJson);
      expect(q1).toHaveLength(20);
      expect(q1.some((s) => /شانہ بشانہ|شاطر/.test(s))).toBe(false);
      expect(q1).toContain('شیخ سعدی کا تعلق کس ملک سے تھا؟');
      expect(q1).toContain(SPARES[0].question);
      const a = asked.filter((x) => x.sec === 'A');
      expect(a).toHaveLength(2);
      expect(a[0].prompt).not.toContain('Q3 and Q5 of this paper');
      expect(a[1].prompt).toMatch(/Q3 and Q5 of this paper ask the meaning of[^\n]*شانہ بشانہ/);
      // Three places (the two meaning items and the second شکیہ item) and two spares.
      expect(a[1].prompt).toMatch(/Write 5 new items/);
    });
  });
});
