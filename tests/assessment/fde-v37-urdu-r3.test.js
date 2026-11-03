/**
 * Round 6 loop-2 Urdu panel: a keyed answer word shared by two slots, an oblique plural offered beside the plural,
 * a picture sentence keyed with a name, and a conjunction pair MCQ offering two fitting pairs.
 */
const A = '../../bot/shared/services/assessment/';
const { dupeShortfall } = require(`${A}fde-early-dupes`);
const { obliquePluralShortfall, mendPictureNames } = require(`${A}fde-urdu-r3-checks`);
const { conditionalPairShortfall } = require(`${A}fde-accept-alternatives`);
const g1 = require(`${A}patterns/early/g1-urdu`);
const g2 = require(`${A}patterns/early/g2-urdu`);
const g5 = require(`${A}patterns/fde-g5-2027`);

const rule = (P, slot) => ((P.sections || P.subjects.urdu.sections || []).flatMap((s) => s.slots).find((s) => s.slot === slot) || {}).prompt_rule || '';
const P1 = { sections: [{ slots: [{ slot: 'g1.urdu.B.Q5' }, { slot: 'g1.urdu.B.Q7' }] }] };
const P2 = { sections: [{ slots: [{ slot: 'g2.urdu.A.Q1' }, { slot: 'g2.urdu.A.Q5' }] }] };

describe('cross-slot keyed answer repeat', () => {
  const g1Exam = { unseen: { s: { 'Fill in the Blanks': [{ slot: 'g1.urdu.B.Q5', question: '___ دودھ دیتی ہے۔', answer: 'گائے' }],
    'Masculine Feminine': [{ slot: 'g1.urdu.B.Q7', question: 'بیل', answer: 'گائے' }] } } };
  test('RED G1 Q7 keyed with the word Q5 keys is flagged on the later slot', () => {
    const out = dupeShortfall(g1Exam, P1);
    expect(out.map((f) => f.slot)).toEqual(['g1.urdu.B.Q7']);
    expect(out[0].reason).toBe('answer');
    expect(out[0].items[0]).toMatch(/گائے/);
  });
  test('RED G2 Q5 keyed with the plural Q1 v keys is flagged', () => {
    const ex = { unseen: { o: { MCQs: [{ slot: 'g2.urdu.A.Q1', question: 'لفظ «کھڑکی» کی جمع کون سی ہے؟', options: ['الف) کھڑکیاں', 'ب) کھڑکے'], answer: 'الف) کھڑکیاں' }],
      'Singular Plural': [{ slot: 'g2.urdu.A.Q5', question: 'گھر', answer: 'کھڑکیاں' }] } } };
    expect(dupeShortfall(ex, P2).some((f) => f.slot === 'g2.urdu.A.Q5')).toBe(true);
  });
  test('two keys that differ, and a repeat inside one slot, are clean', () => {
    const ok = { unseen: { s: { 'Fill in the Blanks': [{ slot: 'g1.urdu.B.Q5', question: 'a b c', answer: 'گائے' }, { slot: 'g1.urdu.B.Q5', question: 'd e f', answer: 'گائے' }],
      'Masculine Feminine': [{ slot: 'g1.urdu.B.Q7', question: 'بیل', answer: 'بکری' }] } } };
    expect(dupeShortfall(ok, P1)).toEqual([]);
  });
  test('prompt rules carry the cross-question rule', () => {
    ['g1.urdu.B.Q5', 'g1.urdu.B.Q7'].forEach((s) => expect(rule(g1, s)).toMatch(/no answer or target word repeats another question's/i));
    ['g2.urdu.A.Q1', 'g2.urdu.A.Q5'].forEach((s) => expect(rule(g2, s)).toMatch(/no answer or target word repeats another question's/i));
  });
});

describe('oblique plural offered beside the plural', () => {
  const mcq = (options, answer) => ({ unseen: { o: { MCQs: [{ slot: 'g2.urdu.A.Q1', question: 'لفظ «کھڑکی» کی جمع کون سی ہے؟', options, answer }] } } });
  test('RED کھڑکیاں beside کھڑکیوں is flagged', () => {
    const out = obliquePluralShortfall(mcq(['الف) کھڑکیاں', 'ب) کھڑکے', 'ج) کھڑکیوں'], 'الف) کھڑکیاں'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'g2.urdu.A.Q1', reason: 'answer' });
    expect(out[0].items[0]).toMatch(/کھڑکیوں/);
  });
  test('a plural with no oblique option is clean', () => {
    expect(obliquePluralShortfall(mcq(['الف) کھڑکیاں', 'ب) کھڑکے', 'ج) کھڑکی'], 'الف) کھڑکیاں'))).toEqual([]);
  });
  test('prompt rule on G2 Q1', () => expect(rule(g2, 'g2.urdu.A.Q1')).toMatch(/never offers the oblique plural/));
});

describe('Q10 picture sentence names a person', () => {
  const ex = (describe, answer) => ({ unseen: { s: { 'Picture Sentences': [{ slot: 'g1.urdu.B.Q10', question: '', answer, picture: { kind: 'scene', describe } }] } } });
  const first = (r) => r.examJson.unseen.s['Picture Sentences'][0];
  test('RED a girl named Banu becomes لڑکی', () => {
    const r = mendPictureNames(ex('A girl named Banu reading a book.', 'بانو کتاب پڑھ رہی ہے۔'));
    expect(first(r).answer).toBe('لڑکی کتاب پڑھ رہی ہے۔');
    expect(first(r).picture.describe).not.toMatch(/Banu/);
    expect(r.notes).toHaveLength(1);
  });
  test('a boy named Bablu becomes لڑکا; an unknown gender becomes بچہ', () => {
    expect(first(mendPictureNames(ex('A boy named Bablu kicking a ball.', 'ببلو گیند کھیلتا ہے۔'))).answer).toBe('لڑکا گیند کھیلتا ہے۔');
    expect(first(mendPictureNames(ex('A child named Pinky eating.', 'پنکی کھاتی ہے۔'))).answer).toBe('بچہ کھاتی ہے۔');
  });
  test('a describe with no name is untouched and the input is not mutated', () => {
    const e = ex('A girl reading a book.', 'لڑکی کتاب پڑھ رہی ہے۔');
    const r = mendPictureNames(e);
    expect(r.examJson).toBe(e);
    expect(r.notes).toEqual([]);
    const e2 = ex('A girl named Banu reading.', 'بانو پڑھتی ہے۔');
    mendPictureNames(e2);
    expect(first({ examJson: e2 }).answer).toBe('بانو پڑھتی ہے۔');
  });
  test('only the Q10 slot is touched', () => {
    const e = ex('A girl named Banu reading.', 'بانو پڑھتی ہے۔');
    e.unseen.s['Picture Sentences'][0].slot = 'g2.urdu.B.Q7';
    expect(mendPictureNames(e).notes).toEqual([]);
  });
  test('prompt rules on G1 Q10 and G2 Q7', () => {
    expect(rule(g1, 'g1.urdu.B.Q10')).toMatch(/never names a person/);
    expect(rule(g1, 'g1.urdu.B.Q10')).toMatch(/لڑکا \/ لڑکی \/ بچہ/);
    expect(rule(g2, 'g2.urdu.B.Q7')).toMatch(/no animal pulling or carrying a load/);
  });
});

describe('G5 Q4 conditional beside because', () => {
  const both = { slot: 'urdu.C.Q4', question: '______ تم وقت پر پہنچے ______ گاڑی مل گئی۔', options: ['الف) اگر، تو', 'ب) چوں کہ، اس لیے', 'ج) جیسے، ویسے', 'د) لیکن، مگر'], answer: 'الف) اگر، تو' };
  const paper = (q) => ({ unseen: { objective: { MCQs: [q] } } });
  test('RED options holding both «اگر، تو» and «چوں کہ، اس لیے» are flagged in the same shape', () => {
    const out = conditionalPairShortfall(paper(both));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'urdu.C.Q4', reason: 'answer' });
    expect(out[0].items[0]).toMatch(/چوں کہ، اس لیے/);
  });
  test('«چونکہ، اس لیے» spelled joined is flagged too; one pair alone is clean', () => {
    expect(conditionalPairShortfall(paper({ ...both, options: ['الف) اگر، تو', 'ب) چونکہ، اس لیے'] }))).toHaveLength(1);
    expect(conditionalPairShortfall(paper({ ...both, options: ['الف) اگر، تو', 'ب) جیسے، ویسے'] }))).toEqual([]);
  });
  test('prompt rule on G5 Q4', () => expect(rule(g5, 'urdu.C.Q4')).toMatch(/offers only one pair that fits the sentence's tense and meaning/));
});
