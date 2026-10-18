const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
const mockLog = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
const mockPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockPages(...a),
  loadChapterContent: (...a) => mockPages(...a),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, conceptOf } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const lay = (exam, scope, opts = {}) => applyLayout(clone(exam), U, scope, { now: 'x', ...opts });
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (prompt) => prompt.includes(Reader.READER_MARK);
const sectionOf = (prompt) => ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, d]) => d);

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1 = (exam) => items(exam, 'urdu.A.Q1');
const antonyms = (exam) => q1(exam).filter((q) => /کا متضاد/.test(q.question)).map((q) => q.question);

// ── 1. No grammar put-back on chosen lessons ───────────────────────────────────────────────────

// The lessons 4–5 sandbox paper as it printed (Q1 ۱۰ «روشنی» and ۲۰ «بہادر», both antonyms), with
// the concepts Section A declares on chosen lessons put back on its items.
function declared(exam) {
  const out = clone(exam);
  q1(out).forEach((q) => {
    q.concept = /کا متضاد/.test(q.question) ? 'متضاد الفاظ' : /کا (?:مترادف|ہم معنی)/.test(q.question) ? 'مترادف الفاظ'
      : conceptOf(q) ? 'تمنائی اور شکیہ جملے' : 'ذخیرۂ الفاظ / فہم';
  });
  return out;
}

describe('1. sandbox chapters_1 (lessons 4–5): the put-back printed an antonym twice', () => {
  const paper = declared(fixture('r21e-urdu-sandbox-chapters_1'));

  test('the paper as printed asks متضاد twice', () => {
    expect(antonyms(paper)).toEqual(['«روشنی» کا متضاد کون سا لفظ ہے؟', '«بہادر» کا متضاد لفظ کون سا ہے؟']);
  });

  test('after the re-ask, the repeat is not put back: one antonym prints and Q1 is one short', () => {
    const r = lay(paper, ch(4, 5), { reasked: true });
    expect(antonyms(r.examJson)).toHaveLength(1);
    expect((r.putBack || []).map((x) => x.rule)).not.toContain('concept_repeat');
    expect(r.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
  });

  test('a concept tag the stem contradicts is not put back on chosen lessons either', () => {
    const p = clone(paper);
    const tagged = q1(p).find((q) => q.concept === 'ذخیرۂ الفاظ / فہم' && !/متضاد/.test(q.question));
    // A stem that asks the antonym concept, tagged as vocabulary.
    tagged.question = '«خوشی» کا متضاد کون سا لفظ ہے؟';
    tagged.options = ['الف) غم', 'ب) ہنسی', 'ج) مزہ', 'د) رونق'];
    tagged.answer = 'الف) غم';
    const r = lay(p, ch(4, 5), { reasked: true });
    expect((r.putBack || []).map((x) => x.rule)).toEqual([]);
    expect(antonyms(r.examJson)).toHaveLength(1);
  });

  test('the full syllabus lays the same paper out as before (control)', () => {
    const r = lay(fixture('r21e-urdu-sandbox-chapters_1'), FDE, { reasked: true });
    expect(antonyms(r.examJson)).toHaveLength(2);
    expect(r.shortfall).toEqual([]);
  });
});

// The engine, end to end on a lessons 4–5 paper: Section B and C as recorded, Section A a fictional
// reply of 18 word meanings and two antonyms (each item declares its concept).
const rec = fixture('r18-urdu-refused-chapters1');
// Lessons 4–5 as the app asks for them: the lessons and their pages.
const L45 = rec.scope;
const REPLY_B = rec.replies.B;
const REPLY_C = rec.replies.C.split('کی عادت اپنانی چاہیے').join('کی عادت ڈالنی ہو گی');
const WORDS = [['دریا', 'پانی کا بڑا بہاؤ'], ['کتب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'],
  ['درزی', 'کپڑے سینے والا'], ['نانبائی', 'روٹی پکانے والا'], ['موچی', 'جوتے بنانے والا'], ['کسان', 'کھیتی باڑی کرنے والا'],
  ['مچھیرا', 'مچھلیاں پکڑنے والا'], ['ڈاکیا', 'خط پہنچانے والا'], ['معمار', 'عمارت بنانے والا'], ['جولاہا', 'کپڑا بننے والا'],
  ['لوہار', 'لوہے کا کام کرنے والا'], ['سنار', 'زیور بنانے والا'], ['بڑھئی', 'لکڑی کا کام کرنے والا'], ['حلوائی', 'مٹھائی بنانے والا'],
  ['کمہار', 'مٹی کے برتن بنانے والا'], ['مالی', 'پودوں کو پانی دینے والا'], ['چوکیدار', 'رات کو پہرا دینے والا'],
  ['ملاح', 'کشتی چلانے والا'], ['پنساری', 'مصالحے بیچنے والا']];
const meaning = ([w, k]) => ({
  slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» سے کیا مراد ہے؟`,
  options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1, concept: 'ذخیرۂ الفاظ / فہم',
});
const antonym = (w, k, [a, c, d]) => ({
  slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `«${w}» کا متضاد کون سا لفظ ہے؟`,
  options: [`الف) ${a}`, `ب) ${k}`, `ج) ${c}`, `د) ${d}`], answer: `ب) ${k}`, marks: 1, concept: 'متضاد الفاظ',
});
const LIGHT = antonym('روشنی', 'اندھیرا', ['نور', 'چمک', 'اجالا']);
const BRAVE = antonym('بہادر', 'بزدل', ['نڈر', 'جری', 'مضبوط']);
const WARM = antonym('گرم', 'ٹھنڈا', ['تپتا', 'جلتا', 'سلگتا']);
const mcqs = (list) => JSON.stringify({ unseen: { objective: { MCQs: clone(list) } } });
const GRAMMAR_USED_UP = /grammar is used up/i;

// The book pages: the poem the recorded Q6 prints, so its verses are the book's.
function book() {
  const c = JSON.parse(REPLY_C);
  const q6 = Object.values(c.unseen.subjective || {}).flat().find((q) => q && q.slot === 'urdu.C.Q6');
  const content = ['=== Page 63 ===', 'ندی کی فریاد', ...String((q6 && q6.passage) || '').split('\n')].join('\n\n');
  mockPages.mockImplementation(async ({ pageRanges } = {}) => ({ content, pageReference: String(pageRanges || '28') }));
}
function serve(a, reader = null) {
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    if (isReader(prompt)) {
      const n = asked.filter((x) => x.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', prompt });
      return { choices: [{ message: { content: reader(prompt, n) }, finish_reason: 'stop' }], usage: { total_tokens: 100 } };
    }
    const sec = sectionOf(prompt);
    asked.push({ sec, prompt });
    const n = asked.filter((x) => x.sec === sec).length;
    const content = sec === 'A' ? a(n, prompt) : sec === 'B' ? REPLY_B : REPLY_C;
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  });
  return asked;
}
const run = (scope, extra = {}) => Gen.generatePatternExam({
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope, pageRanges: scope.pages || null, requestId: 'req-r21e', ...extra,
}).then((ok) => ({ ok }), (err) => ({ err }));

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockPages.mockReset(); book(); });

const strip = (list) => list.map((q) => { const c = clone(q); delete c.concept; return c; });
const first = [LIGHT, ...WORDS.slice(0, 9).map(meaning), BRAVE, ...WORDS.slice(9, 18).map(meaning)];

describe('RT-1 lessons 4–5: a grammar concept never prints twice', () => {
  test('RT-1a the grammar top-up writes an antonym and declares no concepts: one antonym prints', async () => {
    serve((n, prompt) => (n === 1 ? mcqs(first) : GRAMMAR_USED_UP.test(prompt) ? mcqs(strip([WARM, meaning(WORDS[18]), meaning(WORDS[19])])) : mcqs([WARM])));
    const out = await run(L45);
    const exam = out.ok ? out.ok.examJson : out.err.examJson;
    expect(antonyms(exam)).toHaveLength(1);
  });

  test('RT-1b the same top-up WITH its concepts declared: one antonym prints (control)', async () => {
    serve((n, prompt) => (n === 1 ? mcqs(first) : GRAMMAR_USED_UP.test(prompt) ? mcqs([WARM, meaning(WORDS[18]), meaning(WORDS[19])]) : mcqs([WARM])));
    const out = await run(L45);
    const exam = out.ok ? out.ok.examJson : out.err.examJson;
    expect(antonyms(exam)).toHaveLength(1);
  });

  test('RT-1c the reader top-up writes an antonym and declares no concepts: one antonym prints', async () => {
    const full = [LIGHT, ...WORDS.slice(0, 19).map(meaning)];
    serve(
      (n) => (n === 1 ? mcqs(full) : mcqs(strip([BRAVE, meaning(WORDS[19])]))),
      (prompt, n) => {
        if (n > 1) return '{"candidates":[]}';
        const label = (re) => prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l)).split(' ')[0];
        return JSON.stringify({ candidates: [{ item: label(/«درزی»/), by: label(/«دریا»/), evidence: 'دریا', reason: 'test', given_away: true }] });
      },
    );
    const out = await run(L45, { readerPass: true });
    const exam = out.ok ? out.ok.examJson : out.err.examJson;
    expect(antonyms(exam)).toHaveLength(1);
  });

  test('RT-1d full syllabus with the reader: no top-up is told grammar is used up (control)', async () => {
    const full = [LIGHT, ...WORDS.slice(0, 19).map(meaning)];
    const asked = serve(
      (n) => (n === 1 ? mcqs(full) : mcqs([BRAVE, meaning(WORDS[19])])),
      (prompt, n) => {
        if (n > 2) return '{"candidates":[]}';
        const label = (re) => prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l));
        const l = label(/«درزی»/) || label(/«باغبان»/);
        const b = label(/«دریا»/);
        return JSON.stringify({ candidates: l && b ? [{ item: l.split(' ')[0], by: b.split(' ')[0], evidence: 'دریا', reason: 'test', given_away: true }] : [] });
      },
    );
    await run(FDE, { readerPass: true });
    expect(asked.filter((x) => x.sec === 'A' && GRAMMAR_USED_UP.test(x.prompt))).toHaveLength(0);
  });

  test('RT-1e pages scope inside lessons 4–5 takes the grammar top-up too', async () => {
    const asked = serve((n, prompt) => (n === 1 ? mcqs(first) : GRAMMAR_USED_UP.test(prompt) ? mcqs([meaning(WORDS[18]), meaning(WORDS[19])]) : mcqs([WARM])));
    const out = await run({ kind: 'pages', chapters: null, pages: '30-36' });
    expect(asked.filter((x) => x.sec === 'A' && GRAMMAR_USED_UP.test(x.prompt))).toHaveLength(1);
    expect(antonyms(out.ok ? out.ok.examJson : out.err.examJson)).toHaveLength(1);
  });

  test('RT-1f a grammar top-up that throws: the paper fails closed with PATTERN_SHORT_SLOT, never a crash', async () => {
    let n = 0;
    serve((k, prompt) => {
      if (GRAMMAR_USED_UP.test(prompt)) throw new Error('boom');
      n += 1;
      return n === 1 ? mcqs(first) : mcqs([WARM]);
    });
    const out = await run(L45);
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(antonyms(out.err.examJson)).toHaveLength(1);
  });
});

describe('RT-2 the KEY-option cue never reads a distractor', () => {
  const paper = fixture('r21e-urdu-sandbox-chapters_2');
  const has = (exam, re) => q1(exam).some((q) => re.test(q.question));
  const both = (exam) => has(exam, /تکیے کے پاس کاغذ/) && has(exam, /باغ میں بچوں کے ساتھ کیا کیا/);

  test('RT-2a «فاختائیں فضا میں اڑائیں» as a WRONG option of ۱۶: both items print', () => {
    const p = clone(paper);
    const q = q1(p).find((x) => /باغ میں بچوں کے ساتھ کیا کیا/.test(x.question));
    q.answer = 'الف) درخت لگائے';
    const out = lay(p, ch(6, 7)).examJson;
    expect(both(out)).toBe(true);
  });

  test('RT-2b the same with a letter-only answer «الف»: both items print', () => {
    const p = clone(paper);
    const q = q1(p).find((x) => /باغ میں بچوں کے ساتھ کیا کیا/.test(x.question));
    q.answer = 'الف';
    const out = lay(p, ch(6, 7)).examJson;
    expect(both(out)).toBe(true);
  });

  test('RT-2c letter-only answer «ب» on the cue item: still one of the two prints (positive control)', () => {
    const p = clone(paper);
    const q = q1(p).find((x) => /باغ میں بچوں کے ساتھ کیا کیا/.test(x.question));
    q.answer = 'ب';
    const out = lay(p, ch(6, 7)).examJson;
    expect(both(out)).toBe(false);
  });

  test('RT-2d the noun in TWO options of ۲: no hold (exactly-one-option rule)', () => {
    const p = clone(paper);
    const q = q1(p).find((x) => /تکیے کے پاس کاغذ/.test(x.question));
    q.options[0] = 'الف) دو بڑی فاختائیں';
    const out = lay(p, ch(6, 7)).examJson;
    expect(both(out)).toBe(true);
  });

  test('RT-2e full syllabus, Science/Maths untouched: namesKeyOf runs for urdu only (an English paper lays out the same with a cue-shaped pair)', () => {
    // the chapters_2 paper laid out under the full syllabus still holds the pair (urdu everywhere)
    const out = lay(paper, FDE).examJson;
    expect(both(out)).toBe(false);
  });
});
