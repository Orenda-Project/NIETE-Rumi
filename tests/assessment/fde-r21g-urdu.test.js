/**
 * Urdu board-pattern papers, five more rules from the last round of sandbox papers (six papers, wider
 * scopes: lessons 4–5, 6–7, 8–9, 10 alone and the full syllabus):
 *
 * 1. Concept rows that missed. «… کون سا لفظ خوبی بیان کر رہا ہے؟» asks صفت and «جس چیز کی خوبی …» asks
 *    موصوف; on lessons 10 alone صفت printed twice. «"پاکیزہ" کا متضاد» printed on lessons 6–7, which teach
 *    no antonym: an antonym or a synonym item is a grammar concept on every scope, so there it is
 *    grammar from another lesson. The concept code reads in a stem and the concept Section A declares
 *    are one set: either one marks a concept, and a declared «ذخیرۂ الفاظ» never clears a stem code tags.
 * 2. Name cues code missed. (a) A name inside a key of several words, in no other option, printed in
 *    another stem, in a Section B–D stem or in a Section C word list («ایدھی فاؤنڈیشن میں …» beside «ایدھی
 *    صاحب نے …»; «قائدِ اعظم کے مزار …» beside «قائدِ اعظم نے …»; «کراچی» beside Q4's «ارادہ، کراچی»). (b) A
 *    reader replacement passes every code hold before it prints. (c) A رموزِ اوقاف item whose key mark
 *    ends its own stem («… کون سی علامت لگائی جاتی ہے؟» → ؟).
 * 3. Q4 takes one item of each of its four kinds (گروہی، شرط و جزا، حال → مستقبل، ارکان), in that order;
 *    a second گروہی never takes the ارکان place, and the Section C top-up is told which kind is missing.
 * 4. An MCQ with two right options: «مَن» and «من۔» are one word written twice.
 * 5. A Q1 item that asks the meaning or the use of a Q3/Q5 entry in another form of its verb («دم گھٹ
 *    رہا ہے» beside «دم گھٹنا»), or asks it as «… کسے کہتے ہیں؟» or «… کے لیے کون سا جملہ درست ہے؟».
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
const { applyLayout, takenNote, conceptOf } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const ch = (...n) => ({ kind: 'chapters', chapters: n, pages: null });
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const paper = (name) => fixture(`r21g-urdu-sandbox-${name}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const lay = (exam, scope, opts = {}) => applyLayout(clone(exam), U, scope, { now: 'x', ...opts });
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const isReader = (prompt) => prompt.includes(Reader.READER_MARK);
const sectionOf = (prompt) => ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1 = (exam) => items(exam, 'urdu.A.Q1');
const prints = (exam, re) => q1(exam).some((q) => re.test(q.question));
const holdsOf = (r) => r.examJson._layout.holds || [];
const held = (r, rule) => holdsOf(r).some((h) => h.slot === 'urdu.A.Q1' && h.rule === rule);
const mcq = (question, options, at = 0) => ({
  slot: 'urdu.A.Q1', question, options: options.map((o, i) => `${['الف', 'ب', 'ج', 'د'][i]}) ${o}`),
  answer: `${['الف', 'ب', 'ج', 'د'][at]}) ${options[at]}`, marks: 1,
});

// ── 1. Concept rows ────────────────────────────────────────────────────────────────────────────

describe('1. sandbox chapters_5 (lesson 10): صفت asked twice', () => {
  const p = paper('chapters_5');
  const NANHI = /ننھی چڑیا/;
  const SURKH = /سرخ غبارہ/;
  const PAHAR = /جس چیز کی خوبی بتائی گئی/;

  test('the paper as printed asks صفت in ۱۰ and ۱۷, and موصوف in ۱۱', () => {
    expect([NANHI, SURKH, PAHAR].every((re) => prints(p, re))).toBe(true);
  });

  test('«خوبی بیان کر …» tags صفت and «جس چیز کی خوبی …» tags موصوف (positive controls)', () => {
    const find = (re) => q1(p).find((q) => re.test(q.question));
    expect(conceptOf(find(NANHI))).toBe('adjective');
    expect(conceptOf(find(SURKH))).toBe('adjective');
    expect(conceptOf(find(PAHAR))).toBe('qualified');
  });

  test('the second صفت is held; the first and the موصوف item print, and Q1 is short by it (and by ۱۶, rule 5)', () => {
    const r = lay(p, ch(10));
    expect(prints(r.examJson, NANHI)).toBe(true);
    expect(prints(r.examJson, SURKH)).toBe(false);
    expect(prints(r.examJson, PAHAR)).toBe(true);
    expect(r.shortfall).toEqual([{ slot: 'urdu.A.Q1', missing: 2 }]);
  });

  test('after the re-ask the repeat never comes back', () => {
    const r = lay(p, ch(10), { reasked: true });
    expect(prints(r.examJson, SURKH)).toBe(false);
  });
});

describe('1. sandbox chapters_2 (lessons 6–7): an antonym is another lesson\'s grammar', () => {
  const p = paper('chapters_2');
  const PAK = /«پاکیزہ» کا متضاد/;

  test('the paper as printed asks it', () => {
    expect(prints(p, PAK)).toBe(true);
  });

  test('it is held as grammar outside the chosen lessons', () => {
    const r = lay(p, ch(6, 7), { reasked: true });
    expect(prints(r.examJson, PAK)).toBe(false);
    expect(r.held).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'grammar_outside_lessons', concept: 'antonym' })]));
  });

  test('on lessons 4–5, which teach it, it prints (control)', () => {
    const r = lay(p, ch(4, 5), { reasked: true });
    expect(prints(r.examJson, PAK)).toBe(true);
  });

  test('«… کا الٹ کون سا لفظ ہے؟» is the same concept', () => {
    expect(conceptOf(mcq('«روشن» کا الٹ کون سا لفظ ہے؟', ['تاریک', 'چمکدار', 'صاف', 'سفید']))).toBe('antonym');
  });
});

describe('1. the concept code reads and the concept Section A declares are one set', () => {
  // A full lessons 10 Section A: grammar and vocabulary from that lesson, each with its declared concept.
  const word = (w, k, i) => ({ ...mcq(`لفظ «${w}» سے کیا مراد ہے؟`, [k, 'پہاڑ کی چوٹی', 'آسمان کا رنگ', 'رات کا وقت']), concept: 'ذخیرۂ الفاظ / فہم', n: i });
  const WORDS = [['ڈائری', 'روزنامچہ'], ['ٹفن', 'کھانے کا ڈبا'], ['کینٹین', 'کھانے کی دکان'], ['بہانہ', 'حیلہ'], ['سرکس', 'تماشا'],
    ['آزمودہ', 'آزمایا ہوا'], ['کھسیانی', 'شرمندہ'], ['کرکرا', 'بے مزا'], ['لبریز', 'لبالب'], ['چہیتے', 'لاڈلے'],
    ['ہم جماعت', 'ساتھ پڑھنے والا'], ['دل جوئی', 'تسلی'], ['چوکور', 'چار کونوں والا'], ['تکونی', 'تین کونوں والا'],
    ['گیٹ', 'دروازہ'], ['ہوم ورک', 'گھر کا کام'], ['وائی فائی', 'بے تار رابطہ'], ['کیک', 'میٹھی ٹکیہ']];
  // Code tags this stem صفت; the reply declares it vocabulary.
  const STEM = { ...mcq('جملے «لمبی سڑک دور تک جاتی ہے» میں کون سا لفظ خوبی بیان کرتا ہے؟', ['لمبی', 'سڑک', 'دور', 'جاتی']), concept: 'ذخیرۂ الفاظ / فہم' };
  // Code tags nothing in this stem (it names no term); the reply declares صفت.
  const TAG = { ...mcq('جملے «میٹھا آم مزے دار ہے» میں «میٹھا» آم کے بارے میں کیا بتاتا ہے؟', ['آم کا ذائقہ', 'آم کا وزن', 'آم کی جگہ', 'آم کا وقت']), concept: 'صفت' };
  const tree = (list) => ({ unseen: { objective: { MCQs: clone(list) } } });

  test('code tags the first and not the second (the setup)', () => {
    expect(conceptOf(STEM)).toBe('adjective');
    expect(conceptOf(TAG)).toBeNull();
  });

  test('a declared صفت and a stem code tags صفت are one concept asked twice: the second never prints, even after the re-ask', () => {
    const r = lay(tree([TAG, ...WORDS.map(word), STEM]), ch(10), { reasked: true });
    expect(q1(r.examJson).some((q) => /لمبی سڑک/.test(q.question))).toBe(false);
    expect(q1(r.examJson).some((q) => /میٹھا آم/.test(q.question))).toBe(true);
  });

  test('two vocabulary items stay two (control)', () => {
    const r = lay(tree([...WORDS.map(word)]), ch(10));
    expect(q1(r.examJson)).toHaveLength(WORDS.length);
  });
});

// ── 2. Name cues ───────────────────────────────────────────────────────────────────────────────

describe('2(a). sandbox chapters_4 (lessons 8–9): «ایدھی» in a key of several words', () => {
  const p = paper('chapters_4');
  const AARZU = /سب سے بڑی آرزو/;

  test('the paper as printed: ۵ and ۱۵ name ایدھی; ۷\'s key is its only option that does', () => {
    expect(prints(p, /ڈاکو نے ایدھی صاحب/)).toBe(true);
    expect(prints(p, AARZU)).toBe(true);
  });

  test('۷ is held', () => {
    const r = lay(p, ch(8, 9), { reasked: true });
    expect(prints(r.examJson, AARZU)).toBe(false);
  });
});

describe('2(a). sandbox chapters_3 (lessons 4–5): «قائدِ اعظم» and «کراچی»', () => {
  const p = paper('chapters_3');
  const MAZAR = /کا مزار کہاں واقع ہے/;
  const SHEHR = /کس شہر میں پیدا ہوئیں/;

  test('the paper as printed has both', () => {
    expect(prints(p, MAZAR)).toBe(true);
    expect(prints(p, SHEHR)).toBe(true);
  });

  test('۲۰ (its key the only option naming قائدِ اعظم, whom ۱۵\'s stem names) is held', () => {
    const r = lay(p, ch(4, 5), { reasked: true });
    expect(prints(r.examJson, MAZAR)).toBe(false);
  });

  test('۱۱ (keyed «کراچی», which Q4\'s ارکان word list prints) is held against Section C', () => {
    const r = lay(p, ch(4, 5), { reasked: true });
    expect(prints(r.examJson, SHEHR)).toBe(false);
  });

  test('a name a WRONG option carries, printed elsewhere, is no cue (control)', () => {
    const exam = clone(p);
    const shehr = q1(exam).find((q) => SHEHR.test(q.question));
    // «کراچی» moved to a wrong option; the key is a city nothing else prints.
    shehr.options = ['الف) لاہور', 'ب) ملتان', 'ج) کراچی', 'د) کوئٹہ'];
    shehr.answer = 'د) کوئٹہ';
    const r = lay(exam, ch(4, 5), { reasked: true });
    expect(prints(r.examJson, SHEHR)).toBe(true);
  });

  test('an item that asks about a word is no name ask: its key printed elsewhere stays (control)', () => {
    const exam = clone(p);
    const shehr = q1(exam).find((q) => SHEHR.test(q.question));
    shehr.question = 'لفظ «شہر» کا مطلب کون سا لفظ بتاتا ہے؟';
    const r = lay(exam, ch(4, 5), { reasked: true });
    expect(prints(r.examJson, /لفظ «شہر» کا مطلب/)).toBe(true);
  });
});

describe('2(c). sandbox chapters_4: a punctuation key that ends its own stem', () => {
  const p = paper('chapters_4');
  const MARK = /سوال پوچھنے پر کون سی علامت/;

  test('the paper as printed asks «… کون سی علامت لگائی جاتی ہے؟» keyed ؟', () => {
    expect(prints(p, MARK)).toBe(true);
  });

  test('it is held', () => {
    const r = lay(p, ch(8, 9), { reasked: true });
    expect(prints(r.examJson, MARK)).toBe(false);
    expect(held(r, 'mark_ends_stem')).toBe(true);
  });

  test('a sentence printed without its mark stays (control)', () => {
    const exam = clone(p);
    const q = q1(exam).find((x) => MARK.test(x.question));
    q.question = 'جملے «کیا تم کل اسکول آؤ گے» کے آخر میں کون سی علامت لگے گی';
    const r = lay(exam, ch(8, 9), { reasked: true });
    expect(prints(r.examJson, /کیا تم کل اسکول آؤ گے/)).toBe(true);
  });
});

// ── 3. Q4: one item of each kind ───────────────────────────────────────────────────────────────

const q4 = (exam) => items(exam, 'urdu.C.Q4');
const KIND = [/گروہی/, /شرط|جزا/, /مستقبل/, /ارکان/];
const kindOf = (q) => KIND.findIndex((re) => re.test(`${q.main_question || ''} ${q.question || ''}`));

describe('3. sandbox full_1: Q4 printed گروہی twice and no ارکان', () => {
  const p = paper('full_1');

  test('the paper as printed', () => {
    expect(q4(p).map(kindOf)).toEqual([0, 1, 2, 0]);
  });

  test('the second گروہی never takes the ارکان place: Q4 is one short', () => {
    const r = lay(p, FDE, { reasked: true });
    expect(q4(r.examJson).map(kindOf)).toEqual([0, 1, 2]);
    expect(r.shortfall).toEqual(expect.arrayContaining([{ slot: 'urdu.C.Q4', missing: 1 }]));
  });

  test('the Section C top-up is told the kind Q4 is missing', () => {
    const r = lay(p, FDE);
    const C = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.C.Q4'));
    const note = takenNote(U, C, r.examJson, { topUp: true, shortfall: r.shortfall });
    expect(note).toMatch(/ارکان سازی/);
    expect(note).not.toMatch(/Q4 needs[^\n]*گروہی/);
  });

  test('a paper with the four kinds lays Q4 out as it was (control)', () => {
    const four = paper('chapters_3');
    const r = lay(four, ch(4, 5), { reasked: true });
    expect(q4(r.examJson)).toEqual(q4(four).map((q) => ({ ...q })));
  });

  test('a reply that writes the kinds out of order prints them in FDE\'s order', () => {
    const exam = clone(paper('chapters_3'));
    for (const list of Object.values(exam.unseen.subjective)) {
      const at = list.findIndex((q) => q.slot === 'urdu.C.Q4');
      if (at >= 0) list.splice(at, 4, ...list.slice(at, at + 4).reverse());
    }
    const r = lay(exam, ch(4, 5), { reasked: true });
    expect(q4(r.examJson).map(kindOf)).toEqual([0, 1, 2, 3]);
  });
});

// ── 4. Two right options ───────────────────────────────────────────────────────────────────────

describe('4. sandbox full_1: «مَن» and «من۔»', () => {
  const p = paper('full_1');
  const MAN = /چالیس کلو/;

  test('the paper as printed', () => {
    expect(prints(p, MAN)).toBe(true);
  });

  test('it is held', () => {
    const r = lay(p, FDE, { reasked: true });
    expect(prints(r.examJson, MAN)).toBe(false);
    expect(held(r, 'two_right_options')).toBe(true);
  });

  test.each([
    [['مَن', 'مِن', 'مان', 'مین']],
    [['سَحَر', 'سِحر', 'سحری', 'ساحر']],
    [['مَن', 'مَنّ', 'مان', 'منا']],
  ])('distinct words that differ by their marks, every one marked, stay (control): %j', (options) => {
    const exam = clone(p);
    const q = q1(exam).find((x) => MAN.test(x.question));
    q.options = options.map((o, i) => `${['الف', 'ب', 'ج', 'د'][i]}) ${o}`);
    q.answer = q.options[0];
    const r = lay(exam, FDE, { reasked: true });
    expect(prints(r.examJson, MAN)).toBe(true);
  });
});

// ── 5. Q3/Q5 entries in another form ───────────────────────────────────────────────────────────

describe('5. a Q1 item on a Q3/Q5 entry in another form, or asked as its use', () => {
  test.each([
    ['chapters_1', ch(6, 7), /میرا دم گھٹ رہا ہے/, '«دم گھٹ رہا ہے» beside Q5 «دم گھٹنا»'],
    ['chapters_3', ch(4, 5), /"ہراول دستہ" کسے کہتے ہیں/, '«"ہراول دستہ" کسے کہتے ہیں؟» beside Q5 «ہراول دستہ»'],
    ['chapters_5', ch(10), /«صبر کا پیمانہ لبریز ہونا» کے لیے کون سا جملہ/, '«… کے لیے کون سا جملہ درست ہے؟» beside Q5'],
  ])('sandbox %s: %s is held (%s)', (name, scope, re) => {
    const p = paper(name);
    expect(prints(p, re)).toBe(true);
    const r = lay(p, scope, { reasked: true });
    expect(prints(r.examJson, re)).toBe(false);
  });

  test('«دل لگنا» and «دل لگانا» stay two idioms (control)', () => {
    const exam = clone(paper('chapters_1'));
    const five = items(exam, 'urdu.C.Q5')[0];
    five.words = five.words.map((w) => (w === 'دم گھٹنا' ? 'دل لگانا' : w));
    const q = q1(exam).find((x) => /میرا دم گھٹ رہا ہے/.test(x.question));
    q.question = 'ندی جب کہتی ہے کہ اب میرا دل لگ رہا ہے تو اس سے کیا مراد ہے؟';
    const r = lay(exam, ch(6, 7), { reasked: true });
    expect(prints(r.examJson, /میرا دل لگ رہا ہے/)).toBe(true);
  });
});

// ── The engine ─────────────────────────────────────────────────────────────────────────────────

// Lessons 4–5: Section B and C as recorded, Section A a fictional reply of word meanings.
const rec = fixture('r18-urdu-refused-chapters1');
const L45 = rec.scope;
const REPLY_B = rec.replies.B;
const REPLY_C = rec.replies.C.split('کی عادت اپنانی چاہیے').join('کی عادت ڈالنی ہو گی');
const WORDS = [['دریا', 'پانی کا بڑا بہاؤ'], ['کتب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'],
  ['درزی', 'کپڑے سینے والا'], ['نانبائی', 'روٹی پکانے والا'], ['موچی', 'جوتے بنانے والا'], ['کسان', 'کھیتی باڑی کرنے والا'],
  ['مچھیرا', 'مچھلیاں پکڑنے والا'], ['ڈاکیا', 'خط پہنچانے والا'], ['معمار', 'عمارت بنانے والا'], ['جولاہا', 'کپڑا بننے والا'],
  ['لوہار', 'لوہے کا کام کرنے والا'], ['سنار', 'زیور بنانے والا'], ['بڑھئی', 'لکڑی کا کام کرنے والا'], ['حلوائی', 'مٹھائی بنانے والا'],
  ['کمہار', 'مٹی کے برتن بنانے والا'], ['مالی', 'پودوں کو پانی دینے والا'], ['چوکیدار', 'رات کو پہرا دینے والا'],
  ['ملاح', 'کشتی چلانے والا'], ['پنساری', 'مصالحے بیچنے والا'], ['جراح', 'زخموں کا علاج کرنے والا']];
const meaning = ([w, k]) => ({
  slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» سے کیا مراد ہے؟`,
  options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1, concept: 'ذخیرۂ الفاظ / فہم',
});
// A kept item whose stem names ایدھی, and a replacement keyed on the only option that names him.
const EDHI = {
  slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: 'ایدھی صاحب نے اپنی زندگی کی کمائی سے کیا بنایا؟',
  options: ['الف) بڑا کارخانہ', 'ب) نیا بازار', 'ج) خوب صورت باغ', 'د) چھوٹی ڈسپنسری'], answer: 'د) چھوٹی ڈسپنسری', marks: 1, concept: 'ذخیرۂ الفاظ / فہم',
};
const CUE = {
  slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: 'عبدالشکور کی سب سے بڑی آرزو کیا ہے؟',
  options: ['الف) بڑا کاروبار کرنا', 'ب) کھلاڑی بننا', 'ج) بیرون ملک جانا', 'د) ایدھی فاؤنڈیشن میں لوگوں کی مدد کرنا'],
  answer: 'د) ایدھی فاؤنڈیشن میں لوگوں کی مدد کرنا', marks: 1, concept: 'ذخیرۂ الفاظ / فہم',
};
const mcqs = (list) => JSON.stringify({ unseen: { objective: { MCQs: clone(list) } } });

function book() {
  const c = JSON.parse(REPLY_C);
  const q6 = Object.values(c.unseen.subjective || {}).flat().find((q) => q && q.slot === 'urdu.C.Q6');
  const content = ['=== Page 63 ===', 'ندی کی فریاد', ...String((q6 && q6.passage) || '').split('\n')].join('\n\n');
  mockPages.mockImplementation(async ({ pageRanges } = {}) => ({ content, pageReference: String(pageRanges || '28') }));
}
function serve({ a, c = () => REPLY_C, reader = null }) {
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
    const content = sec === 'A' ? a(n, prompt) : sec === 'B' ? REPLY_B : c(n, prompt);
    return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
  });
  return asked;
}
const run = (scope, extra = {}) => Gen.generatePatternExam({
  grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope, pageRanges: scope.pages || null, requestId: 'req-r21g', ...extra,
}).then((ok) => ({ ok }), (err) => ({ err }));

beforeEach(() => { mockCreate.mockReset(); mockLog.mockReset(); mockPages.mockReset(); book(); });

describe('2(b). the engine: a reader replacement passes every code hold before it prints', () => {
  test('the reader catches one item; the top-up\'s first item names ایدھی as its key only: it never prints, the clean one does', async () => {
    const full = [EDHI, ...WORDS.slice(0, 19).map(meaning)];
    const asked = serve({
      a: (n) => (n === 1 ? mcqs(full) : mcqs([CUE, meaning(WORDS[19]), meaning(WORDS[20])])),
      reader: (prompt, n) => {
        if (n > 1) return '{"candidates":[]}';
        const label = (re) => prompt.split('\n').find((l) => /^Q1\.\d+ /.test(l) && re.test(l)).split(' ')[0];
        return JSON.stringify({ candidates: [{ item: label(/«درزی»/), by: label(/«دریا»/), evidence: 'دریا', reason: 'test', given_away: true }] });
      },
    });
    const out = await run(L45, { readerPass: true });
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    expect(asked.filter((x) => x.sec === 'A').length).toBeGreaterThan(1);
    expect(prints(out.ok.examJson, /سب سے بڑی آرزو/)).toBe(false);
    expect(prints(out.ok.examJson, /«درزی»/)).toBe(false);
    expect(prints(out.ok.examJson, /«پنساری»/)).toBe(true);
    expect(q1(out.ok.examJson)).toHaveLength(20);
  });
});

describe('3. the engine: Section C writes گروہی twice and no ارکان', () => {
  // The recorded Section C with its ارکان item swapped for a second گروہی item.
  const twoGroups = () => {
    const c = JSON.parse(REPLY_C);
    for (const list of Object.values(c.unseen.subjective)) {
      const at = list.findIndex((q) => q.slot === 'urdu.C.Q4' && /ارکان/.test(`${q.main_question} ${q.question}`));
      if (at >= 0) {
        list[at] = {
          ...list[at], main_question: 'گروہی الفاظ', question: 'درج ذیل الفاظ کے لیے درست گروہی لفظ منتخب کریں: آم، کیلا، سیب، انگور۔',
          options: ['الف) پھل', 'ب) سبزی', 'ج) پرندے', 'د) کپڑے'], answer: 'الف) پھل', scheme: { points: [{ text: 'درست گروہی لفظ', marks: 1.25, kind: 'A' }], accept: ['الف) پھل'] },
        };
      }
    }
    return JSON.stringify(c);
  };

  test('Section C is asked again, told ارکان سازی is missing; Q4 prints its four kinds in order', async () => {
    const asked = serve({ a: () => mcqs(WORDS.slice(0, 20).map(meaning)), c: (n) => (n === 1 ? twoGroups() : REPLY_C) });
    const out = await run(L45);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const cs = asked.filter((x) => x.sec === 'C');
    expect(cs).toHaveLength(2);
    expect(cs[1].prompt).toMatch(/ارکان سازی/);
    expect(q4(out.ok.examJson).map(kindOf)).toEqual([0, 1, 2, 3]);
  });
});

describe('2(c). the Section A prompt', () => {
  test('asks a رموزِ اوقاف item by a sentence printed without its mark', async () => {
    const asked = serve({ a: () => mcqs(WORDS.slice(0, 20).map(meaning)) });
    await run(L45);
    const a = asked.find((x) => x.sec === 'A');
    expect(a.prompt).toMatch(/رموزِ اوقاف/);
    expect(a.prompt).toMatch(/printed without/);
    expect(asked.find((x) => x.sec === 'C').prompt).not.toMatch(/printed without its mark/);
  });
});
