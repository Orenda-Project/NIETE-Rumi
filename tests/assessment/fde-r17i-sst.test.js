/**
 * Social Studies, round 9:
 *   2. Q1 asks for at least 16 Remember items and at most 2 Understand (FDE's own Q1 is 20 recall), and the
 *      section loses its «3 to 5 pure recall» lines; the log reads Q1 by the model's tags and by its stems.
 *   3. A Q6 is a decision: advice written «دو مشورے دیں» keeps an item, a relay with a colon is a relay, and
 *      a Q6 that only asks to tell someone what a place or a system is like is recall.
 *   4. A Q1 item a C/D stem gives away: a date key needs no topic word, and a stem that glosses the key
 *      («ایوانِ زیریں (قومی اسمبلی)») gives a concept key away too. «کسی», «کوئی» are no topic.
 *   5. Section D's re-asks are told Q1's answers, never to print one in a stem.
 *   6. Two Q1 items keyed the same from one line of the book's p.29 table are one question.
 *   7. «رب» in a name («رب نواز») is not the premise.
 *   8. Q7: the prompt names the shapes every child knows; a Q7 whose answer is in its own stem is held.
 *   9. A spare's label never prints; Section B's topics lose a «ذہنی نقشہ», a bracketed instruction and
 *      an Urdu-digit count.
 * The papers are local model output; the people in their stories are the model's own.
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
  loadPageRangeContent: async ({ pageRanges }) => ({ content: '=== Page 4 ===\nسبق کا متن', pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');

const PRESET = Patterns.get('fde_g5_2027');
const SST = PRESET.subjects.social_studies;
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const lay = (exam, reasked = false) => applyLayout(clone(exam), SST, scopeOf(exam), { reasked, now: 'T' });
const heldRules = (laid, stem) => laid.held.filter((h) => h.q && h.q.question === stem).map((h) => h.rule);
const repeatRules = (laid, stem) => laid.repeated.filter((h) => h.q && h.q.question === stem).map((h) => h.rule);
const printed = (laid, slot) => items(laid.examJson, slot).map((q) => q.question);
const prompt = (S, sec, subject) => Gen.buildPatternUserPrompt({
  grade: 5, subject, pageContent: 'متن', pageReference: '1-9', section: sec, slots: sec.slots, lang: 'ur', P: S, scope: { kind: 'fde' },
});
const sec = (id) => SST.sections.find((s) => s.id === id);
const OTHERS = ['maths', 'science', 'english', 'urdu'];
const Q1 = 'social_studies.A.Q1';
const Q5 = 'social_studies.C.Q5';
const Q6 = 'social_studies.D.Q6';
const Q7 = 'social_studies.D.Q7';
const local = (name) => fixture(`r17i-sst-local-${name}`);

const Q1_BANDS = 'Q1: at least 16 Remember items and at most 2 Understand; any other Q1 item is Apply (a situation the child decides).';
const Q7_COMMON = 'A Q7 item is never a fact every Grade 5 child knows without the book (the year Pakistan was made, its capital, its national language, washing hands before eating, that television shows pictures, the name of a social media app); it asks a fact these pages teach.';

const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (text) => text.includes(Reader.READER_MARK);
const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((s) => text.includes(`"slot": "social_studies.${s}.`));
const logged = (name) => mockLog.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

async function replay(rec, { edit = null } = {}) {
  const r = clone(rec);
  if (edit) edit(r);
  const queue = { A: [...r.replies.A], B: [...r.replies.B], C: [...r.replies.C], D: [...r.replies.D] };
  const asked = [];
  mockCreate.mockReset();
  mockLog.mockReset();
  mockCreate.mockImplementation(async (req) => {
    const text = textOf(req);
    if (isReader(text)) {
      asked.push({ sec: 'reader', text });
      return { choices: [{ message: { content: JSON.stringify({ candidates: [] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    }
    const s = sectionOf(text);
    asked.push({ sec: s, text });
    const content = queue[s].length > 1 ? queue[s].shift() : queue[s][0];
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const out = await Gen.generatePatternExam({
    grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: r.scope, pageRanges: r.scope.pages, requestId: 'req-r17i', readerPass: false,
  }).catch((e) => ({ error: e }));
  return { asked, out };
}
const FRESH_A = fixture('sst-a-reask-fresh').reply;

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); });

describe('2. Q1: at least 16 Remember, at most 2 Understand; the recall lines agree', () => {
  test('Section A carries the counts and no «3 to 5» recall line', () => {
    const A = prompt(SST, sec('A'), 'social_studies');
    expect(A).toContain(Q1_BANDS);
    expect(A).toContain('at least 16 of them pure recall');
    expect(A).not.toContain('3 to 5 pure recall');
    expect(A).not.toContain('include 3–5 straight recall MCQs');
    expect(A).not.toContain('at least 12 Remember');
  });

  test('B, C, D and every other subject keep what they had', () => {
    for (const id of ['B', 'C', 'D']) expect(prompt(SST, sec(id), 'social_studies')).not.toContain(Q1_BANDS);
    const science = PRESET.subjects.science.sections.find((s) => s.slots.some((x) => x.shape === 'mcq'));
    expect(prompt(PRESET.subjects.science, science, 'science')).toContain('include 3–5 straight recall MCQs');
  });

  test('through the engine: the log counts Q1 by the model\'s tags against the new counts, and by its stems', async () => {
    const { out } = await replay(fixture('r17g-sst-replies-chapters_2'), { edit: (r) => r.replies.A.push(FRESH_A) });
    expect(out.error).toBeUndefined();
    const [line] = logged('[assessment] q1 levels');
    const q1 = items(out.examJson, Q1);
    const n = (b) => q1.filter((q) => q.blooms === b).length;
    expect(line).toEqual(expect.objectContaining({
      remember: n('Remember'), understand: n('Understand'), apply: n('Apply'),
      meets: n('Remember') >= 16 && n('Understand') <= 2,
    }));
    expect(line.by_stem).toEqual(expect.objectContaining({ remember: expect.any(Number), understand: expect.any(Number), apply: expect.any(Number) }));
    expect(line.by_stem.remember + line.by_stem.understand + line.by_stem.apply).toBe(q1.length);
  });

  test.each([
    ['قرارداد پاکستان کس سال منظور ہوئی؟', 'remember'],
    ['جمہوریت کو بہترین طرزِ حکومت کیوں سمجھا جاتا ہے؟', 'understand'],
    ['آپ کے محلے میں گلیوں کا گندا پانی نکالنے کا مسئلہ ہے۔ آپ کو کس حکومت سے رابطہ کرنا چاہیے؟', 'apply'],
  ])('a stem «%s» reads as %s', (question, level) => {
    expect(Gen.sstStemLevel({ question })).toBe(level);
  });
});

describe('3. a Q6 is a decision', () => {
  const full1 = local('full_1');
  const ch6 = local('chapters_6');
  const zara = items(full1, Q6)[4];
  const sana = items(ch6, Q6)[2];
  const withQ6 = (stem) => { const e = clone(full1); items(e, Q6)[4].question = stem; return e; };

  test('setup: full_1 Q6 5 «زارا کو بتائیں کہ وہاں موسم کیسا ہو گا …», chapters_6 Q6 3 «… موازنہ کرتے ہوئے بتائیں کہ …»', () => {
    expect(zara.question).toContain('زارا کو بتائیں کہ وہاں موسم کیسا');
    expect(sana.question).toContain('موازنہ کرتے ہوئے بتائیں کہ');
  });

  test('both are held as recall: they ask to tell what a place or a system is like', () => {
    expect(heldRules(lay(full1, true), zara.question)).toEqual(['tells_what']);
    expect(heldRules(lay(ch6, true), sana.question)).toEqual(['tells_what']);
    expect(printed(lay(full1, true), Q6)).not.toContain(zara.question);
  });

  test('D\'s re-ask is told why', () => {
    const laid = lay(full1, false);
    const note = takenNote(SST, sec('D'), laid.examJson, { held: laid.held });
    expect(note).toContain(zara.question.trim());
    expect(note).toContain('only asks to tell someone what a place or a system is like');
  });

  test.each([
    'زینب جاننا چاہتی ہے کہ ووٹ دیتے وقت کن باتوں کا خیال رکھے، آپ اسے دو مشورے دیں کہ وہ کیا کرے اور کیوں۔',
    'زینب جاننا چاہتی ہے کہ ووٹ دیتے وقت کن باتوں کا خیال رکھے؟ آپ اسے دو مشورے دیں اور ہر ایک کی وجہ بتائیں۔',
    'احمد کو بتائیں کہ اسے سیلاب کے وقت کیا کرنا چاہیے اور کیوں۔',
    'سارہ کے گاؤں میں صاف پانی نہیں ہے۔ سارہ کو بتائیں کہ وہ کس سے بات کرے اور کیا کہے۔',
  ])('advice keeps an item: «%s»', (stem) => {
    const rules = heldRules(lay(withQ6(stem), true), stem);
    expect(rules).not.toContain('asks_frame');
    expect(rules).not.toContain('tells_what');
  });

  test('a relay with a colon is a relay', () => {
    const stem = 'علی نے استاد سے پوچھا: زلزلہ کیا ہوتا ہے اور کیوں آتا ہے؟ آپ علی کو مفصل جواب دیں۔';
    expect(heldRules(lay(withQ6(stem), true), stem)).toEqual(['asks_frame']);
  });
});

describe('4. key_in_stem: a date needs no topic word; a gloss gives a concept away; «کسی» is no topic', () => {
  const pairs = [
    ['chapters_4', 'قرارداد پاکستان کس سال منظور ہوئی؟'],
    ['chapters_5', 'قرارداد پاکستان کب منظور ہوئی؟'],
    ['chapters_6', 'ایوانِ زیریں کا دوسرا نام کیا ہے؟'],
    ['chapters_5', 'ایک بادشاہ یا ملکہ کے ملک چلانے کا نظام کہلاتا ہے:'],
  ];
  test.each(pairs)('%s Q1 «%s» is held and never prints', (name, stem) => {
    const e = local(name);
    expect(items(e, Q1).map((q) => q.question)).toContain(stem);
    const laid = lay(e, true);
    expect(heldRules(laid, stem)).toEqual(['key_in_stem']);
    expect(printed(laid, Q1)).not.toContain(stem);
  });

  test('the C/D items that give them away are untouched', () => {
    for (const [name] of pairs) {
      const e = local(name);
      const laid = lay(e, true);
      for (const slot of [Q5, Q6, Q7]) expect(printed(laid, slot)).toEqual(printed(lay(e, true), slot));
    }
  });

  test('a body named for its work, with no gloss, is no gloss: only the named-key rule holds it', () => {
    const e = local('chapters_6');
    const q5 = items(e, Q5).find((q) => q.question.includes('ایوانِ زیریں (قومی اسمبلی)'));
    q5.question = 'ایوانِ بالا اور قومی اسمبلی میں دو فرق بیان کریں۔';
    // The stem names the key «قومی اسمبلی» (one option of four), which tells the child the option to pick.
    expect(heldRules(lay(e, true), 'ایوانِ زیریں کا دوسرا نام کیا ہے؟')).toEqual(['key_named_in_stem']);
  });

  test('«کسی» is no topic: a tax Q6 does not give «بغیر تصدیق … خبر … → نقصان» away', () => {
    const e = local('chapters_2');
    const q1 = items(e, Q1)[0];
    q1.question = 'کسی خبر کو بغیر تصدیق آگے بھیجنے سے کیا ہوتا ہے؟';
    q1.answer = 'ب) نقصان';
    q1.options = ['الف) فائدہ', 'ب) نقصان', 'ج) انعام', 'د) شہرت'];
    items(e, Q6)[0].question = 'کسی دکان دار نے ٹیکس نہیں دیا اور ٹریفک کا اشارہ بھی توڑا۔ اس سے ملک کو کیا نقصان ہوتا ہے؟ اسے کیا کرنا چاہیے؟';
    expect(heldRules(lay(e, true), q1.question)).toEqual([]);
  });
});

describe('5. Section D\'s re-asks are told Q1\'s answers, never to print one in a stem', () => {
  const LINE = 'Never print any of these Section A answers in a stem you write';

  test('D\'s note lists Q1\'s keys; C\'s and A\'s notes do not carry the line', () => {
    const e = local('chapters_5');
    const laid = lay(e, false);
    const D = takenNote(SST, sec('D'), laid.examJson, { held: laid.held, topUp: true, shortfall: [{ slot: Q7, missing: 2 }] });
    expect(D).toContain(LINE);
    expect(D).toContain('23 مارچ 1940ء');
    expect(D).toContain('شہنشاہیت');
    expect(takenNote(SST, sec('C'), laid.examJson, { held: laid.held }) || '').not.toContain(LINE);
  });

  test('through the engine: Section D\'s re-ask carries it', async () => {
    const { asked } = await replay(fixture('r17e-sst-replies-full_2'));
    const reasks = asked.filter((a) => a.sec === 'D').slice(1);
    expect(reasks.length).toBeGreaterThan(0);
    for (const a of reasks) expect(a.text).toContain(LINE);
  });
});

describe('6. two Q1 items keyed the same from one line of the book\'s table are one question', () => {
  const ch4 = local('chapters_4');
  const water = 'پینے کے پانی کا بندوبست کون سی حکومت دیکھتی ہے؟';
  const drains = 'آپ کے محلے میں گلیوں کا گندا پانی نکالنے کا مسئلہ ہے۔ آپ کو کس حکومت سے رابطہ کرنا چاہیے؟';

  test('chapters_4 Q1 12 ≡ 15: the second never prints', () => {
    const laid = lay(ch4, true);
    expect(printed(laid, Q1)).toContain(water);
    expect(printed(laid, Q1)).not.toContain(drains);
    expect(repeatRules(laid, drains)).toEqual(['same_line']);
  });

  test('two jobs of one government from different lines stay two', () => {
    const e = clone(ch4);
    items(e, Q1).find((q) => q.question === drains).question = 'مویشی منڈیاں اور عوامی میلے کون سی حکومت منعقد کرتی ہے؟';
    const laid = lay(e, true);
    expect(printed(laid, Q1)).toContain('مویشی منڈیاں اور عوامی میلے کون سی حکومت منعقد کرتی ہے؟');
    expect(printed(laid, Q1)).toContain(water);
  });
});

describe('7. «رب» in a name is not the premise', () => {
  const mk = (text) => ({ unseen: { subjective: { 'Short Questions': [{ slot: Q6, question: text, answer: 'جواب', scheme: { points: [{ kind: 'K', text: 'جواب', marks: 1 }] } }] } } });
  test.each([
    'رب نواز نے دکان کھولی اور ٹیکس نہیں دیا۔ اسے کیا کرنا چاہیے؟',
    'علی اور رب نواز نے پارک میں کچرا اٹھایا۔ ان کے کام کی دو اچھی باتیں بتائیں۔',
  ])('«%s» is not held', async (text) => {
    expect(await Gen.religiousFilter(mk(text), SST, { grade: 5, subject: 'social_studies' })).toEqual([]);
  });
  test.each(['سب کا رب ایک ہے', 'رب نے سب انسان برابر بنائے', 'اپنے رب کا شکر ادا کریں۔'])('«%s» is still held', async (text) => {
    expect((await Gen.religiousFilter(mk(text), SST, { grade: 5, subject: 'social_studies' })).map((d) => d.term)).toEqual(['رب']);
  });
});

describe('8. Q7 never asks what every child knows; a Q7 whose answer is in its own stem is held', () => {
  test('the D prompt names the shapes', () => {
    expect(prompt(SST, sec('D'), 'social_studies')).toContain(Q7_COMMON);
  });

  test('chapters_2 Q7 4 «… تحقیق میں کام آتا ہے؟ → تحقیقی مواد» is held', () => {
    const e = local('chapters_2');
    const stem = items(e, Q7)[3].question;
    expect(stem).toContain('تحقیق');
    const laid = lay(e, true);
    expect(heldRules(laid, stem)).toEqual(['key_in_own_stem']);
    expect(printed(laid, Q7)).not.toContain(stem);
  });

  test('D\'s re-ask is told why', () => {
    const e = local('chapters_2');
    const laid = lay(e, false);
    const note = takenNote(SST, sec('D'), laid.examJson, { held: laid.held });
    expect(note).toContain('prints its own answer in its question');
  });

  test('control: «… دنیا کی کون سی بڑی نمک کی کان ہے؟ → دنیا کی دوسری بڑی نمک کی کان» stays: «دوسری» is the fact', () => {
    const e = local('full_2');
    const q = items(e, Q7)[0];
    q.question = 'کھیوڑہ کی نمک کی کان دنیا کی کون سی بڑی نمک کی کان ہے؟';
    q.answer = 'دنیا کی دوسری بڑی نمک کی کان۔';
    expect(heldRules(lay(e, true), q.question)).not.toContain('key_in_own_stem');
  });

  test('controls: an answer that only restates its stem around a new fact stays', () => {
    const laid = lay(local('chapters_4'), true);
    for (const q of items(local('chapters_4'), Q7)) expect(heldRules(laid, q.question)).not.toContain('key_in_own_stem');
  });
});

describe('9. print hygiene', () => {
  test('full_2 C.Q5 7 prints without the spare\'s label', () => {
    const e = local('full_2');
    const q = items(e, Q5)[6];
    expect(q.question).toContain('سوال نمبر 5 کا اضافی سوال:');
    const laid = lay(e, true);
    expect(printed(laid, Q5)).toContain('کثیر الثقافتی معاشرے کے دو فوائد بیان کریں۔');
    expect(printed(laid, Q5).join('\n')).not.toContain('اضافی سوال');
  });

  test.each([
    ['جمہوریت کی اہمیت کے بارے میں 4 سے 6 شاخوں پر مشتمل ذہنی نقشہ (مائنڈ میپ) بنائیں۔', 'جمہوریت کی اہمیت'],
    ['جمہوریت کی اہمیت (مرکزی خیال کے گرد 4 سے 6 شاخیں بنا کر ہر شاخ میں ایک نکتہ لکھیں)', 'جمہوریت کی اہمیت'],
    ['اچھے شہری کی ذمہ داریاں پر ۴ سے ۶ شاخوں والا ذہنی خاکہ بنائیں۔', 'اچھے شہری کی ذمہ داریاں'],
  ])('B.Q4 «%s» prints its topic once', (stem, topic) => {
    const e = local('chapters_4');
    items(e, 'social_studies.B.Q4')[0].question = stem;
    expect(printed(lay(e, true), 'social_studies.B.Q4')).toEqual([topic]);
  });
});

describe('every other subject is untouched', () => {
  test('their prompts carry none of the new lines', () => {
    for (const key of OTHERS) {
      for (const s of PRESET.subjects[key].sections) {
        const p = prompt(PRESET.subjects[key], s, key);
        for (const line of [Q1_BANDS, Q7_COMMON]) expect(p).not.toContain(line);
      }
    }
  });
});
