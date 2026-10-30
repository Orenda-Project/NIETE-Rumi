/**
 * The order a match question prints its Column B in (bd-5jmnfj.4.23): sorted, so it never
 * follows the order the model wrote the pairs, and turned until no answer sits beside its
 * own stem.
 */

const { matchOrder, matchTable, matchStem } = require('../../bot/shared/services/assessment/fde-match-block');

const beside = (answers, order) => order.filter((a, i) => a === answers[i]).length;

test.each([
  [['b', 'a', 'c']],
  [['a', 'b', 'c', 'd', 'e']],
  [['e', 'd', 'c', 'b', 'a']],
  [['صحرا', 'گھونسلہ', 'پودے', 'پانی', 'سونگھنا']],
])('%j: every answer is printed once, none beside its own stem', (answers) => {
  const order = matchOrder(answers);
  expect([...order].sort()).toEqual([...answers].sort());
  expect(beside(answers, order)).toBe(0);
});

test('two pairs swap; one pair is printed as it is', () => {
  expect(matchOrder(['x', 'y'])).toEqual(['y', 'x']);
  expect(matchOrder(['x'])).toEqual(['x']);
});

// v30 G3 General Knowledge Q2 printed the slot instruction five times as the stems (bd-5jmnfj.33.2):
// the model wrote the term in column_a and the instruction in question.
test('a match stem is its own Column A, else its question', () => {
  expect(matchStem({ question: 'کالم الف کو کالم ب سے ملائیں۔', column_a: ['گھر'], column_b: ['کھلونا'] })).toBe('گھر');
  expect(matchStem({ question: 'camel', column_a: [' '], column_b: ['desert'] })).toBe('camel');
  expect(matchStem({ question: 'camel' })).toBe('camel');
  expect(matchStem({})).toBe('');
});

test('the table puts each stem beside a Column B cell, one row per pair', () => {
  const html = matchTable(['1 A', '2 B'], ['q', 'p']);
  expect((html.match(/<tr>/g) || [])).toHaveLength(2);
  expect(html).toContain('<td class="m-a">1 A</td><td class="m-gap"></td><td class="m-b">q</td>');
});

// bd-5jmnfj.33.5.4: G3 General Knowledge ch3 returned column_b [] with the pair joined by a colon in answer;
// Column B printed the row's own Column A term and all five marks were free.
describe('bd-5jmnfj.33.5.4 matchAnswer with a colon-joined pair', () => {
  const { matchAnswer } = require('../../bot/shared/services/assessment/fde-match-block');
  const A = 'قابو سے باہر اختلاف';

  test('ASCII colon: Column B is the tail after the colon', () => {
    expect(matchAnswer({ column_a: [A], column_b: [], answer: `${A}: لڑائی` })).toBe('لڑائی');
  });

  test('full-width colon: Column B is the tail after the colon', () => {
    expect(matchAnswer({ column_a: [A], column_b: [], answer: `${A}：لڑائی` })).toBe('لڑائی');
  });

  test('guard: a real column_b still wins', () => {
    expect(matchAnswer({ column_a: [A], column_b: ['لڑائی'], answer: `${A}: لڑائی` })).toBe('لڑائی');
  });

  test('only the row\'s own Column A prefix is stripped, so a time in Column B survives', () => {
    expect(matchAnswer({ column_a: ['اسکول کا وقت'], column_b: [], answer: 'اسکول کا وقت: 10:30' })).toBe('10:30');
    expect(matchAnswer({ column_a: ['وقت'], column_b: [], answer: '10:30' })).toBe('10:30');
  });
});
