'use strict';
/**
 * Practice door: the freshness check (no question may match an exam-bank question, a textbook exercise or one the
 * child has already seen) and the replay cap (rounds per child per Pakistan day). Pure.
 */
const F = require('../../../shared/services/quiz/test-practice/freshness');
const Cap = require('../../../shared/services/quiz/test-practice/cap');

describe('norm', () => {
  test('case, punctuation and spacing do not count', () => {
    expect(F.norm('  What is the  PLURAL of "cat"? ')).toBe(F.norm('what is the plural of cat'));
  });
  test('Urdu letters survive', () => {
    expect(F.norm('بلی، کہاں ہے؟')).toBe('بلیکہاںہے');
  });
  test('null and numbers are safe', () => {
    expect(F.norm(null)).toBe('');
    expect(F.norm(12)).toBe('12');
  });
});

describe('textsOf', () => {
  test('pulls every string out of nested exercise JSON', () => {
    expect(F.textsOf({ q: [{ text: 'Fill in the blank' }, 'Match the words', { n: 3 }], t: 'x' }))
      .toEqual(['Fill in the blank', 'Match the words', 'x']);
  });
  test('null gives nothing', () => { expect(F.textsOf(null)).toEqual([]); });
});

describe('blocker / isFresh', () => {
  const block = F.blocker(['What is the plural of cat?', 'Write five sentences about your school and family.', 'ok']);
  test('an exact match (after norm) is not fresh', () => {
    expect(block.isFresh('what is the PLURAL of cat')).toBe(false);
  });
  test('a question that contains a long blocked text is not fresh', () => {
    expect(block.isFresh('Read carefully. Write five sentences about your school and family!')).toBe(false);
  });
  test('a question contained in a long blocked text is not fresh', () => {
    expect(block.isFresh('five sentences about your school')).toBe(false);
  });
  test('short blocked texts only block an exact match', () => {
    expect(block.isFresh('Is it ok to run?')).toBe(true);
    expect(block.isFresh('OK!')).toBe(false);
  });
  test('an unrelated question is fresh', () => {
    expect(block.isFresh('Which word is a noun: run, dog, blue?')).toBe(true);
  });
  test('an empty question is never fresh', () => {
    expect(block.isFresh('  ?? ')).toBe(false);
  });
  test('a short question is not blocked by containment inside a long text', () => {
    expect(F.blocker(['the cat sat on the mat today']).isFresh('the cat')).toBe(true);
  });
  test('size counts distinct blocked texts', () => {
    expect(block.size).toBe(3);
  });
});

describe('cap', () => {
  test('three rounds a day', () => { expect(Cap.ROUNDS_PER_DAY).toBe(3); });
  test('the Pakistan day starts at 19:00 UTC the day before', () => {
    expect(Cap.pktDayStart(new Date('2026-11-27T10:00:00Z'))).toBe('2026-11-26T19:00:00.000Z');
    expect(Cap.pktDayStart(new Date('2026-11-27T19:30:00Z'))).toBe('2026-11-27T19:00:00.000Z');
    expect(Cap.pktDayStart(new Date('2026-11-27T18:59:59Z'))).toBe('2026-11-26T19:00:00.000Z');
  });
  test.each([[0, false], [2, false], [3, true], [9, true]])('%i rounds today capped=%p', (n, c) => {
    expect(Cap.capped(n)).toBe(c);
  });
});
