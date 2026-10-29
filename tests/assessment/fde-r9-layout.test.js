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
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  // Its Q1 «سندھ کو الگ صوبہ کب بنایا گیا؟» names the key of Q1 «… پہلا صوبہ …», which holds that item (a Q1 stem
  // that names another Q1 item's key); these tests read the Q5/Q7 hold against it, so the stem asks the same year
  // without the name.
  if (name === 'r9-sst-chapters2') j.unseen.objective.MCQs.find((q) => q.question === 'سندھ کو الگ صوبہ کب بنایا گیا؟').question = 'بمبئی سے الگ ہو کر ایک نیا صوبہ کس سال بنا؟';
  return j;
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/\s+/g, ' ');
}

const SCOPE = { kind: 'chapters', chapters: [1, 2], pages: null };
const lay = (exam, subject) => applyLayout(clone(exam), P[subject], SCOPE, { now: NOW });
// After the engine's one re-ask (the re-asked section's items appended, as the top-up does).
const layAfter = (exam, subject) => applyLayout(clone(exam), P[subject], SCOPE, { now: NOW, reasked: true });

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

  test('Q1 is never touched by the Q5/Q7 hold', () => {
    const exam = fixture('r9-sst-chapters2');
    // The cross-section hold never touches Q1. One recorded Q1 MCQ keys encroachment removal to the
    // local government; the book's p.29 table says provincial, so the which-government check (a
    // wrong key, not a repeat) holds it. Two more are given away by a Q7 stem that prints their key
    // on the same topic (Q7 «بلوچستان میں مہر گڑھ …», «چودھری رحمت علی نے … پاکستان کا نام تجویز کیا؟»),
    // so Section A is asked again for them; that hold reads Q1 against C and D, never the reverse.
    const WRONG_TIER = 'ایک شہر کی سڑکوں اور راستوں سے تجاوزات ہٹانے کا کام کون سی حکومت کرتی ہے؟';
    const GIVEN = ['مہر گڑھ کی قدیم تہذیب کے آثار کس صوبے سے دریافت ہوئے ہیں؟', 'پاکستان کا نام سب سے پہلے کس نے تجویز کیا؟'];
    const before = slotItems(exam, 'social_studies.A.Q1').map((q) => q.question).filter((q) => q !== WRONG_TIER && !GIVEN.includes(q));
    expect(before).toHaveLength(slotItems(exam, 'social_studies.A.Q1').length - 3);
    const out = lay(exam, 'social_studies');
    // Q1 items whose key (a name or a term) a C/D stem names are held by that rule as well, Q1 against C and D again.
    const named = out.held.filter((h) => h.slot === 'social_studies.A.Q1' && ['key_named_in_stem', 'key_in_own_stem', 'names_q1_key'].includes(h.rule)).map((h) => h.q.question);
    expect(slotItems(out.examJson, 'social_studies.A.Q1').map((q) => q.question).sort()).toEqual(before.filter((q) => !named.includes(q)).sort());
    const q1Held = out.held.filter((h) => h.slot === 'social_studies.A.Q1' && h.rule === 'key_in_stem').map((h) => h.q.question);
    expect(q1Held.sort()).toEqual([...GIVEN].sort());
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

  test('on the first reply every repeat is held; after the re-ask clean items fill and a repeat never comes back', () => {
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
    const after = layAfter(withExtra(exam, 'social_studies.D.Q7', extra), 'social_studies');
    const q7 = slotItems(after.examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(after.shortfall.find((f) => f.slot === 'social_studies.D.Q7')).toBeUndefined();
    expect(q7).toEqual(expect.arrayContaining(['پاکستان کا قومی پھول کون سا ہے؟', 'پاکستان کا قومی کھیل کون سا ہے؟']));
    // Since round 17 the place left after the two clean items stays empty: Q7 prints seven of eight.
    expect(q7.filter((t) => REPEATS.includes(t))).toEqual([]);
    expect(q7).toHaveLength(7);
  });

  test('before the re-ask a model extra does not bring a held item back: the slot stays short, so the section is asked again', () => {
    const exam = withExtra(fixture('r7-sst-item-text'), 'social_studies.D.Q7', [{ question: 'پاکستان کا قومی پھول کون سا ہے؟', answer: 'چنبیلی۔' }]);
    const out = lay(exam, 'social_studies');
    expect(out.shortfall).toEqual(expect.arrayContaining([{ slot: 'social_studies.D.Q7', missing: 2 }]));
  });

  test('after a re-ask that brought nothing new, the held items stay out: Q7 prints five, short of the six to answer plus one', () => {
    const out = layAfter(fixture('r7-sst-item-text'), 'social_studies');
    expect(out.shortfall.find((f) => f.slot === 'social_studies.D.Q7')).toEqual({ slot: 'social_studies.D.Q7', missing: 2 });
    expect(slotItems(out.examJson, 'social_studies.D.Q7')).toHaveLength(5);
  });

  test('one question once per slot: the same stem with the same options is not placed twice', () => {
    const exam = fixture('r9-english-giveaway');
    const first = slotItems(exam, 'english.A.Q1a')[3]; // «Which word is a proper noun?» river / teacher / Lahore / city
    const extra = [
      { question: first.question, options: ['a) city', 'b) Lahore', 'c) river', 'd) teacher'], answer: 'b) Lahore' },
      { question: 'Pick the plural of box.', options: ['a) boxs', 'b) boxes', 'c) boxies', 'd) box'], answer: 'b) boxes' },
      { question: 'Which word is a verb?', options: ['a) jump', 'b) table', 'c) green', 'd) slowly'], answer: 'a) jump' },
      { question: 'Which word is an adjective?', options: ['a) run', 'b) tall', 'c) chair', 'd) quickly'], answer: 'b) tall' },
    ];
    extra.push({ question: 'Which noun is a proper noun?', options: ['a) teacher', 'b) Lahore', 'c) city', 'd) river'], answer: 'b) Lahore' });
    const q1a = slotItems(layAfter(withExtra(exam, 'english.A.Q1a', extra), 'english').examJson, 'english.A.Q1a').map((q) => q.question);
    expect(q1a).toHaveLength(20);
    expect(q1a.filter((t) => t === first.question)).toHaveLength(1);
    // The same options and key, the stem differing only in a framing word: the same question.
    expect(q1a).not.toContain('Which noun is a proper noun?');
    expect(q1a).toEqual(expect.arrayContaining(['Pick the plural of box.', 'Which word is a verb?', 'Which word is an adjective?']));
    const q7 = withExtra(fixture('r9-sst-chapters2'), 'social_studies.D.Q7', [{ question: 'پاکستان کے پہلے وزیر اعظم کون تھے؟', answer: 'لیاقت علی خان۔' }]);
    const placed = slotItems(layAfter(q7, 'social_studies').examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(placed.filter((t) => t === 'پاکستان کے پہلے وزیر اعظم کون تھے؟')).toHaveLength(1);
  });

  test.each([
    ["Which word has a silent letter 'k'?", ['a) knife', 'b) kite', 'c) kind', 'd) keep'], "Which word has a silent letter 'b'?", ['a) thumb', 'b) bat', 'c) bed', 'd) big']],
    ['Which word is an abstract noun?', ['a) bravery', 'b) chair', 'c) river', 'd) book'], 'Which word is an abstract noun?', ['a) kindness', 'b) table', 'c) cup', 'd) tree']],
    ['Choose the correct article: ___ apple.', ['a) a', 'b) an', 'c) the', 'd) no article'], 'Choose the correct article: ___ umbrella.', ['a) a', 'b) an', 'c) the', 'd) no article']],
    ["How many syllables are in 'butterfly'?", ['a) 1', 'b) 2', 'c) 3', 'd) 4'], "How many syllables are in 'recycle'?", ['a) 1', 'b) 2', 'c) 3', 'd) 4']],
  ])('two questions stay two: %s / %s', (s1, o1, s2, o2) => {
    const exam = clone(fixture('r9-english-giveaway'));
    const list = Object.values(exam.unseen).flatMap((t) => Object.values(t)).find((l) => l.some((q) => q.slot === 'english.A.Q1a'));
    const at = list.findIndex((q) => q.slot === 'english.A.Q1a');
    list[at] = { ...list[at], question: s1, options: o1, answer: o1[2] };
    list[at + 1] = { ...list[at + 1], question: s2, options: o2, answer: o2[2] };
    const q1a = slotItems(lay(exam, 'english').examJson, 'english.A.Q1a');
    // Both stay, each once (options are turned round by the layout, so compare them as a set).
    const has = (stem, opts) => q1a.filter((q) => q.question === stem && [...q.options].map((o) => o.slice(3)).sort().join('|') === opts.map((o) => o.slice(3)).sort().join('|')).length;
    expect(has(s1, o1)).toBe(1);
    expect(has(s2, o2)).toBe(1);
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

  test('a reworded pair is still the same fact (three of the MCQ\'s eight words), and an answer that is only an MCQ\'s options is held', () => {
    const exam = fixture('r9-sst-chapters2');
    const q1 = slotItems(exam, 'social_studies.A.Q1');
    q1[1].question = '26 جون 1947ء کو پاکستان میں شامل ہونے کا فیصلہ کس کی اسمبلی نے کیا؟';
    const q7 = slotItems(exam, 'social_studies.D.Q7');
    q7[0].question = 'حکومت کے تین اعضا کے نام لکھیں۔';
    q7[0].answer = 'مقننہ، انتظامیہ اور عدلیہ';
    q7[0].scheme = { accept: [], points: [{ kind: 'K', text: 'تینوں نام', marks: 2 }] };
    const placed = slotItems(lay(exam, 'social_studies').examJson, 'social_studies.D.Q7').map((q) => q.question);
    expect(placed).not.toContain('پاکستان میں شامل ہونے والا پہلا صوبہ کون سا تھا؟');
    expect(placed).not.toContain('حکومت کے تین اعضا کے نام لکھیں۔');
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
  // maths and urdu re-recorded for bd-5jmnfj.19: the only change is each section's `levels` carried into
  // _layout; with it stripped they hash to the a843a14b0 values. urdu again when its A/C split moved to R20 / R10 U10
  // (with the old split restored they hash to the previous values).
  // maths again for bd-5jmnfj.11: Q4-8 gained `sub_numbering` and the angle options in its prompt_rule (with
  // those two fields restored it hashes to 0c31303f…).
  // All five again for bd-5jmnfj.4.26: the header lost disclaimer_*, footer_* and the covers suffix; nothing
  // else in the layout differs (with those six strings restored they hash to c89b21fc…, de227f21…, 8c2c920f…,
  // 2956ee5a…, 2b3b7900…).
  // science again for bd-5jmnfj.4.50.7: its Q1 keys ran «a c d a c d» and are dealt again; only Q1's
  // options and keys differ (each item keys the same option text).
  // science and r7-science again for bd-5jmnfj.4.51.10: the Q1 (b) frame's book_page is the item's page, not the
  // pattern's example 168 (with the 168 and the pattern value restored they hash to the earlier values).
  // maths, urdu and urdu-gen-full again for bd-5jmnfj.4.51.11: maths Q4 carries FDE's own obtuse/supplementary/
  // straight wording again, and urdu Q6 drops the Naat alternative; the same three hashes come out of the
  // previous code with only patterns/fde-g5-2027.js changed.
  // urdu and urdu-gen-full again for the v24 review: urdu Q7's prompt_rule asks for `describe_en`; with the old
  // rule restored they hash to the previous values.
  // maths again for bd-5jmnfj.4.55: Q4-8's prompt_rule asks for every length with its unit; with the old rule
  // restored it hashes to faf7fc6c….
  const BEFORE = {
    science: ['science', 'c09d5ceadd74d6dcb519af1330b9b7261318ce0ac6cfcc0c106c1e3c80c0f626'],
    maths: ['maths', 'a6718724d4bcc26940c78ee6ffac4a0b5370da08421eedf462b6e4e3ffb588cf'],
    urdu: ['urdu', '42f0f277e15402128c69a6f792a6e9f119a4e66a7c4271bc7d387509721d85a1'],
    'r7-science-full1.exam': ['science', 'ce648f1e8c5b69e1f16b822ff101f812c539f94c5450bf4afb98e59101f2a48a'],
    'urdu-gen-full': ['urdu', '4457288ac76d86f9c902ffa8ded3dcc860b776a2f4c297a648c05f1cb83aa93d'],
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
