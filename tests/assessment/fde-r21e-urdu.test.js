/**
 * Urdu board-pattern papers, three more rules from the sandbox papers of the last round:
 *
 * 1. On chosen lessons a grammar concept asked again never comes back to fill a Q1 place. The lessons
 *    4–5 paper printed «روشنی» and «بہادر», both antonyms, because the put-back took the repeat. Now
 *    a place still empty after the re-asks is topped up once more, told grammar is used up (write
 *    vocabulary, word-meaning or comprehension items), and a place still empty after that fails the
 *    paper closed. The full syllabus is unchanged.
 * 2. Written keys a teacher marks from: a Q4 ارکان key whose accepted answer splits a word another
 *    way («کہا – نی» beside «کَ – ہا – نی») is asked again, whatever mark cuts the parts; the Q4 prompt
 *    says how the book splits a word, and Q2 (ب) says relation words are اسم نکرہ.
 * 3. A Q1 item whose key another Q1 item's CORRECT option names, from the same story («… باغ میں
 *    کیا کیا؟ → فاختائیں فضا میں اڑائیں» beside «… کاغذ کی کیا چیزیں …؟ → دو فاختائیں»), is held, and
 *    the reader is told the shape. A wrong option naming it is no cue.
 *
 * The papers are the sandbox's own (content only). The model boundary and the book store are mocked,
 * never the chain.
 */

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

  test('the full syllabus asks a concept once too: one antonym prints and Q1 is one short', () => {
    const r = lay(fixture('r21e-urdu-sandbox-chapters_1'), FDE, { reasked: true });
    expect(antonyms(r.examJson)).toHaveLength(1);
    expect((r.putBack || []).map((x) => x.rule)).not.toContain('concept_repeat');
    expect(r.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
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

describe('1. the engine on lessons 4–5: a Q1 place the antonym repeat left', () => {
  // First reply: two antonyms and 18 meanings, so the layout holds one antonym and Q1 is one short.
  // Every re-ask writes a third antonym, held again, until Section A is told grammar is used up.
  const first = [LIGHT, ...WORDS.slice(0, 9).map(meaning), BRAVE, ...WORDS.slice(9, 18).map(meaning)];

  test('one more Section A top-up, told grammar is used up; the paper prints one antonym', async () => {
    const asked = serve((n, prompt) => (n === 1 ? mcqs(first) : GRAMMAR_USED_UP.test(prompt) ? mcqs([meaning(WORDS[18]), meaning(WORDS[19])]) : mcqs([WARM])));
    const out = await run(L45);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(antonyms(out.ok.examJson)).toHaveLength(1);
    expect(q1(out.ok.examJson)).toHaveLength(20);
    const as = asked.filter((x) => x.sec === 'A');
    expect(as.filter((x) => GRAMMAR_USED_UP.test(x.prompt))).toHaveLength(1);
    // The last call is the one told grammar is used up, and it asks for spares past the gap.
    expect(as[as.length - 1].prompt).toMatch(GRAMMAR_USED_UP);
    expect(as[as.length - 1].prompt).toMatch(/needs 1 more\. Write 3 new items/);
    const applied = logged('[assessment] layout applied');
    expect(applied[applied.length - 1].putBack).toBeUndefined();
  });

  test('a top-up that writes grammar again leaves Q1 short: the paper fails closed, the repeat not printed', async () => {
    const asked = serve((n) => (n === 1 ? mcqs(first) : mcqs([WARM])));
    const out = await run(L45);
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    expect(antonyms(out.err.examJson)).toHaveLength(1);
    // Exactly one top-up told grammar is used up; never a second.
    expect(asked.filter((x) => x.sec === 'A' && GRAMMAR_USED_UP.test(x.prompt))).toHaveLength(1);
  });

  test('the full syllabus: the concept is asked once there too, so the one more top-up is told grammar is used up', async () => {
    const asked = serve((n) => (n === 1 ? mcqs(first) : mcqs([WARM])));
    const out = await run(FDE);
    const told = asked.filter((x) => x.sec === 'A' && GRAMMAR_USED_UP.test(x.prompt));
    expect(told).toHaveLength(1);
    expect(told[0].prompt).toContain('from lessons 4–10');
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(antonyms(out.err.examJson)).toHaveLength(1);
  });

  test('with the reader on: a caught item\'s place is never filled by the antonym repeat', async () => {
    // A full first reply (one antonym), the reader catches one meaning, and the first top-up writes
    // an antonym: the second top-up is told grammar is used up.
    const full = [LIGHT, ...WORDS.slice(0, 19).map(meaning)];
    const asked = serve(
      (n, prompt) => (n === 1 ? mcqs(full) : GRAMMAR_USED_UP.test(prompt) ? mcqs([meaning(WORDS[19])]) : mcqs([BRAVE])),
      (prompt, n) => {
        if (n > 1) return '{"candidates":[]}';
        const label = (re) => prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l)).split(' ')[0];
        return JSON.stringify({ candidates: [{ item: label(/«درزی»/), by: label(/«دریا»/), evidence: 'دریا', reason: 'test', given_away: true }] });
      },
    );
    const out = await run(L45, { readerPass: true });
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(antonyms(out.ok.examJson)).toHaveLength(1);
    expect(q1(out.ok.examJson).some((q) => /«درزی»/.test(q.question))).toBe(false);
    expect(asked.filter((x) => x.sec === 'A' && GRAMMAR_USED_UP.test(x.prompt))).toHaveLength(1);
  });
});

// ── 2. Written keys ────────────────────────────────────────────────────────────────────────────

const q4 = (exam) => items(exam, 'urdu.C.Q4');
const syllables = (exam) => q4(exam).find((q) => /ارکان/.test(q.question));

describe('2(i). a Q4 ارکان key that splits a word apart from its own accepted answer is asked again', () => {
  test.each([
    ['chapters_2', ch(6, 7), 'کہا – نی beside کَ – ہا – نی'],
    ['full_1', FDE, 'ب - گو - لا beside بگ - و - لا'],
  ])('sandbox %s (%s): %s', (name, scope) => {
    const paper = fixture(`r21e-urdu-sandbox-${name}`);
    expect(syllables(paper)).toBeTruthy();
    const r = lay(paper, scope);
    expect(syllables(r.examJson)).toBeUndefined();
    expect(r.shortfall.filter((f) => f.slot === 'urdu.C.Q4')).toEqual([{ slot: 'urdu.C.Q4', missing: 1 }]);
    expect(r.examJson._layout.holds).toEqual(expect.arrayContaining([{ slot: 'urdu.C.Q4', rule: 'syllable_split', n: 1 }]));
  });

  test('sandbox full_2: «پا + کی + زہ» beside «پا کی زہ» splits the same way, and stays (control)', () => {
    const r = lay(fixture('r21e-urdu-sandbox-full_2'), FDE);
    expect(syllables(r.examJson)).toBeTruthy();
    expect(r.shortfall).toEqual([]);
  });

  test('sandbox chapters_1: a key cut with «ـ» beside an accepted answer in words stays (control)', () => {
    const r = lay(fixture('r21e-urdu-sandbox-chapters_1'), FDE);
    expect(syllables(r.examJson)).toBeTruthy();
  });

  test('the conditional item «اگر – تو», accepted as written, is no split (control)', () => {
    const paper = fixture('r21e-urdu-sandbox-chapters_2');
    const r = lay(paper, ch(6, 7));
    expect(q4(r.examJson).some((q) => /شرط و جزا/.test(q.question))).toBe(true);
  });
});

describe('2. the prompt lines', () => {
  const prompts = (scope) => {
    const asked = serve((n) => mcqs([LIGHT, ...WORDS.slice(0, 19).map(meaning)]));
    return run(scope).then(() => asked);
  };

  test.each([['full syllabus', FDE], ['lessons 4–5', L45]])('%s: C says how the book splits a word; B says relation words are اسم نکرہ', async (_, scope) => {
    const asked = await prompts(scope);
    const c = asked.find((x) => x.sec === 'C').prompt;
    const b = asked.find((x) => x.sec === 'B').prompt;
    expect(c).toContain('split every word into its spoken syllables, as the book does (غ – لا – ظت)');
    expect(b).toContain('relation words (امی، ابو، بھائی) are اسم نکرہ');
    // Each line is in its own section only.
    expect(b).not.toContain('غ – لا – ظت');
    expect(c).not.toContain('relation words (امی، ابو، بھائی)');
    expect(asked.find((x) => x.sec === 'A').prompt).not.toMatch(/غ – لا – ظت|relation words \(امی/);
  });
});

// ── 3. Another item's correct option names the key ─────────────────────────────────────────────

describe('3. sandbox chapters_2 (lessons 6–7): ۱۶\'s key «فاختائیں فضا میں اڑائیں» names ۲\'s key «دو فاختائیں»', () => {
  const paper = fixture('r21e-urdu-sandbox-chapters_2');
  const has = (exam, re) => q1(exam).some((q) => re.test(q.question));

  test('the paper as printed has both', () => {
    expect(has(paper, /تکیے کے پاس کاغذ/)).toBe(true);
    expect(has(paper, /باغ میں بچوں کے ساتھ کیا کیا/)).toBe(true);
  });

  test('the layout prints only one of the two', () => {
    const out = lay(paper, ch(6, 7)).examJson;
    expect(has(out, /تکیے کے پاس کاغذ/) && has(out, /باغ میں بچوں کے ساتھ کیا کیا/)).toBe(false);
  });

  test('a wrong option naming another item\'s key is no cue: «امینہ» in ۲۰\'s options beside ۱۲ → امینہ (control)', () => {
    const out = lay(paper, ch(6, 7)).examJson;
    expect(has(out, /گلی میں کس کو اسکول کی طرف جاتے دیکھا/)).toBe(true);
    expect(has(out, /بین الاقوامی کانفرنس میں بلانے والا/)).toBe(true);
  });

  test('sandbox full_1: «ایدھی», a wrong option of ۱۹, never holds ۱۸ → ایدھی سینٹر (control)', () => {
    const out = lay(fixture('r21e-urdu-sandbox-full_1'), FDE).examJson;
    expect(has(out, /عبدالشکور کس ادارے میں/)).toBe(true);
    expect(has(out, /کسی عام چیز کا نام ہے/)).toBe(true);
  });

  test('the reader is told that another item\'s correct option can state an answer', () => {
    const { prompt } = Reader.buildReaderPrompt(paper, U);
    expect(prompt).toContain('another Q1 item\'s CORRECT option states this item\'s answer');
  });
});
