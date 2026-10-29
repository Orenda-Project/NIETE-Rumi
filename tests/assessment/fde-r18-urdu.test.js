/**
 * Urdu board-pattern papers: three ways a paper failed a teacher or printed a give-away.
 *
 * 1. The lessons 1–3 filter drops any item carrying a 24-character run only the held lessons print.
 *    An everyday phrase in a model answer can be one («… کی عادت اپنانی چاہیے۔» in a C.Q8 paragraph),
 *    and the emptied place was never refilled: the whole paper failed PATTERN_SHORT_SLOT, on 3 of 16
 *    local papers. The filter stays exactly as strict; the place is now asked again once, told the run.
 * 2. The reader pass caught a give-away and the paper printed it anyway: an in-Q1 hold went back
 *    into a place the top-up left empty. A caught item now never prints; one more top-up runs, and a
 *    place still empty fails the paper closed, the record on it.
 * 3. A Q4 stem carried its four options inline («… الف) اسکول ب) بازار …») beside the options row,
 *    so the paper printed them twice.
 *
 * Replayed from recorded runs (content only): two local papers refused on the filter, and two
 * sandbox papers. The held pages here are FICTIONAL: one made-up sentence that carries the phrase
 * the real runs matched. No text of the held lessons enters this repo. The model boundary and the
 * book store are mocked, never the chain.
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
const mockPages = jest.fn();
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: (...a) => mockPages(...a),
  loadChapterContent: (...a) => mockPages(...a),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (prompt) => prompt.includes(Reader.READER_MARK);
const sectionOf = (prompt) => ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
const logged = (line) => mockLog.mock.calls.filter(([l]) => l === line).map(([, d]) => d);

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);

// The run the real papers matched (24 characters), and a made-up held-page sentence that carries it.
const RUN = 'نے کی عادت اپنانی چاہیے۔';
const HELD_PAGES = `=== Page 12 ===\nہر بچے کو صبح سویرے اٹھ${RUN} یہ آزمائشی سطر ہے۔`;

// The lesson pages: the poem each recorded Q6 prints (so its verses are the book's), for any range.
function lessonPages(rec) {
  const c = JSON.parse(rec.replies.C);
  const q6 = Object.values(c.unseen.subjective || {}).flat().find((q) => q && q.slot === 'urdu.C.Q6');
  return ['=== Page 63 ===', 'ندی کی فریاد', ...String((q6 && q6.passage) || '').split('\n')].join('\n\n');
}
function book(rec) {
  const lessons = lessonPages(rec);
  mockPages.mockImplementation(async ({ pageRanges } = {}) => (pageRanges === '1-27'
    ? { content: HELD_PAGES, pageReference: '1-27' }
    : { content: lessons, pageReference: String(pageRanges || '28') }));
}

// Fictional replacement MCQs (everyday facts), for the top-ups.
const NEW = [['دریا', 'پانی کا بڑا بہاؤ'], ['کتاب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'],
  ['درزی', 'کپڑے سینے والا'], ['نانبائی', 'روٹی پکانے والا'], ['موچی', 'جوتے بنانے والا']]
  .map(([w, k]) => ({
    slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» سے کیا مراد ہے؟`,
    options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1,
  }));
const mcqs = (list) => JSON.stringify({ unseen: { objective: { MCQs: clone(list) } } });

/**
 * Serves a recorded paper. `a(n)`, `c(n)` give the content of the n-th Section A / C call (1-based;
 * null → the recording's own: A1, then A2 when recorded, else A1); `reader(prompt, n)` the reader's.
 */
function serve(rec, { a = () => null, c = () => null, reader = null } = {}) {
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    if (isReader(prompt)) {
      const n = asked.filter((x) => x.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', prompt });
      return { choices: [{ message: { content: await reader(prompt, n) }, finish_reason: 'stop' }], usage: { total_tokens: 100 } };
    }
    const sec = sectionOf(prompt);
    asked.push({ sec, prompt });
    const n = asked.filter((x) => x.sec === sec).length;
    let content = sec === 'A' ? a(n, prompt) : sec === 'C' ? c(n, prompt) : null;
    if (content == null) content = sec === 'A' ? (n > 1 && rec.replies.A2) || rec.replies.A1 || rec.replies.A : rec.replies[sec];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  });
  return asked;
}

const run = (scope, extra = {}) => Gen.generatePatternExam({
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope, pageRanges: scope.pages || null, requestId: 'req-r18', ...extra,
}).then((ok) => ({ ok }), (err) => ({ err }));

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockPages.mockReset(); });

// A Q4 ارکان item's accepted answer set to its key, so it splits each word as the key does.
function agreedSyllables(tree) {
  for (const q of items(tree, 'urdu.C.Q4')) if (/ارکان/.test(q.question) && q.scheme) q.scheme.accept = [q.answer];
  return tree;
}

// ── 1. A place the lessons 1–3 filter empties is asked again once ─────────────────────────────

describe.each([
  ['r18-urdu-refused-full1', 'local full_1'],
  ['r18-urdu-refused-chapters1', 'reader round 2 chapters_1 (lessons 4–5)'],
])('%s (%s): C.Q8 quotes an everyday phrase the held lessons also print', (name) => {
  const rec = fixture(name);
  // full_1's recorded Q4 ارکان item splits its words one way in the key and another in its accepted
  // answer («خو - ش - بخ - تی» beside «خوش - بخ - تی»), which Section C is now asked again for. These
  // tests are about Q8, so Q4's accepted answer here is its key.
  rec.replies.C = JSON.stringify(agreedSyllables(JSON.parse(rec.replies.C)));
  // The C re-ask writes the paragraph in other words.
  const cleanC = () => rec.replies.C.split('کی عادت اپنانی چاہیے').join('کی عادت ڈالنی ہو گی');

  test('the slot is asked again with the run named, and the paper is made with no held run printed', async () => {
    book(rec);
    const asked = serve(rec, { c: (n) => (n === 2 ? cleanC() : null) });
    const out = await run(rec.scope);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    // The filter held the first paragraph, exactly as strictly as before.
    expect(logged('[assessment] held item dropped')).toEqual([expect.objectContaining({ slot: 'urdu.C.Q8', reason: 'lesson_1_3', match: expect.stringContaining('کی عادت اپنانی چاہیے') })]);
    // Section C was asked once more, told the run and the count it lacks.
    const cs = asked.filter((x) => x.sec === 'C');
    expect(cs).toHaveLength(2);
    expect(cs[1].prompt).toMatch(/- «[^»]*کی عادت اپنانی چاہیے[^»]*»/);
    expect(cs[1].prompt).toMatch(/needs 1 more\. Write 1 new item for it/);
    expect(logged('[assessment] held quote re-asked')).toEqual([expect.objectContaining({ slots: ['urdu.C.Q8'], refilled: true, held_again: 0 })]);
    expect(items(out.ok.examJson, 'urdu.C.Q8')).toHaveLength(2);
    // No run of the held page prints anywhere on the paper or its scheme.
    const printed = JSON.stringify(out.ok.examJson);
    for (let i = 0; i + 24 <= HELD_PAGES.length; i += 1) {
      const shingle = HELD_PAGES.slice(i, i + 24);
      if (!/=== Page/.test(shingle)) expect(printed.includes(shingle)).toBe(false);
    }
  });

  test('a re-ask that quotes the held lessons again still fails the paper as a short slot', async () => {
    book(rec);
    const asked = serve(rec);
    const out = await run(rec.scope);
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.err.shortfall).toEqual([{ slot: 'urdu.C.Q8', missing: 1 }]);
    expect(asked.filter((x) => x.sec === 'C')).toHaveLength(2);
    expect(logged('[assessment] held item dropped').every((d) => d.reason === 'lesson_1_3' && d.slot === 'urdu.C.Q8')).toBe(true);
    expect(logged('[assessment] held quote re-asked')).toEqual([expect.objectContaining({ refilled: false, held_again: 1 })]);
    expect(JSON.stringify(out.err.examJson)).not.toContain('کی عادت اپنانی چاہیے');
  });
});

describe('a Section A item that quotes the held lessons', () => {
  test('the A re-ask is told the run and what Q1 already keeps, with its count and spares', async () => {
    const rec = fixture('r18-urdu-refused-full1');
    book(rec);
    // The paragraph is clean; one MCQ's answer carries the run instead.
    const a1 = JSON.parse(rec.replies.A1);
    a1.unseen.objective.MCQs[0].answer = `الف) ہر بچے کو صبح سویرے اٹھ${RUN}`;
    a1.unseen.objective.MCQs[0].options[0] = a1.unseen.objective.MCQs[0].answer;
    const cleanC = rec.replies.C.split('کی عادت اپنانی چاہیے').join('کی عادت ڈالنی ہو گی');
    const asked = serve(rec, { a: (n) => (n === 1 ? JSON.stringify(a1) : null), c: () => cleanC });
    await run(rec.scope);
    const reask = asked.filter((x) => x.sec === 'A' && /it repeats words from a lesson the paper must never quote/.test(x.prompt));
    expect(reask).toHaveLength(1);
    expect(reask[0].prompt).toMatch(/already keeps these items \(question → answer\)/);
    expect(reask[0].prompt).toMatch(/needs 1 more\. Write \d+ new items/);
  });
});

// ── 2. A reader-caught item never prints ───────────────────────────────────────────────────────

describe('sandbox chapters_2 (lessons 6–7): ۱۱ prints ۲۰\'s answer, and the reader caught it', () => {
  const SCOPE = { kind: 'chapters', chapters: [6, 7], pages: '50-70' };
  // The recorded Section A asks two lesson-10 grammar items (۱۰ اسمِ معرفہ, ۱۵ اسمِ صوت), which a
  // lessons 6–7 paper now holds. Here they are two vocabulary items from lesson 7, as the prompt now
  // asks (words that are not the paper's Q3/Q5 words), so the reader pass is read on a paper whose
  // Q1 is otherwise as recorded.
  const LESSON_7 = [
    { question: 'لفظ «افق» کے معنی کیا ہیں؟', options: ['الف) آسمان کا کنارہ', 'ب) پہاڑ کی چوٹی', 'ج) گہرا کنواں', 'د) گھنا جنگل'], answer: 'الف) آسمان کا کنارہ' },
    { question: 'لفظ «ندی» کے معنی کیا ہیں؟', options: ['الف) بڑا سمندر', 'ب) چھوٹا دریا', 'ج) اونچا ٹیلا', 'د) کھلا میدان'], answer: 'ب) چھوٹا دریا' },
  ];
  const LESSON_10 = [/^کون سا لفظ اسمِ معرفہ ہے؟/, /^کون سا لفظ اسمِ صوت ہے؟/];
  // And ۳ «… امینہ نے اس کے لیے کیا رکھا تھا؟ → کاغذ کی فاختہ»: its correct option names the paper doves
  // another item asks for («… کاغذ سے بنے ہوئے پرندے کون سے تھے؟ → فاختائیں»), so the layout holds it
  // now. Here it is a third vocabulary item, so Q1 is full as recorded.
  const DOVE = /امینہ نے اس کے لیے کیا رکھا تھا/;
  const LESSON_7_MORE = { question: 'لفظ «جھیل» کے معنی کیا ہیں؟', options: ['الف) پانی سے بھرا بڑا گڑھا', 'ب) اونچا پہاڑ', 'ج) ریت کا میدان', 'د) گھنا باغ'], answer: 'الف) پانی سے بھرا بڑا گڑھا' };
  const recorded = fixture('r18-urdu-sandbox-chapters2');
  const rec = clone(recorded);
  const a = JSON.parse(rec.replies.A);
  const mcqsOf = (x) => (Array.isArray(x) ? x.flatMap(mcqsOf) : x && typeof x === 'object' ? (Array.isArray(x.options) ? [x] : Object.values(x).flatMap(mcqsOf)) : []);
  LESSON_10.forEach((re, i) => Object.assign(mcqsOf(a).find((q) => re.test(q.question)), LESSON_7[i]));
  // The reply with ۳ kept for the reader's own test below, its correct option the bare word «فاختہ»
  // (a one-word option the layout does not read), so the reader is the one that catches it.
  const recTwin = clone(rec);
  const aTwin = clone(a);
  Object.assign(mcqsOf(aTwin).find((q) => DOVE.test(q.question)), { options: ['الف) فاختہ', 'ب) رنگین غبارہ', 'ج) چھوٹی سی کتاب', 'د) پھولوں کا گلدستہ'], answer: 'الف) فاختہ' });
  recTwin.replies.A = JSON.stringify(aTwin);
  Object.assign(mcqsOf(a).find((q) => DOVE.test(q.question)), LESSON_7_MORE);
  rec.replies.A = JSON.stringify(a);

  test('the reply as recorded asks lesson-10 grammar, which a lessons 6–7 paper holds', () => {
    const asRecorded = JSON.parse(recorded.replies.A);
    const laid = applyLayout(asRecorded, U, SCOPE, { reasked: false });
    expect(laid.held.map((h) => h.concept)).toEqual(['naming', 'sound']);
    expect(q1Stems(laid.examJson).some((s) => LESSON_10.some((re) => re.test(s)))).toBe(false);
    const swapped = q1Stems(applyLayout(JSON.parse(rec.replies.A), U, SCOPE, { reasked: false }).examJson);
    expect(swapped).toEqual(expect.arrayContaining(LESSON_7.map((q) => q.question)));
  });
  const GIVEN = /ندی کا دم کیوں گھٹ رہا ہے/; // ۲۰: keyed «اس میں شہر کا گندا نالہ گرتا ہے»
  const GIVER = /گندا نالہ ندی میں گرتا ہے/; // ۱۱ quotes that sentence
  const labelOf = (prompt, re) => { const l = prompt.split('\n').find((x) => /^Q1\.\d+ /.test(x) && re.test(x)); return l ? l.split(' ')[0] : null; };
  const flag = (item, by, evidence, reason) => JSON.stringify({ candidates: [{ item, by, evidence, reason, given_away: true }] });
  const first = (prompt) => flag(labelOf(prompt, GIVEN), labelOf(prompt, GIVER), 'گندا نالہ ندی میں گرتا ہے', 'states why the river suffocates');
  // Every replacement the re-check is shown is flagged again, by the kept ۱۱.
  const allAgain = (prompt) => {
    const only = (prompt.split('\n').find((l) => l.startsWith(Reader.ONLY_HEAD)) || '').match(/Q1\.\d+/g) || [];
    return JSON.stringify({ candidates: only.map((item) => ({ item, by: labelOf(prompt, GIVER), evidence: 'گندا نالہ ندی میں گرتا ہے', reason: 'stand-in', given_away: true })) });
  };

  test('the recorded paper prints both, with the pass off', async () => {
    book(rec);
    serve(rec);
    const out = await run(SCOPE);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const stems = q1Stems(out.ok.examJson);
    expect(stems.some((s) => GIVEN.test(s)) && stems.some((s) => GIVER.test(s))).toBe(true);
  });

  test('a replacement the re-check flags again: one more top-up runs, and the caught item never prints', async () => {
    book(rec);
    const asked = serve(rec, {
      a: (n) => (n === 2 ? mcqs(NEW.slice(0, 1)) : n === 3 ? mcqs(NEW.slice(1, 4)) : null),
      reader: async (prompt, n) => (n === 1 ? first(prompt) : n === 2 ? allAgain(prompt) : JSON.stringify({ candidates: [] })),
    });
    const out = await run(SCOPE, { readerPass: true });
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const stems = q1Stems(out.ok.examJson);
    expect(stems).toHaveLength(20);
    expect(stems.some((s) => GIVEN.test(s))).toBe(false);
    expect(stems).not.toContain(NEW[0].question);
    expect(stems).toContain(NEW[1].question);
    expect(asked.filter((x) => x.sec === 'A')).toHaveLength(3);
    expect(asked.filter((x) => x.sec === 'reader')).toHaveLength(3);
    const r = out.ok.examJson._layout.reader;
    expect(r).toMatchObject({ flagged: 1, put_back: 0, top_ups: 2, still_flagged: 1 });
    expect(r.items.map((x) => x.outcome)).toEqual(['replaced', 'taken_off']);
  });

  test('still short after the second top-up: the paper fails closed, the record on it, the caught item not printed', async () => {
    book(rec);
    const asked = serve(rec, {
      a: (n) => (n === 2 ? mcqs(NEW.slice(0, 1)) : n === 3 ? mcqs(NEW.slice(1, 2)) : null),
      reader: async (prompt, n) => (n === 1 ? first(prompt) : allAgain(prompt)),
    });
    const out = await run(SCOPE, { readerPass: true });
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(out.err.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
    expect(asked.filter((x) => x.sec === 'A')).toHaveLength(3);
    const exam = out.err.examJson;
    expect(q1Stems(exam).some((s) => GIVEN.test(s))).toBe(false);
    expect(exam._layout.reader).toMatchObject({ flagged: 1, put_back: 0, top_ups: 2, still_flagged: 2, error: 'the paper would be short' });
    expect(exam._layout.reader.items.map((x) => x.outcome)).toEqual(['replaced', 'taken_off', 'taken_off']);
    const line = logged('[assessment] reader pass')[0];
    expect(line).toMatchObject({ subject: 'urdu', flagged: 1, error: 'the paper would be short' });
  });

  test('a top-up call that fails: the caught item still never prints, and the record keeps its items', async () => {
    book(rec);
    let nA = 0;
    serve(rec, { reader: async (prompt) => first(prompt) });
    const inner = mockCreate.getMockImplementation();
    mockCreate.mockImplementation(async (req) => {
      if (sectionOf(textOf(req)) === 'A' && !isReader(textOf(req)) && ++nA === 2) throw new Error('upstream 529');
      return inner(req);
    });
    const out = await run(SCOPE, { readerPass: true });
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(q1Stems(out.err.examJson).some((s) => GIVEN.test(s))).toBe(false);
    expect(out.err.examJson._layout.reader).toMatchObject({ flagged: 1, error: expect.stringMatching(/^top-up: /) });
    expect(out.err.examJson._layout.reader.items).toHaveLength(1);
  });

  // ۱۳ «… امینہ نے اس کے لیے کیا رکھا تھا؟ → کاغذ کی فاختہ» and ۲ «کاغذ سے بنے ہوئے پرندے … → فاختائیں»:
  // one book fact. The first read held a twin of ۲ and the top-up wrote it again in a new shape.
  test('the top-up is told the kept partner\'s fact and key; the re-check reads each replacement against every kept item', async () => {
    book(recTwin);
    const PARTNER = /کاغذ سے بنے ہوئے پرندے/;
    const TWIN = /امینہ نے اس کے لیے کیا رکھا/;
    const asked = serve(recTwin, {
      a: (n) => (n === 2 ? mcqs(NEW.slice(0, 3)) : null),
      reader: async (prompt, n) => (n === 1
        ? flag(labelOf(prompt, TWIN), labelOf(prompt, PARTNER), 'کاغذ سے بنے ہوئے پرندے', 'same paper-bird fact')
        : JSON.stringify({ candidates: [] })),
    });
    const out = await run(SCOPE, { readerPass: true });
    expect(out.err).toBeUndefined();
    const topUp = asked.filter((x) => x.sec === 'A')[1].prompt;
    expect(topUp).toMatch(/The paper keeps سدرہ کے تکیے کے پاس کاغذ سے بنے ہوئے پرندے کون سے تھے؟ → فاختائیں: never ask that fact again/);
    const recheck = asked.filter((x) => x.sec === 'reader')[1].prompt;
    expect(recheck).toContain('against EVERY other Q1 item');
    expect(recheck).toContain('«فاختہ» / «فاختائیں»');
    expect(q1Stems(out.ok.examJson).some((s) => TWIN.test(s))).toBe(false);
  });
});

// ── 3. A Q4 stem never prints its options twice ────────────────────────────────────────────────

describe('sandbox full_2: Q4 ۱–۲ carry their options inline as well as in the options row', () => {
  const rec = fixture('r18-urdu-sandbox-full2');
  const c = JSON.parse(rec.replies.C);
  const q4 = () => items(applyLayout(clone(c), U, { kind: 'fde' }, { now: 'x', reasked: true }).examJson, 'urdu.C.Q4');

  test('the stem keeps its question and loses the inline list; the options row is unchanged', () => {
    const before = items(c, 'urdu.C.Q4');
    expect(before[0].question).toMatch(/الف\) اسکول ب\) بازار/);
    const after = q4();
    expect(after[0].question).toBe('گروہی الفاظ پڑھ کر وہ لفظ منتخب کریں جس کے یہ متلازم ہیں: «کلاس، بستہ، کاپی، استانی صاحبہ»۔');
    expect(after[1].question).toBe('حرفِ شرط و جزا کی درست جوڑی منتخب کریں: ___ تم محنت کرو گے ___ کامیاب ہو جاؤ گے۔');
    expect(after[0].options).toEqual(before[0].options);
    // An item with no options row, or a stem whose letters are not its four options, is untouched.
    expect(after[2].question).toBe(before[2].question);
    expect(after[3].question).toBe(before[3].question);
  });

  test('a stem whose lettered run is not its options keeps it', () => {
    const q = { slot: 'urdu.C.Q4', question: 'جملہ «الف) میں ب) تم ج) وہ د) ہم» دیکھیں', options: ['الف) اسکول', 'ب) بازار', 'ج) باغ', 'د) ہسپتال'], answer: 'الف) اسکول' };
    const tree = { unseen: { subjective: { 'Rewrite Sentences': [q] } } };
    expect(items(applyLayout(tree, U, { kind: 'fde' }, { now: 'x' }).examJson, 'urdu.C.Q4')[0].question).toBe(q.question);
  });

  test('another subject\'s stem with Urdu letters is never stripped (the Urdu rule is Urdu-only)', () => {
    const S = Patterns.get('fde_g5_2027').subjects.social_studies;
    const slot = S.sections.flatMap((s) => s.slots).find((s) => /A\.Q1$/.test(s.slot)).slot;
    const q = { slot, question: 'درست جواب چنیں: الف) ایک ب) دو ج) تین د) چار', options: ['الف) ایک', 'ب) دو', 'ج) تین', 'د) چار'], answer: 'الف) ایک' };
    const out = applyLayout({ unseen: { objective: { MCQs: [q] } } }, S, { kind: 'fde' }, { now: 'x' }).examJson;
    expect(items(out, slot)[0].question).toBe(q.question);
  });
});
