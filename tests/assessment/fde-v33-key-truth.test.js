/**
 * bd-5jmnfj.33.4 — answer keys that are wrong or garbled on the v32 Grade 3-4 papers (REVIEW.md).
 *  G4 Urdu Q2 v: the key and a point name «خطِ استوا», a place the stem never mentions and the
 *  chapter's facts do not give (without the sun's pull the bodies would go straight on).
 *  G4 Urdu Q4 i: «لفظ «چاند» کی جمع لکھیں» keyed «چاند (جمع: چاندوں کے لیے جملے میں 'بہت سے چاند')»
 *  with accept «چاند», which is the very error the item lists.
 *  G4 Urdu Q4 ii: common error «ستاروں لکھنا بغیر جملے کے» on a stem that asks for the plural only.
 * Pure data in, data out; exact v32 items as fixtures.
 */

const { keyTruth, keyTruthFlags, keyTruthNote } = require('../../bot/shared/services/assessment/fde-key-truth');

const exam = (items) => ({ _layout: { subject: 'Urdu', sections: [] }, unseen: { subjective: { Items: items } } });
const items = (out) => out.examJson.unseen.subjective.Items;
const short = (question, answer, points, accept, common_error, slot = 'g4.urdu.B.short') => ({
  slot, question, answer, marks: points.reduce((n, p) => n + p[1], 0),
  scheme: { points: points.map(([text, marks, kind = 'K']) => ({ text, marks, kind })), accept, common_error },
});
const grammar = (question, answer, accept, common_error, points = [['درست جمع', 1], ['مکمل جواب', 1, 'A']]) =>
  short(question, answer, points, accept, common_error, 'g4.urdu.B.grammar');

const EQUATOR = short('اگر سورج کی کشش اثر انداز نہ ہوتی تو اجرامِ فلکی کس سیدھ میں سفر کرتے؟',
  'وہ ایک ہی سیدھ یعنی خطِ استوا پر سفر کرتے رہتے۔',
  [['ایک ہی سیدھ کا ذکر', 1], ['خطِ استوا کا ذکر', 1]], ['خطِ استوا پر سیدھے سفر کرتے'], 'گول مدار میں گھومنا بتانا');
const G4_URDU_SHORT = [
  short('چاند زمین کے گرد کیوں گردش کرتا ہے؟', 'زمین کی کششِ ثقل کی وجہ سے چاند اس کے گرد گردش کرتا ہے۔',
    [['زمین کی کشش کا ذکر', 1], ['چاند کے گردش کرنے کا ذکر', 1]], ['زمین چاند کو اپنی طرف کھینچتی ہے اس لیے وہ گھومتا ہے'], 'چاند کے گھومنے کی وجہ سورج کی کشش بتانا'),
  short('بڑا مادہ اپنے سے چھوٹے مادے کے ساتھ کیا کرتا ہے؟', 'بڑا مادہ چھوٹے مادے کو ہمیشہ اپنی طرف کھینچتا ہے۔',
    [['بڑے مادے کا ذکر', 1], ['اپنی طرف کھینچنے کا ذکر', 1]], ['بڑا مادہ چھوٹے کو اپنی طرف کھینچتا ہے'], 'چھوٹے مادے کو بڑے کو کھینچنے والا بتانا'),
  short('اجرامِ فلکی سورج سے ٹکرا کر ختم کیوں نہیں ہوتے؟', 'وہ نہایت تیز رفتار سے سورج کے قریب سے گزرتے ہیں، یہی رفتار انھیں ٹکرانے سے بچاتی ہے۔',
    [['تیز رفتار کا ذکر', 1], ['ٹکرانے سے بچاؤ کا ذکر', 1]], ['ان کی رفتار انھیں بچاتی ہے'], 'سورج کی کشش کم ہونا وجہ بتانا'),
  short('ہماری زمین کا سورج سے فاصلہ کیسا ہے اور اس کا کیا فائدہ ہے؟', 'فاصلہ بالکل مناسب ہے، اس لیے زمین نہ بہت گرم ہے نہ بہت سرد۔',
    [['فاصلہ مناسب ہونا', 1], ['نہ بہت گرم نہ بہت سرد ہونا', 1]], ['پانی موجود رہتا ہے اور برف ہی برف نہیں'], 'زمین کو سورج کے بہت قریب بتانا'),
  EQUATOR,
  short('ہمارا نظامِ شمسی کائنات کے مقابلے میں کیسا ہے؟', 'کائنات کے مقابلے میں یہ ریت کے ذرے سے بھی چھوٹا ہے۔',
    [['کائنات سے مقابلے کا ذکر', 1], ['ریت کے ذرے سے چھوٹا ہونا', 1]], ['بہت ہی چھوٹا ہے'], 'نظام کو کائنات سے بڑا بتانا'),
  short('دوسرے سیاروں پر زندگی کے لیے موزوں ماحول کیوں نہیں؟', 'وہ سورج کے بہت قریب ہیں یا بہت دور، اس لیے موزوں آب و ہوا نہیں ملتی۔',
    [['سورج سے بہت قریب یا دور ہونا', 1], ['موزوں آب و ہوا نہ ملنا', 1]], ['فاصلہ مناسب نہیں'], 'سب سیاروں کو سورج سے قریب بتانا'),
];
const MCQ_ELSEWHERE = { slot: 'g4.urdu.A.mcq', question: 'ہر مادہ کون سی قوت رکھتا ہے؟', options: ['الف) روشنی', 'ب) آواز', 'ج) حرارت', 'د) کششِ ثقل'], answer: 'د) کششِ ثقل', marks: 1 };
const PLURAL = grammar('لفظ «چاند» کی جمع لکھیں۔', "چاند (جمع: چاندوں کے لیے جملے میں 'بہت سے چاند')", ['چاند'], 'واحد ہی دوبارہ لکھنا',
  [['درست جمع صورت', 1], ['مکمل درست جواب', 1, 'A']]);
const STARS = grammar('لفظ «ستارہ» کی جمع لکھیں۔', 'ستارے', ['ستارے'], 'ستاروں لکھنا بغیر جملے کے');

describe('B1: a key-only proper term is flagged and its point removed', () => {
  test('G4 Urdu Q2 v: the equator point goes, its mark moves to the remaining point, the accept naming it goes', () => {
    const out = keyTruth(exam([EQUATOR]));
    const q = items(out)[0];
    expect(q.scheme.points).toEqual([{ text: 'ایک ہی سیدھ کا ذکر', marks: 2, kind: 'K' }]);
    expect(q.scheme.accept).toEqual([]);
    expect(out.notes).toEqual([expect.objectContaining({ slot: 'g4.urdu.B.short', reason: 'key_only_term', term: 'خط استوا' })]);
  });

  test('the item is flagged for a re-ask, naming the term', () => {
    const flags = keyTruthFlags(exam([EQUATOR]));
    expect(flags).toEqual([expect.objectContaining({ slot: 'g4.urdu.B.short', reason: 'key_truth', kind: 'key_only_term', words: ['خط استوا'] })]);
    expect(keyTruthNote(flags)).toMatch(/خط استوا/);
  });

  test('flagged after the fix too: the key itself still names the term', () => {
    expect(keyTruthFlags(keyTruth(exam([EQUATOR])).examJson)).toHaveLength(1);
  });

  test('the other six G4 Urdu Q2 items, with a paper sharing «کششِ ثقل» in an MCQ, raise nothing', () => {
    const paper = exam([MCQ_ELSEWHERE, ...G4_URDU_SHORT.filter((q) => q !== EQUATOR)]);
    expect(keyTruthFlags(paper)).toEqual([]);
    expect(keyTruth(paper).notes).toEqual([]);
  });

  test('a term the stem names is no key-only term', () => {
    const q = short('خطِ استوا کہاں سے گزرتا ہے؟', 'خطِ استوا کئی ملکوں سے گزرتا ہے۔', [['ملکوں کا ذکر', 1], ['گزرنے کا ذکر', 1]], [], 'غلط جگہ');
    expect(keyTruthFlags(exam([q]))).toEqual([]);
  });

  test('an equator point is dropped only when another point stays', () => {
    const q = short('کون سا خط زمین کو دو حصوں میں بانٹتا ہے؟', 'خطِ استوا۔', [['خطِ استوا کا ذکر', 1]], [], 'غلط خط');
    expect(items(keyTruth(exam([q])))[0].scheme.points).toHaveLength(1);
  });

  test('an English Science key naming a capitalised term the paper never prints is flagged', () => {
    const q = { slot: 'g4.science.B.short', question: 'What does a thermometer measure?', answer: 'It measures temperature, as the Celsius scale shows.', marks: 2,
      scheme: { points: [{ text: 'States temperature', marks: 1, kind: 'K' }, { text: 'Names the Celsius scale', marks: 1, kind: 'K' }], accept: [], common_error: 'Says it measures weight.' } };
    expect(keyTruthFlags(exam([q]))).toEqual([expect.objectContaining({ kind: 'key_only_term', words: ['celsius'] })]);
  });

  test('Islamiat, Grade 5 and picture items are left alone', () => {
    const mk = (slot, extra = {}) => ({ ...EQUATOR, slot, ...extra });
    const paper = exam([mk('g4.islamiat.B.short'), mk('g5.urdu.B.short'), mk('g4.urdu.B.short', { picture: { name: 'x' } })]);
    expect(keyTruthFlags(paper)).toEqual([]);
    expect(keyTruth(paper).examJson).toEqual(paper);
  });
});

describe('B2: a plural item whose key is its own stem word', () => {
  test('the singular goes from accept, and the item is flagged: no distinct plural', () => {
    const out = keyTruth(exam([PLURAL]));
    expect(items(out)[0].scheme.accept).toEqual([]);
    expect(out.notes).toContainEqual(expect.objectContaining({ reason: 'accept_is_error', accept: 'چاند' }));
    const flags = keyTruthFlags(exam([PLURAL]));
    expect(flags.map((f) => f.kind).sort()).toEqual(['garbled_key', 'plural_same']);
    expect(flags.every((f) => f.slot === 'g4.urdu.B.grammar')).toBe(true);
  });

  test('a bracketed «(جمع: ...)» key is garbled', () => {
    const q = grammar('لفظ «کتاب» کی جمع لکھیں۔', 'کتابیں (جمع: کتابوں کے لیے)', ['کتابیں'], 'واحد لکھنا');
    expect(keyTruthFlags(exam([q]))).toEqual([expect.objectContaining({ kind: 'garbled_key' })]);
  });

  test('a clean plural item is not flagged and loses nothing', () => {
    expect(keyTruthFlags(exam([STARS]))).toEqual([]);
    expect(items(keyTruth(exam([STARS])))[0].scheme.accept).toEqual(['ستارے']);
  });

  test('an accept the common error quotes is dropped; the key itself never', () => {
    const q = grammar('لفظ «بچہ» کا مؤنث لکھیں۔', 'بچی', ['بچی', 'بچیا'], 'بچہ کو «بچیا» لکھنا');
    expect(items(keyTruth(exam([q])))[0].scheme.accept).toEqual(['بچی']);
    const same = grammar('لفظ «بچہ» کا مؤنث لکھیں۔', 'بچی', ['بچی'], '«بچی» کو غلط سمجھنا');
    expect(items(keyTruth(exam([same])))[0].scheme.accept).toEqual(['بچی']);
  });
});

describe('S3: a common error that is not an error', () => {
  test('G4 Urdu Q4 ii: "writing ستاروں without a sentence" goes when the stem asks for the plural only', () => {
    const out = keyTruth(exam([STARS]));
    expect(items(out)[0].scheme.common_error).toBe('');
    expect(out.notes).toContainEqual(expect.objectContaining({ reason: 'form_error_dropped' }));
  });

  test('it stays when the stem does ask for a sentence', () => {
    const q = grammar('لفظ «ستارہ» جملے میں لکھیں۔', 'آسمان پر ستارے ہیں۔', [], 'بغیر جملے کے صرف لفظ لکھنا');
    expect(items(keyTruth(exam([q])))[0].scheme.common_error).toBe('بغیر جملے کے صرف لفظ لکھنا');
  });
});

describe('an item nothing touches is the same object', () => {
  test('clean items pass through', () => {
    const paper = exam([MCQ_ELSEWHERE, G4_URDU_SHORT[3]]);
    expect(items(keyTruth(paper))).toEqual(paper.unseen.subjective.Items);
    expect(items(keyTruth(paper))[1]).toBe(G4_URDU_SHORT[3]);
  });

  test('no paper, no flags', () => {
    expect(keyTruthFlags(null)).toEqual([]);
    expect(keyTruth(null).notes).toEqual([]);
  });
});

describe('an item whose every point only repeats the stem is flagged', () => {
  test('both K points restate the question', () => {
    const q = short('چاند زمین کے گرد کیوں گردش کرتا ہے؟', 'کششِ ثقل کی وجہ سے۔', [['چاند کے گردش کرنے کا ذکر', 1], ['زمین کے گرد کا ذکر', 1]], [], 'غلط وجہ');
    expect(keyTruthFlags(exam([MCQ_ELSEWHERE, q]))).toEqual([expect.objectContaining({ kind: 'points_restate_stem' })]);
  });

  test('one real point is enough: the real G4 Urdu Q2 i is not flagged', () => {
    expect(keyTruthFlags(exam([MCQ_ELSEWHERE, G4_URDU_SHORT[0]]))).toEqual([]);
  });
});
