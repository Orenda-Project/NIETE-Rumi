/**
 * Urdu board-pattern papers, the shapes a sandbox round still printed.
 *
 * 1. The reader passed two give-aways it was never told about: a stem that DEFINES a term («جو لفظ
 *    کسی انسان، جانور یا بے جان چیز کی آواز ظاہر کرے» ایسے اسم کی مثال …) answers the item that asks
 *    for that term (… اسمِ صوت کون سا ہے؟), and a stem that QUOTES the word its key is built from
 *    («ان پڑھ» … → «ان اور ان»). The reader prompt names both.
 * 2. Section A's prompt: a homograph item never quotes the pair's word; the "each concept once" line
 *    names the grammar concepts one by one and counts a definition item as asking its concept; at
 *    most three items come from one word table, and no distractor is another item's key.
 * 3. Q6 (ب): a model-written point above 2 marks («A4 … (…)») is split into the ideas it joins, the
 *    marks shared out so they still add up. The prompt asks for one idea per point.
 * 4. Q4 group word: «گروہی لفظ منتخب کریں: دوست، دشمن، ساتھی، ہم راہ» → دشمن is an odd-one-out keyed as a
 *    group word. A group-word item whose key is one of the words its stem lists is held, and the
 *    prompt says the group word is never one of the listed words.
 *
 * The recorded papers are sandbox replies (content only).
 */

const fs = require('fs');
const path = require('path');

const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Reader = require('../../bot/shared/services/assessment/fde-reader');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { renderMarkingScheme } = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { conceptRepeats } = require('./helpers/urdu-concept-once');

const PAT = Patterns.get('fde_g5_2027');
const U = PAT.subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `r20-urdu-sandbox-${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const laid = (exam) => applyLayout(clone(exam), U, FDE, { reasked: false });
const prompt = (subject, section) => Gen.buildPatternUserPrompt({
  grade: 5, subject, pageContent: 'x', pageReference: '1', section, lang: 'ur', P: PAT.subjects[subject], scope: FDE,
});
const sectionWith = (P, slot) => P.sections.find((s) => s.slots.some((x) => x.slot === slot));

// The reader is asked through the engine's own call; the model boundary answers with `reply`.
async function askReader(exam, reply) {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  const out = await Gen._askReader({ examJson: exam, P: U, model: 'anthropic-direct/test', ownModel: 'anthropic-direct/test', job: 'assessment.generate.fde', usages: [] });
  return { ...out, sent: textOf(mockCreate.mock.calls[0][0]) };
}
const labelOf = (labels, re) => [...labels].find(([, q]) => re.test(q.question))[0];
const rulesOf = (sent) => sent.slice(0, sent.indexOf(Reader.PAPER_HEAD));

describe('reader: a definition stem and a quoted key word are give-aways', () => {
  test('full_2: the prompt sent names a definition stem as answering the item that asks for its term', async () => {
    const exam = read('full_2');
    const { labels } = Reader.buildReaderPrompt(exam, U);
    const def = labelOf(labels, /آواز ظاہر کرے/);
    const asks = labelOf(labels, /اسمِ صوت کون سا ہے/);
    const { sent, flags } = await askReader(exam, { candidates: [
      { item: asks, by: def, evidence: 'جو لفظ کسی انسان، جانور یا بے جان چیز کی آواز ظاہر کرے', reason: 'definition', given_away: true },
    ] });
    expect(rulesOf(sent)).toMatch(/DEFINES a term/);
    expect(rulesOf(sent)).toContain('آواز ظاہر کرے');
    expect(flags.map((f) => f.item)).toEqual([asks]);
  });

  test('full_1: the prompt sent names a stem that quotes the word its key is built from', async () => {
    const exam = read('full_1');
    const { labels } = Reader.buildReaderPrompt(exam, U);
    const self = labelOf(labels, /ایک ہی املا مگر مختلف معنی/);
    const { sent, flags } = await askReader(exam, { candidates: [
      { item: self, by: self, evidence: 'ان پڑھ', reason: 'quotes the key word', given_away: true },
    ] });
    expect(rulesOf(sent)).toMatch(/QUOTES the word its key is built from/);
    expect(flags.map((f) => f.item)).toEqual([self]);
  });
});

describe('urdu Section A prompt', () => {
  const A = prompt('urdu', sectionWith(U, 'urdu.A.Q1'));
  const others = [
    ...U.sections.filter((s) => s !== sectionWith(U, 'urdu.A.Q1')).map((s) => prompt('urdu', s)),
    ...Object.keys(PAT.subjects).filter((k) => k !== 'urdu').flatMap((k) => PAT.subjects[k].sections.map((s) => prompt(k, s))),
  ];
  const lines = [/homograph \(ایک ہی املا\)/, /اسم صوت، اسم آلہ، اسم معرفہ، اسم نکرہ، صفت، موصوف/, /at most 3 items from one word table/];

  test('carries the homograph line, the named concepts with definition items, and the word-table cap', () => {
    lines.forEach((re) => expect(A).toMatch(re));
    expect(A).toMatch(/a definition item asks its concept/);
  });

  test('no other urdu section, and no other subject, carries them', () => {
    others.forEach((p) => lines.forEach((re) => expect(p).not.toMatch(re)));
  });
});

describe('urdu Q6 (ب): no scheme point above 2 marks', () => {
  const q6 = (exam) => items(exam, 'urdu.C.Q6')[0];

  test('full_2: the model-written A4 is split into its two ideas, 2 + 2, and K1 stays', () => {
    const full2 = read('full_2');
    expect(q6(full2).scheme.points.map((p) => p.marks)).toEqual([1, 4]);
    const points = q6(normaliseScheme(clone(full2)).examJson).scheme.points;
    expect(points).toEqual([
      { kind: 'K', marks: 1, text: 'ندی کی صفائی کی درخواست کا ذکر' },
      { kind: 'A', marks: 2, text: 'صفائی میں ندی اور انسان دونوں کے فائدے کا ذکر' },
      { kind: 'A', marks: 2, text: 'صاف پانی سے بیماریوں سے بچاؤ اور خوشی کا ذکر' },
    ]);
  });

  test('full_2: the printed scheme has no A4 chip on Q6', () => {
    const { examJson } = normaliseScheme(clone(read('full_2')));
    const html = renderMarkingScheme({ examJson, grade: 5, subject: 'urdu' });
    const rows = html.split('<tr').filter((r) => r.includes('data-row="urdu.C.Q6"'));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r).not.toMatch(/<span class="chip">[A-Z][3-9]/));
  });

  test('full_1 and chapters_1: points of 2 marks or less are left as they are', () => {
    for (const name of ['full_1', 'chapters_1']) {
      const exam = read(name);
      expect(q6(normaliseScheme(clone(exam)).examJson).scheme.points).toEqual(q6(exam).scheme.points);
    }
  });

  test('a comma-joined point of 3 marks splits into its ideas in halves that add to 3', () => {
    const exam = read('full_2');
    q6(exam).scheme.points = [{ kind: 'A', marks: 3, text: 'صفائی کی درخواست، دونوں کا فائدہ، بیماری سے بچاؤ' }, { kind: 'A', marks: 2, text: 'خوشی' }];
    const points = q6(normaliseScheme(exam).examJson).scheme.points;
    expect(points.map((p) => p.text)).toEqual(['صفائی کی درخواست', 'دونوں کا فائدہ', 'بیماری سے بچاؤ', 'خوشی']);
    expect(points.map((p) => p.marks)).toEqual([1, 1, 1, 2]);
  });

  test('a point above 2 marks with one idea stays one point (nothing to split on)', () => {
    const exam = read('full_2');
    q6(exam).scheme.points = [{ kind: 'K', marks: 3, text: 'ندی کی بے بسی' }, { kind: 'A', marks: 2, text: 'صفائی کا پیغام' }];
    expect(q6(normaliseScheme(exam).examJson).scheme.points.map((p) => p.marks)).toEqual([3, 2]);
  });

  test('one model point of the whole 5 marks with nothing to split on is written again on the answer\'s sentences', () => {
    const exam = read('full_2');
    const q = q6(exam);
    q.answer = 'ندی کہتی ہے کہ میں بے بس ہوں اور میری فریاد کوئی نہیں سنتا۔ اگر لوگ مجھے صاف رکھیں تو سب کو صاف پانی ملے گا۔';
    q.scheme.points = [{ kind: 'A', marks: 5, text: 'ندی کی فریاد کا درست مفہوم' }];
    const { examJson } = normaliseScheme(exam);
    const points = q6(examJson).scheme.points;
    expect(points.map((p) => p.marks)).toEqual([2.5, 2.5]);
    expect(points.map((p) => p.text)).toEqual(['ندی کہتی ہے کہ میں بے بس ہوں اور میری فریاد کوئی نہیں سنتا۔', 'اگر لوگ مجھے صاف رکھیں تو سب کو صاف پانی ملے گا۔']);
    expect(examJson._layout.scheme_shortfall.filter((f) => f.slot === 'urdu.C.Q6' && f.filled_by === 'code')).toHaveLength(1);
  });

  test('the same split is not made on another subject\'s written row', () => {
    const S = PAT.subjects.science;
    const slot = S.sections.flatMap((s) => s.slots).find((x) => x.shape !== 'mcq' && x.category !== 'objective' && !['comprehension', 'situation', 'composition'].includes(x.shape));
    const exam = { unseen: { subjective: { Long: [{ slot: slot.slot, marks: 4, answer: 'x', question: 'y', scheme: { points: [{ kind: 'A', marks: 4, text: 'one (two), three' }] } }] } }, _layout: clone(read('full_2')._layout) };
    exam._layout.sections = S.sections;
    expect(items(normaliseScheme(exam).examJson, slot.slot)[0].scheme.points).toEqual([{ kind: 'A', marks: 4, text: 'one (two), three' }]);
  });

  test('the urdu prompt for the section with Q6 asks for one idea per point, no point above 2 marks', () => {
    const sec = sectionWith(U, 'urdu.C.Q6');
    expect(prompt('urdu', sec)).toMatch(/one idea per point, no point above 2 marks/);
    U.sections.filter((s) => s !== sec).forEach((s) => expect(prompt('urdu', s)).not.toMatch(/no point above 2 marks/));
  });
});

describe('urdu Q4: the group word is never one of the listed words', () => {
  const stems = (exam) => items(exam, 'urdu.C.Q4').map((q) => q.question);

  // A stem that lists four words of its own, apart from the options, keyed on one of them.
  const listedApart = (exam) => {
    const q = items(exam, 'urdu.C.Q4').find((x) => /گروہی/.test(x.question));
    q.question = 'گروہی لفظ منتخب کریں: تھرمامیٹر، نبض، دوا، ڈاکٹر';
    q.options = ['الف) اسپتال', 'ب) ڈاکٹر', 'ج) بازار', 'د) اسکول'];
    return q;
  };

  test('chapters_1: a stem listing «تھرمامیٹر، نبض، دوا، ڈاکٹر» apart from its options and keyed ڈاکٹر is held', () => {
    const ch1 = read('chapters_1');
    const q = listedApart(ch1);
    q.answer = 'ب) ڈاکٹر';
    q.scheme.accept = [q.answer];
    expect(stems(laid(ch1).examJson)).toEqual(stems(ch1).filter((s) => s !== q.question));
  });

  test('chapters_1: the same stem keyed اسپتال, the word outside the list, is kept', () => {
    const ch1 = read('chapters_1');
    const q = listedApart(ch1);
    q.answer = 'الف) اسپتال';
    q.scheme.accept = [q.answer];
    expect(stems(laid(ch1).examJson)).toEqual(stems(ch1));
  });

  test('recorded: «… متعلق ہیں: سورج، کرنیں، دھوپ، روشنی» with سورج the one option its list prints is held', () => {
    const rec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'r16-urdu-local-chapters3.json'), 'utf8'));
    const q = items(rec, 'urdu.C.Q4').find((x) => /سورج، کرنیں/.test(x.question));
    expect(q.answer).toBe('الف) سورج');
    expect(stems(applyLayout(clone({ unseen: rec.unseen }), U, rec._scope, { reasked: false }).examJson)).not.toContain(q.question);
  });

  test('chapters_1 Q4 ۱ (its list is its own four options, «دوست، دشمن، ساتھی، ہم راہ» → دشمن) is not held in code: the prompt line carries it', () => {
    const ch1 = read('chapters_1');
    const odd = items(ch1, 'urdu.C.Q4').find((q) => /گروہی/.test(q.question));
    expect(odd.answer).toBe('ب) دشمن');
    expect(stems(laid(ch1).examJson)).toEqual(stems(ch1));
  });

  test('full_1 and full_2 keep every Q4 item (their group words are not in the list)', () => {
    for (const name of ['full_1', 'full_2']) {
      const exam = read(name);
      expect(stems(laid(exam).examJson)).toEqual(stems(exam));
    }
  });

  test('the urdu prompt for the section with Q4 says the group word is not one of the listed words', () => {
    expect(prompt('urdu', sectionWith(U, 'urdu.C.Q4'))).toMatch(/the group word is NOT one of the words the item lists/);
  });
});

// The Urdu page text's numeral dates are not reliable (years lose a digit, «۱۹۱۳ء» reads «۱۹۳ ء»),
// so a board-pattern item keyed on a year, a date or a day of the month is held, and the Section A
// and C prompts say never to ask one.
describe('urdu: no item keyed on a year or a date', () => {
  const stemsOf = (exam, slot) => items(exam, slot).map((q) => q.question);
  const yearStem = 'محترمہ فاطمہ جناح نے کس سال سینئر کیمبرج کا امتحان پاس کیا، جس کے بعد انھوں نے کلکتہ میں داخلہ لیا؟';

  test('chapters_1 Q1 ۲۰ keyed «۱۹۱۹ء» is held, and every other Q1 item prints', () => {
    const ch1 = read('chapters_1');
    const q = items(ch1, 'urdu.A.Q1').find((x) => x.question === yearStem);
    expect(q.answer).toBe('ب) ۱۹۱۹ء');
    const out = stemsOf(laid(ch1).examJson, 'urdu.A.Q1');
    expect(out).not.toContain(yearStem);
    // Laid on the full syllabus, which asks the antonym and the synonym once: their later items are held too.
    const again = conceptRepeats(items(ch1, 'urdu.A.Q1'));
    expect(out).toEqual(stemsOf(ch1, 'urdu.A.Q1').filter((s) => s !== yearStem && !again.includes(s)));
  });

  test('after the re-ask the held year item is not put back', () => {
    const ch1 = read('chapters_1');
    const out = applyLayout(clone(ch1), U, FDE, { reasked: true });
    expect(stemsOf(out.examJson, 'urdu.A.Q1')).not.toContain(yearStem);
  });

  // One Q1 item of chapters_1, its key and accept replaced.
  const withKey = (answer, accept) => {
    const ch1 = read('chapters_1');
    const q = items(ch1, 'urdu.A.Q1').find((x) => x.question !== yearStem);
    q.question = 'یہ سوال کس کا ہے؟';
    q.options = ['الف) ایک', 'ب) دو', 'ج) تین', 'د) چار'];
    q.answer = answer;
    q.scheme = { ...(q.scheme || {}), accept: accept || [answer] };
    return { ch1, held: !stemsOf(laid(ch1).examJson, 'urdu.A.Q1').includes(q.question) };
  };

  test.each([
    ['a Latin-digit year', 'الف) 1947ء'],
    ['a year with a space before «ء»', 'الف) ۱۸۷۷ ء'],
    ['a day and a month', 'الف) ۱۴ اگست'],
    ['a month and a day', 'الف) اگست ۱۴'],
    ['a day of an Islamic month', 'الف) ۱۲ ربیع الاول'],
    ['a bare four-digit year', 'الف) ۱۹۴۷'],
  ])('a key carrying %s is held', (_, answer) => {
    expect(withKey(answer).held).toBe(true);
  });

  test('a year in the accept list only is held', () => {
    expect(withKey('الف) ایک', ['الف) ایک', 'سن ۱۹۴۷ء']).held).toBe(true);
  });

  test.each([
    ['a word', 'الف) ایک'],
    ['a small number', 'الف) ۲۵'],
    ['a month without a day', 'الف) اگست'],
  ])('a key carrying %s is kept', (_, answer) => {
    expect(withKey(answer).held).toBe(false);
  });

  test('a Section C item keyed on a date is held there too', () => {
    const ch1 = read('chapters_1');
    const q = items(ch1, 'urdu.C.Q4').find((x) => /مستقبل/.test(x.question));
    q.question = 'فعلِ حال کو فعلِ مستقبل میں بدل کر جملہ دوبارہ لکھیں: میلہ ۲۵ دسمبر کو لگتا ہے۔';
    q.answer = 'میلہ ۲۵ دسمبر کو لگے گا۔';
    q.scheme.accept = [q.answer];
    expect(stemsOf(laid(ch1).examJson, 'urdu.C.Q4')).not.toContain(q.question);
  });

  test('a dated letter or essay is a model, not a key, and prints', () => {
    const ch1 = read('chapters_1');
    for (const slot of ['urdu.C.Q8', 'urdu.C.Q10']) items(ch1, slot)[0].answer = `۱۵ مئی ۲۰۲۴ء\n${items(ch1, slot)[0].answer}`;
    for (const slot of ['urdu.C.Q8', 'urdu.C.Q10']) expect(stemsOf(laid(ch1).examJson, slot)).toEqual(stemsOf(ch1, slot));
  });

  test('the Section A and C prompts say never to ask a year or a date; Section B does not', () => {
    const rule = /Never ask an item whose answer is a year, a date or a day of the month/;
    expect(prompt('urdu', sectionWith(U, 'urdu.A.Q1'))).toMatch(rule);
    expect(prompt('urdu', sectionWith(U, 'urdu.C.Q4'))).toMatch(rule);
    expect(prompt('urdu', sectionWith(U, 'urdu.B.Q2'))).not.toMatch(rule);
  });

  test('other subjects do not carry the line', () => {
    for (const subject of ['science', 'maths', 'english', 'social_studies']) {
      for (const section of PAT.subjects[subject].sections) expect(prompt(subject, section)).not.toMatch(/a year, a date or a day of the month/);
    }
  });
});
