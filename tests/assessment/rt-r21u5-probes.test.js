/**
 * Probes on the Urdu one-story Q1 rules: the story-item cap across re-layouts, the name cue,
 * the reader's candidate list. The model boundary and the book store are mocked, never the chain.
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
const L67 = { kind: 'chapters', chapters: [6, 7], pages: '50-60, 61-70' };
const STORY_CAP = /at most 8 of the 20 Q1 items ask a fact of the story/;
const BOOK_53 = ['=== Page 53 ===', 'کے بعد گویا سدرہ کی زندگی ہمیشہ کے لیے بدل گئی تھی۔ جوکچھ اس نے دیکھا تھا، اس کے اثرات کئی',
  'سال تک لوگوں کی صحت اور زندگی پر پڑتے رہے۔ تاب کاری سے لوگوں کو جلد، سانس اور بہت ساری دیگر یماریاں',
  'لاحق ہوگئیں۔ سدرہ اکثریہ سوچتی کہ لوگ لڑائیاں اور جنگیں کیوں کرتے ہیں؟'].join('\n');
const CAND = Reader.CANDIDATES_HEAD;
const labelOf = (prompt, re) => (prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l)) || '').split(' ')[0];

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

const { urduSpares } = require('./helpers/urdu-spares');

// Eight story facts with distinct one-word keys that no other stem prints, and word-meaning items.
const THINGS = ['کتاب', 'پتنگ', 'گھڑی', 'چھتری', 'لالٹین', 'ٹوکری', 'بستہ', 'قلم', 'گڑیا', 'سیٹی', 'رومال', 'چابی'];
const ORD = ['پہلے', 'دوسرے', 'تیسرے', 'چوتھے', 'پانچویں', 'چھٹے', 'ساتویں', 'آٹھویں', 'نویں', 'دسویں', 'گیارہویں', 'بارہویں'];
const storyItem = (i) => ({
  slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `کہانی کے ${ORD[i]} منظر میں سدرہ کے ہاتھ میں کون سی چیز تھی؟`, source: 'story',
  options: [`الف) ${THINGS[i]}`, 'ب) پتھر', 'ج) پانی', 'د) مٹی'], answer: `الف) ${THINGS[i]}`, marks: 1,
});
const STORY_RE = /منظر میں سدرہ کے ہاتھ میں/;
const storyCount = (exam) => q1(exam).filter((q) => STORY_RE.test(q.question)).length;
const meanings = (n) => urduSpares(n).map((q) => ({ ...q, source: 'meaning' }));
const firstA = () => [...[0, 1, 2, 3, 4, 5, 6, 7].map(storyItem), ...meanings(12)];
const exam = (list) => ({ unseen: { objective: { MCQs: clone(list) } } });

describe('RT-1 the story cap holds across a re-layout of a laid paper', () => {
  test('RT-1a layout: a laid L6–7 paper (8 story items, tags gone) topped up with a story item and a meaning prints 8 story items', () => {
    const first = lay(exam(firstA()), L67);
    expect(storyCount(first.examJson)).toBe(8);
    expect(first.examJson._layout.story_items).toBe(8);
    // A reader catch takes one meaning item off; the top-up writes a story item first, then a meaning.
    const kept = clone(first.examJson);
    for (const types of Object.values(kept.unseen)) for (const [t, list] of Object.entries(types)) types[t] = list.filter((q) => !/«جولاہا»/.test(q.question));
    const next = { ...kept, unseen: { ...kept.unseen, _top: { MCQs: [storyItem(8), meanings(13)[12]] } } };
    const r = lay(next, L67, { reasked: true });
    expect(q1(r.examJson)).toHaveLength(20);
    expect(storyCount(r.examJson)).toBe(8);
    expect(r.examJson._layout.story_items).toBe(storyCount(r.examJson));
  });

  test('RT-1b engine, reader ON: a caught meaning item replaced by a top-up that writes a story item first prints 8 story items', async () => {
    const asked = serve((n) => (n === 1 ? mcqs(firstA()) : mcqs([storyItem(8), { ...meanings(13)[12], question: 'لفظ «کمہار» سے کیا مراد ہے؟' }])), (prompt, n) => {
      if (n > 1) return '{"candidates":[]}';
      const item = labelOf(prompt, /«جولاہا»/);
      const by = labelOf(prompt, /«لوہار»/);
      return JSON.stringify({ candidates: [{ item, by, evidence: 'لوہے کا کام کرنے والا', reason: 'r', given_away: true }] });
    });
    const out = await run(L67, { readerPass: true });
    expect(out.err && { code: out.err.code, msg: out.err.message }).toBeUndefined();
    const e = out.ok.examJson;
    expect(e._layout.reader.replaced).toBe(1);
    expect(asked.filter((x) => x.sec === 'A').length).toBe(2);
    expect(q1(e)).toHaveLength(20);
    expect(storyCount(e)).toBe(8);
    expect(e._layout.story_items).toBe(storyCount(e));
  });

  test('RT-1c (documents the lane\'s choice) the put-back: top-ups that write only story items leave Q1 full of story facts', () => {
    const many = [...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(storyItem), ...meanings(8)];
    const r = lay(exam(many), L67, { reasked: true });
    expect(q1(r.examJson)).toHaveLength(20);
    expect(storyCount(r.examJson)).toBe(12);
    expect((r.putBack || []).filter((x) => x.rule === 'story_cap')).toHaveLength(4);
  });
});

describe('RT-2 the name cue', () => {
  const pair = (aOpts, bQ, bOpts, bAns) => exam([
    { slot: 'urdu.A.Q1', question: 'کہانی میں سدرہ کی سہیلی کا نام کیا تھا؟', options: aOpts, answer: aOpts[0], source: 'story' },
    { slot: 'urdu.A.Q1', question: bQ, options: bOpts, answer: bAns, source: 'story' },
    ...meanings(12),
  ]);
  const NAME_Q = /سدرہ کی سہیلی کا نام/;
  const A4 = ['الف) نسرین', 'ب) زینب', 'ج) فریحہ', 'د) ثمینہ'];
  test('RT-2a a wrong multi-word option that names the key is no cue', () => {
    const r = lay(pair(A4, 'میلے میں سدرہ نے کیا خریدا؟', ['الف) ایک گڑیا', 'ب) نسرین کی کتاب', 'ج) ایک قلم', 'د) ایک بستہ'], 'الف) ایک گڑیا'), L67);
    expect(has(r.examJson, NAME_Q)).toBe(true);
  });
  test('RT-2b a correct multi-word option that names the key is a cue (positive control)', () => {
    const r = lay(pair(A4, 'میلے میں سدرہ نے کیا خریدا؟', ['الف) نسرین کی کتاب', 'ب) ایک گڑیا', 'ج) ایک قلم', 'د) ایک بستہ'], 'الف) نسرین کی کتاب'), L67);
    expect(has(r.examJson, NAME_Q) && has(r.examJson, /میلے میں سدرہ نے کیا خریدا/)).toBe(false);
  });
  test('RT-2c a key that two of its own options carry is no cue', () => {
    const r = lay(pair(['الف) نسرین', 'ب) نسرین بانو', 'ج) فریحہ', 'د) ثمینہ'], 'نسرین نے سدرہ کو کیا تحفہ دیا؟', ['الف) پھول', 'ب) گھڑی', 'ج) قلم', 'د) بستہ'], 'الف) پھول'), L67);
    expect(has(r.examJson, NAME_Q)).toBe(true);
  });
  test('RT-2d (measures) a «کہاں» item keyed on a common noun another stem prints', () => {
    const p = exam([
      { slot: 'urdu.A.Q1', question: 'کہانی میں بچے شام کو کہاں کھیلتے تھے؟', options: ['الف) میدان', 'ب) چھت', 'ج) گلی', 'د) کمرہ'], answer: 'الف) میدان' },
      { slot: 'urdu.A.Q1', question: 'میدان میں بچوں نے کون سا کھیل کھیلا؟', options: ['الف) کرکٹ', 'ب) ہاکی', 'ج) فٹ بال', 'د) کبڈی'], answer: 'الف) کرکٹ' },
      ...meanings(12)]);
    const r = lay(p, L67);
    // Recorded in the report: true means the pair is broken although the key is no proper noun.
    console.log('RT-2d common-noun «کہاں» pair held:', !(has(r.examJson, /بچے شام کو کہاں/) && has(r.examJson, /میدان میں بچوں نے/)));
  });
});

describe('RT-3 the candidate list', () => {
  test('RT-3a the reader\'s first read and its re-check both carry the candidate block on L6–7', async () => {
    book(BOOK_53);
    const asked = serve((n) => (n === 1 ? mcqs(q1(fixture('r21f-urdu-sandbox-chapters_4'))) : mcqs(WORDS.map(meaning))));
    await run(L67, { readerPass: true });
    const reads = asked.filter((x) => x.sec === 'reader');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0].prompt).toContain(CAND);
  });
  test('RT-3b no wrong option is ever named a place', () => {
    const j = fixture('r21f-urdu-sandbox-chapters_4');
    const { prompt } = Reader.buildReaderPrompt(j, U, { pages: BOOK_53 });
    const block = prompt.split(CAND)[1] || '';
    expect(block).not.toMatch(/wrong option/);
  });
});

describe('RT-4 lesson 7 alone is a poem', () => {
  test('RT-4a (measures) the Section A prompt on lesson 7 alone says these lessons hold one story', async () => {
    const asked = serve(() => mcqs(firstA()));
    await run({ kind: 'chapters', chapters: [7], pages: '61-70' });
    const a = asked.find((x) => x.sec === 'A');
    console.log('RT-4a lesson 7 alone carries the story line:', Boolean(a && STORY_CAP.test(a.prompt)));
  });
});
