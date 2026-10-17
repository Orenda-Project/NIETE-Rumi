/**
 * Urdu board-pattern papers, two shapes a sandbox round printed.
 *
 * 1. A grammar-term MCQ whose stem prints a word of its own key: ««ہلکا نیلا» جیسی ترکیب میں «گاڑی»
 *    کی صفت بیان کرنے والے لفظ کو کیا کہتے ہیں؟» → اسم صفت, beside موصوف / اسم آلہ / اسم صوت. «صفت»
 *    is in the stem and in the key only, so a child picks the key by matching words. Held. A word
 *    inside the stem's quoted example, a key that is not a grammar term, or a word another option
 *    also carries is not a give-away, and stays.
 * 2. Q6 (ب) with no scheme points got ONE «A5 <the whole meaning>» row: a teacher cannot give 3 of
 *    5 against it. The meaning is now split into one A point per sentence, the marks shared out in
 *    halves, and still listed as one row code filled.
 *
 * The recorded papers are sandbox replies (content only). chapters_2 is saved as the scheme check
 * met it: the Q6 (ب) item with no points.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { renderMarkingScheme } = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r19-urdu-sandbox-${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const q1Stems = (exam) => items(exam, 'urdu.A.Q1').map((q) => q.question);
const laid = (exam) => applyLayout(clone(exam), U, FDE, { reasked: false }).examJson;
const paper = (q1) => ({ unseen: { objective: { MCQs: [{ slot: 'urdu.A.Q1', marks: 1, ...q1 }] } } });

describe('urdu Q1: a grammar-term item whose stem prints a word of its key', () => {
  const full1 = read('full_1');
  const leak = full1.unseen.objective.MCQs[15];

  test('the recorded item is on the paper as given', () => {
    expect(leak.question).toContain('کی صفت بیان کرنے والے لفظ');
    expect(leak.answer).toBe('ج) اسم صفت');
  });

  test('full_1 Q1 ۱۶ (→ اسم صفت, «صفت» in the stem) is held', () => {
    expect(q1Stems(laid(full1))).not.toContain(leak.question);
  });

  test('full_1 keeps every other Q1 item', () => {
    expect(q1Stems(laid(full1))).toEqual(q1Stems(full1).filter((s) => s !== leak.question));
  });

  test('a bare term key printed in the stem stays held («مذکر» named in the stem → مذکر)', () => {
    const exam = paper({ question: 'جو لفظ مذکر کے لیے آئے اسے کیا کہتے ہیں؟', options: ['الف) مذکر', 'ب) مونث', 'ج) واحد', 'د) جمع'], answer: 'الف) مذکر' });
    expect(q1Stems(laid(exam))).toEqual([]);
  });

  test('the word inside the stem\'s quoted example stays («"اسم صفت" والی ترکیب …»)', () => {
    const exam = paper({ question: '«نیلی گاڑی» میں «نیلی» کو کیا کہتے ہیں؟', options: ['الف) موصوف', 'ب) اسم آلہ', 'ج) اسم صفت', 'د) اسم صوت'], answer: 'ج) اسم صفت' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });

  test('a word another option also carries stays (the child still chooses)', () => {
    const exam = paper({ question: 'صفت کی کون سی قسم رنگ بتاتی ہے؟', options: ['الف) صفت ذاتی', 'ب) صفت عددی', 'ج) صفت مقداری', 'د) صفت نسبتی'], answer: 'الف) صفت ذاتی' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });

  test('a key that is not a grammar term stays (a name or a fact the stem names)', () => {
    const exam = paper({ question: 'قائداعظم کا پورا نام کیا تھا؟', options: ['الف) محمد علی جناح', 'ب) علامہ اقبال', 'ج) لیاقت علی خان', 'د) سرسید احمد خان'], answer: 'الف) محمد علی جناح' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });

  test('a class word alone («اسم», «لفظ») in the stem is the stem\'s frame, and stays', () => {
    const exam = paper({ question: 'کسی کام کے کرنے یا ہونے کو ظاہر کرنے والے لفظ کو کیا کہتے ہیں؟', options: ['الف) فعل', 'ب) اسم', 'ج) حرف', 'د) ضمیر'], answer: 'الف) فعل' });
    expect(q1Stems(laid(exam))).toHaveLength(1);
  });

  test('the same item in an English paper is not read (English is live)', () => {
    const E = PAT.subjects.english;
    const exam = { unseen: { objective: { MCQs: [{ slot: 'english.A.Q1a', marks: 1, question: 'A word that describes a noun is called a/an:', options: ['a) noun', 'b) describing adjective', 'c) verb', 'd) adverb'], answer: 'b) describing adjective' }] } } };
    const out = applyLayout(clone(exam), E, FDE, { reasked: false }).examJson;
    expect(items(out, 'english.A.Q1a')).toHaveLength(1);
  });
});

describe('urdu prompt: Section A is told a grammar-term item never uses the term\'s own word', () => {
  const NOTE = 'A grammar-term item (اسم صفت، حرفِ عطف، فعل …) never prints a word of its own answer in its stem: describe what the term does, and quote an example.';
  const prompt = (subject, section) => Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'x', pageReference: '1', section, lang: 'ur', P: PAT.subjects[subject], scope: FDE,
  });
  const hasA1 = (s) => s.slots.some((x) => x.slot === 'urdu.A.Q1');

  test('the urdu Section A prompt carries the line', () => {
    expect(prompt('urdu', U.sections.find(hasA1))).toContain(NOTE);
  });

  test('no other urdu section, and no other subject, carries it', () => {
    for (const section of U.sections.filter((s) => !hasA1(s))) expect(prompt('urdu', section)).not.toContain(NOTE);
    for (const key of Object.keys(PAT.subjects).filter((k) => k !== 'urdu')) {
      for (const section of PAT.subjects[key].sections) expect(prompt(key, section)).not.toContain(NOTE);
    }
  });
});

describe('urdu Q6 (ب): a meaning with no scheme points is split into one point per sentence', () => {
  const ch2 = read('chapters_2');
  const q6 = (exam) => items(exam, 'urdu.C.Q6')[0];

  test('the recorded item has no points (the shape the scheme check met)', () => {
    expect(q6(ch2).scheme.points).toBeUndefined();
    expect(q6(ch2).answer.split('۔').filter((s) => s.trim())).toHaveLength(4);
  });

  test('chapters_2: four A points, one per sentence, in halves that add to 5', () => {
    const { examJson } = normaliseScheme(clone(ch2));
    const points = q6(examJson).scheme.points;
    expect(points).toHaveLength(4);
    points.forEach((p) => {
      expect(p.kind).toBe('A');
      expect(Number.isInteger(p.marks * 2)).toBe(true);
      expect(p.marks).toBeGreaterThan(0);
    });
    expect(points.reduce((t, p) => t + p.marks, 0)).toBe(5);
    expect(points.map((p) => p.text)).toEqual([
      'ندی کہتی ہے کہ میں بے بس ہوں اور میری فریاد کوئی نہیں سنتا۔',
      'کوئی میرا دکھ نہیں سمجھتا۔',
      'لوگو مجھے جلد اس گندگی سے صاف کرو۔',
      'یہ اچھا کام کر کے تم اپنے ماحول کو بھی بچا لو گے۔',
    ]);
  });

  test('chapters_2: still ONE row code filled for the box line', () => {
    const { examJson } = normaliseScheme(clone(ch2));
    const rows = examJson._layout.scheme_shortfall.filter((e) => e.slot === 'urdu.C.Q6');
    expect(rows).toEqual([{ slot: 'urdu.C.Q6', item: 0, part: null, filled_by: 'code' }]);
  });

  test('chapters_2: the printed scheme has no A5 lump chip on Q6', () => {
    const { examJson } = normaliseScheme(clone(ch2));
    const html = renderMarkingScheme({ examJson, grade: 5, subject: 'urdu' });
    const rows = html.split('<tr').filter((r) => r.includes('data-row="urdu.C.Q6"'));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r).not.toMatch(/<span class="chip">A5<\/span>/));
  });

  test('more sentences than marks: grouped into at most one point per mark', () => {
    const paperIn = clone(ch2);
    const q = q6(paperIn);
    q.answer = 'ایک۔ دو۔ تین۔ چار۔ پانچ۔ چھ۔ سات۔';
    const points = q6(normaliseScheme(paperIn).examJson).scheme.points;
    expect(points.length).toBeLessThanOrEqual(5);
    expect(points.reduce((t, p) => t + p.marks, 0)).toBe(5);
    expect(points.map((p) => p.text).join(' ')).toBe('ایک۔ دو۔ تین۔ چار۔ پانچ۔ چھ۔ سات۔');
  });

  test('one sentence stays one point', () => {
    const paperIn = clone(ch2);
    q6(paperIn).answer = 'ندی لوگوں سے کہتی ہے کہ اسے گندگی سے صاف کریں۔';
    expect(q6(normaliseScheme(paperIn).examJson).scheme.points).toEqual([{ kind: 'A', marks: 5, text: 'ندی لوگوں سے کہتی ہے کہ اسے گندگی سے صاف کریں۔' }]);
  });

  test('a Q6 with the model\'s own points is left as it is', () => {
    const paperIn = clone(ch2);
    q6(paperIn).scheme.points = [{ kind: 'K', marks: 3, text: 'ندی کی بے بسی' }, { kind: 'A', marks: 2, text: 'صفائی کا پیغام' }];
    expect(q6(normaliseScheme(paperIn).examJson).scheme.points).toEqual([
      { kind: 'K', marks: 3, text: 'ندی کی بے بسی' }, { kind: 'A', marks: 2, text: 'صفائی کا پیغام' },
    ]);
  });

  test('another urdu slot\'s code-filled row is one point, as before (Q5)', () => {
    const paperIn = clone(ch2);
    const q5 = items(paperIn, 'urdu.C.Q5')[0];
    if (!q5) return;
    delete q5.scheme;
    q5.answer = 'پہلا جملہ۔ دوسرا جملہ۔';
    const out = items(normaliseScheme(paperIn).examJson, 'urdu.C.Q5')[0];
    expect(out.scheme.points).toHaveLength(1);
  });
});
