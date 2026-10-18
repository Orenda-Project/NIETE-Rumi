/**
 * Social Studies, round 8, probes:
 *
 *   1. The religious premise written with no honorific is held too. Two recorded papers print it:
 *      local chapters_1 C.Q5 keys «… سب آدم و حوا کی اولاد ہیں» in its model answer, and local
 *      chapters_2 C.Q5 accepts «سب انسان حضرت آدم اور حضرت حوا کی اولاد ہیں»; neither carries
 *      «علیہ السلام» or «اللہ تعالیٰ». A child called «آدم», «حوالہ» and the names that carry «اللہ»
 *      or «رب» are other words.
 *   2. The reader pass never fails a paper for a Q1 item that its own Section D top-up gives away.
 *      A replacement whose stem prints a Q1 key on that item's topic holds the Q1 item, and Section A
 *      has no top-up after the reader: the paper was refused (PATTERN_SHORT_SLOT on Q1). That
 *      replacement is left out before the re-check instead; the Q1 item prints.
 *
 * The papers are local model output (people in them are the model's own fictional ones).
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 40 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const stems = (exam, slot) => items(exam, slot).map((q) => q.question);
const Q1 = 'social_studies.A.Q1';
const C5 = 'social_studies.C.Q5';
const D7 = 'social_studies.D.Q7';
const section = (id) => SST.sections.find((s) => s.id === id);
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const labelOf = (text, re) => { const l = text.split('\n').find((x) => /^Q\d\.\d+ /.test(x) && re.test(x)); return l ? l.split(' ')[0] : null; };
const filter = (exam) => Gen.religiousFilter(exam, SST, { grade: 5, subject: 'social_studies' });

function replyOf(exam, sectionId) {
  const tree = { unseen: {} };
  for (const slot of section(sectionId).slots) {
    ((tree.unseen[slot.category] ||= {})[slot.type] ||= []).push(...items(exam, slot.slot).map((q) => ({ ...q })));
  }
  return JSON.stringify(tree);
}

// The engine on a recorded paper: every section answers with its recorded reply, `reader(text, n)`
// answers the reader's calls and `topUp` the Section D call that carries the reader's note.
async function run(exam, { reader, topUp }) {
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      const n = asked.filter((a) => a === 'reader').length + 1;
      asked.push('reader');
      return { choices: [{ message: { content: await reader(text, n) }, finish_reason: 'stop' }], usage: { prompt_tokens: 9000, completion_tokens: 300, total_tokens: 9300 } };
    }
    const sec = sectionOf(text);
    asked.push(sec);
    const content = sec === 'D' && text.includes('A reader of this paper found') ? topUp : replyOf(exam, sec);
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: scopeOf(exam), pageRanges: '1-20', requestId: 'req-probe', readerPass: true,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('1. the religious premise with no honorific is held', () => {
  const mk = (text) => ({ slot: C5, question: 'سوال؟', answer: text, scheme: { points: [{ kind: 'K', text, marks: 1 }] } });
  const exam = (list) => ({ unseen: { subjective: { 'Short Questions': list } } });

  test('local chapters_1: the C.Q5 answered «… سب آدم و حوا کی اولاد ہیں» is dropped', async () => {
    const e = fixture('r15-sst-local-chapters_1');
    const stem = items(e, C5).find((q) => String(q.answer).includes('آدم و حوا')).question;
    const dropped = await filter(e);
    expect(dropped.map((d) => [d.slot, d.term])).toEqual([[C5, 'آدم و حوا']]);
    expect(stems(e, C5)).not.toContain(stem);
  });

  test('local chapters_2: the C.Q5 that accepts «سب انسان حضرت آدم اور حضرت حوا کی اولاد ہیں» is dropped', async () => {
    const e = fixture('r17-sst-local-chapters_2');
    const stem = items(e, C5).find((q) => JSON.stringify(q.scheme || {}).includes('حضرت حوا')).question;
    const dropped = await filter(e);
    expect(dropped.map((d) => [d.slot, d.term])).toEqual([[C5, 'آدم و حوا']]);
    expect(stems(e, C5)).not.toContain(stem);
  });

  test.each([
    'سب انسان آدم اور حوا کی اولاد ہیں',
    'سب انسان آدمؑ و حواؑ کی اولاد ہیں',
    'سب انسان آدم وحوّا کی اولاد ہیں',
  ])('«%s» in a scheme point holds the item', async (text) => {
    expect((await filter(exam([mk(text)]))).map((d) => d.term)).toEqual(['آدم و حوا']);
  });

  test.each([
    'آدم نے اپنے محلے کا نقشہ بنایا تاکہ نئی ہم جماعت راستہ دیکھ سکے',
    'آئین کے حوالے سے دو باتیں لکھیں',
    'کتاب کا حوالہ دیں',
    'سر عبد اللہ ہارون نے سندھ میں تحریک کی قیادت کی',
    'قائد اعظم رحمۃ اللہ علیہ کی قیادت میں',
    'بیگم شائستہ اکرام اللہ',
    'سردار عبدالرب نشتر',
    'زلزلے کے دوران ایک آدمی اور حواس پر قابو رکھنا',
  ])('control: «%s» is not held', async (text) => {
    expect(await filter(exam([mk(text)]))).toEqual([]);
  });
});

describe('2. the reader pass never refuses a paper for a Q1 item its own D top-up gives away', () => {
  // Its Q1 «قانون بنانے کا اختیار کس ادارے کے پاس ہے؟ → مقننہ» is named by C.Q5 «مقننہ اور عدلیہ …»; an item no stem
  // names stands in, so these tests read the D top-up alone.
  const FULL = (() => {
    const e = fixture('r15-sst-local-full_2');
    Object.assign(items(e, Q1).find((q) => q.question === 'قانون بنانے کا اختیار کس ادارے کے پاس ہے؟'), {
      question: 'پاکستان کا قومی پھول کون سا ہے؟', options: ['الف) گلاب', 'ب) چنبیلی', 'ج) سورج مکھی', 'د) کنول'], answer: 'ب) چنبیلی',
    });
    // Its Q1 «پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام کون سی حکومت دیکھتی ہے؟ → مقامی حکومت» is stated by a Q6
    // that prints «مقامی حکومت» beside the water line and the drains, and is held; an item no stem states stands in.
    Object.assign(items(e, Q1).find((q) => q.question.startsWith('پینے کے پانی کا بندوبست')), {
      question: 'پاکستان کا قومی پرندہ کون سا ہے؟', options: ['الف) چکور', 'ب) طوطا', 'ج) کبوتر', 'د) مور'], answer: 'الف) چکور',
    });
    return e;
  })();
  const FLAGGED = 'آل انڈیا مسلم لیگ کب قائم ہوئی؟';
  const KEPT_Q1 = 'سندھ کو بمبئی سے الگ کر کے صوبہ کس سال بنایا گیا؟';
  const q7 = (question, answer, point) => ({
    main_question: 'درج ذیل میں سے کوئی چھ سوالات کے مختصر جواب دیں', question, answer, marks: 2, lines: 0, slot: D7, blooms: 'Remember',
    scheme: { points: [{ text: point, marks: 2, kind: 'K' }], accept: [answer.replace(/[۔.]$/, '')], common_error: 'کسی اور کا نام لکھنا' },
  });
  // Prints Q1's key «1936ء» beside its topic (سندھ، بمبئی، صوبہ); its own key is in no Q1 item.
  const GIVER = q7('1936ء میں سندھ کو بمبئی سے الگ کر کے صوبہ بنایا گیا۔ اکتوبر 1938ء میں سندھ صوبائی مسلم لیگ کے اجلاس میں آزاد مسلم ریاست کی قرارداد کس نے پیش کی؟', 'شیخ عبدالمجید سندھی نے۔', 'قرارداد شیخ عبدالمجید سندھی نے پیش کی');
  const CLEAN = q7('پاکستان کا سب سے بڑا ڈیم کون سا ہے؟', 'تربیلا ڈیم۔', 'تربیلا ڈیم کا درست نام');
  const tree = (list) => JSON.stringify({ unseen: { subjective: { 'Short Questions': list } } });
  const reader = async (text, n) => {
    if (n !== 1) return JSON.stringify({ candidates: [] });
    const item = labelOf(text, /آل انڈیا مسلم لیگ کب قائم/);
    return JSON.stringify({ candidates: [{ item, by: item, evidence: 'آل انڈیا مسلم لیگ', reason: 'own stem', given_away: true }] });
  };

  test('setup: the recorded paper lays out whole, Q1 prints its 1936ء item, and the flagged Q7 prints', () => {
    const laid = applyLayout(clone(FULL), SST, scopeOf(FULL), { reasked: true, now: 'T' });
    expect(laid.shortfall).toEqual([]);
    expect(stems(laid.examJson, Q1)).toContain(KEPT_Q1);
    expect(stems(laid.examJson, D7)).toContain(FLAGGED);
  });

  test('setup: in place of the flagged Q7, the giver holds that Q1 item (key_in_stem) and Q1 is short', () => {
    const e = clone(FULL);
    const list = Object.values(e.unseen.subjective).find((l) => l.some((q) => q.slot === D7));
    list.splice(list.findIndex((q) => q.question === FLAGGED), 1, clone(GIVER));
    const laid = applyLayout(e, SST, scopeOf(FULL), { reasked: true, now: 'T' });
    expect(laid.held.filter((h) => h.slot === Q1).map((h) => [h.rule, h.q.question])).toEqual([['key_in_stem', KEPT_Q1]]);
    expect(laid.shortfall).toEqual([{ slot: Q1, missing: 1 }]);
  });

  test('through the engine: the top-up\'s giver is left out, the paper is made, and the Q1 item prints', async () => {
    const { asked, out } = await run(FULL, { reader, topUp: tree([GIVER, CLEAN]) });
    expect(out.error && out.error.code).toBeUndefined();
    expect(stems(out.examJson, Q1)).toContain(KEPT_Q1);
    expect(stems(out.examJson, D7)).not.toContain(GIVER.question);
    expect(stems(out.examJson, D7)).not.toContain(FLAGGED);
    // The item that took the place is one the reader's re-check read.
    expect(stems(out.examJson, D7)).toContain(CLEAN.question);
    expect(asked.filter((a) => a === 'reader')).toHaveLength(2);
    expect(out.examJson._layout.reader).toEqual(expect.objectContaining({ gives_q1: 1 }));
  });

  test('a top-up with no giver is laid out as before: nothing is left out', async () => {
    const { out } = await run(FULL, { reader, topUp: tree([CLEAN]) });
    expect(out.error && out.error.code).toBeUndefined();
    expect(stems(out.examJson, D7)).toContain(CLEAN.question);
    expect(stems(out.examJson, Q1)).toContain(KEPT_Q1);
    expect(out.examJson._layout.reader.gives_q1).toBeUndefined();
  });

  test('a top-up that writes only the giver: the slot prints one fewer, never the giver, and the paper is made', async () => {
    const { out } = await run(FULL, { reader, topUp: tree([GIVER]) });
    expect(out.error && out.error.code).toBeUndefined();
    expect(stems(out.examJson, D7)).not.toContain(GIVER.question);
    expect(stems(out.examJson, Q1)).toContain(KEPT_Q1);
    expect(items(out.examJson, D7).length).toBe(7);
  });
});
