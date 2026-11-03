/**
 * Urdu board-pattern papers, six more rules from the last round of sandbox papers:
 *
 * 1. Lessons that hold one prose story (lessons 6–7: «امن کی فاختہ» and a poem; any single lesson; pages
 *    inside one lesson) gave Q1 sixteen story facts that named each other. Section A now asks for at
 *    most eight story items, the rest from the lessons' word lists, meanings, idioms and the poem, and
 *    each item says where it comes from (`source`, never printed). A ninth story item is held, and a
 *    top-up is told how many story items are left.
 *
 * 2. A Q1 item that asks a name or a place, keyed on one word only its key option carries, is given away
 *    by another Q1 stem or correct option that prints the word («ہیروشیما», «امینہ»).
 * 3. The reader is handed code's own candidates: each short key's printed places, and the pairs of Q1
 *    items whose keys stand in the same or neighbouring book sentences.
 * 4. On the full syllabus too, a grammar concept is asked once, antonym and synonym included.
 * 5. A Q4 ارکان key that splits a word the book itself splits («دامن» دا – من, «غلاظت» غ – لا – ظت) must
 *    split it the book's way; the Section C prompt quotes the book's splits. «فاختہ» is split nowhere in
 *    the book, so it is not checked.
 * 6. One word, one place in Section C: a Q5 that asks a sentence with a word Q3 asks the meaning of
 *    («شانہ بشانہ» in both) is held and Section C is asked again, told Q3's words; if the re-ask writes it
 *    again it is put back (it gives nothing away). An idiom built on a Q3 word («شانہ بشانہ کام کرنا») is
 *    another entry.
 *
 * The papers are the sandbox's own (content only). The model boundary and the book store are mocked,
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
const has = (exam, re) => q1(exam).some((q) => re.test(q.question));

// ── 1. A Q1 mix for a one-story scope ──────────────────────────────────────────────────────────

// The lessons 6–7 sandbox paper as it printed: 16 of its 20 Q1 items are facts of the story, two are
// the poem's, ۱ is a meaning and ۶ a homograph. Each item is given the source Section A now declares.
const POEM = /ندی/;
function sourced(exam) {
  const out = clone(exam);
  q1(out).forEach((q, i) => { q.source = i === 0 ? 'meaning' : i === 5 ? 'word' : POEM.test(q.question) ? 'poem' : 'story'; });
  return out;
}
const STORY_STEMS = new Set(q1(sourced(fixture('r21f-urdu-sandbox-chapters_4'))).filter((q) => q.source === 'story').map((q) => q.question));
const stories = (exam) => q1(exam).filter((q) => STORY_STEMS.has(q.question));
const L67 = { kind: 'chapters', chapters: [6, 7], pages: '50-60, 61-70' };

describe('1. sandbox chapters_4 (lessons 6–7): sixteen story items', () => {
  const paper = sourced(fixture('r21f-urdu-sandbox-chapters_4'));

  test('the paper as printed asks sixteen story facts', () => {
    expect(stories(paper)).toHaveLength(16);
  });

  test('the layout keeps eight story items and holds the rest; Q1 is short until a top-up', () => {
    const r = lay(paper, ch(6, 7));
    expect(stories(r.examJson).length).toBeLessThanOrEqual(8);
    expect(r.examJson._layout.holds).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'urdu.A.Q1', rule: 'story_cap' })]));
    expect(r.examJson._layout.story_items).toBe(stories(r.examJson).length);
    expect(r.shortfall.find((f) => f.slot === 'urdu.A.Q1')).toBeTruthy();
  });

  test('the source never prints', () => {
    const r = lay(paper, ch(6, 7), { reasked: true });
    expect(q1(r.examJson).some((q) => Object.prototype.hasOwnProperty.call(q, 'source'))).toBe(false);
  });

  test('a single lesson and a pages scope inside one lesson are one story too', () => {
    expect(lay(paper, ch(6)).examJson._layout.holds).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'story_cap' })]));
    expect(lay(paper, { kind: 'pages', chapters: null, pages: '51-55' }).examJson._layout.holds)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'story_cap' })]));
  });

  test.each([['lessons 4–5 (two prose lessons)', ch(4, 5)], ['the full syllabus', FDE]])('%s: no story cap (control)', (_, scope) => {
    const r = lay(paper, scope);
    expect((r.examJson._layout.holds || []).some((h) => h.rule === 'story_cap')).toBe(false);
    expect(r.examJson._layout.story_items).toBeUndefined();
    expect(q1(r.examJson).some((q) => Object.prototype.hasOwnProperty.call(q, 'source'))).toBe(false);
  });

  test('a reply that declares no source is laid out as before (control)', () => {
    const plainPaper = fixture('r21f-urdu-sandbox-chapters_4');
    const r = lay(plainPaper, ch(6, 7));
    expect((r.examJson._layout.holds || []).some((h) => h.rule === 'story_cap')).toBe(false);
    expect(r.examJson._layout.story_items).toBeUndefined();
  });
});

// The engine on lessons 6–7: Section A's first reply is the sandbox paper's 20 items with their
// sources; Section B and C are the recorded lessons 4–5 replies (their content does not matter here).
const rec = fixture('r18-urdu-refused-chapters1');
const REPLY_B = rec.replies.B;
const REPLY_C = rec.replies.C.split('کی عادت اپنانی چاہیے').join('کی عادت ڈالنی ہو گی');
const mcqs = (list) => JSON.stringify({ unseen: { objective: { MCQs: clone(list) } } });
const WORDS = [['تاب کاری', 'ایٹمی شعاعوں کا اثر'], ['جھکڑ', 'تیز آندھی'], ['سانچے', 'ڈھانچے، قالب'], ['بین الاقوامی', 'کئی ملکوں کا'],
  ['دامن', 'کپڑے کا نچلا کنارا'], ['امن', 'سکون اور صلح'], ['فضا', 'ہوا اور آسمان'], ['افق', 'جہاں زمین آسمان سے ملتی دکھائی دے'],
  ['خاک', 'مٹی، دھول'], ['گونجنا', 'آواز کا پھیلنا']];
const meaning = ([w, k]) => ({
  slot: 'urdu.A.Q1', question: `لفظ «${w}» سے کیا مراد ہے؟`, source: 'meaning',
  options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1,
});
function book(extra = '') {
  const c = JSON.parse(REPLY_C);
  const q6 = Object.values(c.unseen.subjective || {}).flat().find((q) => q && q.slot === 'urdu.C.Q6');
  const content = [extra, '=== Page 63 ===', 'ندی کی فریاد', ...String((q6 && q6.passage) || '').split('\n')].filter(Boolean).join('\n\n');
  mockPages.mockImplementation(async ({ pageRanges } = {}) => ({ content, pageReference: String(pageRanges || '50') }));
}
function serve(a, reader = null) {
  const asked = [];
  mockCreate.mockImplementation(async (req) => {
    const prompt = textOf(req);
    if (isReader(prompt)) {
      const n = asked.filter((x) => x.sec === 'reader').length + 1;
      asked.push({ sec: 'reader', prompt });
      return { choices: [{ message: { content: reader ? reader(prompt, n) : '{"candidates":[]}' }, finish_reason: 'stop' }], usage: { total_tokens: 100 } };
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
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope, pageRanges: scope.pages || null, requestId: 'req-r21f', ...extra,
}).then((ok) => ({ ok }), (err) => ({ err }));

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockPages.mockReset(); book(); });

const STORY_CAP = /at most 8 of the 20 Q1 items ask a fact of the story/;
const SOURCE_FIELD = /Give every Q1 item a "source" field/;
const USED_UP = /Story items are used up/;

describe('1. the engine on lessons 6–7', () => {
  const first = q1(sourced(fixture('r21f-urdu-sandbox-chapters_4'))).map((q) => ({ ...q, slot: 'urdu.A.Q1' }));

  test('Section A asks for at most eight story items and a source per item', async () => {
    const asked = serve(() => mcqs(first));
    await run(L67);
    const a = asked.find((x) => x.sec === 'A').prompt;
    expect(a).toMatch(STORY_CAP);
    expect(a).toMatch(SOURCE_FIELD);
    expect(asked.find((x) => x.sec === 'B').prompt).not.toMatch(STORY_CAP);
    expect(asked.find((x) => x.sec === 'C').prompt).not.toMatch(STORY_CAP);
  });

  test('the top-up is told story items are used up, and its new items fill Q1: the paper prints at most eight story items', async () => {
    const asked = serve((n) => (n === 1 ? mcqs(first) : mcqs(WORDS.map(meaning))));
    const out = await run(L67);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const as = asked.filter((x) => x.sec === 'A');
    expect(as.length).toBeGreaterThan(1);
    expect(as[1].prompt).toMatch(USED_UP);
    expect(stories(out.ok.examJson).length).toBeLessThanOrEqual(8);
    expect(q1(out.ok.examJson)).toHaveLength(20);
  });

  test.each([['lessons 4–5', { kind: 'chapters', chapters: [4, 5], pages: '28-37, 38-49' }], ['the full syllabus', FDE]])('%s: no story line (control)', async (_, scope) => {
    const asked = serve(() => mcqs(first));
    await run(scope);
    const a = asked.find((x) => x.sec === 'A').prompt;
    expect(a).not.toMatch(STORY_CAP);
    expect(a).not.toMatch(SOURCE_FIELD);
  });
});

// ── 2. The proper-noun name cue ────────────────────────────────────────────────────────────────

// An item that asks a name or a place, keyed on one word only its key option carries, is given away by
// another Q1 stem or correct option that prints the word. No shared topic word is needed.
describe('2. sandbox chapters_4 (lessons 6–7): two stems print another item\'s one-word name', () => {
  const paper = fixture('r21f-urdu-sandbox-chapters_4');
  const HIRO_KEY = /ایٹم بم کا حملہ جاپان کے کس شہر/;
  const HIRO_STEM = /ہیروشیما پر نظر آنے والے/;
  const AMINA_KEY = /سدرہ کی بہن کا نام/;
  const AMINA_STEM = /امینہ گلی میں کس طرف/;

  test('the paper as printed has both pairs', () => {
    expect([HIRO_KEY, HIRO_STEM, AMINA_KEY, AMINA_STEM].every((re) => has(paper, re))).toBe(true);
  });

  test.each([['lessons 6–7', ch(6, 7)], ['the full syllabus', FDE]])('%s: the layout prints only one item of each pair', (_, scope) => {
    const out = lay(paper, scope).examJson;
    expect(has(out, HIRO_KEY) && has(out, HIRO_STEM)).toBe(false);
    expect(has(out, AMINA_KEY) && has(out, AMINA_STEM)).toBe(false);
  });

  test('a wrong option that names the key is no cue (control)', () => {
    const p = clone(paper);
    const stem = q1(p).find((q) => AMINA_STEM.test(q.question));
    stem.question = 'سالگرہ کی صبح سدرہ کی سہیلی گلی میں کس طرف جا رہی تھی؟';
    stem.options = ['الف) اسکول کی طرف', 'ب) امینہ کے گھر کی طرف', 'ج) باغ کی طرف', 'د) اسپتال کی طرف'];
    const out = lay(p, ch(6, 7)).examJson;
    expect(has(out, AMINA_KEY)).toBe(true);
    expect(has(out, /سدرہ کی سہیلی گلی میں/)).toBe(true);
  });

  test('a one-word key of an item that asks about a word (its opposite) is no name: «امن» کا متضاد → جنگ stays (control)', () => {
    const p = clone(paper);
    const [a, b] = q1(p).filter((q) => /تاب کاری کے اثر|سدرہ کو دور افق/.test(q.question));
    Object.assign(a, { question: '«امن» کا متضاد کون سا لفظ ہے؟', options: ['الف) جنگ', 'ب) سکون', 'ج) صلح', 'د) خوشی'], answer: 'الف) جنگ' });
    Object.assign(b, { question: 'جنگ ختم ہونے کے بعد بچوں نے میدان میں کیا لگایا؟', options: ['الف) درخت', 'ب) جھنڈے', 'ج) خیمے', 'د) جھولے'], answer: 'الف) درخت' });
    const out = lay(p, ch(6, 7)).examJson;
    expect(has(out, /«امن» کا متضاد/)).toBe(true);
    expect(has(out, /جنگ ختم ہونے کے بعد/)).toBe(true);
  });
});

// ── 3. The reader gets its candidates ─────────────────────────────────────────────────────────

// The book's two sentences ۱۲ and ۲۰ answer from (page 53 of «امن کی فاختہ»), as the page store has them.
const BOOK_53 = ['=== Page 53 ===', 'کے بعد گویا سدرہ کی زندگی ہمیشہ کے لیے بدل گئی تھی۔ جوکچھ اس نے دیکھا تھا، اس کے اثرات کئی',
  'سال تک لوگوں کی صحت اور زندگی پر پڑتے رہے۔ تاب کاری سے لوگوں کو جلد، سانس اور بہت ساری دیگر یماریاں',
  'لاحق ہوگئیں۔ سدرہ اکثریہ سوچتی کہ لوگ لڑائیاں اور جنگیں کیوں کرتے ہیں؟'].join('\n');
const CAND = Reader.CANDIDATES_HEAD;
const labelOf = (prompt, re) => (prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l)) || '').split(' ')[0];
const candidates = (prompt) => prompt.slice(prompt.indexOf(CAND)).split('\n').filter((l) => l.startsWith('- '));

describe('3. the reader prompt lists what code can find', () => {
  const paper = fixture('r21f-urdu-sandbox-chapters_4');

  test('each one-word key\'s printed places: «ہیروشیما» in ۱۴\'s stem, «امینہ» in ۱۷\'s stem; never a wrong option', () => {
    const { prompt } = Reader.buildReaderPrompt(paper, U, { pages: BOOK_53 });
    expect(prompt).toContain(CAND);
    const lines = candidates(prompt);
    const hiro = lines.find((l) => l.startsWith('- Q1.8 ') && l.includes('ہیروشیما'));
    expect(hiro).toContain('Q1.14 (stem)');
    // ۲ prints «ہیروشیما» only as a wrong option.
    expect(hiro).not.toContain('Q1.2 ');
    expect(lines.find((l) => l.startsWith('- Q1.11 ') && l.includes('امینہ'))).toContain('Q1.17 (stem)');
  });

  test('a pair whose keys stand in neighbouring book sentences: ۱۲ and ۲۰', () => {
    const { prompt } = Reader.buildReaderPrompt(paper, U, { pages: BOOK_53 });
    expect(candidates(prompt).some((l) => /Q1\.12\b/.test(l) && /Q1\.20\b/.test(l) && /sentence/.test(l))).toBe(true);
  });

  test('no pages, no pair lines; the key-place lines stay', () => {
    const { prompt } = Reader.buildReaderPrompt(paper, U);
    expect(candidates(prompt).some((l) => /Q1\.12\b/.test(l) && /Q1\.20\b/.test(l))).toBe(false);
    expect(candidates(prompt).some((l) => l.startsWith('- Q1.8 '))).toBe(true);
  });

  test('the Social Studies prompt carries no candidate list (control)', () => {
    const S = Patterns.get('fde_g5_2027').subjects.social_studies;
    expect(Reader.buildReaderPrompt({ unseen: {} }, S, { pages: BOOK_53 }).prompt).not.toContain(CAND);
  });
});

describe('3. the engine hands the reader the book pages', () => {
  const first = q1(fixture('r21f-urdu-sandbox-chapters_4'));
  test('the reader prompt lists the ۱۲ / ۲۰ pair from the loaded pages', async () => {
    book(BOOK_53);
    const asked = serve((n) => (n === 1 ? mcqs(first) : mcqs(WORDS.map(meaning))));
    const out = await run(L67, { readerPass: true });
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall, msg: out.err.message }).toBeUndefined();
    const reads = asked.filter((x) => x.sec === 'reader');
    expect(reads.length).toBeGreaterThan(0);
    const prompt = reads[0].prompt;
    const [a, b] = [labelOf(prompt, /تاب کاری کے اثر سے/), labelOf(prompt, /کئی سال تک کس چیز پر/)];
    expect(a && b).toBeTruthy();
    const at = (label) => new RegExp(`${label.replace('.', '\\.')}\\b`);
    expect(candidates(prompt).some((l) => at(a).test(l) && at(b).test(l) && /sentence/.test(l))).toBe(true);
  });
});

// ── 4. Once on the full syllabus ───────────────────────────────────────────────────────────────

const antonyms = (exam) => q1(exam).filter((q) => /کا متضاد|الٹ معنی/.test(q.question)).map((q) => q.question);

describe('4. sandbox full_1: the full syllabus asked متضاد twice', () => {
  const paper = fixture('r21f-urdu-sandbox-full_1');

  test('the paper as printed asks two antonyms (۱۳ «بزدل», ۱۹ «اندھیرا»)', () => {
    expect(antonyms(paper)).toHaveLength(2);
  });

  test.each([[false], [true]])('reasked %s: one antonym prints, the repeat never comes back', (reasked) => {
    const r = lay(paper, FDE, { reasked });
    expect(antonyms(r.examJson)).toHaveLength(1);
    expect((r.putBack || []).map((x) => x.rule)).not.toContain('concept_repeat');
    expect(r.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 1 }]);
  });

  test('the full paper adds no `counted` mark and no other change (control)', () => {
    const r = lay(paper, FDE);
    expect(r.examJson._layout.counted).toBeUndefined();
  });

  test('lessons 6–7 teach no antonym: two antonyms there are vocabulary and both print (control)', () => {
    const r = lay(paper, ch(6, 7));
    expect(antonyms(r.examJson)).toHaveLength(2);
  });
});

const antonym = (w, k, [a, c, d]) => ({
  slot: 'urdu.A.Q1', question: `«${w}» کا متضاد کون سا لفظ ہے؟`,
  options: [`الف) ${a}`, `ب) ${k}`, `ج) ${c}`, `د) ${d}`], answer: `ب) ${k}`, marks: 1,
});
const LIGHT = antonym('روشنی', 'اندھیرا', ['نور', 'چمک', 'اجالا']);
const BRAVE = antonym('بہادر', 'بزدل', ['نڈر', 'جری', 'مضبوط']);
const WARM = antonym('گرم', 'ٹھنڈا', ['تپتا', 'جلتا', 'سلگتا']);
const MORE = [['دریا', 'پانی کا بڑا بہاؤ'], ['کتب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'], ['درزی', 'کپڑے سینے والا'],
  ['نانبائی', 'روٹی پکانے والا'], ['موچی', 'جوتے بنانے والا'], ['کسان', 'کھیتی باڑی کرنے والا'], ['مچھیرا', 'مچھلیاں پکڑنے والا'],
  ['ڈاکیا', 'خط پہنچانے والا'], ['معمار', 'عمارت بنانے والا'], ['جولاہا', 'کپڑا بننے والا'], ['لوہار', 'لوہے کا کام کرنے والا'],
  ['سنار', 'زیور بنانے والا'], ['بڑھئی', 'لکڑی کا کام کرنے والا'], ['حلوائی', 'مٹھائی بنانے والا'], ['کمہار', 'مٹی کے برتن بنانے والا'],
  ['مالی', 'پودوں کو پانی دینے والا'], ['چوکیدار', 'رات کو پہرا دینے والا'], ['ملاح', 'کشتی چلانے والا'], ['پنساری', 'مصالحے بیچنے والا']];
const GRAMMAR_USED_UP = /grammar is used up/i;
const ONCE_FULL = /An antonym item and a synonym item are concepts too/;

describe('4. the engine on the full syllabus', () => {
  const first = [LIGHT, ...MORE.slice(0, 9).map(meaning), BRAVE, ...MORE.slice(9, 18).map(meaning)];

  test('Section A says antonym and synonym are asked once (full syllabus only)', async () => {
    const asked = serve(() => mcqs(first));
    await run(FDE);
    expect(asked.find((x) => x.sec === 'A').prompt).toMatch(ONCE_FULL);
    const chapters = serve(() => mcqs(first));
    await run({ kind: 'chapters', chapters: [4, 5], pages: '28-37, 38-49' });
    expect(chapters.find((x) => x.sec === 'A').prompt).not.toMatch(ONCE_FULL);
  });

  test('a top-up that writes an antonym again: one more, told grammar is used up; the paper prints one antonym', async () => {
    const asked = serve((n, prompt) => (n === 1 ? mcqs(first) : GRAMMAR_USED_UP.test(prompt) ? mcqs([meaning(MORE[18]), meaning(MORE[19])]) : mcqs([WARM])));
    const out = await run(FDE);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(antonyms(out.ok.examJson)).toHaveLength(1);
    expect(q1(out.ok.examJson)).toHaveLength(20);
    expect(asked.filter((x) => x.sec === 'A' && GRAMMAR_USED_UP.test(x.prompt))).toHaveLength(1);
  });

  test('top-ups that keep writing antonyms leave Q1 short: the paper fails closed, the repeat never printed', async () => {
    serve((n) => (n === 1 ? mcqs(first) : mcqs([WARM])));
    const out = await run(FDE);
    expect(out.err && out.err.code).toBe('PATTERN_SHORT_SLOT');
    expect(antonyms(out.err.examJson)).toHaveLength(1);
  });
});

// ── 5. ارکان from the book's own splits ────────────────────────────────────────────────────────

const syllableItem = (answer, accept = [answer]) => ({
  slot: 'urdu.C.Q4', question: 'درج ذیل الفاظ کی ارکان سازی کریں: دامن، غلاظت', main_question: 'ارکان سازی', answer, scheme: { accept },
});
const q4Held = (q, rule) => (lay({ unseen: { subjective: { 'Rewrite Sentences': [q] } } }, FDE).examJson._layout.holds || []).filter((h) => h.rule === rule).length;

describe('5. a Q4 ارکان key against the book\'s own splits', () => {
  test('a key that splits «دامن» as دام – ن (key and accept agree) is held', () => {
    expect(q4Held(syllableItem('دام – ن، غ – لا – ظت'), 'book_split')).toBe(1);
  });

  test('«غلاظت» split غلا – ظت is held too', () => {
    expect(q4Held(syllableItem('دا – من، غلا – ظت'), 'book_split')).toBe(1);
  });

  test('the book\'s own splits, written with «+» or marks, stay', () => {
    expect(q4Held(syllableItem('دا – من، غ – لا – ظت'), 'book_split')).toBe(0);
    expect(q4Held(syllableItem('دا + مَن\nغَ + لا + ظت'), 'book_split')).toBe(0);
  });

  test('a word the book never splits is not checked: «فاختہ: فا – ختہ» stays (control)', () => {
    const q = { slot: 'urdu.C.Q4', question: 'درج ذیل الفاظ کی ارکان سازی کریں: فاختہ، مشغول', answer: 'فا – ختہ، مش – غول', scheme: { accept: ['فا – ختہ، مش – غول'] } };
    expect(q4Held(q, 'book_split')).toBe(0);
  });

  test('an item that is no ارکان item is not read (control)', () => {
    const q = { slot: 'urdu.C.Q4', question: 'فعلِ حال کو فعلِ مستقبل میں تبدیل کریں: دامن صاف ہے۔', answer: 'دامن صاف ہو گا۔', scheme: { accept: ['دامن صاف ہو گا۔'] } };
    expect(q4Held(q, 'book_split')).toBe(0);
  });

  test('the Section C prompt quotes the book\'s splits; Section A and B do not', async () => {
    const asked = serve(() => mcqs(MORE.map(meaning)));
    await run(FDE);
    const c = asked.find((x) => x.sec === 'C').prompt;
    expect(c).toContain('The book splits «دامن» as دا – من and «غلاظت» as غ – لا – ظت.');
    expect(asked.find((x) => x.sec === 'A').prompt).not.toContain('The book splits');
    expect(asked.find((x) => x.sec === 'B').prompt).not.toContain('The book splits');
  });
});

// ── 6. One word, one place in Section C ────────────────────────────────────────────────────────

const words = (exam, slot) => items(exam, slot).flatMap((q) => q.words || []);
describe('6. sandbox chapters_1 (lessons 4–5): «شانہ بشانہ» in Q3 and in Q5', () => {
  const paper = fixture('r21f-urdu-sandbox-chapters_1');

  test('the paper as printed asks it in both', () => {
    expect(words(paper, 'urdu.C.Q3')).toContain('شانہ بشانہ');
    expect(words(paper, 'urdu.C.Q5')).toContain('شانہ بشانہ');
  });

  test('before the re-ask Q5 is held and Section C is short', () => {
    const r = lay(paper, ch(4, 5));
    expect(items(r.examJson, 'urdu.C.Q5')).toHaveLength(0);
    expect(r.shortfall).toContainEqual({ slot: 'urdu.C.Q5', missing: 1 });
    expect(r.examJson._layout.holds).toEqual(expect.arrayContaining([{ slot: 'urdu.C.Q5', rule: 'word_twice', n: 1 }]));
  });

  test('after the re-ask, a Q5 that still repeats the word is put back: it gives nothing away', () => {
    const r = lay(paper, ch(4, 5), { reasked: true });
    expect(items(r.examJson, 'urdu.C.Q5')).toHaveLength(1);
    expect(r.putBack).toEqual(expect.arrayContaining([{ slot: 'urdu.C.Q5', rule: 'word_twice' }]));
    expect(r.shortfall.find((f) => f.slot === 'urdu.C.Q5')).toBeUndefined();
  });

  test('a Q5 held for a Q3 word may come back, so a Q1 item asking the meaning of a Q5 word is still held', () => {
    const p = clone(paper);
    const w = items(p, 'urdu.C.Q5')[0].words.find((x) => x !== 'شانہ بشانہ' && !words(p, 'urdu.C.Q3').includes(x));
    const q = q1(p)[0];
    Object.assign(q, { question: `لفظ «${w}» کا کیا مطلب ہے؟`, options: ['الف) پکا ارادہ', 'ب) کمزوری', 'ج) خوف', 'د) غصہ'], answer: 'الف) پکا ارادہ' });
    for (const reasked of [false, true]) expect(has(lay(p, ch(4, 5), { reasked }).examJson, new RegExp(`«${w}» کا کیا مطلب`))).toBe(false);
  });

  test('an idiom built on a Q3 word is another entry: «شانہ بشانہ کام کرنا» stays (control)', () => {
    const p = clone(paper);
    const q5 = items(p, 'urdu.C.Q5')[0];
    q5.words = q5.words.map((w) => (w === 'شانہ بشانہ' ? 'شانہ بشانہ کام کرنا' : w));
    expect(items(lay(p, ch(4, 5)).examJson, 'urdu.C.Q5')).toHaveLength(1);
  });

  test('the same idiom with another verb form is the same entry («دھوم مچ جانا» / «دھوم مچانا»)', () => {
    const p = clone(paper);
    items(p, 'urdu.C.Q3')[0].words[0] = 'دھوم مچ جانا';
    const q5 = items(p, 'urdu.C.Q5')[0];
    q5.words = q5.words.map((w) => (w === 'شانہ بشانہ' ? 'دھوم مچانا' : w));
    expect(items(lay(p, ch(4, 5)).examJson, 'urdu.C.Q5')).toHaveLength(0);
  });
});

describe('6. the engine: Section C asked again, told Q3\'s words', () => {
  // The recorded lessons 4–5 Section C, with Q5's «شانہ بشانہ کام کرنا» written as the Q3 word itself.
  const twice = (() => {
    const c = JSON.parse(REPLY_C);
    for (const list of Object.values(c.unseen.subjective)) for (const q of list) if (q.slot === 'urdu.C.Q5') q.words = q.words.map((w) => (/^شانہ بشانہ/.test(w) ? 'شانہ بشانہ' : w));
    return JSON.stringify(c);
  })();
  const L45 = { kind: 'chapters', chapters: [4, 5], pages: '28-37, 38-49' };
  function serveC(cReply) {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = sectionOf(prompt);
      asked.push({ sec, prompt });
      const n = asked.filter((x) => x.sec === sec).length;
      const content = sec === 'A' ? mcqs(MORE.map(meaning)) : sec === 'B' ? REPLY_B : cReply(n);
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
    });
    return asked;
  }
  const NOTE = /Q3 of this paper asks the meaning of these words: [^\n]*شانہ بشانہ/;

  test('the re-ask is told Q3\'s words and its Q5 prints; the paper is whole', async () => {
    const asked = serveC((n) => (n === 1 ? twice : REPLY_C));
    const out = await run(L45);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const cs = asked.filter((x) => x.sec === 'C');
    expect(cs).toHaveLength(2);
    expect(cs[0].prompt).not.toMatch(NOTE);
    expect(cs[1].prompt).toMatch(NOTE);
    expect(words(out.ok.examJson, 'urdu.C.Q5')).not.toContain('شانہ بشانہ');
  });

  test('every first Section C ask says Q3 and Q5 never share a word; A and B do not', async () => {
    const asked = serveC(() => REPLY_C);
    await run(L45);
    expect(asked.find((x) => x.sec === 'C').prompt).toContain('Q3 and Q5 never share a word or idiom');
    expect(asked.find((x) => x.sec === 'A').prompt).not.toContain('Q3 and Q5 never share');
    expect(asked.find((x) => x.sec === 'B').prompt).not.toContain('Q3 and Q5 never share');
  });
});
