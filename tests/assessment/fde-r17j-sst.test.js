/**
 * Social Studies, round 10:
 *   2. The premise words a model writes without an honorific («خدا», «پیغمبر», «فرمایا», «عجمی», «پروردگار»,
 *      «خالق», «اللہ پاک/کریم/رب») are held; bare «اللہ» and «نبی» stay, since they start names.
 *   3. A Q1 item whose key is a name or a term in one of its options and no other is held when a C/D stem names
 *      that option, with no topic test; Section A is asked again.
 *   4. The reader is handed every Q1 key code finds printed in a Q5, Q6 or Q7 stem, to judge beside its open read.
 *   5. A Q1 stem never names its own key, nor another printed Q1 item's key (the item whose key is named is held);
 *      Section A is asked again.
 *   6. Two Q1 items with the same key whose facts sit in one book sentence or two side by side are one question:
 *      the second is held, and Section A is asked again. The engine passes the pages it loaded to the layout.
 *   7. A Q6 whose marking points restate three sentences of the book side by side is recall (book_list): held, and
 *      Section D is told why; Section D's prompt says a Q6 answer is never a list the book gives.
 *   8. Precision: an instruction («وضاحت کریں», «بیان کریں») is no decision, so it neither keeps a «tell what it is like»
 *      Q6 nor reads a Q1 stem as Apply; «کیسے … کر سکتا ہے» asks for advice, so tells_what does not hold it.
 *   9. Section D's Q7 line gives the television item a child answers without the book as an example.
 * The papers are local model output; the people in their stories are the model's own.
 */

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logError: jest.fn(), logWarn: jest.fn() }));
// The pages the section prompts are given; a test sets the book's own text where it reads it.
const mockBook = { text: '=== Page 4 ===\nسبق کا متن' };
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadPageRangeContent: async ({ pageRanges }) => ({ content: mockBook.text, pageReference: String(pageRanges), chapterTitle: null }),
  loadChapterContent: async () => { throw new Error('not used'); },
}));

const fs = require('fs');
const path = require('path');

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');
const Reader = require('../../bot/shared/services/assessment/fde-reader');

const SST = Patterns.get('fde_g5_2027').subjects.social_studies;
const FIX = path.join(__dirname, 'fixtures', 'fde');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
const local = (name) => fixture(`r17j-sst-local-${name}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const items = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === slot);
const scopeOf = (exam) => ({ kind: exam._layout.scope.kind, chapters: exam._layout.scope.chapters, pages: exam._layout.scope.pages });
const lay = (exam, opts = {}) => applyLayout(clone(exam), SST, scopeOf(exam), { reasked: true, now: 'T', ...opts });
const Q1 = 'social_studies.A.Q1';
const Q5 = 'social_studies.C.Q5';
const Q6 = 'social_studies.D.Q6';
const Q7 = 'social_studies.D.Q7';
const nth = (exam, slot, n) => items(exam, slot)[n - 1];
const heldAs = (laid, q) => laid.held.filter((h) => h.q && h.q.question === q.question).map((h) => h.rule);

describe('2. the premise words written without an honorific', () => {
  const mk = (text) => ({ unseen: { subjective: { 'Long Questions': [{ slot: Q5, question: 'انسانی برابری پر دو باتیں لکھیں۔', answer: text, scheme: { points: [{ kind: 'K', text, marks: 2 }] } }] } } });
  const held = async (text) => (await Gen.religiousFilter(mk(text), SST, { grade: 5, subject: 'social_studies' })).map((d) => d.term);

  test.each([
    'خدا نے سب انسانوں کو برابر بنایا ہے۔',
    'پیغمبر نے سب کو برابر کہا۔',
    'آخری خطبے میں فرمایا گیا کہ سب برابر ہیں۔',
    'کسی عربی کو کسی عجمی پر کوئی فضیلت نہیں۔',
    'پروردگار کی نظر میں سب برابر ہیں۔',
    'سب انسانوں کا خالق ایک ہے۔',
    'اللہ پاک نے سب کو برابر پیدا کیا۔',
    'اللہ کریم سب کو دیکھتا ہے۔',
  ])('«%s» is held', async (text) => {
    expect(await held(text)).not.toEqual([]);
  });

  test.each([
    'عبداللہ ہارون نے سندھ کی آزادی کے لیے کام کیا۔',
    'اکرام اللہ نے اسکول میں صفائی کی مہم چلائی۔',
    'غلام نبی نے ووٹ ڈالا۔',
    'خداداد نے پانی کا نلکا ٹھیک کروایا۔',
    'خدا بخش نے دکان کے آگے سے تجاوزات ہٹائیں۔',
    'اللہ کے فضل سے فصل اچھی ہوئی اور کسان خوش ہوئے۔',
    'سب انسانوں کے بنیادی حقوق برابر ہیں۔',
  ])('«%s» is not held', async (text) => {
    expect(await held(text)).toEqual([]);
  });
});

// The twenty Q1 items three readers found a C/D stem names, paper by paper. A stem that only names a key is reported,
// not gated (FDE's own paper prints that shape); the layout still holds a NAME a stem prints, as a precaution that
// costs a Section A re-ask, and never a term the chapter teaches. Two of the names, chapters_1 ۳ and chapters_3 ۴
// («ایدھی فاؤنڈیشن کس شخصیت نے قائم کی؟ → عبدالستار ایدھی»), print the name in their own stem first, and that rule
// holds them (item 5).
const GIVEN = {
  full_1: [11, 18],
  full_2: [16, 17],
  chapters_2: [4],
  chapters_4: [8, 9],
  chapters_6: [10, 11],
};
// The twelve term keys among them («مقننہ», «سپریم کورٹ», «قومی اسمبلی», «ڈیجیٹل شہری», «سوشل میڈیا»,
// «الیکٹرانک میڈیا»): named, not stated.
const TERMS = {
  full_2: [4, 7],
  chapters_1: [2],
  chapters_3: [2, 10],
  chapters_4: [5, 6],
  chapters_5: [1, 2],
};

const A_RULES = ['key_named_in_stem', 'key_in_stem', 'key_in_own_stem', 'names_q1_key'];

describe('3. a Q1 key a C/D stem names', () => {
  test.each(Object.entries(GIVEN))('%s: each Q1 item a C/D stem names is held, and never prints', (name, ns) => {
    const exam = local(name);
    const laid = lay(exam);
    const printed = new Set(items(laid.examJson, Q1).map((q) => q.question));
    for (const n of ns) {
      const q = nth(exam, Q1, n);
      // Held by the C/D rule, or by a Q1 rule read before it (its own stem, or another Q1 stem, names the key too).
      expect([n, heldAs(laid, q).some((r) => A_RULES.includes(r))]).toEqual([n, true]);
      expect(printed.has(q.question)).toBe(false);
    }
  });

  test('the stem that gives it away shares no topic word with the Q1 stem («پمفلٹ» beside «نام تجویز»)', () => {
    const exam = local('full_1');
    expect(nth(exam, Q1, 11).question).toBe('پاکستان کا نام سب سے پہلے کس نے تجویز کیا؟');
    expect(nth(exam, Q7, 2).question).toContain('چودھری رحمت علی');
    expect(heldAs(lay(exam), nth(exam, Q1, 11))).toContain('key_named_in_stem');
  });

  test.each(Object.entries(TERMS))('%s: a term key a C/D stem only names is not held by the name rule', (name, ns) => {
    const exam = local(name);
    const laid = lay(exam);
    for (const n of ns) expect([n, heldAs(laid, nth(exam, Q1, n)).filter((r) => r === 'key_named_in_stem' || r === 'key_in_stem')]).toEqual([n, []]);
  });

  test('a term key a C/D stem states is held: «مقننہ قوانین بناتی ہے …» beside «قوانین بنانے کا اختیار کس ادارے کے پاس ہے؟ → مقننہ»', () => {
    const e = clone(local('chapters_5'));
    const q = nth(e, Q1, 1);
    expect(q.question).toBe('قوانین بنانے کا اختیار کس ادارے کے پاس ہے؟');
    expect(heldAs(lay(e), q)).toEqual([]);
    const q5 = items(e, Q5).find((x) => x.question.includes('مقننہ'));
    q5.question = 'مقننہ قوانین بنانے کا اختیار رکھتی ہے۔ اس کے دو ایوانوں کا موازنہ کریں۔';
    expect(heldAs(lay(e), q)).toEqual(['key_in_stem']);
  });

  test('a C/D stem that prints the name inside an option of its own («بیگم رعنا لیاقت علی خان» is an option) names no one', () => {
    const exam = local('chapters_4');
    const q = clone(nth(exam, Q1, 7));
    q.options = ['الف) لیاقت علی خان', 'ب) بیگم رعنا لیاقت علی خان', 'ج) چودھری رحمت علی', 'د) سردار عبدالرب نشتر'];
    const e = clone(exam);
    Object.assign(nth(e, Q1, 7), q);
    expect(heldAs(lay(e), q)).not.toContain('key_named_in_stem');
  });

  test('a key that is a tier is read by its book line, not here: «مقامی حکومت» named in a Q6 stays', () => {
    const exam = local('full_1');
    const q = nth(exam, Q1, 9);
    expect(q.answer).toContain('مقامی حکومت');
    expect(items(exam, Q6).some((x) => x.question.includes('مقامی'))).toBe(false);
    const e = clone(exam);
    nth(e, Q6, 4).question = `${nth(e, Q6, 4).question} مقامی حکومت سے بات کریں۔`;
    expect(heldAs(lay(e), q)).not.toContain('key_named_in_stem');
  });

  test('a stem that names only a wrong option holds nothing («علی گڑھ» is not «مہر گڑھ»)', () => {
    const exam = local('chapters_4');
    const q = nth(exam, Q1, 14);
    expect(q.answer).toContain('مہر گڑھ');
    expect(heldAs(lay(exam), q)).toEqual([]);
  });

  test('Section A\'s top-up is told the C/D questions and the items set aside', () => {
    const exam = local('chapters_6');
    const laid = lay(exam, { reasked: false });
    const A = SST.sections.find((s) => s.slots.some((x) => x.slot === Q1));
    const note = takenNote(SST, A, laid.examJson, { topUp: true, shortfall: laid.shortfall, held: laid.held });
    expect(note).toContain(nth(exam, Q1, 11).question);
    expect(note).toContain('No Q1 item may be keyed on a name, term, year or number those questions print');
  });
});

describe('4. the reader is handed the Q1 keys a C/D stem prints', () => {
  const CANDIDATES = '=== CANDIDATES (code found each Q1 key below printed in a Q5, Q6 or Q7 stem) ===';

  test('chapters_4 as printed: each Q1 key a C/D stem prints is listed with the stem\'s label and the Q1 label', () => {
    const exam = local('chapters_4');
    const { prompt } = Reader.buildReaderPrompt(exam, SST, {});
    expect(prompt).toContain(CANDIDATES);
    const block = prompt.slice(prompt.indexOf(CANDIDATES));
    expect(block).toContain('- Q7.1 prints «سپریم کورٹ», the key of Q1.5');
    expect(block).toContain('- Q7.2 prints «قومی اسمبلی», the key of Q1.6');
    expect(block).toContain('- Q5.7 prints «بیگم رعنا لیاقت علی خان», the key of Q1.9');
    expect(prompt).toContain('Judge every candidate below');
  });

  test('the candidate block says a stem that only names a key gives nothing away; only a stated fact does', () => {
    const { prompt } = Reader.buildReaderPrompt(local('chapters_4'), SST, {});
    const block = prompt.slice(prompt.indexOf(CANDIDATES));
    expect(block).toContain('A stem tells the answer when it states the fact the Q1 item asks');
    expect(block).toContain('A stem that only names the key, alone or beside a related topic, does not: decide it given_away false.');
  });

  test('a flag on a candidate, quoting the Q1 key, is kept', () => {
    const exam = local('chapters_4');
    const { labels, blocks, split } = Reader.buildReaderPrompt(exam, SST, {});
    const reply = { candidates: [{ item: 'Q7.1', by: 'Q1.5', evidence: 'سپریم کورٹ', reason: 'the stem names Q1.5\'s key', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split }).map((f) => f.item)).toEqual(['Q7.1']);
  });

  test('a paper whose C/D stems print no Q1 key reads exactly as before: no candidate block', () => {
    const laid = lay(local('full_1'));
    const { prompt } = Reader.buildReaderPrompt(laid.examJson, SST, {});
    expect(prompt).not.toContain(CANDIDATES);
    expect(prompt).not.toContain('Judge every candidate below');
  });

  test('what the layout lets print is handed over: a tier, a term only named, a name inside a wife\'s name', () => {
    const block = (name) => { const p = Reader.buildReaderPrompt(lay(local(name)).examJson, SST, {}).prompt; return p.slice(p.indexOf(CANDIDATES)); };
    expect(block('chapters_5')).toMatch(/- Q5\.\d+ prints «وفاقی حکومت», the key of Q1\.\d+/);
    expect(block('chapters_5')).toMatch(/- Q5\.\d+ prints «مقننہ», the key of Q1\.\d+/);
    expect(block('chapters_6')).toMatch(/- Q5\.\d+ prints «لیاقت علی خان», the key of Q1\.\d+/);
  });

  test('a re-check reads the candidates among the items it judges only', () => {
    const exam = local('chapters_4');
    const only = [items(exam, Q7)[0]];
    const { prompt } = Reader.buildReaderPrompt(exam, SST, { only });
    const block = prompt.slice(prompt.indexOf(CANDIDATES));
    expect(block).toContain('- Q7.1 prints «سپریم کورٹ»');
    expect(block).not.toContain('- Q7.2 prints');
  });
});

describe('5. a Q1 stem that names its own key, or another Q1 item\'s', () => {
  const SELF = [['chapters_1', 3], ['chapters_2', 4], ['chapters_3', 4]];

  test.each(SELF)('%s Q1 %i «ایدھی فاؤنڈیشن … → عبدالستار ایدھی» is held as key_in_own_stem and never prints', (name, n) => {
    const exam = local(name);
    const q = nth(exam, Q1, n);
    expect(q.question).toContain('ایدھی فاؤنڈیشن');
    expect(q.answer).toContain('عبدالستار ایدھی');
    const laid = lay(exam);
    expect(heldAs(laid, q)).toContain('key_in_own_stem');
    expect(items(laid.examJson, Q1).map((x) => x.question)).not.toContain(q.question);
  });

  // With the self-key reworded and the C/D stems no longer naming Edhi, the item could print; the other Q1 stem
  // that names «عبدالستار ایدھی» gives it away, so it is held and the naming item prints.
  const unkeyed = (name, n) => {
    const e = clone(local(name));
    nth(e, Q1, n).question = 'کس شخصیت نے اپنی ساری زندگی دکھی انسانیت کی خدمت کے لیے وقف کر دی؟';
    for (const slot of [Q5, Q6, Q7]) for (const q of items(e, slot)) q.question = q.question.split('عبدالستار ایدھی').join('ایک سماجی کارکن').split('ایدھی').join('ایک فلاحی');
    return e;
  };
  test('chapters_3: Q1 4 (keyed «عبدالستار ایدھی») is held as names_q1_key once Q1 16\'s stem names it; Q1 16 prints', () => {
    const e = unkeyed('chapters_3', 4);
    expect(nth(e, Q1, 16).question).toContain('عبدالستار ایدھی');
    const laid = lay(e);
    expect(heldAs(laid, nth(e, Q1, 4))).toEqual(['names_q1_key']);
    const printed = items(laid.examJson, Q1).map((x) => x.question);
    expect(printed).not.toContain(nth(e, Q1, 4).question);
    expect(printed).toContain(nth(e, Q1, 16).question);
  });

  test('chapters_1: Q1 3 and Q1 12 (its stem names «عبدالستار ایدھی») never print together', () => {
    const e = unkeyed('chapters_1', 3);
    expect(nth(e, Q1, 12).question).toContain('عبدالستار ایدھی');
    const laid = lay(e);
    const printed = new Set(items(laid.examJson, Q1).map((x) => x.question));
    expect(printed.has(nth(e, Q1, 3).question) && printed.has(nth(e, Q1, 12).question)).toBe(false);
    // Q1 12 is held for its own key («نشان امتیاز», named in a C/D stem), so it gives nothing away and Q1 3 prints.
    expect(heldAs(laid, nth(e, Q1, 12))).toContain('key_named_in_stem');
    expect(printed.has(nth(e, Q1, 3).question)).toBe(true);
  });

  test('a name two later stems print costs one item: the item keyed «چودھری رحمت علی» is held, both stems print', () => {
    const e = clone(local('full_1'));
    const mcqs = e.unseen.objective.MCQs;
    const keyed = mcqs[10];
    expect(keyed.answer).toContain('چودھری رحمت علی');
    Object.assign(mcqs[12], { question: 'چودھری رحمت علی نے اپنا پمفلٹ «اب یا کبھی نہیں» کس سال جاری کیا؟', options: ['الف) 1930ء', 'ب) 1933ء', 'ج) 1940ء', 'د) 1947ء'], answer: 'ب) 1933ء' });
    Object.assign(mcqs[14], { question: 'چودھری رحمت علی نے کس شہر میں پمفلٹ لکھا؟', options: ['الف) لاہور', 'ب) کیمبرج', 'ج) دہلی', 'د) کراچی'], answer: 'ب) کیمبرج' });
    for (const slot of [Q5, Q6, Q7]) for (const q of items(e, slot)) q.question = q.question.split('چودھری رحمت علی').join('ایک رہنما');
    const laid = lay(e);
    expect(heldAs(laid, keyed)).toEqual(['names_q1_key']);
    // The two naming items are never held for the name; the year item is held on its own, because a Q7 stem prints
    // «28 جنوری 1933ء» beside the pamphlet (a year beside its event states the fact).
    for (const q of [mcqs[12], mcqs[14]]) expect(heldAs(laid, q)).not.toContain('names_q1_key');
    expect(heldAs(laid, mcqs[12])).toEqual(['key_in_stem']);
    expect(heldAs(laid, mcqs[14])).toEqual([]);
  });

  test('a term another Q1 stem names is never held for it («سوشل میڈیا»): the chapter\'s own word', () => {
    const e = fixture('r6-sst-held');
    const keyed = e.unseen.objective.MCQs.find((q) => q.question === 'ابلاغ کی جدید ترین شکل کون سی ہے؟');
    const laid = applyLayout(clone(e), SST, { kind: 'fde' }, { reasked: true, now: 'T' });
    expect(heldAs(laid, keyed)).toEqual([]);
  });

  test('controls: a stem that names none of its options, or lists three of them, keeps its item', () => {
    const e = clone(local('chapters_5'));
    const q = nth(e, Q1, 3);
    Object.assign(q, { question: 'مقننہ، انتظامیہ اور عدلیہ میں سے کون قانون بناتا ہے؟', options: ['الف) انتظامیہ', 'ب) عدلیہ', 'ج) مقننہ', 'د) کابینہ'], answer: 'ج) مقننہ' });
    expect(heldAs(lay(e), q)).not.toContain('key_in_own_stem');
    const r = clone(local('chapters_5'));
    const plainQ = nth(r, Q1, 3);
    Object.assign(plainQ, { question: 'پاکستان کا قومی پھول کون سا ہے؟', options: ['الف) گلاب', 'ب) چنبیلی', 'ج) سورج مکھی', 'د) کنول'], answer: 'ب) چنبیلی' });
    expect(heldAs(lay(r), plainQ)).toEqual([]);
  });

  test('Section A\'s top-up is told the items set aside and why; D\'s note names only its own Q7s', () => {
    const exam = local('chapters_2');
    const laid = lay(exam, { reasked: false });
    const A = SST.sections.find((s) => s.slots.some((x) => x.slot === Q1));
    const note = takenNote(SST, A, laid.examJson, { topUp: true, shortfall: laid.shortfall, held: laid.held });
    expect(note).toContain('A Q1 question never names its own answer, nor the answer of another Q1 item.');
    expect(note).toContain(nth(exam, Q1, 4).question);
    const D = SST.sections.find((s) => s.slots.some((x) => x.slot === Q7));
    const dNote = takenNote(SST, D, laid.examJson, { held: laid.held });
    expect(dNote || '').not.toContain(nth(exam, Q1, 4).question);
  });

  test('every name among the twenty rows is held, by one rule or another', () => {
    const all = { ...GIVEN, chapters_1: [3], chapters_3: [4] };
    for (const [name, ns] of Object.entries(all)) {
      const exam = local(name);
      const printed = new Set(items(lay(exam).examJson, Q1).map((q) => q.question));
      for (const n of ns) expect([name, n, printed.has(nth(exam, Q1, n).question)]).toEqual([name, n, false]);
    }
  });
});

const BOOK_CH46 = fs.readFileSync(path.join(FIX, 'r17j-sst-book-ch4-6.txt'), 'utf8');
const repeatedAs = (laid, q) => laid.repeated.filter((h) => h.q && h.q.question === q.question).map((h) => h.rule);

describe('6. two Q1 items from one book passage are one question', () => {
  const exam = local('chapters_5');
  const first = nth(exam, Q1, 10);
  const second = nth(exam, Q1, 18);

  test('setup: chapters_5 Q1 10 «… پہلی خاتون صوبائی گورنر …» and Q1 18 «1973ء میں سندھ کی گورنر …», both → بیگم رعنا لیاقت علی خان', () => {
    expect(first.question).toBe('پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟');
    expect(second.question).toBe('1973ء میں سندھ کی گورنر کون بنیں؟');
    expect(BOOK_CH46).toContain('1973ء میں وہ صوبہ سندھ کی گورنر بن');
  });

  test('read with the pages: the second is held as same_passage and never prints; the first prints', () => {
    const laid = lay(exam, { book: BOOK_CH46 });
    expect(repeatedAs(laid, second)).toEqual(['same_passage']);
    const printed = items(laid.examJson, Q1).map((q) => q.question);
    expect(printed).not.toContain(second.question);
    expect(printed).toContain(first.question);
  });

  test('two facts about her from sentences further apart stay two questions (APWA, four sentences before)', () => {
    const e = clone(exam);
    Object.assign(nth(e, Q1, 18), { question: 'آل پاکستان ویمن ایسوسی ایشن (APWA) کس نے قائم کی؟' });
    const laid = lay(e, { book: BOOK_CH46 });
    expect(repeatedAs(laid, nth(e, Q1, 18))).toEqual([]);
    expect(items(laid.examJson, Q1).map((q) => q.question)).toContain('آل پاکستان ویمن ایسوسی ایشن (APWA) کس نے قائم کی؟');
  });

  test('two jobs of one tier from two table lines stay two (the table lines stand side by side)', () => {
    const e = clone(exam);
    const tier = { options: ['الف) وفاقی حکومت', 'ب) صوبائی حکومت', 'ج) مقامی حکومت', 'د) عدلیہ'], answer: 'ج) مقامی حکومت' };
    Object.assign(nth(e, Q1, 17), { question: 'مویشی منڈیوں اور عوامی میلوں کا انتظام کون سی حکومت کرتی ہے؟', ...tier });
    Object.assign(nth(e, Q1, 18), { question: 'پینے کے پانی کا بندوبست کون سی حکومت کرتی ہے؟', ...tier });
    const laid = lay(e, { book: BOOK_CH46 });
    expect(repeatedAs(laid, nth(e, Q1, 18))).not.toContain('same_passage');
  });

  test('without the pages nothing is read as one passage', () => {
    expect(repeatedAs(lay(exam), second)).toEqual([]);
  });
});

describe('6. through the engine: the pages it loads reach the layout', () => {
  const rec = fixture('r17j-sst-replies-chapters_5');
  const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const sectionOf = (text) => ['A', 'B', 'C', 'D'].find((x) => text.includes(`"slot": "social_studies.${x}.`));
  async function replay(book) {
    mockBook.text = book;
    const queue = { A: [...rec.replies.A], B: [...rec.replies.B], C: [...rec.replies.C], D: [...rec.replies.D] };
    mockCreate.mockReset();
    mockLog.mockReset();
    mockCreate.mockImplementation(async (req) => {
      const sec = sectionOf(textOf(req));
      const content = queue[sec].length > 1 ? queue[sec].shift() : queue[sec][0];
      return { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });
    return Gen.generatePatternExam({
      grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: rec.scope, pageRanges: rec.scope.pages, requestId: 'req-r17j',
    }).catch((e) => ({ error: e }));
  }
  const heldRows = () => mockLog.mock.calls.filter((c) => c[0] === '[assessment] held items').flatMap((c) => c[1].held);
  const stems = (out) => items((out.examJson || out.error.examJson), Q1).map((q) => q.question);
  afterEach(() => { mockBook.text = '=== Page 4 ===\nسبق کا متن'; });

  test('the recorded first Section A reply asks both items', () => {
    const a = JSON.parse(rec.replies.A[0]).unseen.objective.MCQs.map((q) => q.question);
    expect(a).toEqual(expect.arrayContaining(['پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟', '1973ء میں سندھ کی گورنر کون بنیں؟']));
  });

  test('with the book\'s pages loaded, the paper never prints both, and the log names same_passage', async () => {
    const out = await replay(BOOK_CH46);
    const printed = stems(out);
    expect(printed.includes('پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟') && printed.includes('1973ء میں سندھ کی گورنر کون بنیں؟')).toBe(false);
    expect(heldRows()).toEqual(expect.arrayContaining([expect.objectContaining({ slot: Q1, rule: 'same_passage' })]));
  });

  test('with pages that do not hold the passage, the same replies hold nothing as one passage', async () => {
    await replay('=== Page 4 ===\nسبق کا متن');
    expect(heldRows().filter((h) => h.rule === 'same_passage')).toEqual([]);
  });
});

describe('7. a Q6 answered by a list the book gives', () => {
  const Q6_LIST = 'A Q6 answer is never a list the book gives, nor the name of a tier or a body.';
  const promptOf = (S, id, subject) => { const sec = S.sections.find((x) => x.id === id); return Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'متن', pageReference: '1-9', section: sec, slots: sec.slots, lang: S.medium, P: S, scope: { kind: 'fde' } }); };

  test.each([['chapters_4', 5], ['chapters_5', 3]])('%s Q6 %i (its points the book\'s sentences in order) is held as book_list with the pages', (name, n) => {
    const exam = local(name);
    const q = nth(exam, Q6, n);
    const laid = lay(exam, { book: BOOK_CH46 });
    expect(heldAs(laid, q)).toEqual(['book_list']);
    expect(items(laid.examJson, Q6).map((x) => x.question)).not.toContain(q.question);
  });

  test('control: chapters_6 Q6 5 uses the book\'s ideas in its own story and order (an Apply item), and is not held', () => {
    const exam = local('chapters_6');
    expect(heldAs(lay(exam, { book: BOOK_CH46 }), nth(exam, Q6, 5))).not.toContain('book_list');
  });

  test('control: without the pages no Q6 is read as the book\'s list', () => {
    const exam = local('chapters_4');
    expect(heldAs(lay(exam), nth(exam, Q6, 5))).not.toContain('book_list');
  });

  test('Section D\'s re-ask is told why the item was set aside', () => {
    const exam = local('chapters_5');
    const laid = lay(exam, { book: BOOK_CH46, reasked: false });
    const D = SST.sections.find((s) => s.slots.some((x) => x.slot === Q6));
    const note = takenNote(SST, D, laid.examJson, { topUp: true, shortfall: laid.shortfall, held: laid.held });
    expect(note).toContain(nth(exam, Q6, 3).question.trim());
    expect(note).toContain('or is answered by a list the book gives');
  });

  test('Section D\'s prompt says it; Sections A to C and every other subject\'s prompts do not', () => {
    expect(promptOf(SST, 'D', 'social_studies')).toContain(Q6_LIST);
    for (const id of ['A', 'B', 'C']) expect(promptOf(SST, id, 'social_studies')).not.toContain(Q6_LIST);
    for (const key of ['maths', 'science', 'english', 'urdu']) {
      const S = Patterns.get('fde_g5_2027').subjects[key];
      for (const sec of S.sections) expect(promptOf(S, sec.id, key)).not.toContain(Q6_LIST);
    }
  });
});

describe('8. an instruction is no decision; «how can they help» is advice', () => {
  const r17i = (n) => fixture(`r17i-sst-local-${n}`);
  const withQ6 = (stem) => { const e = clone(r17i('full_1')); items(e, Q6)[4].question = stem; return e; };
  const rulesOf = (laid, stem) => laid.held.filter((h) => h.q && h.q.question === stem).map((h) => h.rule);

  test('a «tell what it is like» Q6 that ends «وضاحت کریں» is held as tells_what', () => {
    const stem = 'زارا گرمیوں میں صحرائے تھر جا رہی ہے۔ زارا کو بتائیں کہ وہاں موسم کیسا ہو گا، اور وضاحت کریں۔';
    expect(rulesOf(lay(withQ6(stem)), stem)).toContain('tells_what');
  });

  test('advice asked as «how can they help» is not held as tells_what', () => {
    const stem = 'احمد اپنے محلے کی صفائی میں حصہ لینا چاہتا ہے۔ احمد کو بتائیں کہ وہ کیسے مدد کر سکتا ہے اور اس سے محلے کو کیا فائدہ ہو گا۔';
    expect(rulesOf(lay(withQ6(stem)), stem)).not.toContain('tells_what');
  });

  test('control: a decision still keeps an item («… وہ کیا کرے»)', () => {
    const stem = 'زارا کو بتائیں کہ وہاں موسم کیسا ہو گا اور وہ سفر میں کیا کرے۔';
    expect(rulesOf(lay(withQ6(stem)), stem)).not.toContain('tells_what');
  });

  test.each([
    ['پارلیمان کے دو ایوان ہیں۔ ان دونوں کی وضاحت کریں۔', 'understand'],
    ['آئین ملک کا بنیادی قانون ہے۔ اس کی دو خصوصیات بیان کریں۔', 'understand'],
    ['قائداعظم 1876ء میں پیدا ہوئے۔ ان کی پیدائش کس شہر میں ہوئی؟', 'remember'],
    ['آپ کے محلے میں گلیوں کا گندا پانی نکالنے کا مسئلہ ہے۔ آپ کو کس حکومت سے رابطہ کرنا چاہیے؟', 'apply'],
    ['علی کے دوست نے بغیر اجازت اس کی تصویر لگا دی۔ علی کیا کرے؟', 'apply'],
  ])('the log reads «%s» as %s', (question, level) => {
    expect(Gen.sstStemLevel({ question })).toBe(level);
  });
});

describe('9. the Q7 line names the television item', () => {
  const Q7_COMMON = 'A Q7 item is never a fact every Grade 5 child knows without the book (the year Pakistan was made, its capital, its national language, washing hands before eating, that television shows pictures («… ٹی وی پر اور کیا دکھایا جاتا ہے؟ → تصویر»), the name of a social media app); it asks a fact these pages teach.';
  const promptOf = (S, sec, subject) => Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'متن', pageReference: '1-9', section: sec, slots: sec.slots, lang: S.medium, P: S, scope: { kind: 'fde' } });

  test('Section D\'s prompt carries it (local chapters_3 Q7 3 «ٹیلی ویژن پر آواز کے ساتھ اور کیا دکھایا جاتا ہے؟ → تصویر»)', () => {
    expect(promptOf(SST, SST.sections.find((x) => x.id === 'D'), 'social_studies')).toContain(Q7_COMMON);
  });

  test('no other section or subject is told it', () => {
    for (const id of ['A', 'B', 'C']) expect(promptOf(SST, SST.sections.find((x) => x.id === id), 'social_studies')).not.toContain('ٹی وی پر اور کیا دکھایا جاتا ہے');
    for (const key of ['maths', 'science', 'english', 'urdu']) {
      const S = Patterns.get('fde_g5_2027').subjects[key];
      for (const sec of S.sections) expect(promptOf(S, sec, key)).not.toContain('ٹی وی پر اور کیا دکھایا جاتا ہے');
    }
  });
});
