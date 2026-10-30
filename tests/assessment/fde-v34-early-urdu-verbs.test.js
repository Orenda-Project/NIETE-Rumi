/**
 * v29 should-fix, G2 Urdu Q4 i and iii (bd-5jmnfj.4.58): the key printed no accept note although the JSON allows a
 * shorter answer, and Q4 iii «بندر ٹوپی پہن کر بھاگ جاتا ہے۔» holds two verb forms (پہن کر and بھاگ جاتا ہے) with only
 * the second accepted.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { verbFix } = require('../../bot/shared/services/assessment/fde-early-urdu-verbs');
const { acceptText } = require('../../bot/shared/services/assessment/fde-accept-line');
const { earlyUrduFixes } = require('../../bot/shared/services/assessment/fde-early-urdu-fixes');

const verb = (question, answer, accept, over = {}) => ({
  slot: 'g2.urdu.A.Q4', main_question: 'درج ذیل جملوں میں سے فعل الگ کریں', question, answer, marks: 1,
  scheme: { points: [{ text: 'درست فعل', marks: 1, kind: 'A' }], accept, common_error: 'ٹوپی کو فعل لکھنا' }, ...over,
});
const paper = (items) => ({
  unseen: { subjective: { Verbs: items } },
  _layout: { sections: [{ id: 'A', slots: [{ slot: 'g2.urdu.A.Q4', type: 'Verbs' }] }] },
});
const list = (ex) => ex.unseen.subjective.Verbs;

describe('G2 Urdu Q4 verbs', () => {
  test('RED v29 iii: a converb before the main verb is accepted, and printed', () => {
    const { examJson, notes } = verbFix(paper([verb('بندر ٹوپی پہن کر بھاگ جاتا ہے۔', 'بھاگ جاتا ہے', ['بھاگ جاتا'])]));
    const q = list(examJson)[0];
    expect(q.scheme.accept).toContain('پہن کر');
    expect(acceptText(q.answer, q.scheme.accept, 'ur')).toMatch(/پہن کر/);
    expect(notes.join(' ')).toMatch(/پہن کر/);
  });
  test('RED v29 i: a shorter accepted form the key would hide is named in the point text', () => {
    const q = list(verbFix(paper([verb('پنکی ہنس رہی ہے۔', 'ہنس رہی ہے', ['ہنس رہی'])])).examJson)[0];
    expect(acceptText(q.answer, q.scheme.accept, 'ur')).toBe('');
    expect(q.scheme.points[0].text).toMatch(/ہنس رہی/);
    expect(q.scheme.points[0].text).toMatch(/^درست فعل/);
  });
  test('a plain one-word verb and an item with no shorter form are left as they were', () => {
    const plain = verb('بچہ باغ میں پہنچتا ہے۔', 'پہنچتا ہے', ['پہنچتا']);
    expect(list(verbFix(paper([plain])).examJson)[0]).toEqual(plain);
  });
  test('a converb already accepted is not added twice; a کر that is part of the answer is not a second verb', () => {
    const done = list(verbFix(paper([verb('بندر ٹوپی پہن کر بھاگ جاتا ہے۔', 'بھاگ جاتا ہے', ['پہن کر'])])).examJson)[0];
    expect(done.scheme.accept.filter((a) => a === 'پہن کر')).toHaveLength(1);
    const own = list(verbFix(paper([verb('وہ کھانا کھا کر سو گیا۔', 'کھا کر', [])])).examJson)[0];
    expect(own.scheme.accept).toEqual([]);
  });
  test('only a Verbs slot, and earlyUrduFixes runs it', () => {
    const other = { ...verb('بندر ٹوپی پہن کر بھاگ جاتا ہے۔', 'بھاگ جاتا ہے', []), slot: 'g2.urdu.A.Q6' };
    const ex = { unseen: { subjective: { Opposites: [other] } }, _layout: { sections: [{ id: 'A', slots: [{ slot: 'g2.urdu.A.Q6', type: 'Opposites' }] }] } };
    expect(verbFix(ex).examJson.unseen.subjective.Opposites[0].scheme.accept).toEqual([]);
    expect(list(earlyUrduFixes(paper([verb('بندر ٹوپی پہن کر بھاگ جاتا ہے۔', 'بھاگ جاتا ہے', [])])).examJson)[0].scheme.accept).toContain('پہن کر');
  });
  test('the slot rule names the converb case', () => {
    const rule = Patterns.subjectOf('fde_g2_2026', 'urdu').sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.urdu.A.Q4').prompt_rule;
    expect(rule).toMatch(/کر/);
    expect(rule).toMatch(/one verb form/);
  });
});
