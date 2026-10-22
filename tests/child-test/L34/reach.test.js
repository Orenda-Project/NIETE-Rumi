'use strict';
/**
 * L34 (bd-s1oo0.47, CONTRACT §20) — the reach rule. A question with needs_line = k is reached iff
 * words_attempted >= lines[k-1].to + 1; a child who finished early reached every question; a fallback block
 * has no questions. Real item bank; only the logger is mocked.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { logToFile } = require('../../../bot/shared/utils/logger');
const { reachedQuestions, anchorFor, lineEndFor } = require('../../../bot/shared/services/child-test/scoring/reach');
const bank = require('../../../bot/shared/services/child-test/item-bank');

const spec = (g, block) => bank.getForm(g, 'A')[block];
const part = (wa, extra = {}) => ({ story: { words_attempted: wa, words_correct: wa, finished_early: false, ...extra } });
const ids = (s) => [...s].sort();

// [grade, block, [question id, needs_line, last word index of that line (0-based)]]
const CASES = [
  [3, 'urdu', [['u3A-q1', 1, 10], ['u3A-q2', 3, 29], ['u3A-q3', 5, 54]]],
  [5, 'urdu', [['u5A-q1', 1, 10], ['u5A-q2', 8, 84], ['u5A-q3', 13, 147]]],
  [5, 'english', [['e5A-q1', 2, 11], ['e5A-q2', 3, 19], ['e5A-q3', 12, 113]]],
];

describe.each(CASES)('G%sA %s: before, at and after each question\'s line', (grade, block, qs) => {
  const s = spec(grade, block);
  test('the bank still has the lines this table names', () => {
    expect(s.questions.map((q) => [q.id, q.needs_line, s.story.lines[q.needs_line - 1].to])).toEqual(qs);
  });
  test.each(qs)('%s (line %s ends at word %s)', (id, _k, to) => {
    const lastWord = to + 1; // words_attempted that just finishes the line
    expect(reachedQuestions(s, part(lastWord - 1)).has(id)).toBe(false); // one word short
    expect(reachedQuestions(s, part(lastWord)).has(id)).toBe(true);      // exactly at the line's end
    expect(reachedQuestions(s, part(lastWord + 5)).has(id)).toBe(true);  // past it
  });
  test('the set is cumulative: everything before the first unreached question', () => {
    const to2 = qs[1][2];
    expect(ids(reachedQuestions(s, part(to2 + 1)))).toEqual(ids([qs[0][0], qs[1][0]]));
    expect(reachedQuestions(s, part(0)).size).toBe(0);
  });
});

describe('special cases', () => {
  const s = spec(5, 'urdu');
  test('a child who finished early reached every question, whatever words_attempted says', () => {
    expect(ids(reachedQuestions(s, part(30, { finished_early: true })))).toEqual(ids(s.questions.map((q) => q.id)));
  });
  test('a fallback (non-reader) block has no questions', () => {
    expect(reachedQuestions(s, { ...part(176), fallback: { letters: { correct: 3, of: 10 } } }).size).toBe(0);
  });
  test('the story part itself is accepted (scorer output, not only ai_marks)', () => {
    expect(reachedQuestions(s, { words_attempted: 11 }).has('u5A-q1')).toBe(true);
  });
  test('story not scored: nothing is dropped (every question counts as reached)', () => {
    expect(reachedQuestions(s, {}).size).toBe(3);
    expect(reachedQuestions(s, { story: null }).size).toBe(3);
  });
  test('N questions, not 3: a fifth question is gated too', () => {
    const five = { ...s, questions: [...s.questions, { id: 'x4', needs_line: 2 }, { id: 'x5', needs_line: 14 }] };
    const r = reachedQuestions(five, part(85));
    expect(ids(r)).toEqual(['u5A-q1', 'u5A-q2', 'x4']);
  });
  test('a bank without needs_line: every question is gated on line 1, and a warning is logged', () => {
    logToFile.mockClear();
    const bare = { story: s.story, questions: s.questions.map(({ needs_line, ...q }) => q) };
    expect(reachedQuestions(bare, part(10)).size).toBe(0);  // line 1 ends at word 10 (11 words)
    expect(reachedQuestions(bare, part(11)).size).toBe(3);
    expect(logToFile).toHaveBeenCalledWith('child_test.reach.no_needs_line', expect.objectContaining({ questions: expect.any(Array) }), 'warn');
  });
  test('lineEndFor gives the words a line needs', () => {
    expect(lineEndFor(s, 13)).toBe(148);
    expect(lineEndFor(s, 1)).toBe(11);
  });
});

describe('anchorFor: the last 2–3 printed words of the question\'s line, no punctuation', () => {
  test('G3A Urdu', () => {
    const s = spec(3, 'urdu');
    expect(anchorFor(s, s.questions[1], 'urdu')).toBe('حرکت کرتے دیکھا');
    expect(anchorFor(s, s.questions[2], 'urdu')).toBe('اور مسکراتا رہا');
  });
  test('G5A English', () => {
    const s = spec(5, 'english');
    expect(anchorFor(s, s.questions[2], 'english')).toBe('to water it');
  });
  test('accepts the whole form plus the block name', () => {
    const f = bank.getForm(5, 'A');
    expect(anchorFor(f, f.urdu.questions[2], 'urdu')).toBe('سے تالیاں بجائیں');
  });
  test('trailing punctuation is trimmed; a long last 3 words drops to 2', () => {
    const toy = { story: { tokens: ['One', 'two.', 'extraordinarily', 'unbelievable,', 'conversations!'], lines: [{ n: 1, from: 0, to: 4 }] }, questions: [] };
    expect(anchorFor(toy, { id: 'a', needs_line: 1 }, 'english')).toBe('unbelievable conversations');
    const short = { story: { tokens: ['Go', 'home.'], lines: [{ n: 1, from: 0, to: 1 }] }, questions: [] };
    expect(anchorFor(short, { id: 'b', needs_line: 1 }, 'english')).toBe('Go home');
  });
});
