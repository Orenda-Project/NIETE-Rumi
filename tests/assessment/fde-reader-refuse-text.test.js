/**
 * Urdu board-pattern papers: a reader pass after the final layout.
 *
 * Three local rounds each found a Section A give-away of a new shape, and some of them share no
 * text with the item they give away: «نہ جانے، کیا خبر اور شاید … کس قسم کے جملوں میں آتے ہیں؟ →
 * شکیہ» answers «کون سا جملہ شکیہ ہے؟». No string rule sees that. So, when the engine is told to,
 * one model call reads the printed question paper (no keys) beside Q1's keys and names the Q1
 * items a child could answer from text printed elsewhere. Those are held, Section A is asked once
 * for replacements, the paper is laid out again, and the reader checks the replacements only.
 *
 * The paper is replayed from a recorded local run (content only); the model boundary is mocked,
 * never the chain.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds the poem the recorded Q6 prints (lesson 7, «ندی کی فریاد»), for any range asked.
const mockPages = (() => {
  const replies = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'fde', 'reader-urdu-local-chapters_1.json'), 'utf8')).replies;
  const q6 = JSON.parse(replies.C).unseen.subjective['Poem Explanation'][0];
  return ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی', ...q6.passage.split('\n')].join('\n\n');
})();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '28' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const rec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'reader-urdu-local-chapters_1.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (prompt) => prompt.includes(Reader.READER_MARK);

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
// The recorded concept twin: ۱۶ states the rule that answers ۱۳.
const RULE_STEM = /نہ جانے/;

// Replacement MCQs the reader's top-up writes (fictional, everyday facts).
const NEW = [['دریا', 'پانی کا بڑا بہاؤ'], ['کتاب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'], ['درزی', 'کپڑے سینے والا']]
  .map(([w, k]) => ({
    slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» سے کیا مراد ہے؟`,
    options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1,
  }));

/**
 * Serves the recorded section replies, and the reader's replies from `reader` (a function of the
 * reader prompt and its call number, returning the reply content or throwing).
 */
function serve({ reader = null, topUp = NEW } = {}) {
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    if (isReader(prompt)) {
      const n = asked.filter((a) => a.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', prompt, req });
      const content = await reader(prompt, n);
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
    asked.push({ sec, prompt, req });
    const nA = asked.filter((a) => a.sec === 'A').length;
    let content = rec.replies[sec === 'A' ? 'A1' : sec];
    if (sec === 'A' && nA === 2) content = rec.replies.A2;
    if (sec === 'A' && nA === 3) content = JSON.stringify({ unseen: { objective: { MCQs: clone(topUp) } } });
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  });
  return asked;
}

// The label the reader prompt gives the first Q1 item matching `re` («Q1.16»).
function labelOf(prompt, re) {
  const line = prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l));
  return line ? line.split(' ')[0] : null;
}

const run = (extra = {}) => Gen.generatePatternExam({
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-reader', ...extra,
}).then((r) => ({ ok: r }), (err) => ({ err }));

// generated_at is the clock's, and `_layout.reader` is the pass's own record (asserted where it
const stable = (exam) => { const e = clone(exam); delete e._layout.generated_at; delete e._layout.reader; return e; };
const Fde = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const flagWith = (reason, extra = {}) => serve({
  reader: async (prompt, n) => (n === 1
    ? JSON.stringify({ candidates: [{ item: labelOf(prompt, RULE_STEM), by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason, given_away: true }] })
    : JSON.stringify({ candidates: [] })),
  ...extra,
});
const renders = (exam) => {
  try {
    Fde.renderPaper({ examJson: exam, grade: 5, subject: 'urdu' });
    Fde.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'urdu' });
    return 'ok';
  } catch (e) { return `${e.code || ''} ${e.message}`; }
};
beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('RT reader2: the reader record on the paper must never stop it printing', () => {
  test('control: a plain reason renders', async () => {
    flagWith('states the rule that answers which sentence is شکیہ');
    const out = await run({ readerPass: true });
    expect(out.err).toBeUndefined();
    expect(renders(out.ok.examJson)).toBe('ok');
  });
  test.each([
    ['an Urdu quote with «اسی طرح» (ordinary Urdu; printed as an item option on gen-local-r7u7d chapters_1)', 'Q1.9 option «اسی طرح انتظار کرتے رہنا بہتر ہے» states the rule'],
    ['an Urdu quote with «مسودہ»', 'Q2 prints «خط کا مسودہ» which answers it'],
    ['English "needs review"', 'the key needs review: Q1.13 states the rule'],
    ['English "filler"', 'Q1.13 is not a filler: it states the rule'],
  ])('a reader reason carrying %s still renders', async (_n, reason) => {
    flagWith(reason);
    const out = await run({ readerPass: true });
    expect(out.err).toBeUndefined();
    expect(out.ok.examJson._layout.reader.items[0].reason).toBe(reason);
    expect(renders(out.ok.examJson)).toBe('ok');
  });
});

describe('RT reader2: failure paths', () => {
  const offPaper = async () => { serve(); const off = await run(); mockCreate.mockReset(); mockLog.mockReset(); return off; };
  test('top-up call throws -> the paper fails closed, the caught item not printed, the record and its items on it', async () => {
    let nA = 0;
    serve({ reader: async (p, n) => (n === 1 ? JSON.stringify({ candidates: [{ item: labelOf(p, RULE_STEM), by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'r', given_away: true }] }) : JSON.stringify({ candidates: [] })) });
    const base = mockCreate.getMockImplementation();
    mockCreate.mockImplementation(async (req) => {
      const t = textOf(req);
      if (!isReader(t) && t.includes('"slot": "urdu.A.') && ++nA === 3) throw new Error('timeout');
      return base(req);
    });
    const on = await run({ readerPass: true });
    expect(on.err && on.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(q1Stems(on.err.examJson).some((s) => RULE_STEM.test(s))).toBe(false);
    expect(on.err.examJson._layout.reader).toMatchObject({ flagged: 1, items: [expect.objectContaining({ outcome: 'replaced' })] });
    expect(on.err.examJson._layout.reader.error).toMatch(/^top-up:/);
  });
  test.each([
    ['an array content', []],
    ['a number content', 42],
    ['an object without candidates', { flags: [] }],
    ['null content', null],
    ['truncated JSON text', '{"candidates":[{"item":"Q1.1"'],
  ])('%s -> the paper prints as today', async (_n, content) => {
    const off = await offPaper();
    serve({ reader: async () => content });
    const on = await run({ readerPass: true });
    expect(on.err).toBeUndefined();
    expect(stable(on.ok.examJson)).toEqual(stable(off.ok.examJson));
    expect(renders(on.ok.examJson)).toBe('ok');
  });
  test('re-check throws -> replacements kept, paper whole, renders', async () => {
    serve({ reader: async (p, n) => { if (n === 1) return JSON.stringify({ candidates: [{ item: labelOf(p, RULE_STEM), by: 'Q1.13', evidence: 'شاید کل بارش ہو جائے', reason: 'r', given_away: true }] }); throw new Error('timeout'); } });
    const on = await run({ readerPass: true });
    expect(on.err).toBeUndefined();
    expect(q1Stems(on.ok.examJson)).toHaveLength(20);
    expect(q1Stems(on.ok.examJson).some((s) => RULE_STEM.test(s))).toBe(false);
    expect(on.ok.examJson._layout.reader).toMatchObject({ rechecked: false });
    expect(renders(on.ok.examJson)).toBe('ok');
  });
});

describe('RT reader2: the 2x top-up', () => {
  test('every Q1 item flagged: the top-up asks >= 40, the paper still has 20 Q1 items and renders', async () => {
    serve({ reader: async (p, n) => (n === 1 ? JSON.stringify({ candidates: p.split('\n').filter((l) => /^Q1\.\d+ /.test(l)).map((l) => ({ item: l.split(' ')[0], by: 'Q2', evidence: 'شاید کل بارش ہو جائے', reason: 'r', given_away: true })) }) : JSON.stringify({ candidates: [] })) });
    const asked = mockCreate;
    const out = await run({ readerPass: true });
    expect(out.err).toBeUndefined();
    const topUp = asked.mock.calls.map(([r]) => textOf(r)).filter((t) => !isReader(t) && /Write \d+ new items/.test(t)).pop();
    const n = Number(topUp.match(/Write (\d+) new items/)[1]);
    console.log('[rt] all-flagged top-up asks', n, 'reader record', JSON.stringify(out.ok.examJson._layout.reader && { ...out.ok.examJson._layout.reader, items: out.ok.examJson._layout.reader.items.length }));
    expect(q1Stems(out.ok.examJson)).toHaveLength(20);
    expect(renders(out.ok.examJson)).toBe('ok');
  });
});

describe('guard: only the reader record is exempt from the review-text scan', () => {
  test('review text in any OTHER _layout key still refuses the paper', async () => {
    serve();
    const off = await run();
    expect(off.err).toBeUndefined();
    const exam = clone(off.ok.examJson);
    expect(renders(exam)).toBe('ok');
    exam._layout.note = 'needs review';
    expect(renders(exam)).toMatch(/REVIEW_TEXT|chrome/);
  });
});
