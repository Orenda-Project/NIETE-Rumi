/**
 * Round 6 Urdu panel (G1/G2/G5): second answer that also fits, oblique blank, oral repeats, scene frame, whole marks,
 * Q10 model answers, and the prompt rules the engine asks of the writer.
 */
const A = '../../bot/shared/services/assessment/';
const { alternativeShortfall, conditionalPairShortfall } = require(`${A}fde-accept-alternatives`);
const { wordBoxFix } = require(`${A}fde-early-urdu-wordbox`);
const { urduOralBad } = require(`${A}fde-early-urdu-oral`);
const { urduG5Shortfall } = require(`${A}fde-urdu-g5-checks`);
const { pictureSceneShortfall, noteUndrawnScenes } = require(`${A}fde-picture-scene`);
const { wholeMarks } = require(`${A}fde-whole-marks`);
const { crossAskFlags } = require(`${A}fde-lang-cross-asks`);
const g1 = require(`${A}patterns/early/g1-urdu`);
const g2 = require(`${A}patterns/early/g2-urdu`);
const g5 = require(`${A}patterns/fde-g5-2027`);

const rule = (P, slot) => ((P.sections || P.subjects.urdu.sections || []).flatMap((s) => s.slots).find((s) => s.slot === slot) || {}).prompt_rule || '';
const paper = (slot, list, type = 'MCQs') => ({ unseen: { objective: { [type]: list.map((q) => ({ slot, ...q })) } } });

describe('B2 اگر، تو and جب، تب both offered', () => {
  const both = { question: '_____ تم محنت کرو گے _____ کامیاب ہو جاؤ گے۔', options: ['الف) اگر، تو', 'ب) جب، تب', 'ج) کیونکہ، اس لیے', 'د) جیسے، ویسے'], answer: 'الف) اگر، تو' };
  test('RED flags an item whose options hold both pairs', () => {
    const out = conditionalPairShortfall(paper('urdu.C.Q4', [both]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'urdu.C.Q4', reason: 'answer' });
    expect(out[0].items[0]).toMatch(/جب، تب/);
  });
  test('alternativeShortfall carries it; one pair alone is clean', () => {
    expect(alternativeShortfall(paper('urdu.C.Q4', [both]), { sections: [] }).some((f) => f.slot === 'urdu.C.Q4')).toBe(true);
    const one = { ...both, options: ['الف) اگر، تو', 'ب) کیونکہ، اس لیے', 'ج) جیسے، ویسے', 'د) لیکن، مگر'] };
    expect(conditionalPairShortfall(paper('urdu.C.Q4', [one]))).toEqual([]);
  });
});

describe('S2 oblique blank', () => {
  const ex = (q) => ({ unseen: { s: { 'Fill in the Blanks': [{ slot: 'g1.urdu.B.Q5', ...q }] } }, _layout: { sections: [{ slots: [{ slot: 'g1.urdu.B.Q5', type: 'Fill in the Blanks' }] }] } });
  test('RED a masculine -ا key before a postposition also accepts the oblique form', () => {
    const out = wordBoxFix(ex({ question: 'پرندہ اپنے ___ میں انڈے رکھتا ہے۔', answer: 'گھونسلا', scheme: { accept: ['گھونسلا'] } }));
    const q = out.examJson.unseen.s['Fill in the Blanks'][0];
    expect(q.scheme.accept).toEqual(expect.arrayContaining(['گھونسلا', 'گھونسلے']));
    expect(out.notes.join(' ')).toMatch(/گھونسلے/);
  });
  test('no oblique cue, no widening', () => {
    const out = wordBoxFix(ex({ question: 'یہ میرا ___ ہے۔', answer: 'بستہ', scheme: { accept: ['بستہ'] } }));
    expect(out.examJson.unseen.s['Fill in the Blanks'][0].scheme.accept).toEqual(['بستہ']);
    const fem = wordBoxFix(ex({ question: 'وہ اپنی ___ میں بیٹھا ہے۔', answer: 'دعا', scheme: { accept: ['دعا'] } }));
    expect(fem.examJson.unseen.s['Fill in the Blanks'][0].scheme.accept).toEqual(['دعا']);
  });
});

describe('S3 oral poem answers', () => {
  const it = (ask, answer) => ({ ask, answer });
  test('RED two questions with one answer are flagged', () => {
    const bad = urduOralBad('poem', [it('ٹوٹ بٹوٹ کے باپ کا نام کیا تھا؟', 'میر سلوٹ'), it('ٹوٹ بٹوٹ کے باپ کو کیا کہا گیا ہے؟', 'میر سلوٹ')], 'ٹوٹ بٹوٹ کے باپ میر سلوٹ');
    expect(bad.map((b) => b.reason)).toContain('repeats-answer');
  });
  test('RED an ask that holds another answer is flagged', () => {
    const bad = urduOralBad('poem', [it('بچے سے پہلے کون پیڑ پر بیٹھی ہوئی ہیں؟', 'ننھی چڑیاں'), it('ننھی چڑیاں پیڑ پر بیٹھ کر کیا گاتی ہیں؟', 'گیت')], 'ننھی چڑیاں پیڑ پر بیٹھ کر گیت گاتی ہیں');
    expect(bad.map((b) => b.reason)).toContain('gives-away');
  });
  test('distinct answers and clean asks pass', () => {
    expect(urduOralBad('poem', [it('باپ کا نام کیا تھا؟', 'میر سلوٹ'), it('ماں کا نام کیا تھا؟', 'بی بی گلاب')], 'میر سلوٹ بی بی گلاب')).toEqual([]);
  });
});

describe('B3 picture scene', () => {
  const layout = { sections: [{ slots: [{ slot: 'urdu.C.Q7', frame: { kind: 'picture', word_bank: true } }] }], supplies: [{ slot: 'urdu.C.Q7', kind: 'picture', line_en: 'Q7: Picture: zoo', line_ur: 'سوال 7: تصویر: چڑیا گھر' }] };
  const item = (extra) => ({ slot: 'urdu.C.Q7', question: 'چڑیا گھر کی سیر', words: ['بندر'], answer: 'ایک لڑکا بندر کو دیکھ رہا ہے۔', ...extra });
  test('RED an item with no describe_en is a shortfall', () => {
    const out = pictureSceneShortfall({ unseen: { s: { 'Picture Description': [item()] } }, _layout: layout });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'urdu.C.Q7', reason: 'answer' });
    expect(pictureSceneShortfall({ unseen: { s: { 'Picture Description': [item({ describe_en: 'A boy points at a monkey.' })] } }, _layout: layout })).toEqual([]);
  });
  test('RED a scene that was not drawn is printed on the teacher line', () => {
    const ex = { unseen: { s: { 'Picture Description': [item({ describe_en: 'A boy points at a monkey.' })] } }, _layout: JSON.parse(JSON.stringify(layout)) };
    noteUndrawnScenes(ex);
    expect(ex._layout.supplies[0].line_en).toMatch(/A boy points at a monkey/);
    expect(ex._layout.supplies[0].line_ur).toMatch(/A boy points at a monkey/);
  });
  test('a drawn scene leaves the line alone', () => {
    const ex = { unseen: { s: { 'Picture Description': [item({ describe_en: 'A boy.', picture: { src: 'data:x' } })] } }, _layout: JSON.parse(JSON.stringify(layout)) };
    noteUndrawnScenes(ex);
    expect(ex._layout.supplies[0].line_en).toBe('Q7: Picture: zoo');
  });
});

describe('S7 whole marks', () => {
  const q = () => ({ slot: 'urdu.C.Q4', marks: 1.25, scheme: { points: [{ text: 'x', marks: 1.25, kind: 'A' }] } });
  test('RED quarter marks become halves and keep the total', () => {
    const out = wholeMarks({ unseen: { s: { 'Rewrite Sentences': [q(), q(), q(), q()] } } });
    const list = out.unseen.s['Rewrite Sentences'];
    expect(list.map((x) => x.marks)).toEqual([1.5, 1.5, 1, 1]);
    expect(list.map((x) => x.scheme.points[0].marks)).toEqual([1.5, 1.5, 1, 1]);
    expect(list.reduce((a, x) => a + x.marks, 0)).toBe(5);
  });
  test('whole and half marks are untouched, input unchanged', () => {
    const ex = { unseen: { s: { T: [{ slot: 'a', marks: 2.5, scheme: { points: [{ marks: 2.5 }] } }] } } };
    expect(wholeMarks(ex)).toBe(ex);
    const quarter = { unseen: { s: { T: [q(), q(), q(), q()] } } };
    wholeMarks(quarter);
    expect(quarter.unseen.s.T[0].marks).toBe(1.25);
  });
});

describe('S9 Q10 model answers', () => {
  const ex = (answer) => paper('urdu.C.Q10', [{ question: 'خط لکھیں', answer }], 'Letter Writing');
  test('RED slash gender form, placeholder sender and past year are flagged', () => {
    expect(urduG5Shortfall(ex('آپ کا بیٹا/بیٹی')).some((f) => /\//.test(f.items.join(' ')) || /بیٹا\/بیٹی/.test(f.items.join(' ')))).toBe(true);
    expect(urduG5Shortfall(ex('آپ کا / کی شکر گزار')).length).toBe(1);
    expect(urduG5Shortfall(ex('تمھارا بیٹا\n(الف، ب، ج)')).length).toBe(1);
    expect(urduG5Shortfall(ex('مورخہ: ۱۵ مئی ۲۰۲۴')).length).toBe(1);
    expect(urduG5Shortfall(ex('مورخہ: 15 May 2024')).length).toBe(1);
  });
  test('a clean model, and the current year, pass', () => {
    expect(urduG5Shortfall(ex('پیاری امی جان!\nآپ کا بیٹا\nعلی\nمورخہ: ۱۵ مئی ۲۰۲۶'))).toEqual([]);
  });
  test('the slash check is for Q10 only', () => {
    expect(urduG5Shortfall(paper('urdu.C.Q2', [{ question: 'x', answer: 'بیٹا/بیٹی' }]))).toEqual([]);
  });
  test('missing describe_en rides the same list', () => {
    const e = { unseen: { s: { 'Picture Description': [{ slot: 'urdu.C.Q7', question: 'q', answer: 'a' }] } }, _layout: { sections: [{ slots: [{ slot: 'urdu.C.Q7', frame: { kind: 'picture', word_bank: true } }] }] } };
    expect(urduG5Shortfall(e).some((f) => f.slot === 'urdu.C.Q7')).toBe(true);
  });
});

describe('S6 غلاظت word box word in the Q6 poem', () => {
  test('RED a Q3 word printed in the Q6 passage flags the Q3 box', () => {
    const ex = { unseen: { s: {
      'Word Meanings': [{ slot: 'urdu.C.Q3', question: 'معنی', words: ['غلاظت', 'شاطر'], answer: 'x' }],
      'Poem Explanation': [{ slot: 'urdu.C.Q6', question: 'مفہوم', passage: 'ندی کی فریاد\nشہروں کی یہ غلاظت' , answer: 'y' }] } } };
    const flags = crossAskFlags(ex);
    expect(flags.some((f) => f.slot === 'urdu.C.Q3' && f.words.includes('غلاظت'))).toBe(true);
  });
});

describe('prompt rules', () => {
  test('S1 G1 Q1 no distractor letter completes a real word', () => expect(rule(g1, 'g1.urdu.A.Q1')).toMatch(/روتی/));
  test('S2 G1 Q5 box word printed as the blank needs it', () => expect(rule(g1, 'g1.urdu.B.Q5')).toMatch(/گھونسلے/));
  test('S4 G2 Q4 no noun that is also a verb form', () => expect(rule(g2, 'g2.urdu.A.Q4')).toMatch(/گانا/));
  test('B1 G5 Q1 idiom key means what the stem describes', () => expect(rule(g5, 'urdu.A.Q1')).toMatch(/شرم سے پانی پانی/));
  test('B2 G5 Q1/Q4 never both pairs', () => {
    expect(rule(g5, 'urdu.C.Q4')).toMatch(/جب، تب/);
    expect(rule(g5, 'urdu.A.Q1')).toMatch(/جب، تب/);
  });
  test('S5 two-meaning word holds both meanings', () => expect(rule(g5, 'urdu.A.Q1')).toMatch(/دونوں معنی/));
  test('S6 Q3 words stay out of other questions and the poem', () => expect(rule(g5, 'urdu.C.Q3')).toMatch(/Q6/));
  test('S7 Q4 marks whole or half', () => expect(rule(g5, 'urdu.C.Q4')).toMatch(/whole or half/));
  test('S8 Q6 points never restate the printed lines', () => expect(rule(g5, 'urdu.C.Q6')).toMatch(/copying/));
  test('S9 Q10 one sender, no slash gender, current year', () => {
    const r = rule(g5, 'urdu.C.Q10');
    expect(r).toMatch(/بیٹا\/بیٹی/);
    expect(r).toMatch(/2026/);
  });
  test('B3 Q7 describe_en is required', () => expect(rule(g5, 'urdu.C.Q7')).toMatch(/describe_en.*required|required.*describe_en/));
});

describe('S10 thanks to God and دعا گو are held for G3-5', () => {
  const { SUPPLICATION_HELD, supplicationOf } = require(`${A}fde-religious-terms`);
  const held = (t) => SUPPLICATION_HELD.some((e) => new RegExp(e.pattern, 'u').test(t));
  test('RED both phrases are held', () => {
    expect(held('اس کی ترقی کے لیے دعا گو ہوں')).toBe(true);
    expect(held('علی نے اللہ کا شکر ادا کیا۔')).toBe(true);
  });
  test('the letter «دعا» stays allowed and a name with اللہ is not held', () => {
    expect(held('میری دعائیں آپ کے ساتھ ہیں')).toBe(false);
    expect(held('عبداللہ کا شکر')).toBe(false);
    expect(supplicationOf('علی نے اللہ کا شکر ادا کیا۔').term).toBeTruthy();
  });
  test('rule on the essay and story slots', () => {
    expect(rule(g5, 'urdu.C.Q8')).toMatch(/no prayer/);
    expect(rule(g5, 'urdu.C.Q9')).toMatch(/no prayer/);
  });
});

// Q10 is mended, not re-asked: a re-ask for an old model's «فرماں بردار / آپ کی» would re-run every recorded Urdu
// chain; the mend gives the same printed key (one gender, a real sender, the current year).
describe('S9 Q10 model answers are mended in place', () => {
  const { mendUrduQ10 } = require(`${A}fde-urdu-g5-checks`);
  const ex = (answer, question = 'خط لکھیں') => paper('urdu.C.Q10', [{ question, answer }], 'Letter Writing');
  const first = (e) => e.unseen.objective['Letter Writing'][0].answer;
  test('RED a slash gender form keeps its first form', () => {
    const r = mendUrduQ10(ex('آپ کا بیٹا/بیٹی\nآپ کا فرماں بردار / آپ کی فرماں بردار'));
    expect(first(r.examJson)).toBe('آپ کا بیٹا\nآپ کا فرماں بردار');
    expect(r.notes.length).toBe(1);
  });
  test('RED a slash the question prints is the addressee and stays', () => {
    const q = 'ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب کے نام درخواست لکھیں۔';
    const r = mendUrduQ10(ex('بخدمت جناب ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب', q));
    expect(first(r.examJson)).toBe('بخدمت جناب ہیڈ مسٹریس صاحبہ / ہیڈ ماسٹر صاحب');
    expect(r.notes).toEqual([]);
  });
  test('RED a placeholder sender becomes علی and a past year becomes 2026', () => {
    const r = mendUrduQ10(ex('تمھارا بیٹا\n(الف، ب، ج)\nمورخہ: ۱۵ مئی ۲۰۲۴ / 3 May 2024'));
    expect(first(r.examJson)).toBe('تمھارا بیٹا\nعلی\nمورخہ: ۱۵ مئی ۲۰۲۶ / 3 May 2026');
  });
  test('other slots and a clean letter are untouched', () => {
    const other = paper('urdu.C.Q2', [{ question: 'x', answer: 'بیٹا/بیٹی' }]);
    expect(mendUrduQ10(other).notes).toEqual([]);
    expect(mendUrduQ10(ex('آپ کا بیٹا\nعلی')).notes).toEqual([]);
  });
});
