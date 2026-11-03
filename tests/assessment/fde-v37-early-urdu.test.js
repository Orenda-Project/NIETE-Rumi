/**
 * v37 round 6, G1/G2 Urdu (W-UR-early): cross-item repeats, poem key answers, and prompt rules.
 * Rows: G1 Q1 vi/vii, Q5 ii, Q5 iv / Q10 i, oral poem Q1; G2 Q2 iv, Q4 iv, Q6, Q9.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { boxWordRepeats, mcqRepeats } = require('../../bot/shared/services/assessment/fde-early-urdu-repeat');
const { urduOralBad } = require('../../bot/shared/services/assessment/fde-early-urdu-oral');

const slotOf = (key, slot) => Patterns.subjectOf(key, 'urdu').sections.flatMap((s) => s.slots).find((s) => s.slot === slot);
const taskOf = (key, id) => Patterns.subjectOf(key, 'urdu').oral.tasks.find((t) => t.id === id);

const blank = (question, answer, extra = {}) => ({ slot: 'g1.urdu.B.Q5', question, answer, scheme: { accept: [answer] }, ...extra });
const pic = (answer, accept = []) => ({ slot: 'g1.urdu.B.Q10', question: 'تصویر دیکھ کر ایک جملہ لکھیں۔', answer, scheme: { accept } });
const mcq = (question, options, answer) => ({ slot: 'g1.urdu.A.Q1', question, options, answer });
const paper = (fill, picture, mcqs = []) => ({
  unseen: { subjective: { 'Fill in the Blanks': fill, 'Picture Sentences': picture, MCQs: mcqs } },
  _layout: { sections: [{ id: 'B', slots: [
    { slot: 'g1.urdu.B.Q5', type: 'Fill in the Blanks' }, { slot: 'g1.urdu.B.Q10', type: 'Picture Sentences' }, { slot: 'g1.urdu.A.Q1', type: 'MCQs' }] }] },
});
const BOX = ['اسکول', 'پنکھا', 'بستہ', 'دودھ', 'جھولے'];

describe('v37 G1 Urdu Q5 box word handed to Q10 (row 2)', () => {
  const fill = [blank('بچے پارک میں ___ پر بیٹھ کر جھولتے ہیں۔', 'جھولے', { words: BOX }), blank('بچہ اپنی کاپی ___ میں رکھتا ہے۔', 'بستہ')];
  test('RED a Q10 model sentence that holds a Q5 box word (also an inflected form) is flagged on Q10', () => {
    const rows = boxWordRepeats(paper(fill, [pic('بچہ پارک میں جھولا جھول رہا ہے۔', ['بچہ جھولے پر بیٹھا ہے۔'])]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: 'g1.urdu.B.Q10', reason: 'answer' });
    expect(rows[0].items[0]).toMatch(/جھولے/);
  });
  test('a Q10 paper with none of the box words is clean', () => {
    expect(boxWordRepeats(paper(fill, [pic('لڑکی پودے کو پانی دے رہی ہے۔')]))).toEqual([]);
  });
  test('a paper with no box is clean', () => {
    expect(boxWordRepeats(paper([blank('x ___', 'بستہ')], [pic('بستہ')]))).toEqual([]);
  });
});

describe('v37 G1 Urdu Q1 vi/vii same letters, same key (row 5)', () => {
  const vi = mcq('لفظ «خر_وش» میں خالی جگہ پر کون سا حرف آئے گا؟', ['الف) ک', 'ب) غ', 'ج) گ'], 'ج) گ');
  const vii = mcq('لفظ «گلاب» کس حرف سے شروع ہوتا ہے؟', ['الف) ک', 'ب) گ', 'ج) غ'], 'ب) گ');
  test('RED two items with one option set and one key are flagged', () => {
    const rows = mcqRepeats(paper([], [], [vi, vii]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: 'g1.urdu.A.Q1', reason: 'answer' });
  });
  test('the same letters with a different key are not a repeat', () => {
    const other = mcq('لفظ «غبارہ» کس حرف سے شروع ہوتا ہے؟', ['الف) ک', 'ب) گ', 'ج) غ'], 'ج) غ');
    expect(mcqRepeats(paper([], [], [vi, other]))).toEqual([]);
  });
});

describe('v37 G1 oral poem Q1 key names nothing (rows 3, 6)', () => {
  const script = 'چاند کے ساتھ ستارے آئے،\nرات کے رنگ نکھر کر چھائے\nچاندنی نے فرش بچھایا،';
  const riddle = { ask: 'رات کو کس کے ساتھ ستارے آئے؟', answer: 'ستارے رات کو آنے والے مہمان کے ساتھ آئے، جس کا نام نظم کے پہلے لفظ میں آتا ہے۔' };
  test('RED an answer that points at the poem instead of naming the word is flagged', () => {
    expect(urduOralBad('poem', [riddle], script).map((b) => b.reason)).toContain('points-at-poem');
  });
  test('RED an answer with no word taken from the poem beyond the question is flagged', () => {
    expect(urduOralBad('poem', [{ ask: 'رات کو کس کے ساتھ ستارے آئے؟', answer: 'ستارے رات کو ایک مہمان کے ساتھ آئے۔' }], script).map((b) => b.reason)).toContain('answer-not-from-poem');
  });
  test('an answer that names چاند is clean', () => {
    expect(urduOralBad('poem', [{ ask: 'رات کو کس کے ساتھ ستارے آئے؟', answer: 'چاند کے ساتھ آئے۔' }], script)).toEqual([]);
    expect(urduOralBad('poem', [{ ask: 'فرش کس نے بچھایا؟', answer: 'فرش چاندنی نے بچھایا۔' }], script)).toEqual([]);
  });
  test('no script, no poem check', () => {
    expect(urduOralBad('poem', [riddle], '').map((b) => b.reason)).not.toContain('answer-not-from-poem');
  });
  test('RED the G1 poem task asks the key to name the word the question asks for, from the poem', () => {
    expect(taskOf('fde_g1_2026', 'poem').ask).toMatch(/names the word the question asks for/);
    expect(taskOf('fde_g1_2026', 'poem').ask).toMatch(/never points at a line or a word position/);
  });
});

describe('v37 G1 Urdu Q5 one box word per blank (row 1, 7)', () => {
  test('RED the Q5 rule tells the writer to test every box word against every blank, naming a place word', () => {
    const rule = slotOf('fde_g1_2026', 'g1.urdu.B.Q5').prompt_rule;
    expect(rule).toMatch(/test every box word against every blank/);
    expect(rule).toMatch(/اسکول/);
  });
  test('RED Q5 and Q10 keep the box words out of the picture sentences', () => {
    expect(slotOf('fde_g1_2026', 'g1.urdu.B.Q5').prompt_rule).toMatch(/Q10/);
    expect(slotOf('fde_g1_2026', 'g1.urdu.B.Q10').prompt_rule).toMatch(/none of Q5's box words/);
  });
  test('RED the G1 Q1 rule keeps one letter choice from repeating with one key', () => {
    expect(slotOf('fde_g1_2026', 'g1.urdu.A.Q1').prompt_rule).toMatch(/no two items share the same three options and the same key/i);
  });
});

describe('v37 G2 Urdu prompt rules', () => {
  test('RED Q2 (row 4/8 ordering part): the three words differ at the first letter', () => {
    expect(slotOf('fde_g2_2026', 'g2.urdu.A.Q2').prompt_rule).toMatch(/begin with three different letters/);
    expect(slotOf('fde_g2_2026', 'g2.urdu.A.Q2').prompt_rule).toMatch(/never decided by the second letter/);
  });
  test('RED Q4 (rows 1, 6): no compound verb', () => {
    const rule = slotOf('fde_g2_2026', 'g2.urdu.A.Q4').prompt_rule;
    expect(rule).toMatch(/never a compound verb/);
    expect(rule).toMatch(/دلاسا دیا/);
  });
  test('RED Q6 (row 2): accept holds every other true opposite', () => {
    const rule = slotOf('fde_g2_2026', 'g2.urdu.A.Q6').prompt_rule;
    expect(rule).toMatch(/every other true opposite/);
    expect(rule).toMatch(/خراب/);
  });
  test('RED Q9 (rows 3, 7): a mark pays the speaker\'s name', () => {
    const slot = slotOf('fde_g2_2026', 'g2.urdu.B.Q9');
    expect(slot.prompt_rule).toMatch(/each point pays the speaker's name/);
    expect(slot.prompt_rule).toMatch(/1 for the name before the turn and 1 for the turn/);
    expect(slot.prompt_rule).not.toMatch(/name the five turns only as/);
  });
});
