/**
 * Urdu board-pattern papers, three Section A shapes a local run printed after the twin hold.
 *
 * 1. Q1 ↔ Q4: full_4 Q1 «"___ تم محنت کرو گے ___ کام یاب ہو جاؤ گے۔" … درست جوڑی» (→ اگر، تو) prints
 *    Q4's «اگر تم محنت کرو گے ___ کامیاب ہو جاؤ گے» and answers it. The Q1 side was read with its
 *    blanks empty only, and «کام یاب» / «کامیاب» cost one more word. The Q1 sentence is now read
 *    with its key in the blanks too, and a compound written split or joined is one word.
 * 2. A stem that prints its own key: «لفظ «سانپ» کی درست املا کون سی ہے؟» → سانپ. Held; a quoted
 *    example that holds the key among other words («"اگر بارش ہوئی تو …" میں حرفِ شرط») stays.
 * 3. Two questions in one stem («…پیش آیا؟ سدرہ کی بہن کا نام کیا تھا؟»): held.
 *
 * The recorded papers are local replies (content only).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r14b-urdu-local-${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
const laid = (exam) => applyLayout(clone(exam), U, FDE, { reasked: false }).examJson;
const sectionA = U.sections.find((s) => s.slots.some((x) => x.slot === 'urdu.A.Q1'));

// A paper of one Q1 item beside the Q4 items given (each slot otherwise empty).
function paper(q1, q4s = []) {
  return { unseen: { objective: { MCQs: [{ slot: 'urdu.A.Q1', marks: 1, ...q1 }] }, subjective: { 'Rewrite Sentences': q4s.map((q) => ({ slot: 'urdu.C.Q4', marks: 1.25, ...q })) } } };
}
const OPTS = ['الف) اگر', 'ب) اور', 'ج) مگر', 'د) کہ'];

describe('Q1 ↔ Q4: a Q1 sentence read with its key in the blanks', () => {
  const full4 = read('full_4');
  const leak = full4.unseen.objective.MCQs[12].question;

  test('the recorded pair is on the paper as given', () => {
    expect(leak).toContain('کام یاب');
    expect(full4.unseen.subjective['Rewrite Sentences'][1].question).toContain('کامیاب');
  });

  test('full_4 Q1 ۱۳ («___ تم محنت کرو گے ___ کام یاب …» → اگر، تو) is held against Q4 ۲', () => {
    expect(q1Stems(laid(full4))).not.toContain(leak);
  });

  test('full_4 keeps every other Q1 item', () => {
    const before = q1Stems(full4).filter((s) => s !== leak);
    expect(q1Stems(laid(full4))).toEqual(before);
  });

  test('a compound written split on one side and joined on the other is one word («کام یاب» / «کم زور»)', () => {
    const exam = paper(
      { question: '"احمد کام یاب ہوا اور کم زور دوست کی مدد کی۔" اس جملے میں حرفِ عطف کون سا ہے؟', options: OPTS, answer: 'ب) اور' },
      [{ question: 'جملہ درست کریں: ’’احمد کامیاب ہوا اور کمزور دوست کی مدد کی۔‘‘', answer: 'احمد کامیاب ہوا اور کمزور دوست کی مدد کی۔' }],
    );
    expect(q1Stems(laid(exam))).toEqual([]);
  });

  test('two different sentences that share a split compound stay («کام یاب» in both, nothing else)', () => {
    const exam = paper(
      { question: '"وہ امتحان میں کام یاب ہوئی۔" اس جملے میں فعل کون سا ہے؟', options: ['الف) ہوئی', 'ب) امتحان', 'ج) وہ', 'د) میں'], answer: 'الف) ہوئی' },
      [{ question: 'جملہ درست کریں: ’’محنتی بچے ہمیشہ کامیاب رہتے ہیں اور خوش رہتے ہیں۔‘‘', answer: 'محنتی بچے ہمیشہ کامیاب رہتے ہیں اور خوش رہتے ہیں۔' }],
    );
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });
});

describe('a Q1 stem that prints its own key', () => {
  const full1 = read('full_1');
  const own = full1.unseen.objective.MCQs[14].question;

  test('full_1 Q1 ۱۵ «لفظ «سانپ» کی درست املا کون سی ہے؟» (→ سانپ) is held', () => {
    expect(own).toContain('«سانپ»');
    expect(q1Stems(laid(full1))).not.toContain(own);
  });

  test('the key outside any quote, in the stem, is held', () => {
    const exam = paper({ question: 'تربوز کس لفظ کی درست املا ہے؟', options: ['الف) طربوز', 'ب) تربوز', 'ج) تربوض', 'د) تربوذ'], answer: 'ب) تربوز' });
    expect(q1Stems(laid(exam))).toEqual([]);
  });

  test('a quoted example that holds the key among other words stays («"اگر بارش ہوئی تو …" میں حرفِ شرط» → اگر)', () => {
    const exam = paper({ question: '"اگر بارش ہوئی تو ہم گھر رہیں گے۔" اس جملے میں حرفِ شرط کون سا ہے؟', options: OPTS, answer: 'الف) اگر' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });

  test('a quote of the key with its marks, among options that differ only by marks, is held («سَحَر» → سَحَر)', () => {
    const exam = paper({ question: '«سَحَر» بمعنی صبح کے لیے درست اعراب والا لفظ کون سا ہے؟', options: ['الف) سُحر', 'ب) سحْر', 'ج) سِحر', 'د) سَحَر'], answer: 'د) سَحَر' });
    expect(q1Stems(laid(exam))).toEqual([]);
  });

  test('a stem that prints another option beside the key stays: the child still chooses («عمارت» اور «اِمارت»)', () => {
    const exam = paper({ question: '«عمارت» اور «اِمارت» میں سے «امیری» کے معنی کس لفظ کے ہیں؟', options: ['الف) عمارت', 'ب) عنبر', 'ج) اِمارت', 'د) آمبر'], answer: 'ج) اِمارت' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });

  test('a spelling item that does not print its word stays («درست املا والا لفظ کون سا ہے؟» → تربوز)', () => {
    const full3 = read('full_3');
    const spelling = full3.unseen.objective.MCQs.find((q) => /درست املا والا لفظ/.test(q.question)).question;
    expect(q1Stems(laid(full3))).toContain(spelling);
  });
});

describe('one question per stem', () => {
  const full3 = read('full_3');
  const two = full3.unseen.objective.MCQs[19].question;

  test('full_3 Q1 ۲۰ (two «؟» in one stem) is held', () => {
    expect((two.match(/؟/g) || []).length).toBe(2);
    expect(q1Stems(laid(full3))).not.toContain(two);
  });

  test('a «؟» inside a quoted example does not count («"تم کہاں جا رہے ہو؟" یہ کس قسم کا جملہ ہے؟»)', () => {
    const exam = paper({ question: '"تم کہاں جا رہے ہو؟" یہ کس قسم کا جملہ ہے؟', options: ['الف) سوالیہ', 'ب) خبریہ', 'ج) تمنائی', 'د) فجائیہ'], answer: 'الف) سوالیہ' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });
});

describe('the Urdu Section A prompt', () => {
  const prompt = (subject, section, lang = 'ur') => Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'x', pageReference: '1', section, lang, P: PAT.subjects[subject], scope: FDE,
  });

  test('says a spelling item never prints the word it tests, and each stem asks one question', () => {
    const A = prompt('urdu', sectionA);
    expect(A).toContain('never the word whose spelling is tested');
    expect(A).toContain('Each MCQ stem asks one question');
  });

  test('no other subject\'s prompt carries either line', () => {
    for (const subject of ['science', 'maths', 'english', 'social_studies']) {
      const P = PAT.subjects[subject];
      if (!P) continue;
      for (const section of P.sections) {
        const text = prompt(subject, section, subject === 'social_studies' ? 'ur' : 'en');
        expect(text).not.toContain('never the word whose spelling is tested');
        expect(text).not.toContain('Each MCQ stem asks one question');
      }
    }
  });
});
