/**
 * v37 G5 language round-6 rows (bd-5jmnfj.4.58): English Q1(b) accept lines, Q2 repeats and stated-false, Q2 i(b), Q3 printed
 * apostrophe and end marks, Q8 sentence range, Q10 picture key; Urdu Q1 stems, Q6 poem points, Q7 picture key.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { mendLangKey } = require('../../bot/shared/services/assessment/fde-g5-lang-key-mends');
const { langFixes } = require('../../bot/shared/services/assessment/fde-g5-lang-fixes');
const { poemPaysPrinted } = require('../../bot/shared/services/assessment/fde-g5-lang-checks');
const { langGiveaways } = require('../../bot/shared/services/assessment/fde-g5-lang-giveaways');
const { openItemsWithoutAccept } = require('../../bot/shared/services/assessment/fde-scheme-checks');

const P = Patterns.get('fde_g5_2027');
const rule = (subject, id) => P.subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id).prompt_rule;

describe('prompt rules', () => {
  test('English Q1(b): every simile or metaphor item carries an accept line of two different rewrites', () => {
    expect(rule('english', 'english.A.Q1b')).toMatch(/accept line of at least two different correct rewrites/);
  });
  test('English Q2: a true/false item never restates a part i question; a False statement is contradicted by the passage', () => {
    const r = rule('english', 'english.B.Q2');
    expect(r).toMatch(/never restates the fact a part i question asks/);
    expect(r).toMatch(/False statement is contradicted by a sentence the passage states/);
  });
  test('English Q2: a "why do you think" item asks a reason the passage does not state', () => {
    expect(rule('english', 'english.B.Q2')).toMatch(/every point can be earned by copying the passage/);
  });
  test('English Q3: no point pays punctuation printed in the question; an end mark point accepts a full stop or an exclamation mark', () => {
    const r = rule('english', 'english.C.Q3');
    expect(r).toMatch(/No point pays a mark already printed in `question`/);
    expect(r).toMatch(/full stop or an exclamation mark/);
  });
  test('English Q8: the model answer states no sentence range; content pays any N relevant ideas', () => {
    const r = rule('english', 'english.C.Q8');
    expect(r).toMatch(/model answer states no sentence count or range/);
    expect(r).toMatch(/any N relevant ideas/);
  });
  test('English Q10 and Urdu Q7: the key states only what describe lists, counts and empty seats included', () => {
    expect(rule('english', 'english.C.Q10')).toMatch(/model answer states only what `describe_en` lists/);
    expect(rule('english', 'english.C.Q10')).toMatch(/empty bench/);
    expect(rule('urdu', 'urdu.C.Q7')).toMatch(/model answer states only what `describe_en` lists/);
    expect(rule('urdu', 'urdu.C.Q7')).toMatch(/balloon/);
  });
  test('Urdu Q1: a stem is complete without unprinted text; idiom and homophone stems have a fixed shape', () => {
    const r = rule('urdu', 'urdu.A.Q1');
    expect(r).toMatch(/never points at text the paper does not print/);
    expect(r).toMatch(/never quotes a sentence that does not use the idiom/);
    expect(r).toMatch(/املا ایک جیسی/);
  });
  test('Urdu Q6: points pay the meaning, never a printed line', () => {
    expect(rule('urdu', 'urdu.C.Q6')).toMatch(/no point restates a printed line/);
  });
});

describe('English Q1(b): an open rewrite gets a rule when the writer gave no accept line', () => {
  const slot = { slot: 'english.A.Q1b' };
  const q = (question, answer) => ({ slot: 'english.A.Q1b', question, answer, marks: 1 });

  test.each([
    ["The runner was fast. (Rewrite as a simile using 'as ... as')", 'The runner was as fast as a cheetah.', /as … as/],
    ['The classroom was noisy like a zoo. (Rewrite as a metaphor)', 'The classroom was a noisy zoo.', /no 'like' or 'as'/],
    ["The baby's cheeks were red. (Rewrite as a simile using 'like')", "The baby's cheeks were like ripe apples.", /'like'/],
  ])('%s', (question, answer, rx) => {
    const notes = [];
    const out = mendLangKey(q(question, answer), slot, notes);
    expect(out.scheme.accept).toHaveLength(2);
    expect(out.scheme.accept[0]).toBe(answer);
    expect(out.scheme.accept[1]).toMatch(rx);
    expect(openItemsWithoutAccept({ unseen: { x: { y: [out] } } }, {})).toEqual([]);
    expect(notes.join(' ')).toMatch(/english\.A\.Q1b/);
  });

  test('an item with two accept entries is untouched', () => {
    const item = { ...q('x (Rewrite as a metaphor)', 'a'), scheme: { accept: ['a', 'b'] } };
    expect(mendLangKey(item, slot, [])).toBe(item);
  });
  test('a non-figure item (tense change) is untouched', () => {
    const item = q('Children play. (Change into simple past)', 'Children played.');
    expect(mendLangKey(item, slot, [])).toBe(item);
  });
  test('reached through langFixes', () => {
    const out = langFixes(q('x (Rewrite as a metaphor)', 'a'), slot, []);
    expect(out.scheme.accept).toHaveLength(2);
  });
});

describe('English Q3: no mark for punctuation already printed, no mark that needs one end mark', () => {
  const slot = { slot: 'english.C.Q3' };
  const base = () => ({
    slot: 'english.C.Q3', question: "friends it's time to save our favourite tree will you help me", answer: "Friends, it's time to save our favourite tree! Will you help me?",
    scheme: {
      points: [
        { text: 'Capital letters used correctly', marks: 1, kind: 'A' },
        { text: 'Comma correctly placed after Friends', marks: 1, kind: 'A' },
        { text: "Apostrophe correctly used in it's", marks: 1, kind: 'A' },
        { text: 'Exclamation mark and question mark correctly placed', marks: 1, kind: 'A' },
        { text: 'Commas in the list and a full stop at the end', marks: 1, kind: 'A' },
      ],
      accept: ['x', 'y'],
      common_error: "Leaving out the apostrophe in it's or using a full stop after the question.",
    },
  });

  test('the apostrophe point goes, its mark moves to the first point, the total holds', () => {
    const notes = [];
    const out = mendLangKey(base(), slot, notes);
    expect(out.scheme.points.some((p) => /apostrophe/i.test(p.text))).toBe(false);
    expect(out.scheme.points[0].marks).toBe(2);
    expect(out.scheme.points.reduce((s, p) => s + p.marks, 0)).toBe(5);
    expect(notes.join(' ')).toMatch(/apostrophe/);
  });
  test('the apostrophe clause leaves the common error, the rest stays', () => {
    expect(mendLangKey(base(), slot, []).scheme.common_error).toBe('Using a full stop after the question.');
  });
  test('an apostrophe point stays when the printed passage has none', () => {
    const q = base();
    q.question = 'friends its time to save our favourite tree';
    expect(mendLangKey(q, slot, []).scheme.points.some((p) => /apostrophe/i.test(p.text))).toBe(true);
  });
  test('the end-mark point accepts a full stop or an exclamation mark', () => {
    const out = mendLangKey(base(), slot, []);
    const t = out.scheme.points.find((p) => /question mark/i.test(p.text)).text;
    expect(t).toMatch(/full stop or an exclamation mark/);
    expect(t).toMatch(/question mark after the direct question/);
  });
});

describe('Urdu Q6: a poem whose points are its own printed lines', () => {
  const passage = 'ندی کی فریاد\nیہ گندگی ہے کیسی آئی ہے یہ کہاں سے؟\nشہروں کی یہ غلاظت آئی ہے کیسے بہہ کے؟\nدم گھٹ رہا ہے میرا بدبو ہے جان لیوا\nگرتا ہے مجھ میں آکے شہروں کا گندہ نالہ';
  const paper = (points) => ({ unseen: { x: { y: [{ slot: 'urdu.C.Q6', question: 'درج ذیل اشعار کا مفہوم واضح کریں۔', passage, answer: 'a', scheme: { points } }] } },
    _layout: { sections: [{ slots: [{ slot: 'urdu.C.Q6', type: 'y' }] }] } });
  const bad = [
    { text: 'ندی کا گندگی کے آنے پر سوال کرنا اور شہروں کی غلاظت کا بہہ کر آنا', marks: 2 },
    { text: 'بدبو سے دم گھٹنا اور اس کا جان لیوا ہونا', marks: 2 },
    { text: 'گندے نالے کا ندی میں گرنا', marks: 1 },
  ];
  const good = [
    { text: 'بولنے والی ندی ہے اور وہ آلودگی کی شکایت کرتی ہے', marks: 2 },
    { text: 'شہر کی گندگی کا ندی کو بیمار کرنا', marks: 2 },
    { text: 'ندی کا مدد مانگنا', marks: 1 },
  ];
  test('the v35 points are flagged', () => {
    const flags = poemPaysPrinted(paper(bad));
    expect(flags).toHaveLength(1);
    expect(flags[0].slot).toBe('urdu.C.Q6');
    expect(flags[0].reason).toBe('giveaway');
  });
  test('points that name the meaning are not', () => expect(poemPaysPrinted(paper(good))).toEqual([]));
  test('reaches the paper-wide list', () => expect(langGiveaways(paper(bad)).some((f) => f.slot === 'urdu.C.Q6')).toBe(true));
  test('an item without passage or points never throws', () => {
    expect(poemPaysPrinted({})).toEqual([]);
    expect(poemPaysPrinted(null)).toEqual([]);
    expect(poemPaysPrinted(paper([]))).toEqual([]);
  });
});

describe('v37 G5 Urdu Q10 rows 6, 11: the application form row is not a title row', () => {
  const { adjustCriteria } = require('../../bot/shared/services/assessment/fde-g5-criteria');
  test('RED a row that names عنوان inside the form list is kept; a row that opens with عنوان still goes', () => {
    const rows = [{ name: 'شکل: بخدمت، عنوان، جنابِ عالی، اختتام', marks: 3 }, { name: 'عنوان', marks: 1 }, { name: 'زبان', marks: 2 }];
    const out = adjustCriteria(rows, { slot: 'urdu.C.Q10', instruction_ur: 'درخواست لکھیں۔' });
    expect(out.map((r) => r.name)).toEqual(['شکل: بخدمت، عنوان، جنابِ عالی، اختتام', 'زبان']);
    expect(out.reduce((s, r) => s + r.marks, 0)).toBe(6);
  });
});
