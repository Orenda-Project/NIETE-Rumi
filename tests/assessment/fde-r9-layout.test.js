/**
 * What the ninth review round asked of the board-pattern layout and renderer,
 * through the real chain (applyLayout → renderPaper / renderMarkingScheme):
 *
 *   1. An item the slot letters itself ((a), (b)) prints its letter once:
 *      «(a) Write an application…», never «(a) (a) Write an application…».
 *   2. One section never gives another away. English: a Q1(a) MCQ carrying one of
 *      Q4's words is held. Social Studies: a Q5 or Q7 item asking the fact a Q1
 *      MCQ already tests is held. A held item takes no place, so the next item
 *      in reply order (the re-asked section's, appended after the first reply)
 *      fills it; with none left the slot is short. The other slot is never touched.
 *
 * Pure: HTML strings, no browser. The stored papers are sandbox / local
 * generations with no person in them; the extra items are fictional.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;
const clone = (o) => JSON.parse(JSON.stringify(o));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/\s+/g, ' ');
}

const SCOPE = { kind: 'chapters', chapters: [1, 2], pages: null };
const lay = (exam, subject) => applyLayout(clone(exam), P[subject], SCOPE, { now: NOW });

// The placed items of one slot, in print order.
function slotItems(exam, slot) {
  const out = [];
  for (const types of Object.values(exam.unseen || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list)) out.push(...list.filter((q) => q && q.slot === slot));
    }
  }
  return out;
}

// Appends items to the model's tree the way the engine's top-up does: after the first reply's.
function withExtra(exam, slot, extra) {
  const out = clone(exam);
  const type = Object.entries(out.unseen).flatMap(([cat, types]) => Object.keys(types).map((t) => [cat, t]))
    .find(([cat, t]) => out.unseen[cat][t].some((q) => q.slot === slot));
  out.unseen[type[0]][type[1]].push(...extra.map((q) => ({ ...q, slot })));
  return out;
}

describe('r9 · an item the slot letters prints its letter once', () => {
  // The stored sandbox paper as it was laid out, straight into the renderer.
  const laid = fixture('r9-english-alt-label');

  test('the paper prints «(a) Write an application…» once', () => {
    const text = visible(R.renderPaper({ examJson: laid, grade: 5, subject: 'english', answerLines: true }));
    expect(text).not.toMatch(/\(a\)\s*\(a\)/);
    expect(text).not.toMatch(/\(b\)\s*\(b\)/);
    expect(text).toContain('Write an application to your principal for sick leave.');
    expect(text).toContain('Write a letter to your friend thanking them for a gift.');
  });

  test('the marking scheme prints the letter once (in its number cell, not again in the row)', () => {
    const text = visible(R.renderMarkingScheme({ examJson: laid, grade: 5, subject: 'english' }));
    expect(text).toContain('Write an application to your principal for sick leave.');
    expect(text).not.toContain('(a) Write an application');
    expect(text).not.toContain('(b) Write a letter');
  });

  test('the stored item keeps its own text (only the print drops the letter)', () => {
    const q7 = slotItems(laid, 'english.C.Q7');
    expect(q7.map((q) => q.question)).toEqual([
      '(a) Write an application to your principal for sick leave.',
      '(b) Write a letter to your friend thanking them for a gift.',
    ]);
  });

  test('a slot that does not letter its items keeps a leading (a)', () => {
    const exam = clone(laid);
    const q9 = slotItems(exam, 'english.C.Q9')[0];
    q9.question = '(a) a lost kite — a kind neighbour — Moral';
    const text = visible(R.renderPaper({ examJson: exam, grade: 5, subject: 'english', answerLines: true }));
    expect(text).toContain('(a) a lost kite');
  });
});

describe('r9 · English: a Q1(a) MCQ carrying a Q4 word is held', () => {
  const exam = fixture('r9-english-giveaway');
  const words = slotItems(exam, 'english.C.Q4')[0].words;

  test('q1a mcqs naming invisible, forgiveness, invent are held; the slot goes short by three', () => {
    const out = lay(exam, 'english');
    const q1a = slotItems(out.examJson, 'english.A.Q1a');
    const texts = q1a.map((q) => [q.question, ...(q.options || [])].join(' '));
    for (const w of ['invisible', 'forgiveness', 'invent']) {
      expect(texts.some((t) => new RegExp(`\\b${w}\\b`, 'i').test(t))).toBe(false);
    }
    expect(out.shortfall).toEqual(expect.arrayContaining([{ slot: 'english.A.Q1a', missing: 3 }]));
  });

  test('Q4 is never touched', () => {
    const out = lay(exam, 'english');
    const q4 = slotItems(out.examJson, 'english.C.Q4');
    expect(q4).toHaveLength(1);
    expect(q4[0].words).toEqual(words);
  });

  test('a held mcq takes no place: the re-asked items fill it, none of them a Q4 word', () => {
    const extra = [
      { question: "Choose the correct article: ___ apple.", options: ['a) a', 'b) an', 'c) the', 'd) no article'], answer: 'b) an' },
      { question: "What does the word 'invisible' mean here?", options: ['a) hidden', 'b) loud', 'c) bright', 'd) wet'], answer: 'a) hidden' },
      { question: 'Which word is a noun?', options: ['a) run', 'b) happy', 'c) table', 'd) quickly'], answer: 'c) table' },
      { question: 'Pick the plural of box.', options: ['a) boxs', 'b) boxes', 'c) boxies', 'd) box'], answer: 'b) boxes' },
    ];
    const out = lay(withExtra(exam, 'english.A.Q1a', extra), 'english');
    const q1a = slotItems(out.examJson, 'english.A.Q1a');
    expect(out.shortfall.find((f) => f.slot === 'english.A.Q1a')).toBeUndefined();
    expect(q1a).toHaveLength(P.english.sections[0].slots.find((s) => s.slot === 'english.A.Q1a').generate);
    expect(q1a.map((q) => q.question)).toEqual(expect.arrayContaining([
      'Choose the correct article: ___ apple.', 'Which word is a noun?', 'Pick the plural of box.',
    ]));
    expect(q1a.some((q) => /invisible/i.test(q.question))).toBe(false);
  });
});

describe('r9 · Social Studies: a Q5/Q7 item asking a Q1 fact is held', () => {
  test('chapters paper: Q7 «first province to join Pakistan» (Q1 keys سندھ) and «Senate members» (Q1 keys 104) are held', () => {
    const exam = fixture('r9-sst-chapters2');
    const out = lay(exam, 'social_studies');
    const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.some((t) => t.includes('پاکستان میں شامل ہونے والا پہلا صوبہ'))).toBe(false);
    expect(q7.some((t) => t.includes('ایوان بالا (سینیٹ) میں ممبران کی تعداد'))).toBe(false);
    expect(out.shortfall).toEqual(expect.arrayContaining([{ slot: 'social_studies.D.Q7', missing: 2 }]));
  });

  test('full paper: Q7 «second-largest salt mine» (Q1 keys کھیوڑہ) is held; Q7 naming a Q1-stem person for another fact is kept', () => {
    const exam = fixture('r9-sst-full2');
    const out = lay(exam, 'social_studies');
    const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.some((t) => t.includes('دنیا کی دوسری بڑی نمک کی کان'))).toBe(false);
    expect(q7).toContain('پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟');
  });

  test('Q1 is never touched', () => {
    const exam = fixture('r9-sst-chapters2');
    const before = slotItems(exam, 'social_studies.A.Q1').map((q) => q.question);
    const out = lay(exam, 'social_studies');
    expect(slotItems(out.examJson, 'social_studies.A.Q1').map((q) => q.question).sort()).toEqual(before.sort());
  });

  test('a held Q7 item takes no place: the re-asked item fills it', () => {
    const exam = fixture('r9-sst-chapters2');
    const extra = [
      { question: 'پاکستان کا قومی پھول کون سا ہے؟', answer: 'چنبیلی۔', scheme: { points: [{ kind: 'K', text: 'چنبیلی', marks: 2 }] } },
      { question: 'قائد اعظم کس شہر میں پیدا ہوئے؟', answer: 'کراچی میں۔', scheme: { points: [{ kind: 'K', text: 'کراچی', marks: 2 }] } },
    ];
    const out = lay(withExtra(exam, 'social_studies.D.Q7', extra), 'social_studies');
    const q7 = slotItems(out.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(out.shortfall.find((f) => f.slot === 'social_studies.D.Q7')).toBeUndefined();
    expect(q7).toEqual(expect.arrayContaining(['پاکستان کا قومی پھول کون سا ہے؟', 'قائد اعظم کس شہر میں پیدا ہوئے؟']));
  });

  test('on the first reply every repeat is held; after the re-ask clean items fill first and a repeat comes back only for a place nothing else takes', () => {
    // The recorded round-7 paper's Q7 re-asks three Q1 facts word for word.
    const exam = fixture('r7-sst-item-text');
    const REPEATS = ['پاکستان کی سب سے بڑی عدالت کون سی ہے اور کہاں واقع ہے؟', 'پاکستان میں اس وقت کون سا آئین نافذ ہے؟', 'بیگم رعنا لیاقت علی خان نے 1949ء میں کون سا ادارہ قائم کیا؟'];
    const first = lay(exam, 'social_studies');
    const q7First = slotItems(first.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(first.shortfall).toEqual(expect.arrayContaining([{ slot: 'social_studies.D.Q7', missing: 3 }]));
    REPEATS.forEach((t) => expect(q7First).not.toContain(t));
    // The re-asked Section D brings two new items and one of the repeats again.
    const extra = [
      { question: 'پاکستان کا قومی پھول کون سا ہے؟', answer: 'چنبیلی۔' },
      { question: 'پاکستان کی سب سے بڑی عدالت کون سی ہے؟', answer: 'سپریم کورٹ آف پاکستان۔' },
      { question: 'پاکستان کا قومی کھیل کون سا ہے؟', answer: 'ہاکی۔' },
    ];
    const after = lay(withExtra(exam, 'social_studies.D.Q7', extra), 'social_studies');
    const q7 = slotItems(after.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(after.shortfall.find((f) => f.slot === 'social_studies.D.Q7')).toBeUndefined();
    expect(q7).toHaveLength(8);
    expect(q7).toEqual(expect.arrayContaining(['پاکستان کا قومی پھول کون سا ہے؟', 'پاکستان کا قومی کھیل کون سا ہے؟']));
    // One place is left after the two clean items: the first repeat in reply order takes it.
    expect(q7.filter((t) => REPEATS.includes(t))).toEqual([REPEATS[0]]);
    expect(q7.indexOf(REPEATS[0])).toBe(7);
  });

  test('one question once per slot: a re-asked item with the same stem, or the same options, key and nearly the same stem, is not placed again', () => {
    const exam = fixture('r9-english-giveaway');
    const extra = [
      { question: 'Which noun is a proper noun?', options: ['a) city', 'b) Lahore', 'c) river', 'd) teacher'], answer: 'b) Lahore' },
      { question: 'Which word is a countable noun?', options: ['a) water', 'b) chair', 'c) milk', 'd) sand'], answer: 'b) chair' },
      { question: 'Pick the plural of box.', options: ['a) boxs', 'b) boxes', 'c) boxies', 'd) box'], answer: 'b) boxes' },
      { question: 'Which word is a verb?', options: ['a) jump', 'b) table', 'c) green', 'd) slowly'], answer: 'a) jump' },
      { question: 'Which word is an adjective?', options: ['a) run', 'b) tall', 'c) chair', 'd) quickly'], answer: 'b) tall' },
    ];
    const q1a = slotItems(lay(withExtra(exam, 'english.A.Q1a', extra), 'english').examJson, 'english.A.Q1a').map((q) => q.question);
    expect(q1a).toHaveLength(20);
    expect(q1a).not.toContain('Which noun is a proper noun?');
    expect(q1a.filter((t) => t === 'Which word is a countable noun?')).toHaveLength(1);
    expect(q1a).toEqual(expect.arrayContaining(['Pick the plural of box.', 'Which word is a verb?', 'Which word is an adjective?']));
    // Two article items with the same options and key are two questions: both stay.
    expect(q1a.filter((t) => t.startsWith('Which article completes the sentence'))).toHaveLength(2);
  });

  test('a three-point Q5 item with one point cued by Q1 is kept; one whose points are all in a Q1 stem is held', () => {
    const exam = fixture('r9-sst-chapters2');
    const q5 = slotItems(lay(exam, 'social_studies').examJson, 'social_studies.C.Q5').map((q) => q.question);
    // «قانون بنانے والا ادارہ»: Q1 keys مقننہ, one point of three.
    expect(q5.some((t) => t.startsWith('اگر ملک میں قانون بنانے والا ادارہ نہ ہو'))).toBe(true);
    const def = withExtra(exam, 'social_studies.C.Q5', []);
    const q1 = slotItems(def, 'social_studies.A.Q1')[0];
    q1.question = 'ایک شخص کی وہ قانونی حیثیت جس سے وہ کسی ملک کا شہری تصور کیا جاتا ہے، کیا کہلاتی ہے؟';
    q1.options = ['الف) قومیت', 'ب) شہریت', 'ج) ثقافت', 'د) حکومت'];
    q1.answer = 'ب) شہریت';
    const target = slotItems(def, 'social_studies.C.Q5')[0];
    target.question = 'شہریت کسے کہتے ہیں؟ مختصر تعریف کریں۔';
    target.answer = 'شہریت ایک شخص کی وہ قانونی حیثیت ہے جس سے اسے کسی ملک کا شہری تصور کیا جاتا ہے، اور اس کے ساتھ حقوق اور فرائض ملتے ہیں۔';
    target.scheme = { accept: [], points: [{ kind: 'K', text: 'قانونی حیثیت', marks: 1.5 }, { kind: 'K', text: 'ملک کا شہری تصور', marks: 1.5 }] };
    const after = slotItems(lay(def, 'social_studies').examJson, 'social_studies.C.Q5').map((q) => q.question);
    expect(after).not.toContain('شہریت کسے کہتے ہیں؟ مختصر تعریف کریں۔');
  });

  test('Urdu-Indic digits and option letters match: a key written ۱۰۴ still holds the 104 item', () => {
    const exam = fixture('r9-sst-chapters2');
    for (const q of slotItems(exam, 'social_studies.A.Q1')) {
      if (q.answer === 'ب) 104') { q.answer = 'ب) ۱۰۴'; q.options = q.options.map((o) => o.replace('104', '۱۰۴')); }
    }
    const q7 = slotItems(lay(exam, 'social_studies').examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(q7.some((t) => t.includes('ایوان بالا (سینیٹ) میں ممبران کی تعداد'))).toBe(false);
  });
});

describe('r9 · subjects without a cross-section table lay out as before', () => {
  // sha256 of JSON.stringify(applyLayout(…)) recorded from the code before this change (sandbox a843a14b0).
  const BEFORE = {
    science: ['science', 'c89b21fc0d5a437e51246e5f213f96f99ebd7eb7fa052e5a166c2623ff91bbe7'],
    maths: ['maths', 'd88bce6f7767acff4db300d0b252353f94e37b040ce2e8dce32e171f1a5fee95'],
    urdu: ['urdu', 'd5ed4cd3602d4b2835292ccc4feaa3365c18f6fbf02b265abb305cc8a1cd5f0c'],
    'r7-science-full1.exam': ['science', '2956ee5a438aa0fe16d14a4e2a4dabcfcb1cea63b813eb234abd75bd0598e7d2'],
    'urdu-gen-full': ['urdu', 'd3d1b1fbea67508c1be28d8198d5d01ddbc55d1e1d931950682d5e6dc6600c28'],
  };
  test.each(Object.keys(BEFORE))('%s lays out byte-identical to before', (name) => {
    const [subject, sha] = BEFORE[name];
    const out = applyLayout(fixture(name), P[subject], { kind: 'fde', chapters: null, pages: null }, { now: NOW });
    expect(require('crypto').createHash('sha256').update(JSON.stringify(out)).digest('hex')).toBe(sha);
  });
});

describe('r9 · English: a Q4 entry too short to be a word holds nothing', () => {
  test('a stray one-letter Q4 entry does not hold every MCQ through its option labels', () => {
    const exam = fixture('r9-english-giveaway');
    slotItems(exam, 'english.C.Q4')[0].words = ['a', 'b'];
    const out = lay(exam, 'english');
    expect(out.shortfall.find((f) => f.slot === 'english.A.Q1a')).toBeUndefined();
  });
});
