/**
 * bd-5jmnfj.4.57 — a common-error figure is the real slip, or no figure at all.
 * v25 G1 Maths Q2 v: "45, 46, 47, __, __" said a child counting back writes 44, 43 (it is 46, 45).
 * v25 G2 Maths Q7 i: 324 + 258 said not carrying "in the ones or tens" gives 472 (only the ones
 * carry, and the slip gives 572). v25 G5 Maths Q1(b) vii: 45.75 + 12.50 said not lining up the
 * points gives Rs. 50.25 or Rs. 57.25 (both have two places, so the slip gives no wrong figure).
 * Run through mathsCheck as the writer runs it on a board-pattern paper (scheme.checked reset).
 */

const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');

const paper = (type, q) => ({
  _layout: { subject: 'Maths', sections: [] },
  unseen: { subjective: { [type]: [q] } },
});
const errorOf = (type, q) => mathsCheck(paper(type, q)).examJson.unseen.subjective[type][0].scheme.common_error;
const series = (question, answer, common_error) => errorOf('Number Series', {
  slot: 'g1.maths.A.Q2', marks: 2, question, answer, main_question: 'Count on by 1 and fill in the two blanks.',
  scheme: { accept: [answer], points: [], checked: null, common_error },
});

describe('counting back or on past a run', () => {
  test('v25 G1 Q2 v: counting back from 47 writes 46, 45', () => {
    expect(series('45, 46, 47, __, __', '48, 49', 'Counts back and writes 44, 43.'))
      .toBe('Counts back and writes 46, 45.');
  });

  test('counting forward on a falling run writes the next numbers up', () => {
    expect(series('9, 8, 7, __, __', '6, 5', 'Counts forward and writes 10, 11.'))
      .toBe('Counts forward and writes 8, 9.');
  });

  test('a right figure, a named step and blanks inside the run are left as written', () => {
    expect(series('2, 4, 6, __, __', '8, 10', 'Counts on by 1 and writes 7, 8.')).toBe('Counts on by 1 and writes 7, 8.');
    expect(series('10, 20, 30, __, __', '40, 50', 'Counts on by 1 and writes 31, 32.')).toBe('Counts on by 1 and writes 31, 32.');
    expect(series('14, 16, __, 20, __', '18, 22', 'Counts on by 1 and writes 17, 21.')).toBe('Counts on by 1 and writes 17, 21.');
  });
});

describe('adding without carrying', () => {
  const sum = (question, answer, common_error) => errorOf('Addition Word Problem', {
    slot: 'g2.maths.B.Q7', marks: 3, question, answer,
    scheme: { accept: ['Bar model then column addition'], points: [], checked: null, common_error },
  });

  test('v25 G2 Q7 i: 324 + 258 carries only in the ones, and the slip gives 572', () => {
    expect(sum(
      'Bunty read 324 pages of a story book last week and 258 pages this week. How many pages did Bunty read altogether?',
      '324 + 258 = 582 pages', 'Not carrying in the ones or tens, giving 472',
    )).toBe('Not carrying in the ones, giving 572');
  });

  test('each column\'s own slip is a right figure and is kept', () => {
    // 167 + 258: drop the ones carry 415, the tens carry 325, both 315.
    expect(sum('Add 167 and 258.', '167 + 258 = 425', 'Not carrying one ten or one hundred, giving 315 or 325.'))
      .toBe('Not carrying one ten or one hundred, giving 315 or 325.');
  });

  test('a sum with nothing to carry is left as written', () => {
    expect(sum('Add 321 and 456.', '321 + 456 = 777', 'Forgets to carry, giving 677.')).toBe('Forgets to carry, giving 677.');
  });
});

describe('not lining up the decimal points', () => {
  const dec = (question, answer, common_error) => errorOf('Short Questions', {
    slot: 'maths.A.Q1b', marks: 2, question, answer,
    scheme: { accept: ['Column addition with decimal points aligned'], points: [], checked: null, common_error },
  });

  test('v25 G5 Q1(b) vii: both prices have two places, so the figures go and the slip stays in words', () => {
    expect(dec(
      'Amna buys a notebook for Rs. 45.75 and a pen for Rs. 12.50. How much money does she pay altogether?',
      '45.75 + 12.50 = Rs. 58.25', 'Not lining up the decimal points, giving Rs. 50.25 or Rs. 57.25',
    )).toBe('Not lining up the decimal points');
  });

  test('different places: the figure is the digits added right-aligned', () => {
    // 3.5 + 1.25 with the digits lined up on the right: 35 + 125 = 160 → 1.60.
    expect(dec('Add 3.5 and 1.25.', '3.5 + 1.25 = 4.75', 'Not lining up the decimal points, giving 4.80.'))
      .toBe('Not lining up the decimal points, giving 1.60.');
    expect(dec('Add 3.5 and 1.25.', '3.5 + 1.25 = 4.75', 'Not lining up the decimal points, giving 1.60.'))
      .toBe('Not lining up the decimal points, giving 1.60.');
  });
});

test('a paper with no board layout is not touched', () => {
  const q = { question: '45, 46, 47, __, __', answer: '48, 49', scheme: { checked: null, common_error: 'Counts back and writes 44, 43.' } };
  const out = mathsCheck({ subject: 'Maths', unseen: { subjective: { 'Number Series': [q] } } }, { subject: 'Maths' });
  expect(out.examJson.unseen.subjective['Number Series'][0].scheme.common_error).toBe('Counts back and writes 44, 43.');
});
