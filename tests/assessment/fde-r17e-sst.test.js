/**
 * Social Studies: scheme points that state no fact («پہلی وجہ درست بتانا») no longer decide
 * the point-set hold, two Section A MCQs that ask one job of one government are one question, and a
 * Q6 whose answer only names a government, court or body is recall, whatever its story.
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 4 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const PRESET = Patterns.get('fde_g5_2027');
const SST = PRESET.subjects.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const Q1 = 'social_studies.A.Q1';
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const D7 = 'social_studies.D.Q7';
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const logged = (msg) => mockLog.mock.calls.filter(([m]) => m === msg).map(([, d]) => d);
const lay = (exam) => applyLayout(clone(exam), SST, scopeOf(exam), { reasked: true });
const FACT_POINTS = 'Each marking point states its fact (e.g. «آئین بنیادی حقوق کا تحفظ کرتا ہے»), never «پہلی وجہ», «دوسری وجہ», «درست وضاحت».';

async function replay(rec) {
  const queue = { A: [...rec.replies.A], B: [...rec.replies.B], C: [...rec.replies.C], D: [...rec.replies.D] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (text.includes(Reader.READER_MARK)) {
      asked.push({ sec: 'reader', text });
      return { choices: [{ message: { content: JSON.stringify({ candidates: [] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    }
    const sec = sectionOf(text);
    asked.push({ sec, text });
    const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-r17e', readerPass: true,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('1. the Social Studies C and D prompts ask for marking points that state their facts', () => {
  const prompt = (S, sec, subject) => Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'متن', pageReference: '1-9', section: sec, slots: sec.slots, lang: 'ur', P: S, scope: { kind: 'fde' },
  });
  test('sections C and D carry the line, A and B do not', () => {
    const [A, B, C, D] = SST.sections.map((sec) => prompt(SST, sec, 'social_studies'));
    expect(C).toContain(FACT_POINTS);
    expect(D).toContain(FACT_POINTS);
    expect(A).not.toContain(FACT_POINTS);
    expect(B).not.toContain(FACT_POINTS);
  });
  test('no other subject carries it', () => {
    for (const key of ['maths', 'science', 'english', 'urdu']) {
      const S = PRESET.subjects[key];
      for (const sec of S.sections) expect(prompt(S, sec, key)).not.toContain(FACT_POINTS);
    }
  });
});

describe('2. placeholder words do not decide the point-set hold', () => {
  test('full_2 through the engine: Q5 points that state no fact no longer hold every Q6, and the paper is made', async () => {
    const rec = fixture('r17e-sst-replies-full_2');
    const { out } = await replay(rec);
    expect(out.error && out.error.code).toBeUndefined();
    const printed = items(out.examJson, D6);
    expect(printed.length).toBeGreaterThanOrEqual(5);
    const held = logged('[assessment] held items').flatMap((d) => d.held || []);
    expect(held.filter((h) => h.slot === D6 && h.rule === 'points').length).toBeLessThan(5);
  });

  test('chapters_4: Q5 «آئین کیوں ضروری ہے؟» with placeholder points is read by its answer, and the school-constitution Q6 that restates it is held', () => {
    const exam = fixture('r17e-sst-local-chapters_4');
    const q5 = items(exam, C5)[1];
    const q6 = items(exam, D6)[3];
    expect(q5.question).toContain('آئین کیوں ضروری ہے');
    expect(q5.scheme.points.map((p) => p.text)).toContain('پہلی وجہ درست بتانا');
    expect(q6.question).toContain('دستور');
    const laid = lay(exam);
    expect(items(laid.examJson, D6).map((q) => q.question)).not.toContain(q6.question);
    expect(laid.held.some((h) => h.slot === D6 && h.rule === 'points' && h.q.question === q6.question)).toBe(true);
    expect(items(laid.examJson, C5).map((q) => q.question)).toContain(q5.question);
  });
});

describe('3. two Section A MCQs that ask one job of one government are one question', () => {
  const exam = fixture('r17e-sst-local-chapters_4');
  const [q8, q14] = [items(exam, Q1)[7], items(exam, Q1)[13]];
  test('setup: Q1 8 and Q1 14 both ask who manages drainage, keyed local government', () => {
    expect(q8.question).toContain('نکاسی');
    expect(q14.question).toContain('نکاسی');
    expect(q8.answer).toContain('مقامی حکومت');
    expect(q14.answer).toContain('مقامی حکومت');
  });
  test('only one of them prints', () => {
    const printed = items(lay(exam).examJson, Q1).map((q) => q.question);
    expect(printed.filter((t) => t === q8.question || t === q14.question)).toHaveLength(1);
  });
  test('two tier MCQs about different jobs keyed the same government both print', () => {
    const e = clone(exam);
    const list = e.unseen.objective.MCQs;
    const tmpl = list.find((q) => q.question === q14.question);
    tmpl.question = 'شہر میں مویشی منڈی لگانے کا انتظام کون سی حکومت کرتی ہے؟';
    const printed = items(lay(e).examJson, Q1).map((q) => q.question);
    expect(printed).toContain(q8.question);
    expect(printed).toContain(tmpl.question);
  });
});

describe('4. a Q6 whose answer only names a government, court or body is recall', () => {
  const exam = fixture('r17e-sst-local-chapters_6');
  const q6 = items(exam, D6);
  test('setup: Q6 1, 2, 3 ask which government does a job; Q6 5 asks the highest court; Q6 6 argues why governments work together', () => {
    expect(q6[1].question).toContain('نشان دہی');
    expect(q6[4].question).toContain('سب سے بڑی عدالت');
    expect(q6[5].question).toContain('مل کر کام');
  });
  test('the naming items do not print and are held as names_body; the reasoned one prints', () => {
    const laid = lay(exam);
    const printed = items(laid.examJson, D6).map((q) => q.question);
    for (const i of [0, 1, 2, 4]) {
      expect(printed).not.toContain(q6[i].question);
      expect(laid.held.some((h) => h.slot === D6 && h.rule === 'names_body' && h.q.question === q6[i].question)).toBe(true);
    }
    expect(printed).toContain(q6[5].question);
  });
  test('D\'s re-ask is told why: a Q6 that only names a government, court or body is recall', async () => {
    const rec = fixture('r17d-sst-replies-chapters_4');
    const { asked } = await replay(rec);
    const held = logged('[assessment] held items').flatMap((d) => d.held || []);
    const named = held.filter((h) => h.slot === D6 && h.rule === 'names_body');
    expect(named.length).toBeGreaterThan(0);
    const note = asked.filter((a) => a.sec === 'D').slice(1).map((a) => a.text).join('\n');
    expect(note).toContain('or only names a government, court or body as its answer');
  });
  test('a Q7 is not held against a Q6 that never prints', () => {
    const base = fixture('r17d-sst-local-chapters_4');
    const target = items(lay(base).examJson, D7)[0];
    const e = clone(base);
    const list = e.unseen.subjective['Long Question'];
    const recallQ6 = 'بلال اپنے صوبے کی سیر کر رہا ہے۔ صوبے کا سربراہ کون ہوتا ہے؟ صوبائی اسمبلی کے ارکان کتنے ہوتے ہیں؟';
    list.push({ ...clone(items(base, D6)[0]), question: recallQ6, answer: target.answer, scheme: { points: [{ text: target.answer, marks: 3, kind: 'K' }, { text: target.answer, marks: 3, kind: 'K' }] } });
    const laid = lay(e);
    expect(items(laid.examJson, D6).map((q) => q.question)).not.toContain(recallQ6);
    expect(items(laid.examJson, D7).map((q) => q.question)).toContain(target.question);
  });
});
