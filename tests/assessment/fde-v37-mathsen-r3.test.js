/**
 * Round 6 loop 2 (v37r2) G1 Maths, G5 Maths and G5 English should-fixes (bd-5jmnfj.4.58):
 *   - G1 Maths Q8: a plain-object rule and the usual alternative names in accept;
 *   - G5 Maths: another item's non-integer answer printed in a stem; word-problem and equal-demand prompt rules;
 *   - G5 English Q10: one word-bank count in the paper's instruction, the scheme row and the accept line.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { crossItemAnswers } = require('../../bot/shared/services/assessment/fde-cross-item-answers');
const { sceneAlternatives } = require('../../bot/shared/services/assessment/fde-g1-scene-accept');
const { pictureWordCount } = require('../../bot/shared/services/assessment/fde-picture-word-count');
const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');
const { keyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes');
const { criteriaFor } = require('../../bot/shared/services/assessment/composition-criteria');

const G5 = Patterns.get('fde_g5_2027');
const G1 = Patterns.get('fde_g1_2026');
const slotOf = (P, subject, id) => P.subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const paper = (list) => ({ unseen: { x: { y: list } }, _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] } });

describe('G5 Maths: another item\'s answer printed in a stem', () => {
  const q1 = { slot: 'maths.A.Q1b', question: 'Write 35% as a decimal.', answer: '35% = 35/100 = 0.35' };
  const q2 = { slot: 'maths.B.Q2', question: 'Write 0.35 as a fraction in simplest form and as a percentage.', answer: '0.35 = 35/100 = 7/20 = 35%.' };

  test('the later stem that prints a decimal answer is flagged, naming the earlier slot', () => {
    const out = crossItemAnswers(paper([q1, q2]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'maths.B.Q2', reason: 'giveaway', printed: true, with: ['maths.A.Q1b'] });
  });
  test('a fraction and a percent answer count too', () => {
    const a = { slot: 'maths.A.Q1b', question: 'Add 1/2 and 1/4.', answer: '1/2 + 1/4 = 3/4' };
    const b = { slot: 'maths.B.Q2', question: 'A jug is 3/4 full. How many litres?', answer: '1.5' };
    expect(crossItemAnswers(paper([a, b]))).toHaveLength(1);
    const c = { slot: 'maths.A.Q1b', question: 'A shop gives 20% off.', answer: '20% of 50 = 10' };
    const d = { slot: 'maths.B.Q2', question: 'Write 0.5 as a percentage.', answer: '0.5 = 50%' };
    const e = { slot: 'maths.C.Q4-8', question: 'Of 80 students 50% are girls.', answer: '40' };
    expect(crossItemAnswers(paper([c, d, e])).map((f) => f.slot)).toEqual(['maths.C.Q4-8']);
  });
  test('whole-number answers and an item\'s own stem are never flagged', () => {
    const a = { slot: 'maths.A.Q1b', question: 'Find 5 x 6.', answer: '30' };
    const b = { slot: 'maths.B.Q2', question: 'There are 30 pens.', answer: '0.5 of 30 = 15' };
    const own = { slot: 'maths.C.Q3', question: 'Write 0.35 as a percent.', answer: '0.35 = 35%' };
    expect(crossItemAnswers(paper([a, b, own]))).toEqual([]);
  });
  test('a longer number holding the digits is not a print of the answer', () => {
    const a = { slot: 'maths.A.Q1b', question: 'x', answer: '0.35' };
    const b = { slot: 'maths.B.Q2', question: 'Add 10.355 and 2.', answer: '12.355' };
    expect(crossItemAnswers(paper([a, b]))).toEqual([]);
  });
  test('the fraction part of a mixed number is another number', () => {
    const a = { slot: 'maths.A.Q1b', question: 'x', answer: '2/3 x 3/5 = 2/5' };
    const b = { slot: 'maths.B.Q2', question: 'Subtract: 8 2/5 - 3 3/4', answer: '4 13/20' };
    expect(crossItemAnswers(paper([a, b]))).toEqual([]);
  });
  test('it rides the G5 paper giveaway re-ask path', () => {
    expect(paperGiveaways(paper([q1, q2])).some((f) => f.slot === 'maths.B.Q2')).toBe(true);
  });
  test('non-maths slots are ignored', () => {
    const a = { slot: 'science.A.Q1', question: 'x', answer: '0.35' };
    const b = { slot: 'science.B.Q2', question: 'Write 0.35.', answer: '1' };
    expect(crossItemAnswers(paper([a, b]))).toEqual([]);
  });
});

describe('G5 Maths prompt rules', () => {
  const rule = (id) => slotOf(G5, 'maths', id).prompt_rule;
  test('Q1(b) and Q2 never print another item\'s decimal, fraction or percent answer', () => {
    ['maths.A.Q1b', 'maths.B.Q2'].forEach((id) => expect(rule(id)).toMatch(/never print a fraction, a percent or a number with a point that another item/i));
  });
  test('Q2: one container and one quantity, the question asks what the stem sets up', () => {
    expect(rule('maths.B.Q2')).toMatch(/one container and one quantity/i);
    expect(rule('maths.B.Q2')).toMatch(/same thing the stem sets up/i);
  });
  test('Q2 short items are one or two steps of similar size; Section C needs two steps', () => {
    expect(rule('maths.B.Q2')).toMatch(/one or two steps of similar size/i);
    expect(rule('maths.C.Q4-8')).toMatch(/at least two steps.*find and use a quantity.*then answer/i);
  });
  test('marks stay as the FDE board fixes them', () => {
    expect(slotOf(G5, 'maths', 'maths.B.Q2').marks_each).toBe(5);
    expect(slotOf(G5, 'maths', 'maths.C.Q4-8').marks_each).toBe(5);
  });
});

describe('G1 Maths Q8 plain objects and alternatives', () => {
  test('the prompt allows only objects a 6-year-old names one way, drawn plainly', () => {
    const r = slotOf(G1, 'maths', 'g1.maths.B.Q8').prompt_rule;
    expect(r).toMatch(/only objects a 6-year-old names one way/i);
    expect(r).toMatch(/drawn plainly/i);
    expect(r).toMatch(/accept/i);
  });
  const item = (answer, accept) => ({ slot: 'g1.maths.B.Q8', question: 'Which is heavier?', answer, scheme: { points: [], accept } });
  const run = (q) => sceneAlternatives(paper([q])).unseen.x.y[0].scheme.accept;
  test('brick also accepts block and eraser-free usual names, with and without "the"', () => {
    const a = run(item('the brick', ['brick', 'the brick']));
    expect(a).toEqual(expect.arrayContaining(['brick', 'the brick', 'block', 'the block']));
  });
  test('motorbike accepts bike and motorcycle; mouse accepts rat', () => {
    expect(run(item('the motorbike', ['motorbike']))).toEqual(expect.arrayContaining(['bike', 'motorcycle']));
    expect(run(item('the mouse', ['mouse']))).toEqual(expect.arrayContaining(['rat']));
  });
  test('no duplicates, other slots untouched, nothing mutated', () => {
    const q = item('the brick', ['brick', 'block']);
    const before = JSON.stringify(q);
    const a = run(q);
    expect(a.filter((x) => x === 'block')).toHaveLength(1);
    expect(JSON.stringify(q)).toBe(before);
    const other = { slot: 'g1.maths.B.Q7', question: 'x', answer: 'the brick', scheme: { points: [], accept: ['brick'] } };
    expect(sceneAlternatives(paper([other])).unseen.x.y[0].scheme.accept).toEqual(['brick']);
  });
  test('an unknown object is left as the writer keyed it', () => {
    expect(run(item('the lamp', ['lamp']))).toEqual(['lamp']);
  });
});

describe('G5 English Q10 one word count', () => {
  const N = /at least (\w+)/.exec(criteriaFor('picture_description', 6, 'en').find((r) => /word-bank/i.test(r.name)).name)[1];
  const word = { 4: 'four', 5: 'five' }[N] || N;
  const q10 = () => ({
    slot: 'english.C.Q10', question: 'children reading', words: ['a', 'b'],
    scheme: { points: [{ text: 'Uses at least five of the given words', marks: 1, kind: 'A' }], accept: ['Any correct sentences that describe only the things in the scene and use at least five of the given words', 'Uses "there is"'] },
  });
  const layout = { _layout: { sections: [{ slots: [{ slot: 'english.C.Q10', kinds: ['picture_description'] }] }] } };
  test('the accept line and a point carry the template count, one number', () => {
    const out = pictureWordCount({ ...layout, unseen: { x: { y: [q10()] } } });
    const q = out.examJson.unseen.x.y[0];
    expect(q.scheme.accept[0]).toMatch(new RegExp(`at least ${word} of the given words`));
    expect(q.scheme.accept.join(' ')).not.toMatch(/at least five/);
    expect(q.scheme.points[0].text).toMatch(new RegExp(`at least ${word}`));
    expect(out.notes).toHaveLength(1);
  });
  test('an accept line already right and other slots are left alone', () => {
    const ok = q10();
    ok.scheme.accept = [`use at least ${word} of the given words`];
    ok.scheme.points = [{ text: 'A sentence', marks: 1 }];
    const other = { slot: 'english.C.Q4', scheme: { accept: ['at least five of the given words'], points: [] } };
    const out = pictureWordCount({ ...layout, unseen: { x: { y: [ok, other] } } });
    expect(out.notes).toHaveLength(0);
    expect(out.examJson.unseen.x.y[1].scheme.accept[0]).toMatch(/five/);
  });
  test('the paper instruction states the same count', () => {
    const ins = slotOf(G5, 'english', 'english.C.Q10').instruction_en;
    expect(ins).toMatch(new RegExp(`at least ${word} of the`, 'i'));
  });
  test('keyFixes applies it on the G5 path', () => {
    const out = keyFixes({ ...layout, unseen: { x: { y: [q10()] } } });
    expect(out.examJson.unseen.x.y[0].scheme.accept[0]).toMatch(new RegExp(`at least ${word} of`));
  });
});
