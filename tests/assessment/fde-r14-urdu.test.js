/**
 * Urdu board-pattern papers: Section A asked a kept fact twice on all four sandbox papers.
 *
 * The Section A re-ask was told nothing about the Q1 items the paper keeps, so it wrote a whole
 * Section A again and its first items restated kept facts under new stems, keyed the same:
 * full_1 Q1 ۲ «… کس شعبے کی ڈگری حاصل کی؟» and Q1 ۱۵ «… کس پیشے کی ڈگری حاصل کی تھی؟», both
 * «دندان سازی». The in-slot twin check wanted equal stems.
 *
 * 1. Same key (one key's words inside the other's, «مینا بازار» / «مینا بازاروں» / «مینا بازار
 *    لگانے») and stems sharing two words, or one stem's words inside the other's: a twin, held.
 * 2. The re-ask is told the items Q1 keeps and their keys.
 * 3. A Q1 stem that prints another Q1 item's key («سدرہ نے اپنی تھیڑ کمپنی …» beside «… کیا
 *    بنایا؟ → تھیڑ کمپنی») is held: a key of two words or more, or two items giving each other away.
 * 4. A held twin's place goes to the next item the re-ask wrote: the paper is whole.
 * 5. Q4: an item with four options keyed on one and accepting another («ج) بارش», accepting
 *    «د) فلکیات») is held, and the Q4 prompt says the group word is one of the options and the key.
 *
 * The recorded papers are sandbox replies (content only).
 */

const fs = require('fs');
require('./helpers/skip-giveaway-check'); // recorded replies hold real give-aways (bd-5jmnfj.4.51.3)
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
// The book store holds lesson 7's poem (the verses the papers' Q6 prints) for any page range asked.
const mockPages = ['=== Page 63 ===', 'سبق ۷', 'ندی کی فریاد', 'شاعر: کوثر صدیقی',
  'پاکیزہ مجھ کو کر دو کرکے مری صفائی', 'میرا بھی فائدہ ہے انساں کی بھی بھلائی',
  'تم مجھ کو صاف رکھ کے خود بھی سکھی رہوگے', 'پانی جو صاف ہوگا بیماری سے بچوگے'].join('\n\n');
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockPages, pageReference: String(pageRanges) }),
  loadChapterContent: async () => ({ content: mockPages, pageReference: '63' }),
}));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r14-urdu-sandbox-${name}.json`), 'utf8'));
const papers = Object.fromEntries(['full_1', 'full_2', 'chapters_1', 'chapters_2'].map((n) => [n, read(n)]));
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
const recorded = (name, n) => items(papers[name], 'urdu.A.Q1')[n - 1];
const lay = (exam, reasked = false) => applyLayout(exam, U, FDE, { reasked });
const laid = (name, reasked = false) => lay(clone(papers[name]), reasked).examJson;
const sectionA = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.A.Q1'));

// The panel's six pairs (Q1 numbers as printed): the first is kept, the later one is the twin.
const TWINS = {
  full_1: [[2, 15], [3, 17]],
  full_2: [[2, 19]],
  chapters_1: [[2, 19], [3, 20]],
  chapters_2: [[2, 20]],
};
const PAIRS = Object.entries(TWINS).flatMap(([name, pairs]) => pairs.map(([a, b]) => [name, a, b]));

describe('(1) a kept fact asked again under a new stem, keyed the same, is a twin', () => {
  test.each(PAIRS.flatMap((p) => [[...p, false], [...p, true]]))('%s Q1 %i / %i (reasked %s): printed once', (name, a, b, reasked) => {
    const stems = q1Stems(laid(name, reasked));
    expect(stems).toContain(recorded(name, a).question);
    expect(stems).not.toContain(recorded(name, b).question);
  });

  test('keys that differ by an ending or a verb are the same key (مینا بازاروں / مینا بازار لگانے)', () => {
    expect(recorded('full_2', 2).answer).toMatch(/مینا بازاروں/);
    expect(recorded('chapters_1', 3).answer).toMatch(/مینا بازار لگانے/);
    expect(q1Stems(laid('full_2'))).not.toContain(recorded('full_2', 19).question);
    expect(q1Stems(laid('chapters_1'))).not.toContain(recorded('chapters_1', 20).question);
  });

  test('the same key on a different question (one shared word) stays two', () => {
    const exam = clone(papers.full_1);
    const q = items(exam, 'urdu.A.Q1')[19];
    Object.assign(q, { question: 'پاکستان کا سب سے بڑا شہر کون سا ہے؟', options: ['الف) لاہور', 'ب) کراچی', 'ج) پشاور', 'د) کوئٹہ'], answer: 'ب) کراچی' });
    expect(recorded('full_1', 1).answer).toMatch(/کراچی/);
    const stems = q1Stems(lay(exam).examJson);
    expect(stems).toContain(recorded('full_1', 1).question);
    expect(stems).toContain('پاکستان کا سب سے بڑا شہر کون سا ہے؟');
  });

  test('a one-word key inside a whole sentence is not the same key («کاش» beside «کاش میں … ہوتا»)', () => {
    const exam = clone(papers.full_1);
    const list = items(exam, 'urdu.A.Q1');
    Object.assign(list[18], { question: 'درج ذیل میں سے کون سا جملہ تمنائی ہے؟', options: ['الف) کاش میں پرندہ ہوتا', 'ب) وہ گھر گیا', 'ج) کیا تم آؤ گے؟', 'د) شاید بارش ہو'], answer: 'الف) کاش میں پرندہ ہوتا' });
    Object.assign(list[19], { question: 'خالی جگہ کے لیے درست لفظ منتخب کریں: «___ ہم بھی ستاروں تک جا سکتے!» (تمنائی جملہ)', options: ['الف) کاش', 'ب) اگر', 'ج) شاید', 'د) جب'], answer: 'الف) کاش' });
    // Both ask تمنائی, so the second is held as one grammar concept asked twice.
    const stems = q1Stems(lay(exam).examJson);
    expect(stems).toContain(list[18].question);
    expect(stems).not.toContain(list[19].question);
    // The key rule alone holds neither: with the sentence asked as a story fact, both stay.
    Object.assign(list[18], { question: 'نظم میں بچہ کیا کہتا ہے؟' });
    const alone = q1Stems(lay(exam).examJson);
    expect(alone).toContain(list[18].question);
    expect(alone).toContain(list[19].question);
  });
});

describe('(3) a Q1 stem that prints another Q1 item\'s key', () => {
  test.each([false, true])('chapters_2 (reasked %s): Q1 ۱ «… اپنی تھیڑ کمپنی …» and Q1 ۱۹ «→ تھیڑ کمپنی» are never both printed', (reasked) => {
    const stems = q1Stems(laid('chapters_2', reasked));
    expect(recorded('chapters_2', 19).answer).toMatch(/تھیڑ کمپنی/);
    expect([recorded('chapters_2', 1).question, recorded('chapters_2', 19).question].filter((s) => stems.includes(s))).toHaveLength(1);
  });

  test('a one-word key a stem merely names stays («… علامت ہیں؟ → امن» beside ««امن» کا متضاد …»)', () => {
    // One antonym on the paper (۷): the full syllabus asks the concept once, so ۶ and ۸ are left out here.
    const exam = clone(papers.chapters_2);
    const others = [recorded('chapters_2', 6).question, recorded('chapters_2', 8).question];
    for (const types of Object.values(exam.unseen)) for (const [t, list] of Object.entries(types)) types[t] = list.filter((q) => !others.includes(q.question));
    const stems = q1Stems(lay(exam).examJson);
    expect(recorded('chapters_2', 3).answer).toMatch(/امن/);
    expect(stems).toContain(recorded('chapters_2', 3).question);
    expect(stems).toContain(recorded('chapters_2', 7).question);
  });

  test('an item naming the kind of a quoted example is not given away by a stem that names the kind', () => {
    const exam = clone(papers.full_1);
    const list = items(exam, 'urdu.A.Q1');
    Object.assign(list[18], { question: "'میری دعا ہے کہ ہم سب خوش رہیں۔' یہ کس قسم کا جملہ ہے؟", options: ['الف) تمنائی جملہ', 'ب) شکیہ جملہ', 'ج) سوالیہ جملہ', 'د) خبریہ جملہ'], answer: 'الف) تمنائی جملہ' });
    Object.assign(list[19], { question: 'کون سا لفظ تمنائی جملے میں استعمال ہوتا ہے؟', options: ['الف) کاش', 'ب) شاید', 'ج) کیا', 'د) اور'], answer: 'الف) کاش' });
    // Both ask تمنائی: the second is held as one grammar concept asked twice, not as a given-away key.
    const stems = q1Stems(lay(exam).examJson);
    expect(stems).toContain(list[18].question);
    expect(stems).not.toContain(list[19].question);
  });

  test('a stem that prints the name a definition item asks for gives it away («… یہ الفاظ کس کے متلازم ہیں؟» / «… کیا کہتے ہیں؟ → متلازم الفاظ»)', () => {
    const exam = clone(papers.full_1);
    const list = items(exam, 'urdu.A.Q1');
    Object.assign(list[18], { question: '«کمبل، آتش دان، مونگ پھلی» یہ الفاظ کس موسم کے متلازم ہیں؟', options: ['الف) سردی', 'ب) گرمی', 'ج) بہار', 'د) خزاں'], answer: 'الف) سردی' });
    Object.assign(list[19], { question: 'ایک ہی موضوع سے تعلق رکھنے والے الفاظ کے گروہ کو کیا کہتے ہیں؟', options: ['الف) متلازم الفاظ', 'ب) متضاد الفاظ', 'ج) ہم آواز الفاظ', 'د) واحد جمع'], answer: 'الف) متلازم الفاظ' });
    const stems = q1Stems(lay(exam).examJson);
    expect(stems).toContain(list[18].question);
    expect(stems).not.toContain(list[19].question);
  });

  test('two items keyed on each other\'s one-word stems are a twin (ہیروشیما / جاپان)', () => {
    const exam = clone(papers.full_1);
    const list = items(exam, 'urdu.A.Q1');
    Object.assign(list[18], { question: 'ہیروشیما کس ملک کا شہر ہے؟', options: ['الف) چین', 'ب) جاپان', 'ج) کوریا', 'د) روس'], answer: 'ب) جاپان' });
    Object.assign(list[19], { question: 'جاپان کا کون سا شہر جنگ میں تباہ ہوا؟', options: ['الف) ٹوکیو', 'ب) اوساکا', 'ج) ہیروشیما', 'د) کیوٹو'], answer: 'ج) ہیروشیما' });
    const stems = q1Stems(lay(exam).examJson);
    expect([list[18].question, list[19].question].filter((s) => stems.includes(s))).toHaveLength(1);
  });
});

describe('(6) a Q1 item whose blanks, filled with its key, print a Q4 sentence (a local paper)', () => {
  // full_4 Q1 ۱۳ «"___ تم محنت کرو گے ___ کام یاب ہو جاؤ گے۔" … جوڑی» → اگر، تو; Q4 ۲ «’’اگر تم محنت
  // کرو گے ___ کامیاب ہو جاؤ گے۔‘‘» → تو. With its blanks empty Q1 carries 7 of Q4's 9 words; filled, 8.
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r14-urdu-local-full_4.json'), 'utf8'));
  const pairQ = items(local, 'urdu.A.Q1')[12].question;
  test('full_4: Q1 ۱۳ is held before the re-ask', () => {
    expect(q1Stems(lay(clone(local)).examJson)).not.toContain(pairQ);
  });
  test('full_4 after the re-ask: a new item takes its place; it comes back only when nothing else can', () => {
    const exam = clone(local);
    const mcqs = Object.values(exam.unseen).map((t) => t.MCQs).find(Array.isArray);
    mcqs.push({ slot: 'urdu.A.Q1', question: 'لفظ «صداقت» کا مطلب کیا ہے؟', options: ['الف) سچائی', 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: 'الف) سچائی' });
    const stems = q1Stems(lay(exam, true).examJson);
    expect(stems).not.toContain(pairQ);
    expect(stems).toContain('لفظ «صداقت» کا مطلب کیا ہے؟');
  });
  test('the other Q1 items stay, but the antonyms asked again (the full syllabus asks a concept once: ۹, ۲۰)', () => {
    const stems = q1Stems(lay(clone(local)).examJson);
    const again = [9, 20].map((n) => items(local, 'urdu.A.Q1')[n - 1].question);
    expect(stems).toEqual(items(local, 'urdu.A.Q1').map((q) => q.question).filter((s) => s !== pairQ && !again.includes(s)));
  });
});

describe('(5) Q4: a key and an accepted answer that name two different options', () => {
  const q4 = (exam) => items(exam, 'urdu.C.Q4');
  test.each([false, true])('chapters_2 (reasked %s): Q4 ۱ keyed «ج) بارش», accepting «د) فلکیات», is held', (reasked) => {
    const before = q4(papers.chapters_2);
    expect(before[0].answer).toMatch(/بارش/);
    const out = lay(clone(papers.chapters_2), reasked);
    const after = q4(out.examJson).map((q) => q.question);
    expect(after).not.toContain(before[0].question);
    expect(after).toEqual(before.slice(1).map((q) => q.question));
    expect(out.shortfall).toContainEqual({ slot: 'urdu.C.Q4', missing: 1 });
  });

  test('an accepted answer that is the key, or no option at all, stays («اگر - تو» accepting «اگر ... تو», «جب، تو»)', () => {
    const exam = clone(papers.chapters_2);
    const [, second] = q4(exam);
    second.scheme.accept = ['اگر ... تو', 'جب، تو', 'الف) اگر - تو'];
    expect(q4(lay(exam).examJson).map((q) => q.question)).toContain(second.question);
  });

  test('the other three papers keep all four Q4 items', () => {
    // An ارکان item whose key and accepted answer split a word apart is held by its own rule; left aside here.
    const own = (list) => list.filter((q) => !String(q.answer).includes('+'));
    for (const name of ['full_1', 'full_2', 'chapters_1']) expect(own(q4(laid(name)))).toHaveLength(own(q4(papers[name])).length);
  });

  test('the Urdu Section C prompt says the group word is one of the four options and is the key', () => {
    const C = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.C.Q4'));
    const prompt = Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'x', pageReference: '1', section: C, lang: 'ur', P: U, scope: FDE });
    expect(prompt).toContain('the group word is one of its four options and is its key');
    const A = Gen.buildPatternUserPrompt({ grade: 5, subject: 'urdu', pageContent: 'x', pageReference: '1', section: sectionA, lang: 'ur', P: U, scope: FDE });
    expect(A).not.toContain('the group word is one of its four options');
  });
});

describe('(2) the Section A re-ask is told the items Q1 keeps, with their keys', () => {
  // full_1 as the first reply wrote it: Q1 ۱–۱۴, the six re-asked items not yet there.
  const firstReply = () => {
    const exam = clone(papers.full_1);
    for (const types of Object.values(exam.unseen)) for (const [t, list] of Object.entries(types)) types[t] = list.filter((q) => q.slot !== 'urdu.A.Q1' || list.indexOf(q) < 14);
    return lay(exam);
  };

  test('a top-up names every kept Q1 item and its key, and never to key a new item on them', () => {
    const first = firstReply();
    // Six re-asked items, and two more: the second شرط و جزا item («جوں جوں» …) and the second antonym (۸)
    // ask a concept Q1 already asks.
    expect(first.shortfall).toContainEqual({ slot: 'urdu.A.Q1', missing: 8 });
    const note = takenNote(U, sectionA, first.examJson, { topUp: true, shortfall: first.shortfall });
    expect(note).toContain(`- ${recorded('full_1', 2).question} → دندان سازی`);
    expect(note).toContain(`- ${recorded('full_1', 3).question} → گلستان`);
    expect(note).toMatch(/never key a new item on any of these answers: [^\n]*دندان سازی، [^\n]*گلستان/);
    // Section C's notes stay as they were.
    expect(note).toContain('Q4 of this paper already asks these');
    expect(note).toContain('Q6 of this paper prints these verses');
  });

  test('a re-ask that is not a top-up (the second reply replaces the first) names no kept items', () => {
    const first = firstReply();
    const note = takenNote(U, sectionA, first.examJson, { topUp: false, shortfall: first.shortfall });
    expect(note).not.toContain('already keeps these items');
    expect(note).not.toContain('never key a new item');
  });
});

describe('(4) through generatePatternExam: the twins go, the next items take their places', () => {
  beforeEach(() => mockCreate.mockReset());
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const treeFor = (sec) => {
    const tree = {};
    for (const [cat, types] of Object.entries(papers.full_1.unseen)) {
      for (const [type, list] of Object.entries(types)) {
        const mine = list.filter((q) => q.slot.startsWith(`urdu.${sec}.`));
        if (mine.length) (tree[cat] ||= {})[type] = clone(mine);
      }
    }
    return tree;
  };
  // Asked again, Section A writes the recorded tail (Q1 ۱۵–۲۰, two of them twins) and then new items.
  // Word meanings: the full syllabus asks the antonym once, so spares that were all antonyms would be held.
  const PAIRS_OF_WORDS = [['صداقت', 'سچائی'], ['دولت', 'مال'], ['مسرت', 'خوشی'], ['فلک', 'آسمان'], ['حرارت', 'گرمی'], ['جدید', 'نیا'], ['سہل', 'آسان'], ['فتح', 'جیت']];
  const SPARES = PAIRS_OF_WORDS.map(([w, k]) => ({
    slot: 'urdu.A.Q1', question: `لفظ «${w}» کا مطلب کیا ہے؟`,
    options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}`,
  }));
  function serve() {
    const asked = [];
    mockCreate.mockImplementation(async (req) => {
      const prompt = textOf(req);
      const sec = ['A', 'B', 'C'].find((x) => prompt.includes(`"slot": "urdu.${x}.`));
      asked.push({ sec, prompt });
      const tree = treeFor(sec);
      if (sec === 'A') {
        const q1 = tree.objective.MCQs;
        tree.objective.MCQs = asked.filter((a) => a.sec === 'A').length > 1 ? [...q1.slice(14), ...clone(SPARES)] : q1.slice(0, 14);
      }
      return { choices: [{ message: { content: JSON.stringify({ unseen: tree }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } };
    });
    return asked;
  }

  test('full_1: Section A is re-asked told its kept keys; ۱۵ and ۱۷ are not printed; Q1 is whole', async () => {
    const asked = serve();
    const out = await Gen.generatePatternExam({ grade: 5, subject: 'urdu', pattern: 'fde_g5_2027', scope: FDE, requestId: 'req-r14u' })
      .then((r) => ({ ok: r }), (err) => ({ err }));
    const a = asked.filter((x) => x.sec === 'A');
    expect(a).toHaveLength(2);
    expect(a[0].prompt).not.toContain('never key a new item');
    expect(a[1].prompt).toMatch(/never key a new item on any of these answers: [^\n]*دندان سازی/);
    expect(out.err && { code: out.err.code, shortfall: out.err.shortfall }).toBeUndefined();
    const q1 = q1Stems(out.ok.examJson);
    expect(q1).toHaveLength(20);
    expect(q1).not.toContain(recorded('full_1', 15).question);
    expect(q1).not.toContain(recorded('full_1', 17).question);
    expect(q1).toContain(recorded('full_1', 16).question);
    expect(q1).toContain(SPARES[0].question);
    expect(q1).toContain(SPARES[1].question);
  });
});
