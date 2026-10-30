/**
 * bd-5jmnfj.4.58.2: v26 G1 Maths oral item 1 read «Bunty saw three flowers. Then she saw four birds.
 * Count on from 4. What number comes after 4?», a story whose numbers a Grade 1 child adds. An
 * oral mental-maths item's script carries no number other than the ones asked about; one that does
 * is asked again (oralContent lists its task as missing).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { extraNumbers } = require('../../bot/shared/services/assessment/fde-oral-numbers');

const V26 = [
  { ask: 'Bunty saw three flowers. Then she saw four birds. Count on from 4. What number comes after 4?', answer: '5' },
  { ask: 'Bunty has 5 apples. What is one more than 5?', answer: '6' },
  { ask: 'Bunty has 8 cookies. What is one less than 8?', answer: '7' },
  { ask: 'Bunty has 5 apples. She gives 2 apples to Babloo. How many apples does Bunty have now?', answer: '3' },
  { ask: 'Which number is bigger, 7 or 5?', answer: '7' },
];

describe('extraNumbers', () => {
  test('finds the v26 item 1 and only it', () => {
    expect(extraNumbers(V26)).toEqual([V26[0].ask]);
  });
  test('count on, one more, one less, add, take away and bigger are clean', () => {
    expect(extraNumbers(V26.slice(1))).toEqual([]);
    expect(extraNumbers([{ ask: 'Count on from 4. What number comes after 4?', answer: '5' }])).toEqual([]);
    expect(extraNumbers([{ ask: 'Count from 4 to 7. What comes between?', answer: '5' }])).toEqual([]);
  });
  test('three numbers in one script is extra, in digits or words', () => {
    expect(extraNumbers([{ ask: 'Bunty has 5 apples and 2 pears and 3 plums. How many apples?', answer: '5' }])).toHaveLength(1);
    expect(extraNumbers([{ ask: 'Bunty has five apples and two pears and three plums. What is one more than five?', answer: '6' }])).toHaveLength(1);
  });
  test('an answer that is no single number is not judged; garbage never throws', () => {
    expect(extraNumbers([{ ask: 'Count on from 3: say the next two numbers.', answer: '4, 5' }])).toEqual([]);
    expect(extraNumbers(null)).toEqual([]);
    expect(extraNumbers([null, {}, { ask: 5 }])).toEqual([]);
  });
});

describe('the oral reply read through oralContent', () => {
  const oral = Patterns.get('fde_g1_2026').subjects.maths.oral;
  test('a mental-maths item with extra numbers sends the task back; a clean reply passes', () => {
    const bad = Prompt.oralContent({ oral: [{ id: 'oral_maths', items: V26 }] }, oral);
    expect(bad.missing).toEqual(['oral_maths']);
    const good = Prompt.oralContent({ oral: [{ id: 'oral_maths', items: V26.slice(1).concat({ ask: 'Count on from 4. What number comes after 4?', answer: '5' }) }] }, oral);
    expect(good.missing).toEqual([]);
  });
  test('the task\'s prompt line carries the rule', () => {
    const P = Patterns.get('fde_g1_2026').subjects.maths;
    const t = Prompt.oralPrompt({ oral, grade: 1, P, pageContent: 'BOOK' });
    expect(t).toMatch(/no number other than the one\(s\) it asks about/);
  });
});
