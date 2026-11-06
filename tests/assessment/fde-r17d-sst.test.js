/**
 * Social Studies, round 5: the reader names the composite give-away (a C/D item whose answer's
 * facts Section A prints, in a stem, a key, or across two Q1 items), and a Q6 that asks only book
 * facts in a situation's dress (who heads or chairs a body, what it is called, how many, when, what
 * was done) is held and D is asked again.
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

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const URDU = Patterns.get('fde_g5_2027').subjects.urdu;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const Q1 = 'social_studies.A.Q1';
const C5 = 'social_studies.C.Q5';
const D6 = 'social_studies.D.Q6';
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const lead = (t) => String(t).slice(0, 40);

async function replay(rec, { reader = {} } = {}) {
  const queue = { A: [...rec.replies.A], B: [...rec.replies.B], C: [...rec.replies.C], D: [...rec.replies.D] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      const n = asked.filter((a) => a.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', text });
      const content = reader[n] ? reader[n](text) : (rec.reader[n - 1] || JSON.stringify({ candidates: [] }));
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = sectionOf(text);
    asked.push({ sec, text });
    const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-r17d', readerPass: true,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}

// The printed label of a stem in a reader prompt («Q5.2 مقننہ اور …» → «Q5.2»).
const labelOf = (prompt, stem) => {
  const line = prompt.split('\n').find((l) => /^Q\d+(\.\d+)? /.test(l) && l.includes(lead(stem)));
  return line ? line.split(' ')[0] : null;
};

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('1. the reader names the composite give-away: the facts a C/D answer needs, printed in Section A', () => {
  const exam = fixture('r17d-sst-local-chapters_4');
  const q5 = items(exam, C5)[1];

  test('setup: Q5 2 asks the difference between the legislature and the executive; Q1 1 and Q1 11 print each half', () => {
    expect(q5.question).toContain('مقننہ اور انتظامیہ');
    expect(items(exam, Q1)[0].answer).toContain('مقننہ');
    expect(items(exam, Q1)[10].answer).toContain('انتظامیہ قانون نافذ کرتی ہے');
  });

  test('the Social Studies reader prompt names a Q1 stem, a key, or two Q1 items together, and asks for each fact quoted', () => {
    const { prompt } = Reader.buildReaderPrompt(exam, SST);
    expect(prompt).toContain('fact its answer needs is printed in Section A');
    expect(prompt).toContain('across two Q1 items');
    expect(prompt).toContain('quote each fact');
    expect(prompt).toContain('" | "');
  });

  test('a flag that quotes one fact from each of two Q1 items, named in `by`, is kept', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q5.question);
    expect(item).toBe('Q5.2');
    const reply = { candidates: [{ item, by: 'Q1.1, Q1.11', evidence: 'قوانین بنانے کا اختیار | انتظامیہ قانون نافذ کرتی ہے', reason: 'both halves printed', given_away: true }] };
    const flags = Reader.parseFlags(reply, labels, null, blocks, { split });
    expect(flags.map((f) => f.item)).toEqual(['Q5.2']);
  });

  test('a quote that runs a Q1 stem into its key («…؟ مقننہ», the options printed between) is kept', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q5.question);
    const reply = { candidates: [{ item, by: 'Q1.1, Q1.11', evidence: 'پاکستان میں قوانین بنانے کا اختیار کس ادارے کے پاس ہے؟ (مقننہ) | انتظامیہ قانون نافذ کرتی ہے، عدلیہ انصاف فراہم کرتی ہے', reason: 'both halves printed', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split }).map((f) => f.item)).toEqual(['Q5.2']);
    // The reader's own label for the key, and an ellipsis, are not on the paper.
    reply.candidates[0].evidence = 'پاکستان میں قوانین بنانے کا اختیار کس ادارے کے پاس ہے؟ (key: مقننہ) | انتظامیہ قانون نافذ کرتی ہے … عدلیہ انصاف فراہم کرتی ہے';
    expect(Reader.parseFlags(reply, labels, null, blocks, { split }).map((f) => f.item)).toEqual(['Q5.2']);
  });

  test('the reader is told a partly answered item is not given away', () => {
    const { prompt } = Reader.buildReaderPrompt(exam, SST);
    expect(prompt).toContain('EVERY fact its answer needs is printed in Section A');
    expect(prompt).toContain('an item Section A answers only in part');
  });

  test('a two-quote flag whose second quote names nothing («… | کا») is dropped', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q5.question);
    const reply = { candidates: [{ item, by: 'Q1.1, Q1.11', evidence: 'قوانین بنانے کا اختیار | کا', reason: 'x', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split })).toEqual([]);
  });

  test('a composite flag with one quote that is not on the paper is still dropped', () => {
    const { prompt, labels, blocks, split } = Reader.buildReaderPrompt(exam, SST);
    const item = labelOf(prompt, q5.question);
    const reply = { candidates: [{ item, by: 'Q1.1, Q1.11', evidence: 'قوانین بنانے کا اختیار | عدلیہ ملک کا دفاع کرتی ہے', reason: 'x', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split })).toEqual([]);
  });

  test('chapters_4 through the engine: the reader names Q5 2 by two Q1 items, and it does not print', async () => {
    // The Q5 names the two bodies, which now holds Q1 «قوانین بنانے کا اختیار … → مقننہ» (its key, named in a C
    // stem) before the reader reads the paper; here it asks the same difference by what each body does.
    const rec = clone(fixture('r17d-sst-replies-chapters_4'));
    const asked5 = 'قانون بنانے والے ادارے اور قانون نافذ کرنے والے ادارے کے کاموں میں کیا فرق ہے؟';
    rec.replies.C = rec.replies.C.map((c) => c.split(q5.question).join(asked5));
    rec.replies.D = rec.replies.D.map((d) => d.split('مقننہ').join('قانون ساز ادارہ'));
    // The two Q1 items are found by their text: a Q1 item a C/D stem gives away is taken off first and
    // its place refilled at the end of Q1, so their numbers follow what the paper prints.
    let by = null;
    const { asked, out } = await replay(rec, {
      reader: {
        1: (prompt) => {
          const item = labelOf(prompt, asked5);
          by = [labelOf(prompt, 'قوانین بنانے کا اختیار'), labelOf(prompt, 'انتظامیہ قانون نافذ کرتی ہے')].join(', ');
          return JSON.stringify({ candidates: [{ item, by, evidence: 'قوانین بنانے کا اختیار | انتظامیہ قانون نافذ کرتی ہے', reason: 'both halves printed in Section A', given_away: true }] });
        },
        2: () => JSON.stringify({ candidates: [] }),
      },
    });
    expect(asked.some((a) => a.sec === 'reader')).toBe(true);
    expect(out.error && out.error.code).toBeUndefined();
    expect(items(out.examJson, C5).map((q) => q.question)).not.toContain(asked5);
    expect(by).toMatch(/^Q1\.\d+, Q1\.\d+$/);
    expect(out.examJson._layout.reader.items.some((x) => x.by === by)).toBe(true);
  });

  test('Urdu: the reader prompt and its flag reading are unchanged (no split)', () => {
    const { split } = Reader.buildReaderPrompt({ unseen: {} }, URDU);
    expect(split).toBeFalsy();
  });
});

describe('2. a Q6 that asks only book facts in a situation is held, and D is asked again', () => {
  const ch5 = fixture('r17d-sst-local-chapters_5');
  const ch6 = fixture('r17d-sst-local-chapters_6');
  const recall5 = [items(ch5, D6)[3], items(ch5, D6)[4]];
  const recall6 = [items(ch6, D6)[3], items(ch6, D6)[4]];

  test('setup: chapters_5 Q6 4/5 ask who makes provincial law and who heads; who chairs; chapters_6 Q6 4/5 ask how many years, who heads; who interprets, what the chief judge is called', () => {
    expect(recall5[0].question).toContain('سربراہ کون ہوتا ہے');
    expect(recall5[1].question).toContain('صدارت کون کرتا ہے');
    expect(recall6[0].question).toContain('کتنے سال بعد');
    expect(recall6[1].question).toContain('کیا کہلاتا ہے');
  });

  for (const [name, exam, recall] of [['chapters_5', ch5, recall5], ['chapters_6', ch6, recall6]]) {
    test(`${name}: the recall Q6 items do not print, and are held as recall`, () => {
      const laid = applyLayout(clone(exam), SST, scopeOf(exam), { reasked: true });
      const printed = items(laid.examJson, D6).map((q) => q.question);
      for (const q of recall) {
        expect(printed).not.toContain(q.question);
        expect(laid.held.some((h) => h.slot === D6 && h.rule === 'recall' && h.q.question === q.question)).toBe(true);
      }
    });
  }

  test('a Q6 that asks which government is responsible for a situation, with a reason, is not held by the book-fact rule (a naming-only one is held as names_body)', () => {
    const ch4 = fixture('r17d-sst-local-chapters_4');
    const laid = applyLayout(clone(ch4), SST, scopeOf(ch4), { reasked: true });
    const tierItems = items(ch4, D6).filter((q) => q.question.includes('وجہ'));
    expect(tierItems.length).toBeGreaterThan(0);
    expect(laid.held.filter((h) => h.rule === 'recall').map((h) => h.q.question)).toEqual(
      expect.not.arrayContaining(tierItems.map((q) => q.question)),
    );
  });

  test('chapters_6 through the engine: D is asked again told a Q6 is a situation that needs two ideas applied, and no recall Q6 prints', async () => {
    const rec = fixture('r17d-sst-replies-chapters_6');
    const { asked, out } = await replay(rec, { reader: { 1: () => JSON.stringify({ candidates: [] }) } });
    const dAsks = asked.filter((a) => a.sec === 'D');
    expect(dAsks.length).toBeGreaterThan(1);
    const note = dAsks.slice(1).map((a) => a.text).join('\n');
    expect(note).toContain('A Q6 is a situation that needs two ideas applied; history recall goes to Q7.');
    expect(note).toContain(lead(recall6[0].question));
    const printed = out.examJson ? items(out.examJson, D6).map((q) => q.question) : items(out.error.examJson, D6).map((q) => q.question);
    for (const q of recall6) expect(printed).not.toContain(q.question);
    const held = logged('[assessment] held items').pop();
    expect(held.held.some((r) => r.slot === D6 && r.rule === 'recall')).toBe(true);
  });

  test('the Social Studies D prompt says a Q6 never asks a civics fact on its own either', async () => {
    const rec = fixture('r17d-sst-replies-chapters_6');
    const { asked } = await replay(rec, { reader: { 1: () => JSON.stringify({ candidates: [] }) } });
    const d = asked.find((a) => a.sec === 'D').text;
    expect(d).toContain('A Q6 situation never asks a history fact; history recall goes to Q7.');
    expect(d).toContain('who heads or chairs a body, what it is called, how many, when');
  });
});

function logged(msg) { return mockLog.mock.calls.filter(([m]) => m === msg).map(([, d]) => d); }
