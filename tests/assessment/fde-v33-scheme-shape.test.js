/**
 * bd-5jmnfj.33.4 — marking points that pay for the wrong thing on the v32 Grade 3-4 papers (REVIEW.md).
 *  S1 points that only restate the stem: G3 Urdu Q2 i «ہوٹل کے ملازم کے تجربے کا ذکر»; G4 Urdu Q2 i, ii, vi.
 *  S2 points that pay for form, not content: G3 Urdu Q2 iv, Q4 i-v; G3 GK Q4 ii-vi; G3 English Q2 i, ii, iv, v;
 *     G4 Urdu Q4 i-v; G4 English Q2 (whole sentence written correctly). Marks fold into the content point.
 *  S5 G4 Science Q3 ii-vi: points for content the question never asks (an example, the ice, the ships, metals,
 *     the first bend); the marks fold into the point that answers the question.
 * Pure data in, data out; exact v32 items as fixtures. Totals never change.
 */

const { schemeShape } = require('../../bot/shared/services/assessment/fde-scheme-shape');

const exam = (items) => ({ _layout: { subject: 'x', sections: [] }, unseen: { subjective: { Items: items } } });
const run = (q) => schemeShape(exam([q]));
const first = (out) => out.examJson.unseen.subjective.Items[0];
const item = (slot, question, points, marks = points.reduce((n, p) => n + p[1], 0)) => ({
  slot, question, marks, answer: 'x', scheme: { points: points.map(([text, m, kind = 'K']) => ({ text, marks: m, kind })), accept: ['a'], common_error: 'e' },
});
const total = (q) => q.scheme.points.reduce((n, p) => n + p.marks, 0);
const texts = (q) => q.scheme.points.map((p) => p.text);

describe('S1 points that restate the question', () => {
  test('G3 Urdu Q2 i: the experience point folds into the period point', () => {
    const q = item('g3.urdu.B.short', 'ہوٹل کے اشتہار میں کتنے سال سے زیادہ تجربے والے ملازم کی ضرورت ہے؟',
      [['ہوٹل کے ملازم کے تجربے کا ذکر', 1], ['درست مدت: چار سال سے زیادہ', 1]]);
    const out = first(run(q));
    expect(texts(out)).toEqual(['درست مدت: چار سال سے زیادہ']);
    expect(out.scheme.points[0].marks).toBe(2);
    expect(total(out)).toBe(q.marks);
  });
  test('G4 Urdu Q2 ii: the big-matter point folds into the pulling point', () => {
    const q = item('g4.urdu.B.short', 'بڑا مادہ اپنے سے چھوٹے مادے کے ساتھ کیا کرتا ہے؟', [['بڑے مادے کا ذکر', 1], ['اپنی طرف کھینچنے کا ذکر', 1]]);
    expect(texts(first(run(q)))).toEqual(['اپنی طرف کھینچنے کا ذکر']);
  });
  test('G4 Urdu Q2 vi and i fold the same way', () => {
    const six = item('g4.urdu.B.short', 'ہمارا نظامِ شمسی کائنات کے مقابلے میں کیسا ہے؟', [['کائنات سے مقابلے کا ذکر', 1], ['ریت کے ذرے سے چھوٹا ہونا', 1]]);
    expect(texts(first(run(six)))).toEqual(['ریت کے ذرے سے چھوٹا ہونا']);
    const one = item('g4.urdu.B.short', 'چاند زمین کے گرد کیوں گردش کرتا ہے؟', [['زمین کی کشش کا ذکر', 1], ['چاند کے گردش کرنے کا ذکر', 1]]);
    expect(texts(first(run(one)))).toEqual(['زمین کی کشش کا ذکر']);
  });
  test('G4 Urdu Q2 iii and vii keep both points', () => {
    const three = item('g4.urdu.B.short', 'اجرامِ فلکی سورج سے ٹکرا کر ختم کیوں نہیں ہوتے؟', [['تیز رفتار کا ذکر', 1], ['ٹکرانے سے بچاؤ کا ذکر', 1]]);
    expect(texts(first(run(three)))).toHaveLength(2);
    const seven = item('g4.urdu.B.short', 'دوسرے سیاروں پر زندگی کے لیے موزوں ماحول کیوں نہیں؟', [['سورج سے بہت قریب یا دور ہونا', 1], ['موزوں آب و ہوا نہ ملنا', 1]]);
    expect(texts(first(run(seven)))).toHaveLength(2);
  });
  test('G3 GK Q4 vi: a question with two asks keeps the point for the second ask',() => {
    const q = item('g3.general_knowledge.B.short', 'اختلافات کب ہو سکتے ہیں اور کس کوشش سے ختم کیے جا سکتے ہیں؟',
      [['کسی بھی وقت ہونے کا ذکر', 1], ['کوشش سے ختم ہونے کا ذکر', 1], ['واضح جملہ', 1]]);
    expect(texts(first(run(q)))).toEqual(['کسی بھی وقت ہونے کا ذکر', 'کوشش سے ختم ہونے کا ذکر']);
  });
  test('when every point restates the stem nothing is dropped', () => {
    const q = item('g4.urdu.B.short', 'بڑا مادہ چھوٹے مادے کو کیا کرتا ہے؟', [['بڑے مادے کا ذکر', 1], ['چھوٹے مادے کا ذکر', 1]]);
    expect(first(run(q))).toBe(q);
  });
});

describe('S2 points that pay for form', () => {
  test('G3 Urdu Q2 iv: the full-sentence point folds into the content point', () => {
    const q = item('g3.urdu.B.short', 'ہوٹل میں ملازم کو گھر سے لانے اور چھوڑنے کی ذمہ داری کس کی ہے؟', [['ہوٹل کا نام لینا', 1], ['مکمل جملے میں جواب دینا', 1]]);
    const out = first(run(q));
    expect(texts(out)).toEqual(['ہوٹل کا نام لینا']);
    expect(out.scheme.points[0].marks).toBe(2);
  });
  test('G3 GK Q4 ii-vi: the clear-sentence point folds into the last content point', () => {
    const q = item('g3.general_knowledge.B.short', 'عام طور پر اختلاف یا جھگڑا کب پیدا ہوتا ہے؟',
      [['ایک دوسرے کی بات نہ سننے کا ذکر', 1], ['اپنی بات کو درست ثابت کرنے کا ذکر', 1], ['واضح جملہ', 1]]);
    const out = first(run(q));
    expect(texts(out)).toHaveLength(2);
    expect(out.scheme.points.map((p) => p.marks)).toEqual([1, 2]);
    expect(total(out)).toBe(3);
  });
  test('G3 Urdu Q4 i-v: the one-word grammar items merge into one point', () => {
    const q = item('g3.urdu.B.grammar', 'لفظ «چھٹی» کی جمع لکھیں۔', [['جمع کی درست شکل', 1], ['لفظ کو مکمل اور درست لکھنا', 1, 'A']]);
    const out = first(run(q));
    expect(texts(out)).toEqual(['جمع کی درست شکل']);
    expect(out.scheme.points[0]).toMatchObject({ marks: 2, kind: 'K' });
    const verb = item('g3.urdu.B.grammar', 'جملے میں سے فعل چن کر لکھیں', [['کام کے لفظ کی پہچان', 1], ['فعل کو مکمل لکھنا', 1, 'A']]);
    expect(texts(first(run(verb)))).toEqual(['کام کے لفظ کی پہچان']);
  });
  test('G4 Urdu Q4: K + A on the plural and the opposite merge; the tense rewrite too', () => {
    const q = item('g4.urdu.B.grammar', 'لفظ «ستارہ» کی جمع لکھیں۔', [['درست جمع', 1], ['مکمل جواب', 1, 'A']]);
    expect(texts(first(run(q)))).toEqual(['درست جمع']);
    const v = item('g4.urdu.B.grammar', 'جملے کو حال سے ماضی میں بدلیں', [['درست فعل کی صورت', 1], ['مکمل جملہ', 1, 'A']]);
    expect(first(run(v)).scheme.points[0].marks).toBe(2);
  });
  test('G3 English Q2 i, ii, iv, v: the copied-sentence point folds, the agreement point stays', () => {
    const i = item('g3.english.A.grammar', 'Change into the feminine: The nephew came home.', [['correct feminine word', 1, 'A'], ['rest of the sentence copied correctly', 1, 'A']]);
    const out = first(run(i));
    expect(texts(out)).toEqual(['correct feminine word']);
    expect(out.scheme.points[0]).toMatchObject({ marks: 2, kind: 'A' });
    const iv = item('g3.english.A.grammar', 'Change into the plural: The path is long.', [['correct plural noun', 1, 'A'], ["correct verb form 'are' with the rest of the sentence", 1, 'A']]);
    expect(first(run(iv))).toBe(iv);
    const iii = item('g3.english.A.grammar', 'Write the action word (verb) in the sentence: The people ran.', [['correct verb identified', 2, 'A']]);
    expect(first(run(iii))).toBe(iii);
  });
  test('G4 English Q2: «Writes the whole sentence correctly» folds', () => {
    const q = item('g4.english.A.grammar', 'Pinky saw ___ empty bottle near the gate. (Fill in the blank.)', [['Writes the correct article', 1], ['Writes the whole sentence correctly', 1, 'A']]);
    expect(texts(first(run(q)))).toEqual(['Writes the correct article']);
  });
  test('a paragraph item paying for «complete sentences with correct spelling» is not touched', () => {
    const q = item('g4.english.B.long', 'Write a letter.', [['Complete sentences with correct spelling', 2], ['Ideas', 2]]);
    expect(first(run(q))).toBe(q);
  });
  test('an item with only form points is not emptied', () => {
    const q = item('g3.urdu.B.short', 'کیا؟', [['واضح جملہ', 2]]);
    expect(first(run(q))).toBe(q);
  });
});

describe('S5 Science points for content the question never asks', () => {
  const sci = (question, points) => item('g4.science.B.short', question, points);
  test('G4 Science Q3 ii: the example point folds into the definition', () => {
    const q = sci('What is an insulator?', [['States that it is a material that does not let electricity pass easily', 1], ['Gives a correct example of an insulator', 1]]);
    const out = first(run(q));
    expect(texts(out)).toEqual(['States that it is a material that does not let electricity pass easily']);
    expect(out.scheme.points[0].marks).toBe(2);
  });
  test('G4 Science Q3 iii-vi drop the unasked second point', () => {
    const cases = [
      ['What unusual thing does water do when it freezes?', [['States that water expands when it freezes', 1], ['Links this to ice floating in a drink', 1]]],
      ['What is buoyancy?', [['States that buoyancy is an upward force from water', 1], ['States that it keeps objects such as ships afloat', 1]]],
      ['What is heat conduction?', [['States that heat conduction is heat or warmth passing through a material', 1], ['States that metals conduct heat well', 1]]],
      ['What happens to a shape-memory alloy such as nitinol when heated?', [['States that heating makes it return to its original shape', 1], ['States that it was bent or stretched into a different shape first', 1]]],
    ];
    cases.forEach(([stem, pts]) => {
      const out = first(run(sci(stem, pts)));
      expect(texts(out)).toEqual([pts[0][0]]);
      expect(total(out)).toBe(2);
    });
  });
  test('Q3 i vacuum and Q3 vii «Name two ways» keep both points', () => {
    const vac = sci('What is a vacuum?', [['States that a vacuum is an area or space', 1], ['States that it contains no matter', 1]]);
    expect(first(run(vac))).toBe(vac);
    const two = sci('Name two ways in which non-metals are different from metals.', [['Gives one correct difference', 1], ['Gives a second correct difference', 1]]);
    expect(first(run(two))).toBe(two);
  });
});

describe('scope', () => {
  test('Islamiat, Grade 5 and picture items are untouched', () => {
    const pts = [['جمع کی درست شکل', 1], ['لفظ کو مکمل اور درست لکھنا', 1, 'A']];
    const isl = item('g3.islamiat.B.grammar', 'لفظ کی جمع لکھیں۔', pts);
    const g5 = item('g5.urdu.B.grammar', 'لفظ کی جمع لکھیں۔', pts);
    const pic = { ...item('g3.urdu.B.grammar', 'لفظ کی جمع لکھیں۔', pts), picture: 'p.png' };
    [isl, g5, pic].forEach((q) => expect(first(run(q))).toBe(q));
  });
  test('notes name the slot and the reason, and an untouched paper reports none', () => {
    const q = item('g4.urdu.B.grammar', 'لفظ «ستارہ» کی جمع لکھیں۔', [['درست جمع', 1], ['مکمل جواب', 1, 'A']]);
    expect(run(q).notes).toEqual([expect.objectContaining({ slot: 'g4.urdu.B.grammar', reason: 'form_point_folded' })]);
    expect(schemeShape(exam([item('g4.urdu.B.short', 'کیا؟', [['الف', 2]])])).notes).toEqual([]);
  });
});
