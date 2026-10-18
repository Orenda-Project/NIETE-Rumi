/**
 * Social Studies, round 10:
 *   2. The premise words a model writes without an honorific («خدا», «پیغمبر», «فرمایا», «عجمی», «پروردگار»,
 *      «خالق», «اللہ پاک/کریم/رب») are held; bare «اللہ» and «نبی» stay, since they start names.
 *   3. A Q1 item whose key is a name or a term in one of its options and no other is held when a C/D stem names
 *      that option, with no topic test; Section A is asked again.
 *   4. The reader is handed every Q1 key code finds printed in a Q5, Q6 or Q7 stem, to judge beside its open read.
 * The papers are local model output; the people in their stories are the model's own.
 */

jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

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

// The twenty Q1 items three readers found a C/D stem gives away (eight that print the key beside the asked
// fact, twelve that print the name alone), paper by paper. Two of them, chapters_1 ۳ and chapters_3 ۴
// («ایدھی فاؤنڈیشن کس شخصیت نے قائم کی؟ → عبدالستار ایدھی»), print the name in their own stem first: the C/D stem
// adds nothing to it, and the Q1 stem's own rule holds them (item 5).
const GIVEN = {
  full_1: [11, 18],
  full_2: [4, 7, 16, 17],
  chapters_1: [2],
  chapters_2: [4],
  chapters_3: [2, 10],
  chapters_4: [5, 6, 8, 9],
  chapters_5: [1, 2],
  chapters_6: [10, 11],
};

describe('3. a Q1 key a C/D stem names', () => {
  test.each(Object.entries(GIVEN))('%s: each Q1 item a C/D stem names is held, and never prints', (name, ns) => {
    const exam = local(name);
    const laid = lay(exam);
    const printed = new Set(items(laid.examJson, Q1).map((q) => q.question));
    for (const n of ns) {
      const q = nth(exam, Q1, n);
      expect([n, heldAs(laid, q).some((r) => r === 'key_named_in_stem' || r === 'key_in_stem')]).toEqual([n, true]);
      expect(printed.has(q.question)).toBe(false);
    }
  });

  test('the stem that gives it away shares no topic word with the Q1 stem («پمفلٹ» beside «نام تجویز»)', () => {
    const exam = local('full_1');
    expect(nth(exam, Q1, 11).question).toBe('پاکستان کا نام سب سے پہلے کس نے تجویز کیا؟');
    expect(nth(exam, Q7, 2).question).toContain('چودھری رحمت علی');
    expect(heldAs(lay(exam), nth(exam, Q1, 11))).toContain('key_named_in_stem');
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

  test('a flag on a candidate, quoting the Q1 key, is kept', () => {
    const exam = local('chapters_4');
    const { labels, blocks, split } = Reader.buildReaderPrompt(exam, SST, {});
    const reply = { candidates: [{ item: 'Q7.1', by: 'Q1.5', evidence: 'سپریم کورٹ', reason: 'the stem names Q1.5\'s key', given_away: true }] };
    expect(Reader.parseFlags(reply, labels, null, blocks, { split }).map((f) => f.item)).toEqual(['Q7.1']);
  });

  test('a paper whose C/D stems print no Q1 key reads exactly as before: no candidate block', () => {
    const laid = lay(local('chapters_1'));
    const { prompt } = Reader.buildReaderPrompt(laid.examJson, SST, {});
    expect(prompt).not.toContain(CANDIDATES);
    expect(prompt).not.toContain('Judge every candidate below');
  });

  test('what the layout lets print is handed over: a tier, a name inside a wife\'s name', () => {
    const block = (name) => { const p = Reader.buildReaderPrompt(lay(local(name)).examJson, SST, {}).prompt; return p.slice(p.indexOf(CANDIDATES)); };
    expect(block('chapters_5')).toMatch(/- Q5\.\d+ prints «وفاقی حکومت», the key of Q1\.\d+/);
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
