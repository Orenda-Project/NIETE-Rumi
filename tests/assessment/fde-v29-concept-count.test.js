/**
 * One concept asked too often on a G5 Science paper (bd-5jmnfj.4.58.4). v28: physical and chemical change five times
 * (Q1 (a) vii, Q2 (b) i c, Q2 (b) ii c, Q3 (a) 9, Q3 (b) 3), vaccines three times (Q1 (a) viii, Q3 (a) 5, Q3 (b) 1).
 * Each concept is asked at most twice on a paper and never by two items of one section; the later items are flagged so
 * their section is asked again. Q3 (b) 3's stem states Q2 (b) i c's answer (dissolving sugar is a physical change): it is
 * the fifth on the paper and is flagged.
 */

const { conceptRepeats } = require('../../bot/shared/services/assessment/fde-concept-count');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const science = require('./fixtures/fde-v29-g5-science.json');
const maths = require('./fixtures/fde-v29-g5-maths.json');
const english = require('./fixtures/fde-v29-g5-english.json');
const urdu = require('./fixtures/fde-v29-g5-urdu.json');

const paper = (list) => ({
  unseen: { x: { y: list } },
  _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] },
});
const q = (slot, question, extra = {}) => ({ slot, question, answer: 'a', ...extra });
const mcq = (slot, question, key) => q(slot, question, { options: [`a) ${key}`, 'b) Rain', 'c) Wind', 'd) Snow'], answer: `a) ${key}` });

describe('the real v28 G5 Science paper', () => {
  const flags = conceptRepeats(science);
  const of = (name) => flags.filter((f) => f.words.includes(name));

  test('physical and chemical change: the third, fourth and fifth asks are flagged, not the first two', () => {
    const f = of('physical and chemical change');
    expect(f.map((x) => x.slot).sort()).toEqual(['science.B.Q2b', 'science.C.Q3a', 'science.C.Q3b']);
    expect(f.find((x) => x.slot === 'science.C.Q3b').with).toEqual(expect.arrayContaining(['science.A.Q1a', 'science.B.Q2b']));
  });

  test('Q3 (b) 3, whose stem states Q2 (b) i c\'s answer, is flagged', () => {
    const f = flags.find((x) => x.slot === 'science.C.Q3b');
    expect(f).toBeTruthy();
    expect(f.text.join(' ')).toMatch(/dissolving sugar|chemical change/i);
  });

  test('vaccines: the third ask (Q3 (b) 1) is flagged', () => {
    expect(of('vaccines').map((x) => x.slot)).toEqual(['science.C.Q3b']);
  });

  test('light and materials, asked twice, is not flagged', () => {
    expect(of('transparent, translucent and opaque')).toEqual([]);
  });

  test('it reaches the re-ask path through answerRepeats', () => {
    expect(answerRepeats(science).map((x) => x.slot)).toEqual(expect.arrayContaining(['science.C.Q3a', 'science.C.Q3b']));
  });
});

describe('the count and the section rule', () => {
  test('two asks of a concept in different sections are fine', () => {
    const p = paper([mcq('science.A.Q1a', 'Which of these is a chemical change?', 'Rusting'), q('science.C.Q3a', 'Is burning wood a physical change or a chemical change?')]);
    expect(conceptRepeats(p)).toEqual([]);
  });

  test('two items of one section asking one concept: the later is flagged even on the second ask', () => {
    const p = paper([q('science.B.Q2b', 'Why is rusting called a chemical change?'), q('science.B.Q2b', 'Is melting wax a physical change?')]);
    const f = conceptRepeats(p);
    expect(f.map((x) => x.slot)).toEqual(['science.B.Q2b']);
    expect(f[0].with).toEqual(['science.B.Q2b']);
  });

  test('two sub-questions of one item are one ask', () => {
    const p = paper([q('science.B.Q2b', 'Sugar is stirred in water.', { questions: [q('science.B.Q2b', 'Is this a physical change?'), q('science.B.Q2b', 'Why is it not a chemical change?')] })]);
    expect(conceptRepeats(p)).toEqual([]);
  });

  test('a stem mentioning a concept inside its keyed option counts for an MCQ', () => {
    const p = paper([mcq('science.A.Q1a', 'What does a vaccine do?', 'Vaccines teach the body'), q('science.C.Q3a', 'Explain how vaccines protect us.'), q('science.C.Q3b', 'Explain how vaccines, masks and handwashing stop a virus.')]);
    expect(conceptRepeats(p).map((x) => x.slot)).toEqual(['science.C.Q3b']);
  });

  test('only science papers are counted', () => {
    const p = paper([q('maths.A.Q1a', 'Is this a chemical change?'), q('maths.B.Q2', 'Is this a chemical change?'), q('maths.C.Q3', 'Is this a chemical change?')]);
    expect(conceptRepeats(p)).toEqual([]);
  });

  test('no paper, no flags', () => {
    expect(conceptRepeats(null)).toEqual([]);
    expect(conceptRepeats({})).toEqual([]);
  });
});

describe('the other Grade 5 papers are not hit', () => {
  test.each([['maths', maths], ['english', english], ['urdu', urdu]])('%s', (_n, p) => { expect(conceptRepeats(p)).toEqual([]); });
});

describe('G5 Science prompt rules name the limit', () => {
  const rule = (slot) => Patterns.subjectOf('fde_g5_2027', 'science').sections.flatMap((s) => s.slots).find((s) => s.slot === slot).prompt_rule;
  test.each(['science.A.Q1a', 'science.B.Q2b', 'science.C.Q3a', 'science.C.Q3b'])('%s', (slot) => {
    expect(rule(slot)).toMatch(/Each concept \(physical or chemical change, vaccines, light and materials\) is asked at most twice in the whole paper, never by two items of one section/);
    expect(rule(slot)).toMatch(/a stem never states another item's answer/);
  });
});
