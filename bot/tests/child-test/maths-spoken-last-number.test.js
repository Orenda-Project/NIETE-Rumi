'use strict';

/**
 * The coach-recorded spoken maths (number identification, quick sums) follows EGMA: the LAST number the child says
 * for an item is the answer. Before this, a second number the child said for the same item was read as a stray
 * extra and dropped, so "seven… no, five" scored correct when seven was the answer (either attempt counted).
 * Both directions on deterministic transcripts: wrong-then-right stays correct, right-then-wrong is now wrong.
 * Synthetic transcripts only: no real child, no names. The real scorer runs; nothing is mocked.
 */

const { wordsFromTokens } = require('../../shared/services/child-test/scoring/text-norm');
const { scoreNumbers, scoreQuickSums } = require('../../shared/services/child-test/scoring/maths-spoken');
const { scoreSpoken } = require('../../shared/services/child-test/scoring/maths');

// [speaker, startSec, text]: words in a line are 0.5 s apart (Soniox-style sub-word tokens).
function tokensFrom(script, gap = 0.5) {
  const tokens = [];
  for (const [speaker, start, text] of script) {
    String(text).split(/\s+/).filter(Boolean).forEach((w, k) => {
      const s = Math.round((start + k * gap) * 1000);
      tokens.push({ text: ` ${w}`, start_ms: s, end_ms: s + 300, speaker: String(speaker), language: 'ur' });
    });
  }
  return tokens;
}
const said = (script) => wordsFromTokens(tokensFrom(script));

describe('number identification: the last number said for an item counts (EGMA)', () => {
  const items = [{ id: 'n1', value: 3 }, { id: 'n2', value: 7 }, { id: 'n3', value: 9 }];

  test('wrong-then-right ("five… no, seven" for 7): correct, heard 7', () => {
    const r = scoreNumbers(said([[2, 4, 'تین'], [2, 8, 'پانچ نہیں سات'], [2, 14, 'نو']]), items);
    expect(r.map((x) => x.verdict)).toEqual(['correct', 'correct', 'correct']);
    expect(r[1].heard).toBe('7');
  });

  test('right-then-wrong ("seven… no, five" for 7): wrong, heard 5', () => {
    const r = scoreNumbers(said([[2, 4, 'تین'], [2, 8, 'سات نہیں پانچ'], [2, 14, 'نو']]), items);
    expect(r.map((x) => x.verdict)).toEqual(['correct', 'wrong', 'correct']);
    expect(r[1].heard).toBe('5');
  });

  test('right-then-wrong on the last item, no word between ("nine five"): wrong', () => {
    const r = scoreNumbers(said([[2, 4, 'تین'], [2, 8, 'سات'], [2, 14, 'نو پانچ']]), items);
    expect(r.map((x) => x.verdict)).toEqual(['correct', 'correct', 'wrong']);
    expect(r[2].heard).toBe('5');
  });

  test('a number said just before the next item belongs to that item, not to the one before', () => {
    // "seven" for 7, then (5 s later) "eight… nine" for 9: the 8 is the next item's first try, never 7's correction
    const r = scoreNumbers(said([[2, 4, 'تین'], [2, 8, 'سات'], [2, 13, 'آٹھ نو']]), items);
    expect(r.map((x) => x.verdict)).toEqual(['correct', 'correct', 'correct']);
  });

  test('the same number said twice stays correct', () => {
    const r = scoreNumbers(said([[2, 4, 'تین'], [2, 8, 'سات سات'], [2, 14, 'نو']]), items);
    expect(r.map((x) => x.verdict)).toEqual(['correct', 'correct', 'correct']);
  });
});

describe('quick sums: the last number said for a sum counts (EGMA)', () => {
  const items = [{ id: 'q1', prompt: '3 + 4', answer: 7 }, { id: 'q2', prompt: '2 + 4', answer: 6 }, { id: 'q3', prompt: '2 + 2', answer: 4 }];
  const nextReadAloud = [items[0], { id: 'q2', prompt: '5 + 1', answer: 6 }, items[2]];

  test('wrong-then-right ("three plus four, five… no, seven"): correct', () => {
    const r = scoreQuickSums(said([[2, 1, 'تین جمع چار پانچ نہیں سات'], [2, 8, 'چھ'], [2, 12, 'چار']]), items, { start: 0, end: 60 });
    expect(r.items.map((x) => x.verdict)).toEqual(['correct', 'correct', 'correct']);
    expect(r).toMatchObject({ correct: 3, attempted: 3 });
  });

  test('right-then-wrong ("three plus four, seven… no, five"): wrong, heard 5', () => {
    const r = scoreQuickSums(said([[2, 1, 'تین جمع چار سات نہیں پانچ'], [2, 8, 'چھ'], [2, 12, 'چار']]), items, { start: 0, end: 60 });
    expect(r.items.map((x) => x.verdict)).toEqual(['wrong', 'correct', 'correct']);
    expect(r.items[0].heard).toBe('5');
    expect(r).toMatchObject({ correct: 2, attempted: 3 });
  });

  test('right-then-wrong without the sum read aloud ("seven five" for 7): wrong', () => {
    const r = scoreQuickSums(said([[2, 1, 'سات پانچ'], [2, 8, 'چھ'], [2, 12, 'چار']]), items, { start: 0, end: 60 });
    expect(r.items.map((x) => x.verdict)).toEqual(['wrong', 'correct', 'correct']);
  });

  test('the next sum read aloud is never taken as a correction of the one before', () => {
    // 7 for 3+4; then the child starts the next sum by reading "five" (its first number) and answers six
    const r = scoreQuickSums(said([[2, 1, 'سات'], [2, 2.5, 'پانچ'], [2, 4, 'چھ'], [2, 8, 'چار']]), nextReadAloud, { start: 0, end: 60 });
    expect(r.items.map((x) => x.verdict)).toEqual(['correct', 'correct', 'correct']);
  });
});

describe('the coach-recorded block runs it end to end (scoreSpoken)', () => {
  const spec = { numbers: [{ id: 'n1', value: 3 }, { id: 'n2', value: 7 }], quick_sums: [{ id: 'q1', prompt: '3 + 4', answer: 7 }] };
  const cut = { coachSpeaker: '1', windows: { numbers: { start: 0, end: 20 }, quick_sums: { start: 20, end: 80 } } };

  test('right-then-wrong in both sections: both wrong; wrong-then-right: both correct', () => {
    const rtw = scoreSpoken({ spec, cut, words: said([[1, 1, 'یہ نمبر پڑھیں'], [2, 4, 'تین'], [2, 8, 'سات نہیں پانچ'], [1, 20, 'شروع'], [2, 22, 'سات نہیں پانچ']]) });
    expect(rtw.numbers.map((x) => x.verdict)).toEqual(['correct', 'wrong']);
    expect(rtw.quick_sums).toMatchObject({ correct: 0, attempted: 1 });
    const wtr = scoreSpoken({ spec, cut, words: said([[1, 1, 'یہ نمبر پڑھیں'], [2, 4, 'تین'], [2, 8, 'پانچ نہیں سات'], [1, 20, 'شروع'], [2, 22, 'پانچ نہیں سات']]) });
    expect(wtr.numbers.map((x) => x.verdict)).toEqual(['correct', 'correct']);
    expect(wtr.quick_sums).toMatchObject({ correct: 1, attempted: 1 });
  });
});
