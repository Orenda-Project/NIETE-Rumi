/**
 * v29 blockers and oral rows wired into the Grade 1-2 writer (bd-5jmnfj.4.58): the G1 Urdu Q5 word-box clash goes to
 * the key re-ask, and an Urdu oral task that asks two things or opens a dialogue with a reply is asked again.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { keyShortfall } = require('../../bot/shared/services/assessment/fde-key-checks');
const { oralContent } = require('../../bot/shared/services/assessment/fde-early-prompt');

const P = Patterns.subjectOf('fde_g1_2026', 'urdu');
const BOX = ['ستارے', 'خوشبو', 'بہن', 'سال', 'گڑیا'];
const item = (question, answer, extra = {}) => ({ slot: 'g1.urdu.B.Q5', question, answer, marks: 1, ...extra });
const paper = (items) => ({ unseen: { subjective: { 'Fill in the Blanks': items } } });
const v29 = [
  item('چاند کے ساتھ ___ آئے۔', 'ستارے', { words: BOX }), item('مٹھائیوں کی ___ آئی۔', 'خوشبو'),
  item('میری ایک ___ ہے۔', 'بہن'), item('میں سات ___ کا ہوں۔', 'سال'), item('بنٹی کی ___ گم ہو گئی تھی۔', 'گڑیا'),
];

describe('G1 Urdu Q5 word-box clash reaches the key re-ask', () => {
  test('v29 box: بہن and گڑیا fit each other\'s blank, so Q5 is asked again', () => {
    const out = keyShortfall(paper(v29), P);
    expect(out.some((f) => f.slot === 'g1.urdu.B.Q5' && f.items.some((s) => /fits this blank too/.test(s)))).toBe(true);
  });
  test('control: a G1 English paper gets no Urdu word-box check', () => {
    const E = Patterns.subjectOf('fde_g1_2026', 'english');
    expect(keyShortfall({ unseen: { subjective: {} } }, E)).toEqual([]);
  });
});

describe('Urdu oral tasks are asked again when they ask two things or a dialogue opens with a reply', () => {
  const oral = (id, kind = 'oral_questions') => ({ tasks: [{ id, kind, n: 1 }] });
  test('v29 G1 «My mother» item 3 asks two things', () => {
    const tree = { oral: [{ id: 'mother', items: [{ ask: 'امی کیا پکاتی ہیں یا انھیں کیا پسند ہے؟', answer: 'روٹی' }] }] };
    expect(oralContent(tree, oral('mother')).missing).toEqual(['mother']);
  });
  test('v29 G2 dialogue opens «ٹھیک ہے، …»', () => {
    const tree = { oral: [{ id: 'dialogue', script: 'احمد: ٹھیک ہے، چلو۔\nعلی: کہاں؟', items: [{ ask: 'احمد کہاں جا رہا ہے؟', answer: 'باغ' }] }] };
    expect(oralContent(tree, oral('dialogue')).missing).toEqual(['dialogue']);
  });
  test('control: an English oral item with two question marks is not an Urdu check', () => {
    const tree = { oral: [{ id: 'mother', items: [{ ask: 'What is it? Is it red?', answer: 'a ball' }] }] };
    expect(oralContent(tree, oral('mother')).missing).toEqual([]);
  });
});

describe('the Grade 1-2 English give-aways reach the writer re-ask through paperGiveaways', () => {
  const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');
  test('v29 G2 English: mangoes (Q16) handing Q8 is in the paper-wide list', () => {
    const flags = paperGiveaways(require('./fixtures/fde-v34-g2-english.json'));
    expect(flags.some((f) => f.slot === 'g2.english.C.Q16' && f.words.some((w) => /mango/.test(w)))).toBe(true);
  });
});

describe('G2 Urdu Q1 rejects the v29 lesson-event items vii and viii (review re-read)', () => {
  const { g2Q1Ok } = require('../../bot/shared/services/assessment/fde-early-urdu-mcq');
  const q = (question) => ({ slot: 'g2.urdu.A.Q1', question, options: ['a', 'b', 'c'] });
  test('vii and viii ask who did what in a lesson', () => {
    expect(g2Q1Ok(q('سبق "تقریر کا فن" میں علی کو تقریر کرنا کس نے سکھایا؟'))).toBe(false);
    expect(g2Q1Ok(q('سبق "تین بہادر دوست" میں لڑکے کی ٹانگیں کس نے پکڑ رکھی تھیں؟'))).toBe(false);
  });
  test('control: meaning and spelling items stay', () => {
    expect(g2Q1Ok(q('لفظ "دلاسا" کے معنی کیا ہیں؟'))).toBe(true);
    expect(g2Q1Ok(q('درست املا کون سا ہے؟'))).toBe(true);
  });
});
